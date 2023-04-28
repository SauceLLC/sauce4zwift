<% if (obj?.stats) { %>
    <div class="activity-summary key-value-grid">
        <key>Start:</key><value>{{humanTime(Date.now() - (stats.elapsedTime * 1000))}}</value>
        <key>Time:</key><value>{{humanTimer(stats.activeTime, {full: true})}}</value>
        <key>Zwift Level:</key><value>{{humanNumber(athlete.level)}}</value>
    </div>
<% } %>
