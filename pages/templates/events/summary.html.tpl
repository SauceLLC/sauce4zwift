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
    <% if (event.sameRouteName && event.route?.name) { %>
        <td class="route" title="Event route: {{event.route?.name}}"><ms>route</ms> {{event.route?.name}}</td>
    <% } else { %>
        <td class="route">-</td>
    <% } %>
    <% if (event.durations.length) { %>
        <% if (event.durations.length > 1) { %>
            <td>{-humanDuration(event.durations[0], {html: true, short: true})-} - {-humanDuration(event.durations.at(-1), {html: true, short: false})-}</td>
        <% } else { %>
            <td>{-humanDuration(event.durations[0], {html: true})-}</td>
        <% } %>
    <% } else if (event.distances.length) { %>
        <% if (event.distances.length > 1) { %>
            <td>{-humanDistance(event.distances[0])-} - {-humanDistance(event.distances.at(-1), {suffix: true, html: true})-}</td>
        <% } else { %>
            <td>{-humanDistance(event.distances[0], {suffix: true, html: true})-}</td>
        <% } %>
    <% } else { %>
        {{console.warn("Event duration/distance bug:", event)}}
        <td>-</td>
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
