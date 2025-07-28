<header>
    <ms>conversion_path</ms>
    <div class="title">Segments</div>
    <div class="expander" data-id="compress" title="Collapse section"><ms>compress</ms></div>
    <div class="expander" data-id="expand" title="Expand section"><ms>expand</ms></div>
</header>
<% const hasSegments = !!(obj.segments && segments.length); %>
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
            <% const orderedSegments = settings.reverseLapsAndSegments ? segments.toReversed() : segments; %>
            <% for (const x of orderedSegments) { %>
                <% const index = segments.indexOf(x); %>
                <tr class="summary {{index === selected ? 'selected expanded' : ''}}" data-segment-index="{{index}}">
                    <td class="name">{{x.segment.friendlyName || x.segment.name}}</td>
                    <td>{-humanTimer(x.stats.elapsedTime, {long: true, ms: true, html: true})-}</td>
                    <td>{-humanDistance(x.segment.distance, {suffix: true, html: true})-}</td>
                    <% if (settings.preferWkg && athlete.weight) { %>
                        <td title="{{humanPower(x.stats.power.avg, {suffix: true})}}"
                            >{-humanWkg(x.stats.power.avg / athlete.weight, {suffix: true, html: true})-}</td>
                    <% } else { %>
                        <td title="{{athlete.weight ? humanWkg(x.stats.power.avg / athlete.weight, {suffix: true}) : ''}}"
                            >{-humanPower(x.stats.power.avg, {suffix: true, html: true})-}</td>
                    <% } %>
                    <td>{-humanPace(x.stats.speed.avg, {suffix: true, html: true, sport: x.sport})-}</td>
                    <td>{-humanNumber(x.stats.hr.avg, {suffix: 'bpm', html: true})-}</td>
                </tr>
                <tr class="details">
                    <td colspan="6">
                        <% if (index === selected && obj.results) { %>
                            {-embed(templates.segmentResults, obj)-}
                        <% } %>
                    </td>
                </tr>
            <% } %>
        <% } else { %>
            <tr>
                <td colspan="6">No Segment Data</td>
            </tr>
        <% } %>
    </tbody>
</table>
