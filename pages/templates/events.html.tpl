<table class="events expandable">
    <thead>
        <tr>
            <th>Start</th>
            <th>Type</th>
            <th class="name">Name</th>
            <th>Length</th>
            <th>Groups</th>
            <th>Entrants</th>
        </tr>
    </thead>
    <tbody>
        <% for (const event of events) { %>
            <tr class="summary {{event.started ? 'started' : ''}}"
                data-event-id="{{event.id}}">
                <td class="start">{{humanTime(event.ts)}}</td>
                <td class="type">{{event.type.replace(/EVENT_TYPE_/, '').replace(/_/, ' ')}}</td>
                <td class="name">{{event.name}}</td>
                <% if (event.durationInSeconds) { %>
                    <td>{-humanDuration(event.durationInSeconds, {suffix: true, html: true})-}</td>
                <% } else { %>
                    <td>{-humanDistance(event.distanceInMeters || event.routeDistance, {suffix: true, html: true})-}</td>
                <% } %>
                <td class="groups">{-event.eventSubgroups.map(x => eventBadge(x.subgroupLabel)).join('')-}</td>
                <td>{{event.totalEntrantCount}}</td>
            </tr>
            <tr class="details">
                <td colspan="6"><div class="container"></div></td>
            </tr>
        <% } %>
    </tbody>
</table>
