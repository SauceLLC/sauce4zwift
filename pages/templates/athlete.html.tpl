<style>
    .athlete {
        display: flex;
        flex-wrap: wrap;
        border-radius: 0.3em;
        overflow: hidden;
        font-variant-numeric: tabular-nums;
        background: #0002;
        box-shadow: 1px 1px 8px 0 #0008;
    }

    .athlete a.avatar {
        flex: 1 0 300px;
        display: block;
        overflow: hidden;
        max-width: 100%;
        border-radius: 0.3em;
        display: flex;
        align-items: center;
        justify-content: center;
    }

    .athlete a.avatar img {
        width: 100%;
        max-width: 100%;
        max-height: 100%;
    }

    .athlete .info {
        padding: 0 0.5em;
        flex: 100 1;
        display: flex;
        flex-direction: column;
        margin: 0.5em 0;
        min-width: 250px;
    }
    .athlete .info.live {
        border-left: 1px solid #6666;
    }

    .athlete .info .row {
        padding: 0.5em 1em;
    }

    .athlete .info .row:nth-child(odd) {
        background-color: #0003;
    }

    .athlete .p1 {
        font-size: 1.2em;
    }

    key {
        display: inline-block;
        min-width: 10ch;
        font-variant: small-caps;
        font-weight: bold;
        font-size: 0.9em;
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
    <a class="avatar" href="{{profile && profile.avatar || ''}}" external target="_blank">
        <img src="{{profile && profile.avatar || 'images/blankavatar.png'}}"/>
    </a>
    <div class="info">
        <% if (obj.profile) { %>
            <div class="row p1">{{profile.sanitizedFullname}}</div>
            <% if (profile.team) { %>
                <div class="row p2"><key>Team:</key>{{profile.team}}</div>
            <% } %>
            <div class="row p2"><key>Level</key>{{profile.level}}</div>
            <div class="row p2"><key>Age</key>{{profile.age}}</div>
            <div class="row p2"><key>Weight</key>{-humanWeight(profile.weight, {suffix: true, html: true})-}</div>
            <div class="row p2"><key>Height</key>{-humanHeight(profile.height, {html: true})-}</div>
            <div class="row p2"><key>FTP</key>{{profile.ftp}}<abbr class="unit">w</abbr></div>
        <% } else { %>
            <div class="row p1"><key>ID</key> {{athleteId}}</div>
            <div class="row p2"><b>No data available yet</b></div>
            <div class="row p2"><i>Profiles are loaded lazily based on rider proximity.</i></div>
        <% } %>
    </div>
    <div class="info live">
        <div class="row p1">Live stats</div>
        <div class="row p2"><key>Power</key><span class="live" data-id="power">-</span><abbr class="unit">w</abbr></div>
        <div class="row p2"><key>HR</key><span class="live" data-id="hr">-</span><abbr class="unit">bpm</abbr></div>
        <div class="row p2"><key>Ride Ons</key><span class="live" data-id="rideons">-</span></div>
        <div class="row p2"><key>Energy</key><span class="live" data-id="kj">-</span><abbr class="unit">kJ</abbr></div>
        <div class="row p2"><key>Watching</key><span class="live" data-id="watching">-</span></div>
    </div>
</div>
