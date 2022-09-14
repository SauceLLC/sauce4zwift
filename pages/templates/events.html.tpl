<table class="events expandable">
    <thead>
        <tr>
            <th>ID</th>
            <th>Start</th>
            <th>Type</th>
            <th>Name</th>
            <th>Length</th>
            <th>Entrants</th>
        </tr>
    </thead>
    <tbody>
        <% for (const event of events) { %>
            <tr class="summary" data-event-id="{{event.id}}">
                <td>{{event.id}}</td>
                <td>{{humanTime(event.eventStart)}}</td>
                <td>{{event.type.replace(/EVENT_TYPE_/, '').replace(/_/, ' ')}}</td>
                <td>{{event.name}}</td>
                <% if (event.durationInSeconds) { %>
                    <td>{-humanDuration(event.durationInSeconds, {suffix: true, html: true})-}</td>
                <% } else { %>
                    <td>{-humanDistance(event.durationInMeters || event.routeDistance, {suffix: true, html: true})-}</td>
                <% } %>
                <td>{{event.totalEntrantCount}}</td>
            </tr>
            <tr class="details">
                <td colspan="6"><div class="container"></div></td>
            </tr>
        <% } %>
    </tbody>
</table>
