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
            <% for (const [i, x] of laps.entries()) { %>
                <tr class="summary" data-lap="{{i}}">
                    <td class="num">{{i+1}} {{x.sport}} {{x.courseId}}</td>
                    <td class="start">{-humanTimer(streams.time[x.startIndex], {long: true})-}</td>
                    <td>{-humanTimer(x.stats.activeTime, {long: true})-}</td>
                    <td>{-humanDistance(streams.distance[x.endIndex + 1] - streams.distance[x.startIndex], {suffix: true, html: true})-}</td>
                    <% if (settings.preferWkg && athleteData.athlete?.weight) { %>
                        <td title="{{humanPower(x.stats.power.avg, {suffix: true})}}"
                            >{-humanWkg(x.stats.power.avg / athleteData.athlete?.weight, {suffix: true, html: true})-}</td>
                    <% } else { %>
                        <td title="{{athleteData.athlete?.weight ? humanWkg(x.stats.power.avg / athleteData.athlete?.weight, {suffix: true}) : ''}}"
                            >{-humanPower(x.stats.power.avg, {suffix: true, html: true})-}</td>
                    <% } %>
                    <td>{-humanPace(x.stats.speed.avg, {suffix: true, html: true, sport: x.sport})-}</td>
                    <td>{-humanNumber(x.stats.hr.avg, {suffix: 'bpm', html: true})-}</td>
                </tr>
            <% } %>
        <% } else { %>
            <tr>
                <td colspan="7">No Lap Data</td>
            </tr>
        <% } %>
    </tbody>
</table>
