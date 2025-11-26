<% if (!athlete) { %>
    <div class="avatar">
        <a class="avatar"><img src="images/not-sure.png"/></a>
    </div>
    <div class="overview-columns">
        <div class="overview-name">
            <span>Not Sure</span>
        </div>
    </div>
<% } else { %>
    <div class="avatar">
        <% if (athlete.avatar) { %>
            <a class="avatar" href="profile-avatar.html?id={{athlete.id}}" target="profile-avatar">
        <% } else { %>
            <a class="avatar">
        <% } %>
            <img src="{{athlete.avatar || 'images/blankavatar.png'}}"/>
            <% if (athlete && athlete.type !== 'NORMAL') { %>
                <div class="special badge">{{athlete.type.replace(/_/, ' ')}}</div>
            <% } %>
        </a>
    </div>
    <div class="overview-columns">
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
        <div class="activity-summary">
            <% if (obj.athleteData) { %>
                <% const {state, stats} = athleteData; %>
                <% const observedTime = athleteData.updated - athleteData.created; %>
                <% if (state && athleteData.age < 120000) { %>
                    <div class="overview-stat" title="How long since joining the Zwift network">
                        <key>Session:</key>
                        <value>{-humanTimer(state.time, {full: true, html: true})-}</value>
                    </div>

                    <div class="overview-stat" title="How long Sauce has observed this athlete">
                        <key>Observed:</key>
                        <value>{-humanDuration(observedTime / 1000, {html: true})-}</value>
                    </div>

                    <div class="overview-stat" title="Total in-game distance (may differ from available Sauce Data below)">
                        <key>Distance:</key>
                        <value>{-humanDistance(state.distance, {suffix: true, html: true})-}</value>
                    </div>

                    <div class="overview-stat" title="Total in-game climbing (may differ from available Sauce Data below)">
                        <key>Climbed:</key>
                        <value>{-humanElevation(state.climbing, {suffix: true, html: true})-}</value>
                    </div>
                <% } else if (stats) { %>
                    <div class="overview-stat" title="When Sauce last received data for this athlete">
                        <key>Last seen:</key>
                        <value>{-humanTime(athleteData.updated, {html: true})-}</value>
                    </div>

                    <div class="overview-stat" title="How long Sauce has observed this athlete">
                        <key>Observed:</key>
                        <value>{-humanDuration(observedTime / 1000, {html: true})-}</value>
                    </div>
                <% } %>

                <% if (stats.coffeeTime) { %>
                    <div class="overview-stat" title="Amount of time Sauce detected a coffee break being used (actual could be higher)">
                        <key>Coffee:</key>
                        <value>{-humanDuration(stats.coffeeTime, {suffix: true, html: true})-}</value>
                    </div>
                <% } %>
            <% } else if (!obj.loading) { %>
                <div class="badge" style="--hue: 0deg;">No Data Available</div>
            <% } %>
        </div>
    </div>
<% } %>
