<div class="card athlete">
    {{obj && obj.sanitizedFullname}} </br/>
    <% if (obj && obj.avatar) { %>
        <img src="{{obj.avatar}}"/>
    <% } %>
    {{obj && obj.level}}
</div>
