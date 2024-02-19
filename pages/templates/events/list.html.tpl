<table class="events expandable">
    <thead>
        <tr>
            <th>Start</th>
            <th>Type</th>
            <th class="name">Name</th>
            <th>Route</th>
            <th>Length</th>
            <th title="Climbing elevation gain"><ms>landscape</ms></th>
            <th>Groups</th>
            <th>Entrants</th>
        </tr>
    </thead>
    <thead class="loader" data-dir="prev"><tr><td colspan="7">Load More</td></tr></thead>
    <tbody class="events">
        <% for (const event of events) { %>
            {-embed(templates.eventsSummary, {event, eventBadge})-}
            <tr class="details" data-event-id="{{event.id}}"><td colspan="7"></td></tr>
        <% } %>
    </tbody>
    <tfoot class="loader" data-dir="next"><tr><td colspan="7">Load More</td></tr></tfoot>
</table>
