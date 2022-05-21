<style>
    .athlete {
        display: flex;
        flex-wrap: wrap;
        border-radius: 0.3em;
        overflow: hidden;
    }

    .athlete a.avatar {
        flex: 0 0 400px;
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
        background: #0002;
        padding: 1em;
        flex: 1 1 auto;
        display: flex;
        flex-direction: column;
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
</style>
<div class="athlete">
    <a class="avatar" href="{{avatar || ''}}" external target="_blank">
        <img src="{{avatar || 'images/blankavatar.png'}}"/>
    </a>
    <div class="info">
        <div class="row p1">{{sanitizedFullname}}</div>
        <% if (obj.team) { %>
            <div class="row p2">Team: {{team}}</div>
        <% } %>
        <div class="row p2">Level: {{level}}</div>
        <div class="row p2">Age: {{age}}</div>
        <div class="row p2">Weight: {{weight}}</div>
        <div class="row p2">Height: {{height}}</div>
        <div class="row p2">FTP: {{ftp}}</div>
    </div>
</div>
