<div class="screen {{obj.configuring ? 'configuring' : ''}}" data-id="{{screen.id}}" data-index="{{sIndex}}">
    <div class="page-title">{{(sIndex + 1).toLocaleString()}}</div>
    <% for (const [sectionIndex, section] of screen.sections.entries()) { %>
        <% if (['large-data-fields', 'data-fields'].includes(section.type)) { %>
            <% const group = section.groups[0]; %>
            <% const spec = groupSpecs[group.type]; %>
            <div class="screen-section columns {{section.type}}"  data-section-type="{{section.type}}"
                 data-section-id="{{section.id}}" data-group-type="{{group.type}}" data-group-id="{{group.id}}"
                 style="--background-image: {{spec.backgroundImage}};">
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
                    <div class="value"></div>
                    <div class="label"></div>
                    <div class="sub-label"></div>
                </div>
                <% if (obj.configuring) { %>
                    <dialog class="edit">
                        <header>Edit Section: {{sectionIndex +1 }}</header>
                        <form method="dialog">
                            <label>Type: {{sectionSpecs[section.type].title}}</label>
                            <label>Data Group:
                                <select name="group" data-id="{{group.id}}">
                                    <% for (const [type, g] of Object.entries(groupSpecs)) { %>
                                        <option value="{{type}}" {{group.type === type ? 'selected' : ''}}>{{g.title}}</option>
                                    <% } %>
                                </select>
                            </label>
                            <footer>
                                <button value="cancel">Cancel</button>
                                <button value="save" class="primary">Save</button>
                            </footer>
                        </form>
                    </dialog>
                <% } %>
        <% } else if (section.type === 'split-data-fields') { %>
            <div class="screen-section columns no-heading {{section.type}}" data-section-type="{{section.type}}"
                 data-section-id="{{section.id}}">
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
                <% if (obj.configuring) { %>
                    <dialog class="edit">
                        <header>Edit Section: {{sectionIndex +1 }}</header>
                        <form method="dialog">
                            <label>Type: {{sectionSpecs[section.type].title}}</label>
                            <% for (const [i, group] of section.groups.entries()) { %>
                                <label>{{!i ? 'Left' : 'Right'}} fields:
                                    <select name="group" data-id="{{group.id}}">
                                        <% for (const [type, g] of Object.entries(groupSpecs)) { %>
                                            <option value="{{type}}" {{group.type === type ? 'selected' : ''}}>{{g.title}}</option>
                                        <% } %>
                                    </select>
                                </label>
                            <% } %>
                            <footer>
                                <button value="cancel">Cancel</button>
                                <button value="save" class="primary">Save</button>
                            </footer>
                        </form>
                    </dialog>
                <% } %>
        <% } else { %>
            <div class="screen-section" data-section-type="{{section.type}}" data-section-id="{{section.id}}">
                <b>Invalid section type: {{section.type}}</b>
        <% } %>
        <% if (obj.configuring) { %>
             <div class="button-group vertical">
                <div class="button" title="Edit section" data-action="edit">
                    <img class="fa" src="images/fa/cog-duotone.svg"/>
                </div>
                <div class="button" title="Delete section" data-action="delete">
                    <img class="fa" src="images/fa/times-circle-duotone.svg"/>
                </div>
            </div>
        <% } %>
        </div><!-- close section div -->
    <% } %>
    <!--<div class="screen-section no-heading no-side-margin">
        <div class="chart-holder ec"></div>
        <div class="s-chart-legend"></div>
    </div>-->
</div>
