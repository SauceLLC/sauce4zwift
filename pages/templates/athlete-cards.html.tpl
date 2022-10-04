<% for (const x of obj) { %>
    <a class="card athlete" href="profile.html?id={{x.id}}" target="profile">
        <% if (x.athlete) { %>
            <% const a = x.athlete; %>
            <div class="avatar">
                <% if (a.avatar) { %>
                    <img src="{{a.avatar}}"/>
                <% } else {%>
                    <img src="images/blankavatar.png"/>
                <% } %>
            </div>
            <div class="line">{{a.sanitizedFullname}}</div>
        <% } else if (x.profile) { %>
            <% const p = x.profile; %>
            <div class="avatar">
                <% if (p.imageSrcLarge || p.imageSrc) { %>
                    <img src="{{p.imageSrcLarge || p.imageSrc}}"/>
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
