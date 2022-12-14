<div class="profile">
    <% if (!athlete) { %>
        <header class="title">
            <div class="name">
                Athlete not found: {{athleteId}}
            </div>
        </header>
    <% } else { %>
        <header class="title">
            <div class="name">
                <% if (athlete.type !== 'NORMAL') { %>
                    <span class="special-badge">({{athlete.type.replace(/_/, ' ')}})</span>
                <% } %>
                <% if (athlete.countryCode) { %>
                    <img class="flag" src="{{flags[athlete.countryCode]}}"
                         title="{{nations[athlete.countryCode]}}"/>
                <% } %>
                {{athlete.sanitizedFullname}}
            </div>
            <div class="buttons">
                <a href="https://zwiftpower.com/profile.php?z={{athleteId}}"
                   title="Open ZwiftPower profile"
                   target="_blank" external><img src="images/zp_logo.png"/></a>
                <% if (gameConnectionStatus && gameConnectionStatus.connected) { %>
                    <a title="Watch this athlete" data-action="watch" href><ms>video_camera_front</ms></a>
                    <% if (obj.debug) { %>
                        <a title="Join this athlete" data-action="join" href><ms>follow_the_signs</ms></a>
                    <% } %>
                <% } else { %>
                    <a title="Game Connection is required to send the Watch command" disabled><ms>videocam</ms></a>
                    <% if (obj.debug) { %>
                        <a title="Game Connection is required to send the Join (i.e. ride with) command"
                           disabled><ms>follow_the_signs</ms></a>
                    <% } %>
                <% } %>
                <a title="Toggle visibility of chat messages from this person"
                   data-action="toggleMuted" class="{{athlete.muted ? 'active' : ''}}"
                   href><ms>comments_disabled</ms></a>
                <a title="Export FIT activity file of sampled data"
                   data-action="exportFit" href><ms>file_download</ms></a>
                <a title="Give a Ride On to this athlete" {{obj.rideonSent ? 'disabled' : 'href'}}
                   data-action="rideon"><ms>thumb_up</ms></a>
                <% if (athlete.following) { %>
                    <a title="You are following this athlete, click to unfollow" href class="active"
                       data-action="unfollow"><ms>follow_the_signs</ms></a>
                <% } else if (athlete.followRequest) { %>
                    <a title="Follow request sent" disabled class=""><ms>pending</ms></a>
                <% } else { %>
                    <a title="You are not following this athlete, click to follow" href
                       data-action="follow"><ms>follow_the_signs</ms></a>
                <% } %>
                <a title="Toggle marked state for this person.  Marked athletes will receieve extra attention and allow quick filtering.  Recommended for friends or foes in race situations."
                   data-action="toggleMarked" class="{{athlete.marked ? 'active' : ''}}"
                   href><ms>{{athlete.marked ? 'bookmark_added' : 'bookmark_add'}}</ms></a>
                <% if (!obj.embedded) { %>
                    <a href title="Close this window" data-action="close" class="electron-only"><ms>close</ms></a>
                <% } %>
            </div>
        </header>
        <section>
            <% if (athlete.avatar) { %>
                <a class="avatar" href="profile-avatar.html?id={{athlete.id}}" target="profile-avatar">
                    <img src="{{athlete.avatar}}"/>
                </a>
            <% } else { %>
                <a class="avatar"><img src="images/blankavatar.png"/></a>
            <% } %>
            <div class="info">
                <% if (athlete.team) { %>
                    <div class="row p2"><key>Team</key>{-common.teamBadge(athlete.team)-}</div>
                <% } %>
                <% if (athlete.level) { %>
                    <div class="row p2"><key>Level</key>{{athlete.level}}</div>
                <% } %>
                <% if (athlete.age) { %>
                    <div class="row p2"><key>Age</key>{{athlete.age}}</div>
                <% } %>
                <% if (athlete.weight) { %>
                    <div class="row p2"><key>Weight</key>{-humanWeightClass(athlete.weight, {suffix: true, html: true})-}</div>
                <% } %>
                <% if (athlete.height) { %>
                    <div class="row p2"><key>Height</key>{-humanHeight(athlete.height, {html: true})-}</div>
                <% } %>
                <div class="row p2"><key>FTP</key>{-humanPower(athlete.ftp, {suffix: true, html: true})-}</div>
                <% if (athlete.cp || athlete.ftp) { %>
                    <div class="row p2" title="CP is Critical Power (often similiar to FTP) and W' (pronounced &quot;W Prime&quot;) is a the amount of energy (kJ) available when working harder than the CP value.  Think of it as a battery level." >
                        <key>CP</key><a title="Click to edit - Press Enter to save"
                            href="javascript:void(0)" data-key="cp" data-type="number"
                            class="inline-edit cp">{-humanPower(athlete.cp, {suffix: true, html: true})-}</a>,
                        W': <a title="Click to edit - Press Enter to save"
                            href="javascript:void(0)" data-key="wPrime" data-type="number"
                            class="inline-edit wprime">{-humanNumber(athlete.wPrime / 1000, {suffix: 'kJ', html: true})-}</a>
                    </div>
                <% } %>
            </div>
            <div class="info live">
                <div class="row p2"><key>World</key><span class="live" data-id="world">-</span></div>
                <div class="row p2"><key>Power</key><span class="live" data-id="power">-</span></div>
                <div class="row p2"><key>Speed</key><span class="live" data-id="speed">-</span></div>
                <div class="row p2"><key>HR</key><span class="live" data-id="hr">-</span><abbr class="unit">bpm</abbr></div>
                <div class="row p2"><key>Ride Ons</key><span class="live" data-id="rideons">-</span></div>
                <div class="row p2"><key>Energy</key><span class="live" data-id="kj">-</span><abbr class="unit">kJ</abbr></div>
            </div>
        </section>
    <% } %>
    <% if (obj.debug) { %>
        <section><pre class="debug"></pre></section>
    <% } %>
</div>
