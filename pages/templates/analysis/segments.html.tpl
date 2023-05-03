<table class="segments">
    <thead>
        <tr>
            <th></th>
            <th>Start</th>
            <th>Elapsed</th>
            <th>Distance</th>
            <th>Power</th>
            <th>Pace</th>
        </tr>
    </thead>
    <tbody>
        <% if (segments && segments.length) { %>
            <% for (const [i, segment] of segments.entries()) { %>
                <tr class="summary" data-segment="{{i}}">
                    <td class="name">{{segment.segment.friendlyName || segment.segment.name}}</td>
                    <td class="start">{-humanTimer(streams.time[segment.startIndex], {long: true})-}</td>
                    <td>{-humanTimer(segment.stats.elapsedTime, {long: true})-}</td>
                    <td>{-humanDistance(streams.distance[segment.endIndex + 1] - streams.distance[segment.startIndex], {suffix: true, html: true})-}</td>
                    <td>{-humanPower(segment.stats.power.avg, {suffix: true, html: true})-}</td>
                    <td>{-humanPace(segment.stats.speed.avg, {suffix: true, html: true, sport: segment.sport})-}</td>
                </tr>
            <% } %>
        <% } else { %>
            <tr>
                <td colspan="6">No Segment Data</td>
            </tr>
        <% } %>
    </tbody>
</table>
