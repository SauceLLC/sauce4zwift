<div class="event-info">
    <div class="card">
        <img class="event-image" src="{{event.imageUrl}}"/>
        <div class="meta">
            <div title="Event World">{{event.world}} <ms>map</ms></div>
            <div title="Route">{{(event.laps && event.laps > 1) ? event.laps + ' x ' : ''}}{{route.name}} <ms>route</ms></div>
            <div title="Climbing">{{humanElevation(event.routeClimbing, {suffix: true})}} <ms>landscape</ms></div>
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
                <% if (sg.durationInSeconds) { %>
                    <div>Duration: {-humanTimer(sg.durationInSeconds, {suffix: true, html: true})-}</div>
                <% } else { %>
                    <div>Distance: {-humanDistance(sg.distanceInMeters || sg.routeDistance, {suffix: true, html: true})-}</div>
                <% } %>
                <div>Total Entrants: {{humanNumber(sg.totalEntrantCount)}}</div>
                <div class="name">{{sg.name}}</div>
            </header>
            <table class="entrants expandable">
                <thead>
                    <tr>
                        <th title="Likely in game now">Active</th>
                        <th title="Has a power meter">Power</th>
                        <th>Name</th>
                        <th>Team</th>
                        <th>FTP</th>
                        <th>Weight</th>
                        <th>ID</th>
                    </tr>
                </thead>
                <tbody>
                    <% for (const {id, athlete, likelyInGame} of sg.entrants) { %>
                        <tr data-id="{{id}}" class="summary">
                            <td><% if (likelyInGame) { %><ms class="in-game">check_circle</ms><% } %></td>
                            <td><% if (athlete.powerMeter) { %><ms>bolt</ms><% } %></td>
                            <td>{{athlete.sanitizedFullname}}</td>
                            <td><% if (athlete.team) { %>{-teamBadge(athlete.team)-}<% } %></td>
                            <td>{-humanPower(athlete.ftp, {suffix: true, html: true})-}</td>
                            <td>{-humanWeightClass(athlete.weight, {suffix: true, html: true})-}</td>
                            <td><a title="Open profile on Zwift Power"
                                href="https://zwiftpower.com/profile.php?z={{id}}" target="_blank" external>{{id}}</a></td>
                        </tr>
                        <tr class="details">
                            <td colspan="7"><div class="container"></div></td>
                        </tr>
                    <% } %>
                </tbody>
            </table>
        </div>
    <% } %>
</div>
