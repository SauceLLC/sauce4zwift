<% const stats = ad?.stats || {}; %>
<div class="selection-stats">
    <div class="stats key-value-grid">
        <key>Power avg:</key><value>{-humanPower(stats.power?.avg, {suffix: true, html: true})-}
            | {-humanWkg(stats.power?.avg / ad?.athlete?.weight, {suffix: true, html: true})-}</value>
        <key>Power max:</key><value>{-humanPower(stats.power?.max, {suffix: true, html: true})-}
            | {-humanWkg(stats.power?.max / ad?.athlete?.weight, {suffix: true, html: true})-}</value>
        <key>Distance:</key><value>{-humanDistance(ad?.state?.distance, {suffix: true, html: true})-}</value>
        <key>Speed avg:</key><value>{-humanPace(stats.speed?.avg, {suffix: true, html: true, sport: ad?.state?.sport})-}</value>
        <key>HR avg:</key><value>{-humanNumber(stats.hr?.avg, {suffix: 'bpm', html: true})-}</value>
    </div>
    <div class="stats key-value-grid">
        <key>Active:</key><value>{{humanTimer(stats.activeTime)}}</value>
        <key>Elapsed:</key><value>{{humanTimer(stats.elapsedTime)}}</value>
    </div>
</div>
