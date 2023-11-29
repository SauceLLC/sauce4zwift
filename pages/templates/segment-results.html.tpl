<div class="results">
    <% for (const [i, x] of results.entries()) { %>
        <div class="result">
            <div class="place">
                <% if (i < 3) { %>
                    <ms class="trophy {{!i ? 'gold' : i === 1 ? 'silver' : 'bronze'}}">trophy</ms>
                <% } else { %>
                    {-humanPlace(i + 1, {suffix: true, html: true})-}
                <% } %>
            </div>
            <div class="name">
                <a href="profile.html?id={{x.athleteId}}&windowType=profile"
                   target="profile_popup_{{x.athleteId}}">{{x.firstName}} {{x.lastName}}</a>
                <% if (x.gender === 'female') { %>
                    <ms class="female">female</ms>
                <% } %>
            </div>
            <div class="power">
                <% if (x.powerType !== 'POWER_METER') { %>
                    <span class="negative" title="Virtual power estimate">~
                <% } %>
                {-humanPower(x.avgPower, {suffix: true, html: true})-}
                <% if (x.powerType !== 'POWER_METER') { %>
                    </span>
                <% } %>
            </div>
            <div class="time">{-humanTimer(x.elapsed, {long: true, ms: true, html: true})-}</div>
            <!--<div class="hr">{-humanNumber(x.avgHR || undefined, {suffix: 'bpm', html: true})-}</div>-->
            <div class="when">{{humanRelTime(x.ts, {short: true, maxParts: 1})}}</div>
        </div>
    <% } %>
</div>
