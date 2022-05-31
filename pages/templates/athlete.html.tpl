<style>
    .athlete {
        display: flex;
        flex-direction: column;
        flex: 1 1;
    }

    .athlete > section {
        display: flex;
        flex-wrap: wrap;
        border-radius: 0.3em;
        overflow: hidden;
        font-variant-numeric: tabular-nums;
        background: #0002;
    }

    .athlete > header {
        padding: 0.4em 0.7em;
        font-size: 1.6em;
        font-weight: bold;
        background-image: linear-gradient(to top, #222, #333);
        display: flex;
    }

    .athlete > header .buttons {
        flex: 1;
        display: flex;
        justify-content: flex-end;
    }

    .athlete a.avatar {
        flex: 1 0 280px;
        display: block;
        overflow: hidden;
        max-width: 100%;
        max-height: calc(100vh - 4rem);
        display: flex;
        padding: 1em;
        align-items: flex-start;
        justify-content: center;
    }

    .athlete a.avatar img {
        width: fit-content;
        max-width: 100%;
        max-height: 100%;
        border-radius: 2.5em 0.6em;
        border: 0.6em solid #0007;
        box-shadow: 1px 1px 5px #0003;
        background-image: radial-gradient(ellipse at 11% 0,
            rgba(32, 2, 72, 0.8) 0%,
            rgba(10, 12, 142, 0.8) 42%,
            rgba(132, 70, 13, 0.8) 94%);
        background-clip: content-box;
    }

    .athlete .info {
        flex: 100 1;
        display: flex;
        flex-direction: column;
        margin: 0.8em 0.33em;
        min-width: 250px;
        border-radius: 0.5em;
        overflow: hidden;
        background-color: #0001;
    }

    .athlete .info .row {
        padding: 0.4em 0.7em;
    }

    .athlete .info .row:nth-child(odd) {
        background-color: #0003;
    }

    .athlete .p1 {
        font-size: 1em;
        font-weight: bold;
    }

    key {
        display: inline-block;
        min-width: 10ch;
        font-variant: small-caps;
        font-weight: bold;
        font-size: 0.8em;
    }

    key::after {
        content: ':';
        margin-right: 0.2em;
    }

    abbr.unit {
        font-size: 0.8em;
        margin-left: 0.15em;
        opacity: 0.86;
    }
</style>
<div class="athlete">
    <header class="title">
        {{profile.sanitizedFullname}}
        <div class="buttons">
            <a href data-action="toggleMute" title="Toggle chat messages from Yahoos.



seriously"><ms>{{profile.muted ? 'comments_disabled' : 'comment'}}</ms></a>
            <a href data-action="togglePinned" title="Toggle pinned state for this person.  Used for windows that only show pinned athletes."><ms>{{profile.pinned ? 'star' : 'grade'}}</ms></a>
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
