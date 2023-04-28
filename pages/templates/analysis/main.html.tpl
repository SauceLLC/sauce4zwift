<% if (!ad?.athlete) { %>
    <section>
        <h1>No data available</h1>
    </section>
<% } else { %>
    <% const athlete = ad.athlete; %>
    <header class="about">
        <a class="avatar" href="profile-avatar.html?id={{athlete.id}}" target="profile-avatar">
            <img src="{{athlete.avatar || 'images/blankavatar.png'}}"/>
            <% if (athlete.type !== 'NORMAL' || true) { %>
                <div class="special badge">{{athlete.type.replace(/_/, ' ')}}</div>
            <% } %>
        </a>
        <div class="activity-intro">
            <div class="name">{{athlete.sanitizedFullname}}
                <% if (athlete.countryCode) { %>
                    <img class="flag" src="{{nationFlags.flags[athlete.countryCode]}}"
                         title="{{nationFlags.nations[athlete.countryCode]}}"/>
                <% } %>
                <% if (athlete.gender === 'female') { %><ms class="gender female" title="Female">female</ms><% } %>
            </div>
            <% if (athlete.team) { %><div class="team">{-common.teamBadge(athlete.team)-}</div><% } %>
            <div class="world">{{worldList.find(x => x.courseId === ad.state.courseId).name}} <small><ms>map</ms></small></div>
        </div>
        <div class="embed" id="header-summary">
            {-await templates.headerSummary(ad)-}
        </div>
    </header>

    <% if (streams) { %>
        <section class="analysis">
            <main>
                <div id="map"></div>
                <div class="more-stats">
                    <div class="stats key-value-grid">
                        <key>Power avg:</key><value>{-humanPower(ad.stats.power.avg, {suffix: true, html: true})-}
                            | {-humanWkg(ad.stats.power.avg / athlete.weight, {suffix: true, html: true})-}</value>
                        <key>Power max:</key><value>{-humanPower(ad.stats.power.max, {suffix: true, html: true})-}
                            | {-humanWkg(ad.stats.power.max / athlete.weight, {suffix: true, html: true})-}</value>
                        <key>Distance:</key><value>{-humanDistance(ad.state.distance, {suffix: true, html: true})-}</value>
                        <key>Speed avg:</key><value>{-humanPace(ad.stats.speed.avg, {suffix: true, html: true, sport: ad.state.sport})-}</value>
                        <key>HR avg:</key><value>{-humanNumber(ad.stats.hr.avg, {suffix: 'bpm', html: true})-}</value>
                    </div>
                    <div class="stats key-value-grid">
                        <key>Active:</key><value>{{humanTimer(ad.stats.activeTime)}}</value>
                        <key>Elapsed:</key><value>{{humanTimer(ad.stats.elapsedTime)}}</value>
                        <key>Data points:</key><value>{{humanNumber(streams.power.length)}}</value>
                    </div>
                    <div class="stats time-in-power-zones"></div>
                </div>
                <div class="chart-holder">
                    <div class="chart"></div>
                    <div class="legend horizontal"></div>
                </div>
            </main>
        </section>

        <section class="laps">
            <header><ms>timer</ms><div class="title">Laps</div></header>
            <main>
                <table class="laps expandable">
                    <thead>
                        <tr>
                            <th></th>
                            <th>Start</th>
                            <th>Time</th>
                            <th>Distance</th>
                            <th>Power</th>
                            <th>Pace</th>
                            <th>HR</th>
                        </tr>
                    </thead>
                    <tbody>
                        <% if (laps && laps.length) { %>
                            <% for (const [i, lap] of laps.entries()) { %>
                                <tr class="summary" data-lap="{{i}}">
                                    <td class="num">{{i+1}}</td>
                                    <td class="start">{-humanTimer(streams.time[lap.startIndex], {long: true})-}</td>
                                    <td>{-humanTimer(lap.stats.activeTime, {long: true})-}</td>
                                    <td>{-humanDistance(streams.distance[lap.endIndex + 1] - streams.distance[lap.startIndex], {suffix: true, html: true})-}</td>
                                    <% if (settings.preferWkg && athlete.weight) { %>
                                        <td title="{{humanPower(lap.stats.power.avg, {suffix: true})}}"
                                            >{-humanWkg(lap.stats.power.avg / athlete.weight, {suffix: true, html: true})-}</td>
                                    <% } else { %>
                                        <td title="{{athlete.weight ? humanWkg(lap.stats.power.avg / athlete.weight, {suffix: true}) : ''}}"
                                            >{-humanPower(lap.stats.power.avg, {suffix: true, html: true})-}</td>
                                    <% } %>
                                    <td>{-humanPace(lap.stats.speed.avg, {suffix: true, html: true, sport: lap.sport})-}</td>
                                    <td>{-humanNumber(lap.stats.hr.avg, {suffix: 'bpm', html: true})-}</td>
                                </tr>
                                <tr class="details">
                                    <td colspan="7"><div class="container"></div></td>
                                </tr>
                            <% } %>
                        <% } else { %>
                            <tr>
                                <td colspan="7">No Lap Data</td>
                            </tr>
                        <% } %>
                    </tbody>
                </table>
            </main>
        </section>

        <section class="segments">
            <header><ms>space_bar</ms><div class="title">Segments</div></header>
            <main>
                <table class="segments expandable">
                    <thead>
                        <tr>
                            <th></th>
                            <th>Start</th>
                            <th>Elapsed</th>
                            <th>Distance</th>
                            <th>Power</th>
                            <th>Pace</th>
                        </tr>
                    </thead>
                    <tbody>
                        <% if (segments && segments.length) { %>
                            <% for (const [i, segment] of segments.entries()) { %>
                                <tr class="summary" data-segment="{{i}}">
                                    <td class="name">{{segment.segment.friendlyName || segment.segment.name}}</td>
                                    <td class="start">{-humanTimer(streams.time[segment.startIndex], {long: true})-}</td>
                                    <td>{-humanTimer(segment.stats.elapsedTime, {long: true})-}</td>
                                    <td>{-humanDistance(streams.distance[segment.endIndex + 1] - streams.distance[segment.startIndex], {suffix: true, html: true})-}</td>
                                    <td>{-humanPower(segment.stats.power.avg, {suffix: true, html: true})-}</td>
                                    <td>{-humanPace(segment.stats.speed.avg, {suffix: true, html: true, sport: segment.sport})-}</td>
                                </tr>
                                <tr class="details">
                                    <td colspan="6"><div class="container"></div></td>
                                </tr>
                            <% } %>
                        <% } else { %>
                            <tr>
                                <td colspan="6">No Segment Data</td>
                            </tr>
                        <% } %>
                    </tbody>
                </table>
            </main>
        </section>
    <% } %>
<% } %>
