<header>
    <ms>conversion_path</ms>
    <div class="title">Segments</div>
    <div class="expander" data-id="compress" title="Collapse section"><ms>compress</ms></div>
    <div class="expander" data-id="expand" title="Expand section"><ms>expand</ms></div>
</header>

<% const hasSegments = !!(obj.slices && slices.length); %>
<article class="overflow">
    <table data-source="segments"
           class="segments-list basic expandable {{hasSegments ? 'selectable' : ''}}">
        <thead>
            <tr>
                <% if (hasSegments) { %>
                    <th style="min-width: 8ch;"></th>
                    <th>Time</th>
                    <th>Dist</th>
                    <th>Power</th>
                    <th>Pace</th>
                    <th>HR</th>
                <% } else { %>
                    <th>&nbsp;</th>
                <% } %>
            </tr>
        </thead>
        <tbody>
            <% if (hasSegments) { %>
                <% const ordered = settings.reverseLapsAndSegments ? slices.toReversed() : slices; %>
                <% for (const x of ordered) { %>
                    <% const index = slices.indexOf(x); %>
                    <tr class="summary {{index === selectedIndex ? 'selected expanded' : ''}}
                               {{x.active ? 'active' : ''}}
                               {{x.incomplete ? 'incomplete' : ''}}"
                        <% if (x.eventSubgroupId) { %>data-event-subgroup-id="{{x.eventSubgroupId}}"<% } %>
                        data-index="{{index}}">
                        <td class="name long">
                            {{x.segment.friendlyName || x.segment.name}}
                            <% if (x.eventSubgroupId) { %><ms title="Event based segment">event</ms><% } %>
                        </td>
                        <td>{-humanTimer(x.stats.elapsedTime, {long: true, ms: true, html: true})-}</td>
                        <td>
                            <% const dist = streams.distance[x.endIndex] - streams.distance[Math.max(0, x.startIndex - 1)]; %>
                            <% if (x.active) { %>
                                {-humanDistance(dist, {suffix: true, html: true})-}<small> /
                                    {-humanDistance(x.segment.distance, {suffix: true, html: true})-}</small>
                            <% } else { %>
                                {-humanDistance(x.segment.distance, {suffix: true, html: true})-}
                            <% } %>
                        </td>
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
                            <% if (index === selectedIndex && obj.results) { %>
                                {-embed(templates.segmentResults, obj)-}
                            <% } %>
                        </td>
                    </tr>
                <% } %>
            <% } else { %>
                <tr>
                    <td><small>No Segment Data</small></td>
                </tr>
            <% } %>
        </tbody>
    </table>
</article>
