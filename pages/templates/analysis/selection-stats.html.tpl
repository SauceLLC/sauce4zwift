<div class="selection-stats">
    <% if (!selectionStats) { %>
        Loading
    <% } else { %>
        <% const {athlete, power, env, el, hr, sport} = selectionStats; %>
        <div class="stats key-value-grid">
            <key>Active:</key><value>{{humanTimer(selectionStats.activeTime)}}</value>
            <key>Elapsed:</key><value>{{humanTimer(selectionStats.elapsedTime)}}</value>
            <key>Speed:</key><value>{-humanPace(env.speed, {suffix: true, html: true, sport})-}</value>
            <key>Distance:</key><value>{-humanDistance(env.distance, {suffix: true, html: true})-}</value>
        </div>

        <div class="stats key-value-grid">
            <key>Power:</key><value>{-humanPower(power.avg, {suffix: true, html: true})-}
                | {-humanWkg(power.avg / athlete?.weight, {suffix: true, fixed: true, html: true})-}</value>
            <key>Max:</key><value>{-humanPower(power.max, {suffix: true, html: true})-}
                | {-humanWkg(power.max / athlete?.weight, {suffix: true, fixed: true, html: true})-}</value>
            <key>NP®:</key><value>{-humanPower(power.np, {suffix: true, html: true})-}</value>
        </div>

        <div class="stats key-value-grid">
            <key>Energy:</key><value>{-humanNumber(power.kj, {suffix: 'kJ', html: true})-}</value>
            <key>TSS®:</key><value>{-humanNumber(power.tss)-}</value>
        </div>

        <% if (power.hr) { %>
            <div class="stats key-value-grid">
                <key>HR:</key><value>{-humanNumber(hr.avg, {suffix: 'bpm', html: true})-}</value>
                <key>Max:</key><value>{-humanNumber(hr.max, {suffix: 'bpm', html: true})-}</value>
            </div>
        <% } %>

        <div class="stats key-value-grid">
            <key>Grade:</key><value>{-humanNumber(el.grade * 100, {suffix: '%', html: true})-}</value>
            <key>Gain:</key><value class="positive">{-humanElevation(el.gain, {suffix: true, html: true})-}</value>
            <key>Loss:</key><value class="negative">{-humanElevation(el.loss, {suffix: true, html: true})-}</value>
            <key>VAM:</key><value>{-humanNumber(el.vam)-}</value>
        </div>

        <% if (power.rank) { %>
            <div class="stats key-value-grid">
                <key>Rank:</key><value>{{humanNumber(power.rank.level * 100)}}</value>
                <key>Cat:</key><value>{{humanNumber(power.rank.catLevel)}}</value>
            </div>
        <% } %>
    <% } %>
</div>
