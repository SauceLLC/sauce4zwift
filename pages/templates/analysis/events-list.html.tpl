<header>
    <ms>event</ms>
    <div class="title">Events</div>
    <div class="expander" data-id="compress" title="Collapse section"><ms>compress</ms></div>
    <div class="expander" data-id="expand" title="Expand section"><ms>expand</ms></div>
</header>

<% const hasEvents = !!(obj.eventSlices && eventSlices.length); %>
<table class="events-list basic {{hasEvents ? 'selectable' : ''}}">
    <thead>
        <tr>
            <th>Event</th>
            <th>Time</th>
            <th>Distance</th>
            <th>Power</th>
            <th>Pace</th>
            <th>HR</th>
            <th title="Time spent in a Coffee break"><ms>coffee</ms></th>
        </tr>
    </thead>
    <tbody>
        <% if (hasEvents) { %>
            <% const ordered = settings.reverseLapsAndSegments ? eventSlices.toReversed() : eventSlices; %>
            <% for (const x of ordered) { %>
                <% if (!x.endIndex) continue; /* reset data, not moving */ %>
                <% const index = eventSlices.indexOf(x); %>
                <tr class="summary {{index === selected ? 'selected' : ''}}"
                    title="{{x.event?.name || 'Unknown Event'}}"
                    data-index="{{index}}" data-source="events">
                    <td class="num">{{x.event?.name || index + 1}}</td>
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
                <td colspan="7"><small>No Events Data</small></td>
            </tr>
        <% } %>
    </tbody>
</table>
