---
layout: default
title: Blog
---

# Latest Posts

<ul style="list-style-type:none">
  {% for post in site.posts %}
    <li>
      <h2><a href="{{ post.url }}">{{ post.title }}</a></h2>
      {{ post.excerpt }}
      <h6><a href="{{ post.url }}">Read more</a></h6>
    </li>
  {% endfor %}
</ul>
