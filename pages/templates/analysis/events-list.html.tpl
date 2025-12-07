<% const hasEvents = !!(obj.slices && slices.length); %>
<% if (hasEvents) { %>
    <header>
        <ms>event</ms>
        <div class="title">Events</div>
        <div class="expander" data-id="compress" title="Collapse section"><ms>compress</ms></div>
        <div class="expander" data-id="expand" title="Expand section"><ms>expand</ms></div>
    </header>

    <article class="overflow">
        <table data-source="events"
               class="events-list basic expandable {{hasEvents ? 'selectable' : ''}}">
            <thead>
                <tr>
                    <th style="min-width: 10ch;"></th>
                    <th>Place</th>
                    <th>Time</th>
                    <th>Dist</th>
                    <th>Power</th>
                    <th>Pace</th>
                    <th>HR</th>
                    <th>Pack</th>
                </tr>
            </thead>
            <tbody>
                <% const ordered = settings.reverseLapsAndSegments ? slices.toReversed() : slices; %>
                <% if (hasEvents) { %>
                    <% for (const x of ordered) { %>
                        <% if (!x.endIndex) continue; /* reset data, not moving */ %>
                        <% const index = slices.indexOf(x); %>
                        <tr class="summary {{index === selectedIndex ? 'selected expanded' : ''}} {{x.active ? 'active' : ''}}"
                            title="{{x.eventSubgroup?.name || 'Unknown Event'}}" data-index="{{index}}">
                            <td class="name long">{{x.eventSubgroup?.name || index + 1}}</td>
                            <td class="place">{-humanPlace(x.place, {suffix: true, html: true})-}</td>
                            <td>{-humanTimer(x.stats.activeTime, {long: true, ms: true, html: true})-}</td>
                            <td>
                                <% const dist = streams.distance[x.endIndex] - streams.distance[Math.max(0, x.startIndex - 1)]; %>
                                <% if (x.eventSubgroup.endDistance) { %>
                                    {-humanDistance(dist, {suffix: true, html: true})-}<small> /
                                        {-humanDistance(x.eventSubgroup.endDistance, {suffix: true, html: true})-}</small>
                                <% } else { %>
                                    {-humanDistance(dist, {suffix: true, html: true})-}
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
                            <td>{-fields.fmtPackTime(x.stats)-}</td>
                        </tr>
                        <tr class="details">
                            <td colspan="8">
                                <% if (index === selectedIndex) { %>
                                    {-embed(templates.eventExpanded, obj)-}
                                <% } %>
                            </td>
                        </tr>
                    <% } %>
                <% } %>
            </tbody>
        </table>
    </article>
<% } %>
