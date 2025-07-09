<% const hasLaps = !!(obj.laps && laps.length); %>
<table class="laps basic {{hasLaps ? 'selectable' : ''}}">
    <thead>
        <tr>
            <th>Lap</th>
            <th>Time</th>
            <th>Distance</th>
            <th>Power</th>
            <th>Pace</th>
            <th>HR</th>
            <th>Coffee</th>
        </tr>
    </thead>
    <tbody>
        <% if (hasLaps) { %>
            <% for (const [i, x] of laps.entries()) { %>
                <% if (!x.endIndex) continue; /* reset data, not moving */ %>
                <tr class="summary" data-lap-index="{{i}}">
                    <td class="num">{{i+1}}</td>
                    <td>{-humanTimer(x.stats.activeTime, {long: true, ms: true, html: true})-}</td>
                    <td>{-humanDistance(streams.distance[x.endIndex] - streams.distance[Math.max(0, x.startIndex - 1)], {suffix: true, html: true})-}</td>
                    <% if (settings.preferWkg && athlete.weight) { %>
                        <td title="{{humanPower(x.stats.power.avg, {suffix: true})}}"
                            >{-humanWkg(x.stats.power.avg / athlete.weight, {suffix: true, html: true})-}</td>
                    <% } else { %>
                        <td title="{{athlete.weight ? humanWkg(x.stats.power.avg / athlete.weight, {suffix: true}) : ''}}"
                            >{-humanPower(x.stats.power.avg, {suffix: true, html: true})-}</td>
                    <% } %>
                    <td>{-humanPace(x.stats.speed.avg, {suffix: true, html: true, sport: x.sport})-}</td>
                    <td>{-humanNumber(x.stats.hr.avg, {suffix: 'bpm', html: true})-}</td>
                    <td>{-humanTimer(x.stats.coffeeTime, {long: true, html: true})-}</td>
                </tr>
            <% } %>
        <% } else { %>
            <tr>
                <td colspan="6">No Lap Data</td>
            </tr>
        <% } %>
    </tbody>
</table>
