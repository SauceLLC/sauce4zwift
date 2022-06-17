<div class="athlete">
    <header class="title">
        <div class="name">{{profile.sanitizedFullname}}</div>
        <div class="buttons">
            
            <a href="https://zwiftpower.com/profile.php?z={{athleteId}}" target="_blank"
               title="Open ZwiftPower profile"
               external><img src="images/zp_logo.png"/></a>
            <% if (gameConnectionStatus && gameConnectionStatus.connected) { %>
                <a title="Watch this athlete"
                   data-action="watch" href><ms>video_camera_front</ms></a>
            <% } else { %>
                <a title="Game connection is not enabled or established which is required to send the watch command."
                   disabled data-action="watch"><ms>videocam</ms></a>
            <% } %>
            <a title="Toggle visibility of chat messages from yahoos



                                                         ...seriously"
               data-action="toggleMuted" class="{{profile.muted ? 'active' : ''}}"
               href><ms>{{profile.muted ? 'comments_disabled' : 'comment'}}</ms></a>
            <a title="Toggle following status" href class="{{profile.following ? 'active' : ''}}"
               data-action="toggleFollow"><ms>{{profile.following ? 'group_remove' : 'group_add'}}</ms></a>
            <% if (profile.following) { %>
                <a title="Toggle favorite status" href
                   data-action="toggleFavorite"><ms>{{profile.favorite ? 'grade' : 'star'}}</ms></a>
            <% } %>
            <a title="Toggle marked state for this person.  Marked athletes will receieve extra attention and allow quick filtering.  Recommended for friends or foes in race situations."
               data-action="toggleMarked" class="{{profile.marked ? 'active' : ''}}"
               href><ms>{{profile.marked ? 'bookmark_added' : 'bookmark_add'}}</ms></a>
        </div>
    </header>
    <section>
        <a class="avatar" href="{{profile && profile.avatar || ''}}" external target="_blank">
            <img src="{{profile && profile.avatar || 'images/blankavatar.png'}}"/>
        </a>
        <div class="info">
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
            <% } else { %>
                <div class="row p1"><key>ID</key> {{athleteId}}</div>
                <div class="row p2"><b>No data available</b></div>
            <% } %>
        </div>
        <div class="info live">
            <div class="row p2"><key>Power</key><span class="live" data-id="power">-</span><abbr class="unit">w</abbr></div>
            <div class="row p2"><key>HR</key><span class="live" data-id="hr">-</span><abbr class="unit">bpm</abbr></div>
            <div class="row p2"><key>Ride Ons</key><span class="live" data-id="rideons">-</span></div>
            <div class="row p2"><key>Energy</key><span class="live" data-id="kj">-</span><abbr class="unit">kJ</abbr></div>
            <div class="row p2"><key>Watching</key><span class="live" data-id="watching">-</span></div>
        </div>
    </section>
</div>
