<% if (!athleteData || !streams || !athleteData.athlete) { %>
    <header>
        <h2>No data available</h2>
    </header>
<% } else { %>
    <% const athlete = athleteData.athlete; %>

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
        <div class="activity-intro">
            <div class="name">{{athlete.sanitizedFullname}}
                <% if (athlete.countryCode) { %>
                    <img class="flag" src="{{nationFlags.flags[athlete.countryCode]}}"
                         title="{{nationFlags.nations[athlete.countryCode]}}"/>
                <% } %>
                <% if (athlete.gender === 'female') { %><ms class="gender female" title="Female">female</ms><% } %>
            </div>
            <% if (athlete.team) { %><div class="team">{-common.teamBadge(athlete.team)-}</div><% } %>
            <div class="athlete-stat">Zwift Level: {{humanNumber(athleteData?.athlete?.level)}}</div>
            <div class="athlete-stat">FTP:
                {{humanPower(athleteData?.athlete?.ftp)}}
                ({-humanNumber(athleteData?.athlete?.ftp / athleteData?.athlete?.weight, {precision: 1, fixed: true, suffix: 'w/kg', html: true})-})
            </div>
        </div>
        {-embed(templates.activitySummary, obj)-}
    </header>

    <% if (streams) { %>
        <nav>
            <section>{-embed(templates.peakEfforts, obj)-}</section>
            <section><div class="stats time-in-power-zones"></div></section>
        </nav>
        <main>
            <section class="analysis selection">
                <div class="world">{{worldList.find(x => x.courseId === athleteData.state.courseId).name}}</div>
                <div id="map-wrap">
                    <div id="map"></div>
                    <div id="map-resizer"><ms>drag_handle</ms></div>
                </div>
                {-embed(templates.selectionStats, obj)-}
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

            <section class="segments">
                <header>
                    <ms>conversion_path</ms>
                    <div class="title">Segments</div>
                </header>
                {-embed(templates.segments, obj)-}
            </section>

            <section class="laps">
                <header>
                    <ms>timer</ms>
                    <div class="title">Laps</div>
                </header>
                {-embed(templates.laps, obj)-}
            </section>
        </main>
    <% } %>
<% } %>
