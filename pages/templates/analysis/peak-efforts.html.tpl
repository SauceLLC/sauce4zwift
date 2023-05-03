<div class="peak-efforts">
    <select name="peak-effort-source">
        <option value="power"
                {{settings.peakEffortSource === 'power' ? 'selected' : ''}}
            >Peak Power</option>
        <!--<option value="power_wkg"
                {{settings.peakEffortSource === 'power_wkg' ? 'selected' : ''}}
            >Peak W/kg</option>-->
        <option value="speed"
                {{settings.peakEffortSource === 'speed' ? 'selected' : ''}}
            >Peak {{athleteData.state.sport === 'running' ? 'Pace' : 'Speed'}}</option>
        <option value="hr"
                {{settings.peakEffortSource === 'hr' ? 'selected' : ''}}
            >Peak HR</option>
        <option value="draft"
                {{settings.peakEffortSource === 'draft' ? 'selected' : ''}}
            >Peak Draft</option>
    </select>
    <table>
        <% const source = settings.peakEffortSource || 'power'; %>
        <% const peaks = (athleteData.stats || {})[source]?.peaks; %>
        <% for (const [k, v] of Object.entries(peaks)) { %>
            <tr><td>{{humanDuration(k)}}</td><td>{-peakFormatters[source](v.avg)-}</td></tr>
        <% } %>
    </table>
</div>
