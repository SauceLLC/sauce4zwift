<% for (const x of obj) { %>
    <% const athlete = x.athlete || {}; %>
    <a class="card athlete {{athlete.marked ? 'marked' : ''}} {{athlete.following ? 'following' : ''}} {{athlete.follower ? 'follower' : ''}}"
       href="profile.html?id={{x.id}}&windowType=profile" target="profile">
        <% if (x.athlete) { %>
            <div class="avatar">
                <% if (athlete.avatar) { %>
                    <img loading="lazy" src="{{athlete.avatar}}"/>
                <% } else {%>
                    <img src="images/blankavatar.png"/>
                <% } %>
            </div>
            <div class="line">{{athlete.sanitizedFullname}}</div>
        <% } else if (x.profile) { %>
            <% const p = x.profile; %>
            <div class="avatar">
                <% if (p.imageSrcLarge || p.imageSrc) { %>
                    <img loading="lazy" src="{{p.imageSrcLarge || p.imageSrc}}"/>
                <% } else {%>
                    <img src="images/blankavatar.png"/>
                <% } %>
            </div>
            <div class="line">{{p.firstName}} {{p.lastName}}</div>
        <% } else { %>
            Justin messed up :(
        <% } %>
    </a>
<% } %>
