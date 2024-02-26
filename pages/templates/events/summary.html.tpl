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
    <% const prettyType = event.eventType.replace(/_/g, ' ').replace(/GROUP WORKOUT/, 'WORKOUT') %>
    <td class="type">
        <% if (event.sport === 'running') { %>
            {{prettyType.replace(/RIDE/, 'RUN')}}
            <ms title="Run">directions_run</ms>
        <% } else { %>
            {{prettyType}}
        <% } %>
    </td>
    <td class="name" title="{{event.name}}">{{event.name}}</td>
    <% if (event.sameRoute && event.route?.name) { %>
        <td class="route" title="Event route: {{event.route?.name}}"><ms>route</ms> {{event.route?.name}}</td>
    <% } else { %>
        <td class="route">-</td>
    <% } %>
    <% if (event.durationInSeconds) { %>
        <td>{-humanDuration(event.durationInSeconds, {suffix: true, html: true, short: true})-}</td>
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
    <td class="count">
        {{event.totalEntrantCount}}<% if (event.followeeEntrantCount) { %>,
            <span title="People your follow"><ms small>follow_the_signs</ms> {{event.followeeEntrantCount}}</span>
        <% } %>
    </td>
</tr>
