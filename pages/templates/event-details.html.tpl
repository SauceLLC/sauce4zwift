<div class="event-info">
    <div class="card">
        <img class="event-image" src="{{event.imageUrl}}"/>
        <div class="meta">
            <div title="Event World">{{world}} <ms>map</ms></div>
            <div title="Route">{{(event.laps && event.laps > 1) ? event.laps + ' x ' : ''}}{{route.name}} <ms>route</ms></div>
            <div title="Climbing">{-humanElevation(event.routeClimbing, {suffix: true, html: true})-} <ms>landscape</ms></div>
            <div title="View event on Zwift Power"><a href="https://zwiftpower.com/events.php?zid={{event.id}}"
                target="_blank" external>Zwift Power <ms>open_in_new</ms></a></div>
        </div>
    </div>
    <div class="desc">{{event.description}}</div>
</div>
<div class="subgroups">
    <h2>Groups</h2>
    <hr/>
    <% for (const sg of subgroups) { %>
        <div class="event-subgroup" data-event-subgroup-id="{{sg.id}}">
            <header>
                {-eventBadge(sg.subgroupLabel)-}
                <% if (sg.startOffset) { %>
                    <div>Starts: +{-humanDuration(sg.startOffset / 1000)-}</div>
                <% } %>
                <% if (sg.durationInSeconds) { %>
                    <div>Duration: {-humanTimer(sg.durationInSeconds)-}</div>
                <% } else { %>
                    <div>Distance: {-humanDistance(sg.distanceInMeters || sg.routeDistance, {suffix: true, html: true})-}</div>
                <% } %>
                <div>Total Entrants: {{humanNumber(sg.totalEntrantCount)}}</div>
                <div class="name">{{sg.name}}</div>
            </header>
            <table class="entrants expandable">
                <thead>
                    <tr>
                        <th></th>
                        <th>ZP</th>
                        <th>Name</th>
                        <th>Team</th>
                        <th>FTP</th>
                        <th>Weight</th>
                    </tr>
                </thead>
                <tbody>
                    <% for (const {id, athlete, likelyInGame} of sg.entrants) { %>
                        <tr data-id="{{id}}" class="summary">
                            <td>
                                <% if (athlete.marked) { %><ms class="marked" title="Is marked">bookmark_added</ms><% } %>
                                <% if (athlete.following) { %><ms class="following" title="You are following">follow_the_signs</ms><% } %>
                                <% if (likelyInGame) { %><ms title="Likely in game" class="in-game">check_circle</ms><% } %>
                                <% if (athlete.powerMeter) { %><ms class="power" title="Has power meter">bolt</ms><% } %>
                                <% if (athlete.gender === 'female') { %><ms class="female" title="Is female">female</ms><% } %>
                            </td>
                            <td><a title="Open profile on Zwift Power"
                                   href="https://zwiftpower.com/profile.php?z={{id}}"
                                   target="_blank" external><ms>open_in_new</ms></a></td>
                            <td>{{athlete.sanitizedFullname}}</td>
                            <td><% if (athlete.team) { %>{-teamBadge(athlete.team)-}<% } %></td>
                            <td>{-humanPower(athlete.ftp, {suffix: true, html: true})-}</td>
                            <td>{-humanWeightClass(athlete.weight, {suffix: true, html: true})-}</td>
                        </tr>
                        <tr class="details">
                            <td colspan="6"><div class="container"></div></td>
                        </tr>
                    <% } %>
                </tbody>
            </table>
        </div>
    <% } %>
</div>
