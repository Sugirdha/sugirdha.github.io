---
layout: default
title: Blog
---

<h1 style="text-align: center; justify-content: center;">Latest Posts</h1>

<ul style="list-style-type:none">
  {% for post in site.posts %}
    <li>
      <h2><a href="{{ post.url }}">{{ post.title }}</a></h2>
      {{ post.excerpt }}
      <h5><a href="{{ post.url }}">Read more</a></h5>
    </li>
  {% endfor %}
</ul>
