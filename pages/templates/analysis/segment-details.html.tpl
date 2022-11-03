<div class="more-stats">
    <div class="stats">
        <key>Max power:</key><value>{-humanPower(segment.stats.power.max, {suffix: true, html: true})-}</value>
        <key>Draft avg:</key><value>{-humanNumber(segment.stats.draft.avg / 100, {html: true, suffix: '%'})-}</value>
        <key>Cadence:</key><value>{-humanNumber(segment.stats.cadence.avg, {html: true, suffix: segment.sport === 'running' ? 'spm' : 'rpm'})-}</value>
    </div>
</div>

<div class="chart-holder" tabindex="0">
    <div class="chart"></div>
    <div class="legend horizontal"></div>
</div>
