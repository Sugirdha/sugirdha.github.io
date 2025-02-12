---
layout: post
title: "Learn Git: Collaboration Workflow"
subtitle: "Collaboration & Conflict Resolution in Git"
thumbnail-img: /assets/img/graphics/feb-2025/250203-git-post/git-post-1.png
share-img: /assets/img/graphics/feb-2025/250203-git-post/git-post-1.png
author: Sugirdha
tags: step-by-step tutorial git collaboration
---

## 1. Collaboration Workflow: Forking, Cloning, and Pull Requests

![Fork a Repository](/assets/img/graphics/feb-2025/250203-git-post/git-post-fork-3.png){:.image-500.center-image}

To contribute to a repository that you do not own, follow these steps:

1. **Fork the Repository**:  
   In the GitHub repository you want to contribute to, click the "Fork" button in the top right corner. This creates a copy under your GitHub account.  

2. **Clone the Forked Repository**:  
    ```bash
    git clone https://github.com/your-username/repository-name.git
    cd repository-name
    ```

3. **Create a New Branch and Make Changes**:  
    ```bash
    git checkout -b my-feature-branch
    echo "New feature added" > feature.txt
    git add feature.txt
    git commit -m "Added a new feature"
    ```

4. **Push the Changes to Your Fork**:  
   ```bash
   git push origin my-feature-branch
   ```

5. **Create a Pull Request**:  
   In the original repository on GitHub, click "Compare & pull request". Then, add a description and submit the pull request for review. If approved, the repository owner reviews your PR and merges it into the main project.

## 2. Handling Merge Conflicts
![Merge Conflict](/assets/img/graphics/feb-2025/250203-git-post/git-post-merge-5.png){:.image-500.center-image}

1. **Simulating a Merge Conflict**  
    A merge conflict happens when Git cannot automatically reconcile changes from two branches modifying the same part of a file differently. This commonly occurs in real-world projects when two team members working on separate feature branches make changes to the same file and attempt to merge their branches into the main branch.

    Let’s simulate this scenario locally by committing changes to the same file in different branches:
    ```bash
    git checkout -b conflicting-branch
    echo "Change from conflicting branch" >> todo.txt
    git commit -am "Conflicting change"
    git checkout main
    echo "Change from main branch" >> todo.txt
    git commit -am "Main branch change"
    git merge conflicting-branch
    ```
    At this point, Git detects a conflict and marks the conflicting sections in `todo.txt`.

2. **Identifying & Resolving the Conflict**  
    Open `todo.txt`, and you’ll see something like this:
    {% raw %}
    ```
    <<<<<<< HEAD
    Change from main branch
    =======
    Change from conflicting branch
    >>>>>>> conflicting-branch
    ```
    {% endraw %}

    Try `git status` to understand more about the status at this unmerged state. 

    Manually edit the file to resolve the conflict:
    - Keep one change
    - Combine both changes
    - Modify the content to create a better version

    Then, stage and commit the resolved file:
    ```bash
    git add todo.txt
    git commit -m "Resolved merge conflict between main and conflicting-branch"
    ```

3. **Aborting the Merge**  
    If you decide to cancel the merge entirely, use:
    ```bash
    git merge --abort
    ```
    This restores the repository to its previous state before the merge started.

## Conclusion
In this guide, you’ve learned how to collaborate using Git and handle merge conflicts. These are essential skills for working in real-world development teams. By mastering these concepts, you’ll be able to contribute effectively to any project.

Want to revisit the basics? Check out **[Learn Git: Mastering the Basics](/2025/02/03/learn-git-basics.html)**.

