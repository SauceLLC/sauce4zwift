<div class="activity-summary key-value-grid">
    <% if (athleteData?.stats) { %>
        <key>Start:</key><value>{{humanTime(Date.now() - (athleteData.stats.elapsedTime * 1000))}}</value>
        <key>Time:</key><value>{{humanTimer(athleteData.stats.activeTime, {full: true})}}</value>
        <key>Distance:</key><value>{-humanDistance(athleteData.state.distance, {suffix: true, html: true})-}</value>
    <% } %>
</div>
