<% const started = event.ts < Date.now(); %>
<% const joinable = event.ts + ((event.lateJoinInMinutes || 0) * 60 * 1000) - Date.now(); %>
<tr class="summary event-row
           {{started ? 'started' : ''}}
           {{joinable > 0 ? 'joinable' : ''}}
           {{event.signedUp ? 'signedup' : ''}}"
    data-event-id="{{event.id}}">
    <td class="start"
        <% if (event.lateJoinInMinutes && joinable > 0) { %>
            title="Can late join until {{humanTime(event.ts + ((event.lateJoinInMinutes || 0) * 60 * 1000))}}"
        <% } %>>
        {{humanTime(event.eventStart, {style: 'date'})}}
        <% if (event.lateJoinInMinutes) { %>
            <ms title="Allows joining late">acute</ms>
        <% } %>
    </td>
    <td class="type">
        {{event.eventType.replace(/_/g, ' ')}}
        {-event.sport === 'running' ? '<ms large title="Run">directions_run</ms>' : ''-}
    </td>
    <td class="name">{{event.name}}</td>
    <td><% if (event.sameRoute) { %>
            {{event.route.name}}
        <% } else { %>
            <% const uRoutes = new Set(event.eventSubgroups ? event.eventSubgroups.map(x => x.route.name) : [event.route.name]); %>
            {{Array.from(uRoutes).join(', ')}}
        <% } %>
    </td>
    <% if (event.durationInSeconds) { %>
        <td>{-humanDuration(event.durationInSeconds, {suffix: true, html: true})-}</td>
    <% } else { %>
        <td>{-humanDistance(event.distanceInMeters || event.routeDistance, {suffix: true, html: true})-}</td>
    <% } %>
    <td title="Climbing elevation gain">{-humanElevation(event.routeClimbing, {suffix: true, html: true})-}</td>
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
