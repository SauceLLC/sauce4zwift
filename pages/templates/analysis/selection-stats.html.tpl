<% if (obj.selectionStats) { %>
    <% const {athlete, power, env, el, hr, sport} = selectionStats; %>
    <div class="stats key-value-grid">
        <key class="header"><ms>timer</ms> Active:</key>
        <value>{-humanTimer(selectionStats.activeTime, {long: true, html: true})-}</value>
        <key>Elapsed:</key><value>{-humanTimer(selectionStats.elapsedTime, {long: true, html: true})-}</value>
        <key>Speed:</key><value>{-humanPace(env.speed, {suffix: true, html: true, sport})-}</value>
        <key>Distance:</key><value>{-humanDistance(env.distance, {suffix: true, html: true})-}</value>
    </div>

    <div class="separator"></div>

    <div class="stats key-value-grid">
        <key class="header"><ms>bolt</ms> Power:</key>
        <value title="Active average power">{-humanPower(power.avg, {suffix: true, html: true})-}</value>
        <% if (athlete?.weight) { %>
            <key>Watts/kg:</key>
            <value title="Active average power / weight (kg)">
                {-humanWkg(power.avg / athlete.weight)-}
            </value>
        <% } %>

        <key><attr for="tp">NP®</attr>:</key>
        <% if (settings.preferWkg && athlete?.weight) { %>
            <value title="{{humanPower(power.np, {suffix: true})}}"
                >{-humanWkg(power.np / athlete?.weight, {suffix: true, html: true})-}</value>
        <% } else { %>
            <value title="{{humanWkg(power.np / athlete?.weight, {suffix: true})}}"
                >{-humanPower(power.np, {suffix: true, html: true})-}</value>
        <% } %>

        <key title="Elapsed average power">Elapsed:</key>
        <% if (settings.preferWkg && athlete?.weight) { %>
            <value title="{{humanPower(power.avgElapsed, {suffix: true})}}"
                >{-humanWkg(power.avgElapsed / athlete?.weight, {suffix: true, html: true})-}</value>
        <% } else { %>
            <value title="{{humanWkg(power.avgElapsed / athlete?.weight, {suffix: true})}}"
                >{-humanPower(power.avgElapsed, {suffix: true, html: true})-}</value>
        <% } %>
    </div>

    <div class="separator"></div>

    <% if (hr && hr.avg && hr.avg > 20) { %>
        <div class="stats key-value-grid">
            <key class="header"><ms>cardiology</ms> HR:</key>
            <value title="Average Heart Rate">{-humanNumber(hr.avg, {suffix: 'bpm', html: true})-}</value>

            <% if (hr.tTss !== null && !isNaN(hr.tTss)) { %>
                <key title="TRIMP (TRaining IMPulse) based Training Stress Score®: A heart rate reserve based stress load indicator">tTSS:</key>
                <value>{-humanNumber(hr.tTss)-}</value>
            <% } %>

            <% if (hr.pwhr !== null && !isNaN(hr.pwhr)) { %>
                <% const pwhr = Math.round(hr.pwhr * 100); %>
                <key title="Pw:Hr is a measurement of aerobic decoupling.  It compares the power to heart rate ratio in the first half of an activity to the second half.  A positive value indicates the heart rate at a given power drifted higher as the activity progressed.  Often this happens on long endurance rides and represents fatigue.">Pw:Hr:</key>
                <value class="{{pwhr < 0 ? 'sauce-positive' : pwhr > 0 ? 'sauce-negative' : ''}}">
                    {-humanNumber(pwhr, {suffix: '%', html: true, signDisplay: pwhr > 0 ? 'always' : undefined})-}
                </value>
            <% } %>
        </div>

        <div class="separator"></div>
    <% } %>

    <div class="stats key-value-grid">
        <key class="header"><ms>readiness_score</ms> Energy:</key>
        <value>{-humanNumber(power.kj, {suffix: 'kJ', html: true})-}</value>

        <key title="Training Stress Score® represents the FTP adjusted stress level of an effort.
Click for more details."><attr for="tp">TSS®</attr>:</key>
        <value>{-humanNumber(power.tss)-}</value>

        <key><attr title="Power / FTP
Click for more details." for="tp">IF®</attr>:</key>
        <value>{-humanNumber(power.intensity * 100, {suffix: '%', html: true})-}</value>

        <key title="Energy expended before this effort in kilojoules">Lead-in:</key>
        <value>{-humanNumber(power.leadInKj || null, {suffix: 'kJ', html: true})-}</value>
    </div>

    <div class="separator"></div>

    <div class="stats key-value-grid">
        <key class="header"><ms>elevation</ms> Grade:</key>
        <value>{-humanNumber(el.grade * 100, {suffix: '%', html: true})-}</value>
        <key>Gain:</key><value>{-humanElevation(el.gain, {suffix: true, html: true})-}</value>
        <key>Loss:</key><value>{-humanElevation(el.loss, {suffix: true, html: true})-}</value>
        <key>VAM:</key><value>{-humanNumber(el.vam, {suffix: 'Vm/h', html: true})-}</value>
    </div>

    <% if (power.rank) { %>
        <div class="separator"></div>

        <div class="stats key-value-grid">
            <key class="header" title="World Ranking on the basis of W/kg for the given time period"><ms>social_leaderboard</ms> Rank:</key>
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
