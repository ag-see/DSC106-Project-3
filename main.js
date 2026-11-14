
import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";

// Data pull
const [australia, fires2019, fires2020] = await Promise.all([
    d3.json("data/australia.geojson"),
    d3.csv("data/modis_2019.csv"),
    d3.csv("data/modis_2020.csv")
]); 

// Fire data preprocessing
function prepareFires(data, year) {
    return data.map(d => ({
        ...d,
        YEAR: year,
        LATITUDE: +d.LATITUDE,
        LONGITUDE: +d.LONGITUDE,
        FRP: +d.FRP,
        MONTH: Number(d.ACQ_DATE?.slice(5, 7))
    })).filter(d =>
        Number.isFinite(d.LATITUDE) &&
        Number.isFinite(d.LONGITUDE) &&
        d.MONTH >= 1 &&
        d.MONTH <= 12
    );
}

const data2019 = prepareFires(fires2019, 2019);
const data2020 = prepareFires(fires2020, 2020);
const allFires = [...data2019, ...data2020];

// Shared FRP scales
const frpValues = allFires
    .map(d => d.FRP)
    .filter(d => Number.isFinite(d) && d >= 0)
    .sort(d3.ascending);

const frpCap = d3.quantile(frpValues, 0.95) ?? 1;

// FRP -> Color
const colorScale = d3.scaleSequential(d3.interpolateYlOrRd)
    .domain([0, frpCap])
    .clamp(true);

// FRP -> Circle radius
const radiusScale = d3.scaleSqrt()
    .domain([0, frpCap])
    .range([1, 6])
    .clamp(true);

// Confidence -> Opacity
const opacityScale = d3.scaleLinear()
    .domain([0, 100])
    .range([0.15, 0.9])
    .clamp(true);

d3.select("#frp-cap")
    .text(`Color and size scales capped at the 95th percentile (${frpCap.toFixed(1)} MW).`);// Map dimensions and projection
const width = 800;
const height = 600;

const projection = d3.geoMercator()
    .fitSize([width, height], australia);

const path = d3.geoPath(projection);

// MAke map
function createMap(id) {
    const svg = d3.select(id)
        .attr("viewBox", `0 0 ${width} ${height}`)
        .attr("preserveAspectRatio", "xMidYMid meet");

    svg.selectAll(".land")
    .data([australia])
    .join("path")
        .attr("class", "land")
        .attr("d", path)
        .attr("fill", "#e5e5e5")
        .attr("stroke", "#333");

    return svg.append("g")
        .attr("class", "fire-layer");
}

const fireLayer2019 = createMap("#fire-map-2019");
const fireLayer2020 = createMap("#fire-map-2020");

// Tooltip
const tooltip = d3.select("#tooltip");

// Draw fire detections
function drawFires(layer, fires) {
    layer.selectAll("circle")
        .data(fires)
        .join("circle")
        .attr("class", "fire")
        .attr("cx", d => projection([
            d.LONGITUDE,
            d.LATITUDE
        ])[0])
        .attr("cy", d => projection([
            d.LONGITUDE,
            d.LATITUDE
        ])[1])
        .attr("r", d =>
            Number.isFinite(d.FRP) ? radiusScale(d.FRP) : 1
        )
        .attr("fill", d =>
            Number.isFinite(d.FRP) ? colorScale(d.FRP) : "#999"
        )
        .attr("opacity", d =>
            Number.isFinite(+d.CONFIDENCE)
                ? opacityScale(+d.CONFIDENCE)
                : 0.3
        )
        .on("mouseover", function(event, d) {
            tooltip
                .style("display", "block")
                .html(`
                    <strong>Year:</strong> ${d.YEAR}<br>
                    <strong>Date:</strong> ${d.ACQ_DATE ?? "N/A"}<br>
                    <strong>FRP:</strong> ${Number.isFinite(d.FRP) ? d.FRP.toFixed(2) + " MW" : "N/A"}<br>
                    <strong>Confidence:</strong> ${d.CONFIDENCE ?? "N/A"}
                `);
        })
        .on("mousemove", function(event) {
            tooltip
                .style("left", `${event.pageX + 12}px`)
                .style("top", `${event.pageY + 12}px`);
        })
        .on("mouseout", function() {
            tooltip.style("display", "none");
        });
}

// Call on year and month slider to update d3 
function updateMap(selection, month) {
    const fires2019Month = data2019.filter(
        d => d.MONTH === month
    );

    const fires2020Month = data2020.filter(
        d => d.MONTH === month
    );

    // Show or hide map panels
    d3.select("#map-2019")
        .style("display", selection === "2020" ? "none" : "block");

    d3.select("#map-2020")
        .style("display", selection === "2019" ? "none" : "block");

    if (selection === "both") {
        drawFires(fireLayer2019, fires2019Month);
        drawFires(fireLayer2020, fires2020Month);

        d3.select("#fire-count").text(
            `2019: ${fires2019Month.length.toLocaleString()} detections | ` +
            `2020: ${fires2020Month.length.toLocaleString()} detections`
        );
    } else if (selection === "2019") {
        drawFires(fireLayer2019, fires2019Month);

        d3.select("#fire-count").text(
            `2019: ${fires2019Month.length.toLocaleString()} detections`
        );
    } else {
        drawFires(fireLayer2020, fires2020Month);

        d3.select("#fire-count").text(
            `2020: ${fires2020Month.length.toLocaleString()} detections`
        );
    }
}

// Self explanatory
const monthNames = [
    "January", "February", "March", "April",
    "May", "June", "July", "August",
    "September", "October", "November", "December"
];

// UI controls
const monthSlider = d3.select("#month-slider");
const yearSelector = d3.select("#season-select");

function refreshMap() {
    const month = +monthSlider.property("value");
    const year = yearSelector.property("value");

    d3.select("#month-label")
        .text(monthNames[month - 1]);

    updateMap(year, month);
}

// Event listeners
monthSlider.on("input", refreshMap);
yearSelector.on("change", refreshMap);

// Initial display
refreshMap();
