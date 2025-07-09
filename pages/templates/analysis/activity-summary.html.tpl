<div class="activity-summary">
    <% if (obj.athleteData) { %>
        <% const {state, stats} = athleteData; %>
        <% const observedTime = athleteData.updated - athleteData.created; %>
        <% if (state && athleteData.age < 120000) { %>
            <small><div class="badge" style="--hue: 110deg">in-game</div></small>

            <div class="overview-stat" title="When the Zwift world was joined">
                <key>Joined:</key>
                <value>{-humanTime(Date.now() - (state.time * 1000), {html: true})-}</value>
            </div>

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
            <small><div class="badge" style="--hue: 10deg">left</div></small>

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
    <% } else  { %>
        <small><div class="badge" style="--hue: 10deg">no-data</div></small>
    <% } %>
</div>
