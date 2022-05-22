<div class="screen" data-id="{{screen.id}}">
    <div class="page-title">{{(sIndex + 1).toLocaleString()}}</div>
    <% for (const section of screen.sections) { %>
        <% if (['large-data-fields', 'data-fields'].includes(section.type)) { %>
            <% const group = section.groups[0]; %>
            <% const spec = groupSpecs[group.type]; %>
            <div class="screen-section columns {{section.type}}" data-group-type="{{group.type}}"
                 data-group-id="{{group.id}}" style="--background-image: {{spec.backgroundImage}};">
                <div class="sub">
                    <heading class="group-title">{{group.title || groupSpecs[group.type].title}}</heading>
                    <div class="field-row" data-default="1" data-field="{{section.id}}-{{group.id}}-0">
                        <div class="key"></div><div class="value"></div><abbr class="unit"></abbr>
                    </div>
                    <div class="field-row" data-default="2" data-field="{{section.id}}-{{group.id}}-1">
                        <div class="key"></div><div class="value"></div><abbr class="unit"></abbr>
                    </div>
                </div>
                <div class="double top" data-default="0" data-field="{{section.id}}-{{group.id}}-2">
                    <div class="value">-</div>
                    <div class="label"></div>
                    <div class="sub-label"></div>
                </div>
            </div>
        <% } else if (section.type === 'split') { %>
            <div class="screen-section columns no-heading {{section.type}}">
                <% for (const group of section.groups) { %>
                    <div class="sub" data-group-type="{{group.type}}" data-group-id="{{group.id}}">
                        <heading class="group-title">{{group.title || groupSpecs[group.type].title}}</heading>
                        <div class="field-row" data-default="0" data-field="{{section.id}}-{{group.id}}-0">
                            <div class="key"></div><div class="value"></div><abbr class="unit"></abbr>
                        </div>
                        <div class="field-row" data-default="1" data-field="{{section.id}}-{{group.id}}-1">
                            <div class="key"></div><div class="value"></div><abbr class="unit"></abbr>
                        </div>
                    </div>
                <% } %>
            </div>
        <% } else { %>
            <% console.warn("Invalid section type:", section.type); %>
        <% } %>
    <% } %>
    <!--<div class="screen-section no-heading no-side-margin">
        <div class="chart-holder ec"></div>
        <div class="s-chart-legend"></div>
    </div>-->
</div>
