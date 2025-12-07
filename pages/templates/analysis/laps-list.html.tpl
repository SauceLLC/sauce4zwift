<header>
    <ms>timer</ms>
    <div class="title">Laps</div>
    <div class="expander" data-id="compress" title="Collapse section"><ms>compress</ms></div>
    <div class="expander" data-id="expand" title="Expand section"><ms>expand</ms></div>
</header>

<article class="overflow">
    <% const hasLaps = !!(obj.slices && slices.filter(x => x.endIndex).length ); %>
    <table data-source="laps" class="laps-list basic {{hasLaps ? 'selectable' : ''}}">
        <thead>
            <tr>
                <% if (hasLaps) { %>
                    <th style="min-width: 4ch;"></th>
                    <th>Time</th>
                    <th>Dist</th>
                    <th>Power</th>
                    <th>Pace</th>
                    <th>HR</th>
                    <th>Pack</th>
                <% } else { %>
                    <th>&nbsp;</th>
                <% } %>
            </tr>
        </thead>
        <tbody>
            <% if (hasLaps) { %>
                <% const ordered = settings.reverseLapsAndSegments ? slices.toReversed() : slices; %>
                <% for (const x of ordered) { %>
                    <% if (!x.endIndex) continue; /* reset data, not moving */ %>
                    <% const index = slices.indexOf(x); %>
                    <tr class="summary {{index === selectedIndex ? 'selected' : ''}} {{x.active ? 'active' : ''}}" data-index="{{index}}">
                        <td class="num" data-grid-mode-prefix="Lap: ">{{index + 1}}</td>
                        <td>{-humanTimer(x.stats.activeTime, {long: true, ms: true, html: true})-}</td>
                        <td>{-humanDistance(streams.distance[x.endIndex] - streams.distance[Math.max(0, x.startIndex - 1)], {suffix: true, html: true})-}</td>
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
                    </tr>
                <% } %>
            <% } else { %>
                <tr class="summary">
                    <td><small>No Lap Data</small></td>
                </tr>
            <% } %>
        </tbody>
    </table>
</article>
