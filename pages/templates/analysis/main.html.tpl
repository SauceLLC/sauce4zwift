<% if (!athlete) { %>
    <% console.warn("Unexpected state", obj); %>
    <header class="not-found">
        <h2>Athlete not found</h2>
    </header>
<% } else { %>
    <header class="avatar">
        <% if (athlete.avatar) { %>
            <a class="avatar" href="profile-avatar.html?id={{athlete.id}}" target="profile-avatar">
        <% } else { %>
            <a class="avatar">
        <% } %>
            <img src="{{athlete.avatar || 'images/blankavatar.png'}}"/>
            <% if (athlete.type !== 'NORMAL') { %>
                <div class="special badge">{{athlete.type.replace(/_/, ' ')}}</div>
            <% } %>
        </a>
    </header>

    <header class="overview">
        <div class="overview-name">
            <span>{{athlete.sanitizedFullname}}</span>
            <% if (athlete.countryCode) { %>
                <img class="flag" src="{{nationFlags.flags[athlete.countryCode]}}"
                     title="{{nationFlags.nations[athlete.countryCode]}}"/>
            <% } %>
            <% if (athlete.gender === 'female') { %><ms class="gender female" title="Female">female</ms><% } %>
            <% if (athlete.team) { %>
                <small>-</small> {-common.teamBadge(athlete.team)-}
            <% } %>
        </div>

        <div class="activity-intro">
            <div class="overview-stat">
                <key>Level:</key><value>{{humanNumber(athlete.level)}}</value>
            </div>

            <% if (athlete.age) { %>
                <div class="overview-stat">
                    <key>Age:</key>
                    <value>{-humanAgeClass(athlete.age)-}</value>
                </div>
            <% } %>

            <% if (athlete.weight && athlete.height) { %>
                <div class="overview-stat">
                    <key>Body:</key>
                    <value>
                        {-humanWeightClass(athlete.weight, {suffix: true, html: true})-},
                        {-humanHeight(athlete.height, {suffix: true, html: true})-}
                    </value>
                </div>
            <% } else if (athlete.weight) { %>
                <div class="overview-stat">
                    <key>Weight:</key>
                    <value>{-humanWeightClass(athlete.weight, {suffix: true, html: true})-}</value>
                </div>
            <% } else if (athlete.weight) { %>
                <div class="overview-stat">
                    <key>Height:</key>
                    <value>{-humanHeight(athlete.height, {suffix: true, html: true})-}</value>
                </div>
            <% } %>

            <div class="overview-stat" title="Zwift Racing Score">
                <key>ZRS:</key>
                <value>
                    {-humanNumber(athlete.racingScore || null)-}
                    <% if (athlete.racingCategory) { %>
                        {-common.eventBadge(athlete.racingCategory)-}
                    <% } %>
                </value>
            </div>

            <% if (athlete.ftp) { %>
                <div class="overview-stat">
                    <key>FTP:</key>
                    <value>{-humanPower(athlete.ftp, {suffix: true, html: true})-}
                        <% if (athlete.weight) { %>
                            <small>({-humanNumber(athlete.ftp / athlete.weight, {precision: 1, fixed: true, suffix: 'w/kg', html: true})-})</small>
                        <% } %>
                    </value>
                </div>
            <% } %>
        </div>
        <div class="activity-summary">{-embed(templates.activitySummary, obj)-}</div>
    </header>

    <nav>
        <section class="peak-efforts"></section>
        <section>
            <header>Time in Zones</header>
            <div class="echarts-chart time-in-power-zones"></div>
        </section>
        <section>
            <header>Pack Time</header>
            <div class="echarts-chart pack-time"></div>
        </section>
    </nav>

    <main>
        <section class="analysis selection">
            <div class="world" id="world-map-title"></div>
            <div id="map-wrap">
                <div id="map"></div>
                <div id="map-resizer"><ms>drag_handle</ms></div>
            </div>
            <div class="selection-stats"></div>
            <div class="chart-holder elevation"><div class="chart"></div></div>
            <div class="chart-holder stream-stack">
                <div class="chart"></div>
                <div class="stream-stats">
                    <div class="stat" data-id="power"></div>
                    <div class="stat" data-id="hr"></div>
                    <div class="stat" data-id="speed"></div>
                    <div class="stat" data-id="cadence"></div>
                    <div class="stat" data-id="wbal"></div>
                    <div class="stat" data-id="draft"></div>
                </div>
            </div>
        </section>

        <section class="segments">{-embed(templates.segments, obj)-}</section>

        <section class="laps">{-embed(templates.laps, obj)-}</section>
    </main>
<% } %>
