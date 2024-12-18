<% if (obj.loading) { %>
    <tr><td><h2><i>Loading...</i></h2></td></tr>
<% } else if (results && results.length) { %>
    <% const critPowers = results[0].criticalP ? Object.keys(results[0].criticalP).map(k => [k, k.match(/criticalP([0-9]+)([A-Z][a-zA-Z]+)/)]).map(([k, m]) => [k, parseInt(m[1]) * (m[2].startsWith('Hour') ? 3600 : m[2].startsWith('Min') ? 60 : 1)]).sort((a, b) => a[1] - b[1]) : []; %>
    <% const hasZRS = results.length > 1 && results.some(x => ['INCREASED', 'DECREASED', 'AT_FLOOR'].includes(x.scoreHistory?.scoreChangeType)); %>
    <thead>
        <tr>
            <th><!--place--></th>
            <th><!--flags--></th>
            <th>Name</th>
            <th>Team</th>
            <th>{{hasZRS ? 'ZRS' : ''}}</th>
            <% if (sg.durationInSeconds) { %>
                <th class="distance">Distance</th>
            <% } else { %>
                <th class="time">Time</th>
            <% } %>
            <th>Power</th>
            <% for (const x of critPowers) { %>
                <th>{- humanDuration(x[1], {short: true, html: true}) -}</th>
            <% } %>
            <th>HR</th>
            <th>Weight</th>
        </tr>
    </thead>
    <tbody>
        <% let place = 0; %>
        <% let groupStart; %>
        <% for (const [i, x] of results.entries()) { %>
            <% const noPower = event.sport !== 'running' && x.sensorData.powerType === 'VIRTUAL_POWER'; %>
            <% const validResult = !noPower && !x.flaggedCheating && !x.flaggedSandbagging; %>
            <% const weight = x.profileData.weightInGrams / 1000; %>
            <tr data-id="{{x.profileId}}"
                class="summary
                       {{x.profileId === selfAthlete?.id ? 'self' : ''}}
                       {{x.flaggedCheating ? 'cheating' : ''}}
                       {{x.flaggedSandbagging ? 'sandbagging' : ''}}
                       {{noPower ? 'nopower' : ''}}
                       {{!validResult ? 'invalid' : ''}}
                ">
                <% place += validResult ? 1 : 0; %>
                <td class="place">
                    <% if (validResult) { %>
                        <% if (place === 1) { %>
                            <ms class="trophy gold">trophy</ms>
                        <% } else if (place === 2) { %>
                            <ms class="trophy silver">trophy</ms>
                        <% } else if (place === 3) { %>
                            <ms class="trophy bronze">trophy</ms>
                        <% } else { %>
                            {-humanPlace(place, {suffix: true, html: true})-}
                        <% } %>
                    <% } else { %>
                        -
                    <% } %>
                </td>
                <td class="icons"><% if (x.flaggedCheating) { %>
                    <ms title="Flagged for cheating" class="flag">warning</ms>
                <% } if (x.flaggedSandbagging) { %>
                    <ms title="Flagged for sandbagging" class="flag">emergency_heat</ms>
                <% } if (noPower) { %>
                    <ms title="No power device" class="flag">power_off</ms>
                <% } if (x.lateJoin) { %>
                    <ms title="Joined late" class="warning">acute</ms>
                <% } %></td>
                <td class="name" title="{{x.athlete.sanitizedFullname}}">
                    {-fmtFlag(x.athlete.countryCode, {empty: ''})-}
                    <% if (x.athlete.gender === 'female') { %>
                        <ms class="female" title="Is female">female</ms>
                    <% } %>
                    {{x.athlete.sanitizedFullname}}
                </td>
                <td class="team"><% if (x.athlete.team) { %>{-teamBadge(x.athlete.team)-}<% } %></td>
                <% if (hasZRS) { %>
                    <td class="racing-score" data-small-header="ZRS">
                        <% if (x.scoreHistory) { %>
                            {{humanNumber(x.scoreHistory.newScore)}}
                            <% const delta = x.scoreHistory.newScore - x.scoreHistory.previousScore; %>
                            <% if (delta > 0.5) { %>
                                <sup class="delta {{delta > 0 ? 'positive' : 'negative'}}">+{{humanNumber(delta)}}</sup>
                            <% } else if (delta < -0.5) { %>
                                <sub class="delta {{delta > 0 ? 'positive' : 'negative'}}">{{humanNumber(delta)}}</sub>
                            <% } %>
                        <% } else { %>
                            -
                        <% } %>
                    </td>
                <% } else { %>
                    <td class="racing-score"></td>
                <% } %>
                <% if (sg.durationInSeconds) { %>
                    <td class="distance" data-small-header="DIST">{-humanDistance(x.activityData.segmentDistanceInCentimeters / 100, {html: true, suffix: true})-}</td>
                <% } else {  %>
                    <% const t = x.activityData.durationInMilliseconds / 1000; %>
                    <% const prevT = i ? results[i - 1].activityData.durationInMilliseconds / 1000 : null; %>
                    <% if (prevT && t - prevT < 2) { %>
                        <td class="time relative" title="{-humanTimer(t, {ms: true})-}" data-small-header="TIME">
                            +{-humanTimer(t - groupStart, {ms: true})-}
                        </td>
                    <% } else { %>
                        <td class="time" data-small-header="TIME">{-humanTimer(t, {html: true, ms: true})-}</td>
                        <% groupStart = t; %>
                    <% }  %>
                <% } %>
                <td class="power" data-small-header="AVG">
                    <contents class="not-wkg">{-humanPower(x.sensorData.avgWatts, {suffix: true, html: true})-}</contents>
                    <contents class="only-wkg">{-humanWkg(x.sensorData.avgWatts / weight, {suffix: true, html: true})-}</contents>
                </td>
                <% for (const xx of critPowers) { %>
                    <td class="crit-power" data-period="{{xx[1]}}"
                        data-small-header="CP{- humanDuration(xx[1], {short: true}) -}">
                        <contents class="not-wkg">{- humanPower(x.criticalP[xx[0]], {suffix: true, html: true}) -}</contents>
                        <contents class="only-wkg">{- humanWkg(x.criticalP[xx[0]] / weight, {suffix: true, html: true}) -}</contents>
                    </td>
                <% } %>
                <td class="hr" data-small-header="HR">{-humanNumber(x.sensorData.heartRateData?.avgHeartRate || null, {suffix: 'bpm', html: true})-}</td>
                <td class="weight" data-small-header="WEIGHT">{-humanWeightClass(weight, {suffix: true, html: true})-}</td>
            </tr>
            <tr class="details"><td colspan="{{9 + critPowers.length}}"></td></tr>
        <% } %>
    </tbody>
<% } else { %>
    <thead>
        <tr>
            <th class="icon"></th>
            <th class="icon"></th>
            <th class="icon"></th>
            <th class="icon"></th>
            <th class="icon"></th>
            <th class="name">Name</th>
            <th class="team">Team</th>
            <th class="ftp">FTP</th>
            <th class="weight">Weight</th>
        </tr>
    </thead>
    <tbody>
        <% for (const {id, athlete, likelyInGame} of entrants) { %>
            <tr data-id="{{id}}" class="summary {{id === selfAthlete?.id ? 'self' : ''}}">
                <td class="icon"><% if (athlete.marked) { %>
                    <ms class="marked" title="Is marked">bookmark_added</ms>
                <% } %></td>
                <td class="icon"><% if (athlete.following) { %>
                    <ms class="following" title="You are following">follow_the_signs</ms>
                <% } %></td>
                <td class="icon"><% if (likelyInGame) { %>
                    <ms title="Likely in game" class="in-game">check_circle</ms>
                <% } %></td>
                <td class="icon"><% if (athlete.powerMeter) { %>
                    <% if (athlete.powerSourceModel === 'Smart Trainer') { %>
                        <ms class="power" title="Has smart trainer">{{=inlineURL /pages/images/smart_trainer.svg=}}</ms>
                    <% } else { %>
                        <ms class="power" title="Has power meter">bolt</ms>
                    <% } %>
                <% } %></td>
                <td class="icon"><% if (athlete.gender === 'female') { %>
                    <ms class="female" title="Is female">female</ms>
                <% } %></td>
                <td class="name">{-fmtFlag(athlete.countryCode, {empty: ''})-} {{athlete.sanitizedFullname}}</td>
                <td class="team"><% if (athlete.team) { %>{-teamBadge(athlete.team)-}<% } %></td>
                <td class="power" data-small-header="FTP">{-humanPower(athlete.ftp || null, {suffix: true, html: true})-}</td>
                <td class="weight" data-small-header="WEIGHT">{-humanWeightClass(athlete.weight, {suffix: true, html: true})-}</td>
            </tr>
            <tr class="details"><td colspan="9"></td></tr>
        <% } %>
    </tbody>
<% } %>
