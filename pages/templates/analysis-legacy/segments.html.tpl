<% const hasSegments = !!(segments && segments.length); %>
<table class="segments expandable {{hasSegments ? 'selectable' : ''}}">
    <thead>
        <tr>
            <th>Segment</th>
            <th>Time</th>
            <th>Distance</th>
            <th>Power</th>
            <th>Pace</th>
            <th>HR</th>
        </tr>
    </thead>
    <tbody>
        <% if (hasSegments) { %>
            <% for (const [i, x] of segments.entries()) { %>
                <tr class="summary" data-segment-index="{{i}}">
                    <td class="name">{{x.segment.friendlyName || x.segment.name}}</td>
                    <td>{-humanTimer(x.stats.elapsedTime, {long: true, ms: true, html: true})-}</td>
                    <td>{-humanDistance(x.segment.distance, {suffix: true, html: true})-}</td>
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
                <tr class="details"><td colspan="6"></td></tr>
            <% } %>
        <% } else { %>
            <tr>
                <td colspan="6">No Segment Data</td>
            </tr>
        <% } %>
    </tbody>
</table>
