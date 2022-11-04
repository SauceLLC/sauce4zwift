<div class="more-stats">
    <div class="stats">
        <key>Max power:</key><value>{-humanPower(lap.stats.power.max, {suffix: true, html: true})-}</value>
        <key>Draft avg:</key><value>{-humanNumber(lap.stats.draft.avg / 100, {html: true, suffix: '%'})-}</value>
        <key>Cadence:</key><value>{-humanNumber(lap.stats.cadence.avg, {html: true, suffix: lap.sport === 'running' ? 'spm' : 'rpm'})-}</value>
    </div>
</div>
<div class="chart-holder">
    <div class="chart"></div>
    <div class="legend horizontal"></div>
</div>
