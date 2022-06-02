<div class="athlete">
    <header class="title">
        <div class="name">{{profile.sanitizedFullname}}</div>
        <div class="buttons">
            <a title="Toggle visibility of chat messages from yahoos



                                                         ...seriously"
               data-action="toggleMuted" class="{{profile.muted ? 'active' : ''}}"
               href><ms>{{profile.muted ? 'comments_disabled' : 'comment'}}</ms></a>
            <a title="Toggle pinned state for this person.  Used for windows that only show pinned athletes."
               data-action="togglePinned" class="{{profile.pinned ? 'active' : ''}}"
               href><ms>{{profile.pinned ? 'person_pin_circle' : 'add_location'}}</ms></a>
        </div>
    </header>
    <section>
        <a class="avatar" href="{{profile && profile.avatar || ''}}" external target="_blank">
            <img src="{{profile && profile.avatar || 'images/blankavatar.png'}}"/>
        </a>
        <div class="info">
            <div class="row p1">About:</div>
            <% if (obj.profile) { %>
                <% if (profile.team) { %>
                    <div class="row p2"><key>Team</key>{{profile.team}}</div>
                <% } %>
                <% if (profile.level) { %>
                    <div class="row p2"><key>Level</key>{{profile.level}}</div>
                <% } %>
                <% if (profile.age) { %>
                    <div class="row p2"><key>Age</key>{{profile.age}}</div>
                <% } %>
                <% if (profile.weight) { %>
                    <div class="row p2"><key>Weight</key>{-humanWeight(profile.weight, {suffix: true, html: true})-}</div>
                <% } %>
                <% if (profile.height) { %>
                    <div class="row p2"><key>Height</key>{-humanHeight(profile.height, {html: true})-}</div>
                <% } %>
                <% if (profile.ftp) { %>
                    <div class="row p2"><key>FTP</key>{{profile.ftp}}<abbr class="unit">w</abbr></div>
                <% } %>
                <div class="row p2">
                    <a href="https://zwiftpower.com/profile.php?z={{athleteId}}" target="_blank"
                       external>ZwiftPower Profile</a>
                </div>
            <% } else { %>
                <div class="row p1"><key>ID</key> {{athleteId}}</div>
                <div class="row p2"><b>No data available yet</b></div>
                <div class="row p2"><i>Profiles are loaded lazily based on rider proximity.</i></div>
            <% } %>
        </div>
        <div class="info live">
            <div class="row p1">Live:</div>
            <div class="row p2"><key>Power</key><span class="live" data-id="power">-</span><abbr class="unit">w</abbr></div>
            <div class="row p2"><key>HR</key><span class="live" data-id="hr">-</span><abbr class="unit">bpm</abbr></div>
            <div class="row p2"><key>Ride Ons</key><span class="live" data-id="rideons">-</span></div>
            <div class="row p2"><key>Energy</key><span class="live" data-id="kj">-</span><abbr class="unit">kJ</abbr></div>
            <div class="row p2"><key>Watching</key><span class="live" data-id="watching">-</span></div>
        </div>
    </section>
</div>
