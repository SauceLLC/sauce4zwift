<div class="container segment-results">
    <header>
        <% if (type === 'live') { %>
            Live Results
        <% } else if (type.startsWith('event')) { %>
            Event Results
            <% if (type.endsWith('tentative')) { %>
                <div class="badge" style="--hue:42deg"
                     title="May include DNFs while event is in progress">Tentative</div>
            <% } %>
        <% } %>
    </header>
    <table class="results basic">
        <thead>
            <tr>
                <th>Place</th>
                <th>Name</th>
                <th>Time</th>
                <th>Power</th>
                <th>Finish</th>
            </tr>
        </thead>
        <% for (const [i, x] of results.entries()) { %>
            <tr class="{{x.athleteId === athlete.id ? 'viewing' : ''}}
                       {{x.lowConfidence ? 'low-confidence' : ''}}">
                <td>
                    <% if (i < 3) { %>
                        <ms class="trophy {{!i ? 'gold' : i === 1 ? 'silver' : 'bronze'}}">trophy</ms>
                    <% } else { %>
                        {-humanPlace(i + 1, {suffix: true, html: true})-}
                    <% } %>
                </td>
                <td>
                    <a href="profile.html?id={{x.athleteId}}&windowType=profile"
                       target="profile_popup_{{x.athleteId}}">{{x.firstName}} {{x.lastName}}</a>
                    <% if (x.gender === 'female') { %>
                        <ms class="female">female</ms>
                    <% } %>
                </td>
                <td>{-humanTimer(x.elapsed, {long: true, ms: true, html: true})-}</td>
                <td>
                    <% if (x.powerType !== 'POWER_METER') { %>
                        <span class="negative" title="Virtual power estimate">~
                    <% } %>
                    {-humanPower(x.avgPower, {suffix: true, html: true})-}</td>
                    <% if (x.powerType !== 'POWER_METER') { %>
                        </span>
                    <% } %>
                <td>
                    <% if (type === 'live') { %>
                        {-humanRelTime(x.ts, {short: true, maxParts: 1, html: true})-}
                    <% } else { %>
                        {-humanTimer((x.ts - x.eventSubgroup.ts) / 1000, {html: true, ms: true})-}
                    <% } %>
                </td>
            </tr>
        <% } %>
    </table>
</div>
