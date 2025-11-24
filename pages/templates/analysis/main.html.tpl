<header class="overview">{-embed(templates.overview, obj)-}</header>

<nav>
    <section class="peak-efforts"></section>

    <section>
        <header>Time in Zones</header>
        <div class="echarts-chart time-in-power-zones"></div>
    </section>

    <section>
        <header>Pack Time</header>
        <div class="echarts-chart pack-time"></div>
    </section>
</nav>

<main>
    <section class="events-holder constrain-height">{-embed(templates.eventsList, obj)-}</section>

    <section class="analysis">
        <div class="world" id="world-map-title"></div>
        <div id="map-wrap">
            <div id="map-holder"></div>
            <div id="elevation-chart"></div>
            <div id="map-resizer"><ms>drag_handle</ms></div>
        </div>
        <div class="selection-stats"></div>
        <div class="chart-holder stream-stack">
            <div class="chart"></div>
            <div class="stream-stats">
                <div class="stat" data-id="power"></div>
                <div class="stat" data-id="hr"></div>
                <div class="stat" data-id="speed"></div>
                <div class="stat" data-id="cadence"></div>
                <div class="stat" data-id="wbal"></div>
                <div class="stat" data-id="draft"></div>
            </div>
        </div>
    </section>

    <section class="segments-holder constrain-height">{-embed(templates.segmentsList, obj)-}</section>
    <section class="laps-holder constrain-height">{-embed(templates.lapsList, obj)-}</section>
</main>
