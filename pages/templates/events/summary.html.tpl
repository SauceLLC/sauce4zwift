<% const started = event.ts < Date.now(); %>
<% const joinable = event.ts + ((event.lateJoinInMinutes || 0) * 60 * 1000) - Date.now(); %>
<tr class="summary event-row" data-event-id="{{event.id}}">
    <td class="start" data-late-join-tooltip="Can late join until {{humanTime(event.ts + ((event.lateJoinInMinutes || 0) * 60 * 1000))}}">
        {-humanDateTime(event.eventStart, {html: true, concise: true, style: 'short', today_style: 'short'})-}
        <% if (event.lateJoinInMinutes) { %>
            <ms title="Allows joining late">acute</ms>
        <% } %>
    </td>
    <td class="type">
        {{event.prettyTypeShort}}
        <% if (event.sport === 'running') { %>
            <ms title="Run">directions_run</ms>
        <% } %>
    </td>
    <td class="name" title="{{event.name}}">{{event.name}}</td>
    <% if (event.sameRouteName && event.route?.name) { %>
        <td class="route" title="Event route: {{event.route?.name}}"><ms>route</ms> {{event.route?.name}}</td>
    <% } else { %>
        <td class="route" title="Multiple routes">...</td>
    <% } %>
    <td>
        <% if (event.durations.length) { %>
            <% const fmt = (x, opts) => humanDuration(x, {html: true, separator: ' ', short: true, ...opts}); %>
            <% if (event.durations.length > 1) { %>
                {-fmt(event.durations[0])-}...{-fmt(event.durations.at(-1))-}{{event.durations.length ? ',' : ''}}
            <% } else { %>
                {-fmt(event.durations[0], {short: !!event.distances.length})-}{{event.distances.length ? ',' : ''}}
            <% } %>
        <% } %>
        <% if (event.distances.length) { %>
            <% const fmt = (x, opts) => humanDistance(x, {html: true, precision: 0, suffix: true, ...opts}); %>
            <% if (event.distances.length > 1) { %>
                {-fmt(event.distances[0], {suffix: false})-}...{-fmt(event.distances.at(-1))-}
            <% } else { %>
                {-fmt(event.distances[0])-}
            <% } %>
        <% } else if (!event.durations.length) { %>
            <b>?</b>{{console.warn("Event duration/distance bug:", event)}}
        <% } %>
    </td>
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
