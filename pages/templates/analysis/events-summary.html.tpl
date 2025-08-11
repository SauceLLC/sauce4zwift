<% if (eventSubgroups.size) { %>
    <header>
        <ms>event</ms>
        <div class="title">Events</div>
    </header>
    <% for (const x of eventSubgroups.values()) { %>
        <section class="event-summary">
            <header>
                <div class="title">
                    <% if (x.results) { %>
                        <% const ourResult = x.results.find(x => x.profileId === athlete.id); %>
                        <% if (ourResult) { %>
                            <div class="rank">
                                <% if (ourResult.rank <= 3) { %>
                                    <ms class="trophy {{ourResult.rank === 1 ? 'gold' : ourResult.rank === 2 ? 'silver': 'bronze'}}">trophy</ms>
                                <% } else { %>
                                    {-humanPlace(ourResult.rank, {suffix: true, html: true})-}
                                <% } %>
                            </div>
                        <% } %>
                    <% } %>
                    <a href="/pages/events.html?id={{x.eventId}}&windowType=events"
                       target="analysis_event">{{x.name}}</a></div>
                </div>
                <div class="expander" data-id="compress" title="Collapse event"><ms>compress</ms></div>
                <div class="expander" data-id="expand" title="Show event details"><ms>expand</ms></div>
            </header>
            <section>
                details
            </section>
        </section>
    <% } %>
<% } %>
