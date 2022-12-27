<div class="screen {{obj.configuring ? 'configuring' : ''}}" data-id="{{screen.id}}" data-index="{{sIndex}}">
    <div class="page-title">{{(sIndex + 1).toLocaleString()}}</div>
    <% if (!screen.sections.length) { %>
        <div class="no-sections">No data sections added</div>
    <% } %>
    <% for (const [sectionIndex, section] of screen.sections.entries()) { %>
        <% const baseSectionType = sectionSpecs[section.type].baseType; %>
        <% if (['large-data-fields', 'data-fields'].includes(section.type)) { %>
            <% const group = section.groups[0]; %>
            <% const spec = groupSpecs[group.type]; %>
            <div class="screen-section columns {{section.type}}" data-base-section-type="{{baseSectionType}}"
                 data-section-type="{{section.type}}" data-section-id="{{section.id}}"
                 data-group-type="{{group.type}}" data-group-id="{{group.id}}"
                 style="--background-image: {{spec.backgroundImage}};">
                <div class="sub">
                    <% const title = group.title || groupSpecs[group.type].title; %>
                    <heading class="group-title">{{typeof title === 'function' ? title() : title}}</heading>
                    <div class="field-row" data-default="1" data-field="{{section.id}}-{{group.id}}-0">
                        <div class="key" tabindex="0"></div><div class="value" tabindex="0"></div><abbr class="unit"></abbr>
                    </div>
                    <div class="field-row" data-default="2" data-field="{{section.id}}-{{group.id}}-1">
                        <div class="key" tabindex="0"></div><div class="value" tabindex="0"></div><abbr class="unit"></abbr>
                    </div>
                </div>
                <div class="full-height" data-default="0" data-field="{{section.id}}-{{group.id}}-2">
                    <div class="value"></div>
                    <div class="line"><div class="label"></div><div class="unit"></div></div>
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
                                        <option value="{{type}}" {{group.type === type ? 'selected' : ''}}
                                            >{{typeof g.title === 'function' ? g.title() : g.title}}</option>
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
            <!-- leave section div open -->
        <% } else if (['single-data-field'].includes(section.type)) { %>
            <% const group = section.groups[0]; %>
            <% const spec = groupSpecs[group.type]; %>
            <div class="screen-section {{section.type}}" data-base-section-type="{{baseSectionType}}"
                 data-section-type="{{section.type}}" data-section-id="{{section.id}}"
                 data-group-type="{{group.type}}" data-group-id="{{group.id}}"
                 style="--background-image: {{spec.backgroundImage}};">
                <div class="full-height" data-default="0" data-field="{{section.id}}-{{group.id}}-0">
                    <% const title = group.title || groupSpecs[group.type].title; %>
                    <heading class="group-title">{{typeof title === 'function' ? title() : title}}</heading>
                    <div class="value"></div>
                    <div class="line">
                        <div class="label"></div>
                        <div class="unit"></div>
                        <div class="sub-label"></div>
                    </div>
                </div>
                <% if (obj.configuring) { %>
                    <dialog class="edit">
                        <header>Edit Section: {{sectionIndex +1 }}</header>
                        <form method="dialog">
                            <label>Type: {{sectionSpecs[section.type].title}}</label>
                            <label>Data Group:
                                <select name="group" data-id="{{group.id}}">
                                    <% for (const [type, g] of Object.entries(groupSpecs)) { %>
                                        <option value="{{type}}" {{group.type === type ? 'selected' : ''}}
                                            >{{typeof g.title === 'function' ? g.title() : g.title}}</option>
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
            <!-- leave section div open -->
        <% } else if (section.type === 'split-data-fields') { %>
            <div class="screen-section columns {{section.type}}" data-section-type="{{section.type}}"
                 data-base-section-type="{{baseSectionType}}" data-section-id="{{section.id}}">
                <% for (const group of section.groups) { %>
                    <div class="sub" data-group-type="{{group.type}}" data-group-id="{{group.id}}">
                        <% const title = group.title || groupSpecs[group.type].title; %>
                        <heading class="group-title">{{typeof title === 'function' ? title() : title}}</heading>
                        <div class="field-row" data-default="0" data-field="{{section.id}}-{{group.id}}-0">
                            <div class="key" tabindex="0"></div><div class="value" tabindex="0"></div><abbr class="unit"></abbr>
                        </div>
                        <div class="field-row" data-default="1" data-field="{{section.id}}-{{group.id}}-1">
                            <div class="key" tabindex="0"></div><div class="value" tabindex="0"></div><abbr class="unit"></abbr>
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
                                            <option value="{{type}}" {{group.type === type ? 'selected' : ''}}
                                                >{{typeof g.title === 'function' ? g.title() : g.title}}</option>
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
            <!-- leave section div open -->
        <% } else if (section.type === 'line-chart') { %>
            <div class="screen-section {{section.type}}" tabindex="0"
                 data-section-type="{{section.type}}" data-base-section-type="{{baseSectionType}}"
                 data-section-id="{{section.id}}">
                <div class="chart-holder ec">
                    <% if (obj.configuring) { %>
                        <img class="example" src="images/examples/sauce-line-chart-cap-50pct.png"/>
                    <% } %>
                </div>
                <div class="s-chart-legend"></div>
                <% if (obj.configuring) { %>
                    <% const settings = section.settings || sectionSpecs[section.type].defaultSettings || {}; %>
                    <dialog class="edit">
                        <header>Edit Section: {{sectionIndex +1 }}</header>
                        <form method="dialog">
                            <label>Type: {{sectionSpecs[section.type].title}}</label>
                            <label>Data points to show:
                                <input name="dataPoints" type="number" placeholder="auto"
                                       value="{{settings.dataPoints || ''}}"/>
                            </label>
                            <small><i>Leave blank for automatic mode</i></small>
                            <hr/>
                            <label>Enable Power: <input type="checkbox" name="powerEn"
                                {{settings.powerEn ? 'checked' : ''}}/></label>
                            <label>Enable Heart Rate: <input type="checkbox" name="hrEn"
                                {{settings.hrEn ? 'checked' : ''}}/></label>
                            <label>Enable Speed: <input type="checkbox" name="speedEn"
                                {{settings.speedEn ? 'checked' : ''}}/></label>
                            <label>Enable Cadence: <input type="checkbox" name="cadenceEn"
                                {{settings.cadenceEn ? 'checked' : ''}}/></label>
                            <label>Enable Draft: <input type="checkbox" name="draftEn"
                                {{settings.draftEn ? 'checked' : ''}}/></label>
                            <label>Enable W'bal: <input type="checkbox" name="wbalEn"
                                {{settings.wbalEn ? 'checked' : ''}}/></label>
                            <hr/>
                            <label>Show max value from:
                                <select name="markMax">
                                    <option {{!settings.markMax ? 'selected' : ''}} value="">-</option>
                                    <option {{settings.markMax === 'power' ? 'selected' : ''}} value="power">Power</option>
                                    <option {{settings.markMax === 'hr' ? 'selected' : ''}} value="hr">Heart Rate</option>
                                    <option {{settings.markMax === 'speed' ? 'selected' : ''}} value="speed">Speed</option>
                                    <option {{settings.markMax === 'cadence' ? 'selected' : ''}} value="cadence">Cadence</option>
                                    <option {{settings.markMax === 'draft' ? 'selected' : ''}} value="draft">Draft</option>
                                    <option {{settings.markMax === 'wbal' ? 'selected' : ''}} value="wbal">W'bal (minimum)</option>
                                </select>
                            </label>
                            <footer>
                                <button value="cancel">Cancel</button>
                                <button value="save" class="primary">Save</button>
                            </footer>
                        </form>
                    </dialog>
                <% } %>
            <!-- leave section div open -->
        <% } else if (section.type === 'time-in-zones') { %>
            <div class="screen-section {{section.type}}" tabindex="0"
                 data-section-type="{{section.type}}" data-base-section-type="{{baseSectionType}}"
                 data-section-id="{{section.id}}">
                <div class="zones-holder {{section.settings.style}}">
                    <% if (obj.configuring) { %>
                        <% if (section.settings.style === 'vert-bars') { %>
                            <img class="example" src="images/examples/power-zones-vert-chart.png"/>
                        <% } else if (section.settings.style === 'horiz-bar') { %>
                            <img class="example" src="images/examples/power-zones-horiz-chart.png"/>
                        <% } else { %>
                            <img class="example" src="images/examples/power-zones-pie-chart.png"/>
                        <% } %>
                    <% } %>
                </div>
                <% if (obj.configuring) { %>
                    <% const settings = section.settings || sectionSpecs[section.type].defaultSettings || {}; %>
                    <dialog class="edit">
                        <header>Edit Section: {{sectionIndex +1 }}</header>
                        <form method="dialog">
                            <label>Type: {{sectionSpecs[section.type].title}}</label>
                            <hr/>
                            <label>Type
                                <select name="type">
                                    <option {{settings.type === 'power' ? 'selected' : ''}} value="power">Power</option>
                                    <option disabled {{settings.type === 'hr' ? 'selected' : ''}} value="hr">Heart Rate (Soon Nordy!)</option>
                                </select>
                            </label>
                            <label>Style
                                <select name="style">
                                    <option {{settings.style === 'vert-bars' ? 'selected' : ''}}
                                            value="vert-bars">Vertical Bars</option>
                                    <option {{settings.style === 'horiz-bar' ? 'selected' : ''}}
                                            value="horiz-bar">Horizontal Bar</option>
                                    <option {{settings.style === 'pie' ? 'selected' : ''}}
                                            value="pie">Pie Chart</option>
                                </select>
                            </label>
                            <footer>
                                <button value="cancel">Cancel</button>
                                <button value="save" class="primary">Save</button>
                            </footer>
                        </form>
                    </dialog>
                <% } %>
            <!-- leave section div open -->
        <% } else { %>
            <div class="screen-section" data-section-type="{{section.type}}"
                 data-base-section-type="{{baseSectionType}}" data-section-id="{{section.id}}">
                <b>Invalid section type: {{section.type}}</b>
        <% } %>
        <% if (obj.configuring) { %>
             <div class="button-mask">
                 <div class="button-group vertical">
                    <div class="button" title="Edit section" data-action="edit">
                        <img class="fa" src="images/fa/cog-duotone.svg"/>
                    </div>
                    <div class="button" title="Delete section" data-action="delete">
                        <img class="fa" src="images/fa/times-circle-duotone.svg"/>
                    </div>
                </div>
            </div>
        <% } %>
        </div><!-- close section div -->
    <% } %>
</div>
