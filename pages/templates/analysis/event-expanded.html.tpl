<div class="container event-expanded">
    <header>
        <div>Nearby Participants</div>
        <div class="spacer"></div>
        <div class="button std icon-only xl" data-action="refresh-expanded"><ms>refresh</ms></div>
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
        <% for (const x of eventExpanded.nearby) { %>
            {{console.log(x)}}
            <tr class="{{x.athleteId === athlete.id ? 'viewing' : ''}}">
                <td class="place">{-humanPlace(x.place, {suffix: true, html: true})-}</td>
                <td class="name">
                    <a href="profile.html?id={{x.athleteId}}&windowType=profile"
                       target="profile_popup_{{x.athleteId}}">{{x.firstName}} {{x.lastName}}</a>
                    <% if (x.gender === 'female') { %>
                        <ms class="female">female</ms>
                    <% } %>
                </td>
                <td>{-humanTimer(x.finishTime, {long: true, ms: true, html: true})-}</td>
                <% if (settings.preferWkg && athlete.weight) { %>
                    <td title="{{humanPower(x.stats.power.avg, {suffix: true})}}"
                        >{-humanWkg(x.stats.power.avg / athlete.weight, {suffix: true, html: true})-}</td>
                <% } else { %>
                    <td title="{{athlete.weight ? humanWkg(x.stats.power.avg / athlete.weight, {suffix: true}) : ''}}"
                        >{-humanPower(x.stats.power.avg, {suffix: true, html: true})-}</td>
                <% } %>
                <td>{-humanPace(x.stats.speed.avg, {suffix: true, html: true, sport: x.sport})-}</td>
                <td>{-humanNumber(x.stats.hr.avg, {suffix: 'bpm', html: true})-}</td>
                <td>{-fields.fmtPackTime(x.stats)-}</td>
                <td><a href="#" data-action="add-to-compare" title="Add to compare"><ms>add</ms></a></td>
            </tr>
        <% } %>
    </table>
</div>
