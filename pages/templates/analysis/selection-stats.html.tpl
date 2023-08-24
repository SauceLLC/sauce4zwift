<div class="selection-stats">
    <% if (!obj.selectionStats) { %>
        Loading
    <% } else { %>
        <% const {athlete, power, env, el, hr, sport} = selectionStats; %>
        <div class="stats key-value-grid">
            <key class="header"><ms>timer</ms> Active:</key>
            <value>{{humanTimer(selectionStats.activeTime, {long: true})}}</value>
            <key>Elapsed:</key><value>{{humanTimer(selectionStats.elapsedTime, {long: true})}}</value>
            <key>Speed:</key><value>{-humanPace(env.speed, {suffix: true, html: true, sport})-}</value>
            <key>Distance:</key><value>{-humanDistance(env.distance, {suffix: true, html: true})-}</value>
        </div>

        <div class="seperator"></div>

        <div class="stats key-value-grid">
            <key class="header"><ms>bolt</ms> Power:</key>
            <value>{-humanPower(power.avg, {suffix: true, html: true})-},
                {-humanWkg(power.avg / athlete?.weight, {suffix: true, fixed: true, html: true})-}</value>
            <key><attr for="tp">NP®</attr>:</key><value>{-humanPower(power.np, {suffix: true, html: true})-}</value>
            <key>Max:</key><value>{-humanPower(power.max, {suffix: true, html: true})-},
                {-humanWkg(power.max / athlete?.weight, {suffix: true, fixed: true, html: true})-}</value>
        </div>

        <div class="seperator"></div>

        <div class="stats key-value-grid">
            <key class="header"><ms>readiness_score</ms> Energy:</key>
            <value>{-humanNumber(power.kj, {suffix: 'kJ', html: true})-}</value>
            <key><attr for="tp">TSS®</attr>:</key><value>{-humanNumber(power.tss)-}</value>
        </div>

        <% if (hr) { %>
            <div class="seperator"></div>

            <div class="stats key-value-grid">
                <key class="header"><ms>ecg_heart</ms> HR:</key>
                <value>{-humanNumber(hr.avg, {suffix: 'bpm', html: true})-}</value>
                <key>Max:</key><value>{-humanNumber(hr.max, {suffix: 'bpm', html: true})-}</value>
            </div>
        <% } %>

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
