<div class="container">
    <table class="results basic">
        <thead>
            <tr>
                <th>Place</th>
                <th>Time</th>
                <th>Name</th>
                <th>Date</th>
                <th>Power</th>
                <th>HR</th>
                <th>Activity</th>
            </tr>
        </thead>
        <% for (const [i, x] of results.entries()) { %>
            <tr>
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
                    <% if (x.male === false) { %>
                        <ms class="female">female</ms>
                    <% } %>
                </td>
                <td>{{humanTimer(x.elapsed)}}{{console.log(x.elapsed)}}</td>
                <td>{{humanDate(x.finishTime, {short: true})}}</td>
                <td>
                    <% if (x.powerType !== 'POWER_METER') { %>
                        <span class="negative" title="Virtual power estimate">~
                    <% } %>
                    {-humanPower(x.avgPower, {suffix: true, html: true})-}</td>
                    <% if (x.powerType !== 'POWER_METER') { %>
                        </span>
                    <% } %>
                <td>{-humanNumber(x.avgHR || undefined, {suffix: 'bpm', html: true})-}</td>
                <td><a href="https://www.zwift.com/activity/{{x.activityId}}"
                       target="_blank" external><ms>open_in_new</ms>Open on web</a></td>
            </tr>
        <% } %>
    </table>
</div>
