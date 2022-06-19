<div class="athlete">
    <% if (!profile) { %>
        <header class="title">
            <div class="name">
                Profile not found: {{athleteId}}
            </div>
        </header>
    <% } else { %>
        <header class="title">
            <div class="name">
                <% if (profile.countryCode) { %>
                    <img class="flag" src="{{flags[profile.countryCode]}}"
                         title="{{nations[profile.countryCode]}}"/>
                <% } %>
                {{profile.sanitizedFullname}}
            </div>
            <div class="buttons">
                <a href="https://zwiftpower.com/profile.php?z={{athleteId}}"
                   title="Open ZwiftPower profile"
                   target="_blank" external><img src="images/zp_logo.png"/></a>
                <% if (gameConnectionStatus && gameConnectionStatus.connected) { %>
                    <a title="Watch this athlete"
                       data-action="watch" href><ms>video_camera_front</ms></a>
                <% } else { %>
                    <a title="Game Connection is required to send the Watch command"
                       disabled><ms>videocam</ms></a>
                    <a title="Game Connection is required to send the Join (i.e. ride with) command"
                       disabled><ms>follow_the_signs</ms></a>
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
            <% if (profile.avatar) { %>
                <a class="avatar" href="{{profile.avatar}}" external target="_blank">
                    <img src="{{profile.avatar}}"/>
                </a>
            <% } else { %>
                <a class="avatar"><img src="images/blankavatar.png"/></a>
            <% } %>
            <div class="info">
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
                    <div class="row p2"><key>Weight</key>{-humanWeightClass(profile.weight, {suffix: true, html: true})-}</div>
                <% } %>
                <% if (profile.height) { %>
                    <div class="row p2"><key>Height</key>{-humanHeight(profile.height, {html: true})-}</div>
                <% } %>
                <% if (profile.ftp) { %>
                    <div class="row p2"><key>FTP</key>{{profile.ftp}}<abbr class="unit">w</abbr></div>
                <% } %>
                <% if (profile.type !== 'NORMAL') { %>
                    <div class="row p2"><key>Type</key>{{prettyType || profile.type}}</div>
                <% } %>
            </div>
            <div class="info live">
                <div class="row p2"><key>Power</key><span class="live" data-id="power">-</span></div>
                <div class="row p2"><key>Speed</key><span class="live" data-id="speed">-</span></div>
                <div class="row p2"><key>HR</key><span class="live" data-id="hr">-</span><abbr class="unit">bpm</abbr></div>
                <div class="row p2"><key>Ride Ons</key><span class="live" data-id="rideons">-</span></div>
                <div class="row p2"><key>Energy</key><span class="live" data-id="kj">-</span><abbr class="unit">kJ</abbr></div>
                <div class="row p2"><key>Watching</key><span class="live" data-id="watching">-</span></div>
            </div>
        </section>
    <% } %>
    <% if (obj.debug) { %>
        <section><pre class="debug"></pre></section>
    <% } %>
</div>
