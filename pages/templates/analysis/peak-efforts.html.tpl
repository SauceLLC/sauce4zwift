<select name="peak-effort-source">
    <option value="power" {{obj.source === 'power' ? 'selected' : ''}}>Peak Power</option>
    <option value="np" {{obj.source === 'np' ? 'selected' : ''}}>Peak NP®</option>
    <option value="speed" {{obj.source === 'speed' ? 'selected' : ''}}
        >Peak {{obj.sport === 'running' ? 'Pace' : 'Speed'}}</option>
    <option value="hr" {{obj.source === 'hr' ? 'selected' : ''}}>Peak HR</option>
    <option value="draft" {{obj.source === 'draft' ? 'selected' : ''}}>Peak Draft</option>
</select>
<table data-source="peaks" data-peak-source="{{source}}" class="peak-effort basic selectable">
    <% if (obj.peaks) { %>
        <% for (const x of peaks) { %>
            <tr data-peak-period="{{x.period}}"
                class="{{x.period === selectedPeriod ? 'selected' : ''}}">
                <td>{-humanDuration(x.period, {html: true, maxParts: 1, precision: 1})-}</td>
                <td>
                    <span class="peak-value">{-formatter(x.avg)-}</span>
                    <% if (x.rank?.badge) { %>
                        <img src="/pages{{x.rank.badge}}" class="rank"/>
                    <% } %>
                </td>
            </tr>
        <% } %>
    <% } %>
</table>
