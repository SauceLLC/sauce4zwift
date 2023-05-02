<div class="activity-summary key-value-grid">
    <% if (ad?.stats) { %>
        <key>Start:</key><value>{{humanTime(Date.now() - (ad.stats?.elapsedTime * 1000))}}</value>
        <key>Time:</key><value>{{humanTimer(ad.stats?.activeTime, {full: true})}}</value>
    <% } %>
</div>
