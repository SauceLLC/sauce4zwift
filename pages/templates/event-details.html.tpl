<div class="event-info">
    <img class="event-image" src="{{event.imageUrl}}"/>
    <div class="desc">{{event.description}}</div>
</div>
<div class="subgroups">
    <h2>Subgroups</h2>
    <hr/>
    <% for (const sg of subgroups) { %>
        <div class="event-subgroup" data-event-subgroup-id="{{sg.id}}">
            <header>
                {-eventBadge(sg.subgroupLabel)-}
                <div class="name">{{sg.name}}</div>
                <% if (sg.durationInSeconds) { %>
                    <div>Duration: {-humanTimer(sg.durationInSeconds, {suffix: true, html: true})-}</div>
                <% } else { %>
                    <div>Distance: {-humanDistance(sg.durationInMeters || sg.routeDistance, {suffix: true, html: true})-}</div>
                <% } %>
                Total Entrants:</b> {{humanNumber(sg.totalEntrantCount)}}
            </header>
            <table class="entrants expandable">
                <thead>
                    <tr>
                        <th>Active Now</th>
                        <th>ID</th>
                        <th>Name</th>
                        <th>FTP</th>
                        <th>Team</th>
                    </tr>
                </thead>
                <tbody>
                    <% for (const {id, athlete, likelyInGame} of sg.entrants) { %>
                        <tr data-id="{{id}}" class="summary">
                            <td><% if (likelyInGame) { %><ms style="color: green;">check_circle</ms><% } %></td>
                            <td>{{id}}</td>
                            <td>{{athlete.sanitizedName}}</td>
                            <td>{{athlete.ftp}}</td>
                            <td><% if (athlete.team) { %>{-teamBadge(athlete.team)-}<% } %></td>
                        </tr>
                        <tr class="details">
                            <td colspan="5"><div class="container"></div></td>
                        </tr>
                    <% } %>
                </tbody>
            </table>
        </div>
    <% } %>
</div>
