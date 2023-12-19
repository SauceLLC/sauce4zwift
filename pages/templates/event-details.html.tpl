<div class="container">
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
    <% if (obj.subgroups && obj.subgroups.length) { %>
        <div class="subgroups">
            <h2>Groups</h2>
            <hr/>
            <% for (const sg of subgroups) { %>
                <% const hasResults = sg.results && sg.results.length; %>
                <div class="event-subgroup {{hasResults ? 'results' : ''}}"
                     data-event-subgroup-id="{{sg.id}}">
                    <header>
                        <div>
                            {-eventBadge(sg.subgroupLabel)-}
                            <% if (hasResults) { %>
                                <b>Results</b>
                            <% } %>
                        </div>
                        <% if (!hasResults) { %>
                            <% if (sg.startOffset) { %>
                                <div>Starts: +{-humanDuration(sg.startOffset / 1000)-}</div>
                            <% } %>
                        <% } %>
                        <% if (sg.durationInSeconds) { %>
                            <div>Duration: {-humanTimer(sg.durationInSeconds)-}</div>
                        <% } else { %>
                            <div>Distance: {-humanDistance(sg.distanceInMeters || sg.routeDistance, {suffix: true, html: true})-}</div>
                        <% } %>
                        <% if (hasResults) { %>
                            <div>Finishers: {{humanNumber(sg.results.length)}}</div>
                        <% } else { %>
                            <div>Entrants: {{humanNumber(sg.entrants.length)}}</div>
                        <% } %>
                        <div class="name">{{sg.name}}</div>
                    </header>

                    <% if (!sg.results || !sg.results.length) { %>
                        <table class="entrants expandable">
                            <thead>
                                <tr>
                                    <th class="icon"><!-- marked --></th>
                                    <th class="icon"><!-- following --></th>
                                    <th class="icon"><!-- in-game --></th>
                                    <th class="icon"><!-- power-meter --></th>
                                    <th class="icon"><!-- gender --></th>
                                    <th class="name">Name</th>
                                    <th class="team">Team</th>
                                    <th class="ftp">FTP</th>
                                    <th class="weight">Weight</th>
                                </tr>
                            </thead>
                            <tbody>
                                <% for (const {id, athlete, likelyInGame} of sg.entrants) { %>
                                    <tr data-id="{{id}}" class="summary">
                                        <td class="icon">
                                            <% if (athlete.marked) { %><ms class="marked" title="Is marked">bookmark_added</ms><% } %>
                                        </td>
                                        <td class="icon">
                                            <% if (athlete.following) { %><ms class="following" title="You are following">follow_the_signs</ms><% } %>
                                        </td>
                                        <td class="icon">
                                            <% if (likelyInGame) { %><ms title="Likely in game" class="in-game">check_circle</ms><% } %>
                                        </td>
                                        <td class="icon">
                                            <% if (athlete.powerMeter) { %>
                                                <% if (athlete.powerSourceModel === 'Smart Trainer') { %>
                                                    <ms class="power" title="Has smart trainer">offline_bolt</ms>
                                                <% } else { %>
                                                    <ms class="power" title="Has power meter">bolt</ms>
                                                <% } %>
                                            <% } %>
                                        </td>
                                        <td class="icon">
                                            <% if (athlete.gender === 'female') { %><ms class="female" title="Is female">female</ms><% } %>
                                        </td>
                                        <td class="name">{-fmtFlag(athlete.countryCode, {empty: ''})-} {{athlete.sanitizedFullname}}</td>
                                        <td class="team"><% if (athlete.team) { %>{-teamBadge(athlete.team)-}<% } %></td>
                                        <td class="power">{-humanPower(athlete.ftp, {suffix: true, html: true})-}</td>
                                        <td class="weight">{-humanWeightClass(athlete.weight, {suffix: true, html: true})-}</td>
                                    </tr>
                                    <tr class="details"><td colspan="9"></td></tr>
                                <% } %>
                            </tbody>
                        </table>
                    <% } else { %>
                        <table class="entrants expandable">
                            <thead>
                                <tr>
                                    <th></th>
                                    <th>Name</th>
                                    <th>Team</th>
                                    <th>Time</th>
                                    <th>Power</th>
                                    <th>HR</th>
                                    <th>Weight</th>
                                </tr>
                            </thead>
                            <tbody>
                                <% for (const x of sg.results) { %>
                                    {{console.log(x)}}
                                    <tr data-id="{{x.profileId}}" class="summary">
                                        <td class="place">
                                        <% if (x.rank === 1) { %>
                                            <ms class="trophy gold">trophy</ms>
                                        <% } else if (x.rank === 2) { %>
                                            <ms class="trophy silver">trophy</ms>
                                        <% } else if (x.rank === 3) { %>
                                            <ms class="trophy bronze">trophy</ms>
                                        <% } else { %>
                                            {-humanPlace(x.rank, {suffix: true, html: true})-}
                                        <% } %>
                                        </td>
                                        <td class="name">
                                            {-fmtFlag(x.athlete.countryCode, {empty: ''})-}
                                            <% if (x.athlete.gender === 'female') { %>
                                                <ms class="female" title="Is female">female</ms>
                                            <% } %>
                                            {{x.athlete.sanitizedFullname}}
                                        </td>
                                        <td class="team"><% if (x.athlete.team) { %>{-teamBadge(x.athlete.team)-}<% } %></td>
                                        <td class="time">{-humanTimer(x.activityData.durationInMilliseconds / 1000, {html: true, ms: true})-}</td>
                                        <td class="power" data-power-type="{{x.sensorData.powerType}}">{-humanPower(x.sensorData.avgWatts, {suffix: true, html: true})-}</td>
                                        <td class="hr">{-humanNumber(x.sensorData.heartRateData?.avgHeartRate, {suffix: 'bpm', html: true})-}</td>
                                        <td class="weight">{-humanWeightClass(x.profileData.weightInGrams / 1000, {suffix: true, html: true})-}</td>
                                    </tr>
                                    <tr class="details"><td colspan="5"></td></tr>
                                <% } %>
                            </tbody>
                        </table>
                    <% } %>
                </div>
            <% } %>
        </div>
    <% } %>
</div>
