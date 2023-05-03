<table class="laps">
    <thead>
        <tr>
            <th></th>
            <th>Start</th>
            <th>Time</th>
            <th>Distance</th>
            <th>Power</th>
            <th>Pace</th>
            <th>HR</th>
        </tr>
    </thead>
    <tbody>
        <% if (laps && laps.length) { %>
            <% for (const [i, lap] of laps.entries()) { %>
                <tr class="summary" data-lap="{{i}}">
                    <td class="num">{{i+1}}</td>
                    <td class="start">{-humanTimer(streams.time[lap.startIndex], {long: true})-}</td>
                    <td>{-humanTimer(lap.stats.activeTime, {long: true})-}</td>
                    <td>{-humanDistance(streams.distance[lap.endIndex + 1] - streams.distance[lap.startIndex], {suffix: true, html: true})-}</td>
                    <% if (settings.preferWkg && athleteData.athlete?.weight) { %>
                        <td title="{{humanPower(lap.stats.power.avg, {suffix: true})}}"
                            >{-humanWkg(lap.stats.power.avg / athleteData.athlete?.weight, {suffix: true, html: true})-}</td>
                    <% } else { %>
                        <td title="{{athleteData.athlete?.weight ? humanWkg(lap.stats.power.avg / athleteData.athlete?.weight, {suffix: true}) : ''}}"
                            >{-humanPower(lap.stats.power.avg, {suffix: true, html: true})-}</td>
                    <% } %>
                    <td>{-humanPace(lap.stats.speed.avg, {suffix: true, html: true, sport: lap.sport})-}</td>
                    <td>{-humanNumber(lap.stats.hr.avg, {suffix: 'bpm', html: true})-}</td>
                </tr>
            <% } %>
        <% } else { %>
            <tr>
                <td colspan="7">No Lap Data</td>
            </tr>
        <% } %>
    </tbody>
</table>
