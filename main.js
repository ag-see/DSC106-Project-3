import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";

// Data pull
const [australia, fires2019, fires2020] = await Promise.all([
    d3.json("data/australia.geojson"),
    d3.csv("data/modis_2019.csv"),
    d3.csv("data/modis_2020.csv")
]);

// Map dimensions and projection (defined first so points can be projected once)
const width = 800;
const height = 600;

const projection = d3.geoMercator()
    .fitSize([width, height], australia);

const path = d3.geoPath(projection);

// Fire data preprocessing
function prepareFires(data, year) {
    return data.map(d => {
        const LATITUDE = +d.LATITUDE;
        const LONGITUDE = +d.LONGITUDE;
        const [x, y] = projection([LONGITUDE, LATITUDE]) ?? [NaN, NaN];
        return {
            ...d,
            YEAR: year,
            LATITUDE,
            LONGITUDE,
            FRP: +d.FRP,
            MONTH: Number(d.ACQ_DATE?.slice(5, 7)),
            x,
            y
        };
    }).filter(d =>
        Number.isFinite(d.x) &&
        Number.isFinite(d.y) &&
        d.MONTH >= 1 &&
        d.MONTH <= 12
    );
}

const data2019 = prepareFires(fires2019, 2019);
const data2020 = prepareFires(fires2020, 2020);
const allFires = [...data2019, ...data2020];

// Shared FRP scales (computed once across both years)
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
    .text(`Color and size are capped at the 95th percentile of FRP across both years (${frpCap.toFixed(1)} MW). More transparent points are lower-confidence detections.`);

// Legend gradient, built from the same color scale as the points
const stops = d3.range(0, 1.01, 0.1)
    .map(t => colorScale(t * frpCap))
    .join(", ");

d3.select(".legend-gradient")
    .style("background", `linear-gradient(to right, ${stops})`);

// Make map
function createMap(id) {
    const svg = d3.select(id)
        .attr("viewBox", `0 0 ${width} ${height}`)
        .attr("preserveAspectRatio", "xMidYMid meet");

    svg.selectAll(".land")
        .data([australia])
        .join("path")
        .attr("class", "land")
        .attr("d", path);

    return svg.append("g")
        .attr("class", "fire-layer");
}

const fireLayer2019 = createMap("#fire-map-2019");
const fireLayer2020 = createMap("#fire-map-2020");

// Tooltip
const tooltip = d3.select("#tooltip");

function positionTooltip(event) {
    const node = tooltip.node();
    const pad = 12;
    let left = event.clientX + pad;
    let top = event.clientY + pad;

    // Flip to the other side if it would run off the window
    if (left + node.offsetWidth > window.innerWidth) {
        left = event.clientX - node.offsetWidth - pad;
    }
    if (top + node.offsetHeight > window.innerHeight) {
        top = event.clientY - node.offsetHeight - pad;
    }

    tooltip
        .style("left", `${left}px`)
        .style("top", `${top}px`);
}

// Draw fire detections
function drawFires(layer, fires) {
    // Draw low FRP first so the most intense fires sit on top
    const sorted = fires
        .slice()
        .sort((a, b) => d3.ascending(a.FRP, b.FRP));

    layer.selectAll("circle")
        .data(sorted)
        .join("circle")
        .attr("class", "fire")
        .attr("cx", d => d.x)
        .attr("cy", d => d.y)
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
            d3.select(this).classed("hovered", true).raise();
            tooltip
                .style("display", "block")
                .html(`
                    <strong>Year:</strong> ${d.YEAR}<br>
                    <strong>Date:</strong> ${d.ACQ_DATE ?? "N/A"}<br>
                    <strong>FRP:</strong> ${Number.isFinite(d.FRP) ? d.FRP.toFixed(2) + " MW" : "N/A"}<br>
                    <strong>Confidence:</strong> ${d.CONFIDENCE ?? "N/A"}
                `);
            positionTooltip(event);
        })
        .on("mousemove", positionTooltip)
        .on("mouseout", function() {
            d3.select(this).classed("hovered", false);
            tooltip.style("display", "none");
        });
}

// Calculate median FRP
const medianFRP = fires =>
    d3.median(
        fires.filter(d => Number.isFinite(d.FRP) && d.FRP >= 0),
        d => d.FRP
    );

function statCard(label, count, median) {
    return `
        <div class="stat-card">
            <div class="stat-label">${label}</div>
            <div class="stat-value">${count.toLocaleString()}</div>
            <div class="stat-sub">detections</div>
            <div class="stat-sub">Median FRP: <strong>${median?.toFixed(2) ?? "N/A"} MW</strong></div>
        </div>
    `;
}

// Called on year and month changes to update the maps
function updateMap(selection, month) {
    const fires2019Month = data2019.filter(d => d.MONTH === month);
    const fires2020Month = data2020.filter(d => d.MONTH === month);

    // Show or hide map panels
    d3.select("#map-2019")
        .style("display", selection === "2020" ? "none" : "block");

    d3.select("#map-2020")
        .style("display", selection === "2019" ? "none" : "block");

    // Let a single map use the full width
    d3.select("#map-container")
        .classed("single", selection !== "both");

    const cards = [];

    if (selection !== "2020") {
        drawFires(fireLayer2019, fires2019Month);
        cards.push(statCard("2019", fires2019Month.length, medianFRP(fires2019Month)));
    }

    if (selection !== "2019") {
        drawFires(fireLayer2020, fires2020Month);
        cards.push(statCard("2020", fires2020Month.length, medianFRP(fires2020Month)));
    }

    d3.select("#stats").html(cards.join(""));
}

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

    // Screen readers announce the month name instead of a number
    monthSlider.attr("aria-valuetext", monthNames[month - 1]);

    updateMap(year, month);
}

// Event listeners
monthSlider.on("input", refreshMap);
yearSelector.on("change", refreshMap);

// Initial display
refreshMap();
