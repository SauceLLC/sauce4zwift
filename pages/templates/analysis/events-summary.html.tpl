<% if (obj.athleteData?.events.length) { %>
    <header>Events</header>
    <% for (const x of athleteData.events) { %>
        <% const sg = await common.getEventSubgroup(x.subgroupId); %>
        <div class="event">
            {{sg.name}} - {{sg.subgroupLabel}}
        </div>
        {{console.log(sg)}}
    <% } %>
<% } %>
