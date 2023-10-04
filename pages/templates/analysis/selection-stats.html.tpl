<div class="selection-stats">
    <% if (!obj.selectionStats) { %>
        Loading
    <% } else { %>
        <% const {athlete, power, env, el, hr, sport} = selectionStats; %>
        <div class="stats key-value-grid">
            <key class="header"><ms>timer</ms> Active:</key>
            <value>{-humanTimer(selectionStats.activeTime, {long: true, html: true})-}</value>
            <key>Elapsed:</key><value>{-humanTimer(selectionStats.elapsedTime, {long: true, html: true})-}</value>
            <key>Speed:</key><value>{-humanPace(env.speed, {suffix: true, html: true, sport})-}</value>
            <key>Distance:</key><value>{-humanDistance(env.distance, {suffix: true, html: true})-}</value>
        </div>

        <div class="seperator"></div>

        <div class="stats key-value-grid">
            <key class="header"><ms>bolt</ms> Power:</key>
            <% if (settings.preferWkg && athlete?.weight) { %>
                <value title="{{humanPower(power.avg, {suffix: true})}}"
                    >{-humanWkg(power.avg / athlete?.weight, {suffix: true, fixed: true, html: true})-}</value>
            <% } else { %>
                <value title="{{humanWkg(power.avg / athlete?.weight, {suffix: true, fixed: true})}}"
                    >{-humanPower(power.avg, {suffix: true, html: true})-}</value>
            <% } %>

            <key><attr for="tp">NP®</attr>:</key>
            <% if (settings.preferWkg && athlete?.weight) { %>
                <value title="{{humanPower(power.np, {suffix: true})}}"
                    >{-humanWkg(power.np / athlete?.weight, {suffix: true, fixed: true, html: true})-}</value>
            <% } else { %>
                <value title="{{humanWkg(power.np / athlete?.weight, {suffix: true, fixed: true})}}"
                    >{-humanPower(power.np, {suffix: true, html: true})-}</value>
            <% } %>

            <key>Max:</key>
            <% if (settings.preferWkg && athlete?.weight) { %>
                <value title="{{humanPower(power.max, {suffix: true})}}"
                    >{-humanWkg(power.max / athlete?.weight, {suffix: true, fixed: true, html: true})-}</value>
            <% } else { %>
                <value title="{{humanWkg(power.max / athlete?.weight, {suffix: true, fixed: true})}}"
                    >{-humanPower(power.max, {suffix: true, html: true})-}</value>
            <% } %>
        </div>

        <div class="seperator"></div>

        <div class="stats key-value-grid">
            <key class="header"><ms>readiness_score</ms> Energy:</key>
            <value>{-humanNumber(power.kj, {suffix: 'kJ', html: true})-}</value>
            <key><attr for="tp">TSS®</attr>:</key><value>{-humanNumber(power.tss)-}</value>
        </div>

        <div class="seperator"></div>

        <div class="stats key-value-grid">
            <key class="header"><ms>elevation</ms> Grade:</key>
            <value>{-humanNumber(el.grade * 100, {suffix: '%', html: true})-}</value>
            <key>Gain:</key><value>{-humanElevation(el.gain, {suffix: true, html: true})-}</value>
            <key>Loss:</key><value>{-humanElevation(el.loss, {suffix: true, html: true})-}</value>
            <key>VAM:</key><value>{-humanNumber(el.vam, {suffix: 'Vm/h', html: true})-}</value>
        </div>

        <% if (power.rank) { %>
            <div class="seperator"></div>

            <div class="stats key-value-grid">
                <key class="header"><ms>social_leaderboard</ms> Rank:</key>
                <% if (power.rank.level > 0) { %>
                    <value>{-humanNumber(power.rank.level * 100, {suffix: '%', html: true})-}</value>
                <% } else { %>
                    <value>-</value>
                <% } %>
                <% if (power.rank.badge) { %>
                    <img src="/pages{{power.rank.badge}}" class="rank"/>
                <% } else { %>
                    <key>Cat:</key><value>{{humanNumber(power.rank.catLevel)}}</value>
                <% } %>
            </div>
        <% } %>
    <% } %>
</div>
