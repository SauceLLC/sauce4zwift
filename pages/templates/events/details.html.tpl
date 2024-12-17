<div class="container">
    <div class="event-info">
        <div class="card">
            <img class="event-image" src="{{event.imageUrl}}"/>
            <div class="meta">
                <div title="Event World"><ms>map</ms> {{world}}</div>
                <div title="Route">
                    <ms>route</ms>
                    <a href="/pages/geo.html?course={{event.courseId}}&route={{event.routeId}}"
                       target="event-route-preview">
                        <% if (event.sameRoute) { %>
                            {{(event.laps && event.laps > 1) ? event.laps + ' x ' : ''}}{{event.route?.name}}
                        <% } else { %>
                            <% const uRoutes = new Set(event.eventSubgroups ? event.eventSubgroups.map(x => x.route?.name) : [event.route?.name]); %>
                            {{Array.from(uRoutes).join(', ')}}
                        <% } %>
                    </a>
                </div>
                <div title="Climbing">
                    <ms>landscape</ms>
                    {-humanElevation(event.routeClimbing, {suffix: true, html: true})-}
                </div>
                <div title="View event on Zwift Power">
                    <a href="https://zwiftpower.com/events.php?zid={{event.id}}"
                       target="_blank" external><img src="/pages/images/zp_logo.png"/></a>
                </div>
            </div>
            <% if (event.sameRoute) { %>
                <div class="elevation-chart"
                     data-sg-id="{{event.eventSubgroupId || event.eventSubgroups[0].id}}"></div>
            <% } %>
        </div>
        <div class="desc">{{event.description}}</div>
        <% if (event.allTags.length) { %>
            <div class="tags">
                <% for (const x of event.allTags.filter(x => !x.match(/(^timestamp=|^created_)/))) { %>
                    <div class="badge">{{x}}</div>
                <% } %>
            </div>
        <% } %>
    </div>
    <% if (event.eventSubgroups && event.eventSubgroups.length) { %>
        <div class="subgroups">
            <% for (const sg of event.eventSubgroups) { %>
                <div class="event-subgroup loading" data-event-subgroup-id="{{sg.id}}">
                    <header>
                        <div class="label">
                            <div class="group">Group</div>
                            {-eventBadge(sg.subgroupLabel)-}
                            <div class="std button danger signup-action only-signedup"
                                 data-action="unsignup"><ms>delete</ms>Leave</div>
                            <div class="std button primary signup-action only-can-signup"
                                 data-action="signup"><ms>add_box</ms>Sign up</div>
                            <b class="only-results">Results</b>
                        </div>
                        <% if (sg.rangeAccessLabel) { %>
                            <div title="Zwift Racing Score range"><ms>sports_score</ms> {{sg.rangeAccessLabel}}</div>
                        <% } %>
                        <label class="only-results" style="user-select: none; font-size:0.9em;">
                            <input oninput="this.closest('.event-subgroup').classList.toggle('wkg')"
                                   type="checkbox" name="wkg"/>
                            W/kg
                        </label>
                        <div class="optional-1"></div>
                        <% if (sg.durationInSeconds) { %>
                            <div title="Duration"><ms>timer</ms> {-humanTimer(sg.durationInSeconds)-}</div>
                        <% } else { %>
                            <div title="Distance"><ms>distance</ms> {-humanDistance(sg.distanceInMeters || sg.routeDistance, {suffix: true, html: true})-}</div>
                        <% } %>
                        <% if (!event.sameRoute) { %>
                            <a href="/pages/geo.html?course={{event.courseId}}&route={{sg.routeId}}"
                               title="Route" target="event-route-preview">
                                <ms>route</ms>
                                <% if (sg.laps && sg.laps > 1) { %>
                                    {{sg.laps}} x
                                <% } %>
                                {{sg.route?.name}}
                            </a>
                        <% } %>
                        <div title="Entrants"><ms>groups</ms> <span class="field-size">{{humanNumber(sg.totalEntrantCount)}}<!--rough estimate--></span></div>
                        <div class="name">{{sg.name}}</div>
                        <div class="expand-collapse">
                            <div class="button not-collapsed" data-action="collapse-subgroup"
                                 title="Collapse subgroup"><ms large>compress</ms></div>
                            <div class="button only-collapsed" data-action="expand-subgroup"
                                 title="Expand subgroup"><ms large>expand</ms></div>
                        </div>
                    </header>
                    <% if (!event.sameRoute) { %>
                        <div class="elevation-chart" data-sg-id="{{sg.id}}"></div>
                    <% } %>
                    <div class="entrants-wrap">
                        <table class="entrants expandable"></table>
                    </div>
                </div>
            <% } %>
        </div>
    <% } %>
</div>
