<div class="screen" data-index="{{sIndex}}" data-id="{{screen.id}}">
    <div class="page-title">{{(sIndex + 1).toLocaleString()}}</div>
    <% for (const section of screen.sections) { %>
        <% if (['primary', 'secondary'].includes(section.type)) { %>
            <% const group = section.groups[0]; %>
            <% const spec = groupSpecs[group.type]; %>
            <div class="screen-row columns {{section.type}}" data-group-type="{{group.type}}" data-group-id="{{group.id}}"
                 style="--background-image: {{spec.backgroundImage}};">
                <div class="sub">
                    <heading class="group-title">{{group.title || groupSpecs[group.type].title}}</heading>
                    <div class="field-row" data-field="{{section.id}}-{{group.id}}-0">
                        <div class="key"></div><div class="value"></div><abbr class="unit"></abbr>
                    </div>
                    <div class="field-row" data-field="{{section.id}}-{{group.id}}-1">
                        <div class="key"></div><div class="value"></div><abbr class="unit"></abbr>
                    </div>
                </div>
                <div class="double top" data-field="{{section.id}}-{{group.id}}-2">
                    <div class="value">-</div>
                    <div class="label"></div>
                    <div class="sub-label"></div>
                </div>
            </div>
        <% } else if (section.type === 'tertiary') { %>
            <div class="screen-row columns no-heading {{section.type}}">
                <% for (const group of section.groups) { %>
                    <div class="sub" data-group-type="{{group.type}}" data-group-id="{{group.id}}">
                        <heading class="group-title">{{group.title || groupSpecs[group.type].title}}</heading>
                        <div class="field-row" data-field="{{section.id}}-{{group.id}}-0">
                            <div class="key"></div><div class="value"></div><abbr class="unit"></abbr>
                        </div>
                        <div class="field-row" data-field="{{section.id}}-{{group.id}}-1">
                            <div class="key"></div><div class="value"></div><abbr class="unit"></abbr>
                        </div>
                    </div>
                <% } %>
            </div>
        <% } else { %>
            <% console.warn("Invalid section type:", section.type); %>
        <% } %>
    <% } %>
    <!--<div class="screen-row no-heading no-side-margin">
        <div class="chart-holder ec"></div>
        <div class="s-chart-legend"></div>
    </div>-->
</div>
