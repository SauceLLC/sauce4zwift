<div class="peak-efforts">
    <select name="peak-effort-source">
        <option value="power" {{obj.source === 'power' ? 'selected' : ''}}>Peak Power</option>
        <!--<option value="np" {{obj.source === 'np' ? 'selected' : ''}}>Peak <attr for="tp">NP®</attr></option>-->
        <option value="speed" {{obj.source === 'speed' ? 'selected' : ''}}
            >Peak {{athleteData.state.sport === 'running' ? 'Pace' : 'Speed'}}</option>
        <option value="hr" {{obj.source === 'hr' ? 'selected' : ''}}>Peak HR</option>
        <option value="draft" {{obj.source === 'draft' ? 'selected' : ''}}>Peak Draft</option>
    </select>
    <table class="peak-effort basic selectable">
        <% if (obj.peaks) { %>
            <% for (const [k, x] of Object.entries(peaks)) { %>
                <tr data-peak-source="{{source}}" data-peak-period="{{k}}">
                    <td>{-humanDuration(k, {html: true})-}</td>
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
</div>
