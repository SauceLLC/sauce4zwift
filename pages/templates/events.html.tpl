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
    <thead class="loader" data-dir="prev"><tr><td colspan="6">Load More</td></tr></thead>
    <tbody class="events">
        <% for (const event of events) { %>
            <tr class="summary event-row {{event.ts < Date.now() ? 'started' : ''}}
                       {{event.eventSubgroups && event.eventSubgroups.some(x => x.signedUp) ? 'signedup' : ''}}"
                data-event-id="{{event.id}}">
                <td class="start">{{humanTime(event.eventStart, {style: 'date'})}}</td>
                <td class="type">
                    {{event.eventType.replace(/_/g, ' ')}}
                    {-event.sport === 'running' ? '<ms large title="Run">directions_run</ms>' : ''-}
                </td>
                <td class="name">{{event.name}}</td>
                <% if (event.durationInSeconds) { %>
                    <td>{-humanDuration(event.durationInSeconds, {suffix: true, html: true})-}</td>
                <% } else { %>
                    <td>{-humanDistance(event.distanceInMeters || event.routeDistance, {suffix: true, html: true})-}</td>
                <% } %>
                <td class="groups">
                    <% if (event.eventSubgroups) { %>
                        {-event.eventSubgroups.map(x => eventBadge(x.subgroupLabel)).join('')-}
                        <% if (event.cullingType === 'CULLING_EVENT_ONLY') { %>
                            <ms large title="Only event participants are visible">group_work</ms>
                        <% } else if (event.cullingType === 'CULLING_SUBGROUP_ONLY') { %>
                            <ms large title="Only event sub-group participants are visible">workspaces</ms>
                        <% } %>
                    <% } %>
                </td>
                <td>
                    {{event.totalEntrantCount}}<% if (event.followeeEntrantCount) { %>,
                        <span title="People your follow"><ms small>follow_the_signs</ms> {{event.followeeEntrantCount}}</span>
                    <% } %>
                </td>
            </tr>
            <tr class="details" data-event-id="{{event.id}}"><td colspan="6"></td></tr>
        <% } %>
    </tbody>
    <tfoot class="loader" data-dir="next"><tr><td colspan="6">Load More</td></tr></tfoot>
</table>
