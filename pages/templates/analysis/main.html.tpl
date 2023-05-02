<% if (!ad?.athlete) { %>
    <section>
        <h1>No data available</h1>
    </section>
<% } else { %>
    <% const athlete = ad.athlete; %>
    <header class="about">
        <a class="avatar" href="profile-avatar.html?id={{athlete.id}}" target="profile-avatar">
            <img src="{{athlete.avatar || 'images/blankavatar.png'}}"/>
            <% if (athlete.type !== 'NORMAL') { %>
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
            <div class="athlete-stat">Zwift Level: {{humanNumber(ad?.athlete?.level)}}</div>
            <div class="athlete-stat">FTP:
                {{humanPower(ad?.athlete?.ftp)}}
                ({-humanNumber(ad?.athlete?.ftp / ad?.athlete?.weight, {precision: 1, fixed: true, suffix: 'w/kg', html: true})-})
            </div>
        </div>
        {-embed(templates.activitySummary, obj)-}
    </header>

    <% if (streams) { %>
        <div class="columns">
            <nav>
                {-embed(templates.peakEfforts, obj)-}
                <div class="stats time-in-power-zones"></div>
            </nav>
            <main>
                <section class="analysis">
                    <div class="world">{{worldList.find(x => x.courseId === ad.state.courseId).name}}</div>
                    <div id="map"></div>
                    {-embed(templates.selectionStats, obj)-}
                    <div class="chart-holder">
                        <div class="chart"></div>
                        <div class="legend horizontal"></div>
                    </div>
                </section>

                <section class="segments">
                    <header><ms>space_bar</ms><div class="title">Segments</div></header>
                    {-embed(templates.segments, obj)-}
                </section>

                <section class="laps">
                    <header><ms>timer</ms><div class="title">Laps</div></header>
                    {-embed(templates.laps, obj)-}
                </section>
            </main>
        </div>
    <% } %>
<% } %>
