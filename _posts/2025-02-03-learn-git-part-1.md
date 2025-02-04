---
layout: post
title: "Git Started: Mastering the Basics (Part 1)"
subtitle: "A Hands-on Introduction to Git"
thumbnail-img: /assets/img/graphics/feb-2025/250203-git-post/git-post-1.png
share-img: /assets/img/graphics/feb-2025/250203-git-post/git-post-1.png
author: Sugirdha
# excerpt: ""
tags: step-by-step tutorial git back-to-basics
---

## What is Git?  
Git is a version control system that enables developers to track and manage changes locally while syncing them with remote repositories. It allows multiple people to work on a project simultaneously, maintains a history of modifications and makes it easy to revert to previous versions when needed. 

![Git-Basics](/assets/img/graphics/feb-2025/250203-git-post/git-post-1.png){:.image-500.center-image}

## 1. Setting Up Git 
1. Install Git on your system if it is not already installed.  
   [Installation Instructions <i class="fa-solid fa-up-right-from-square"></i>](https://git-scm.com/downloads){:target="_blank"}  

2. Verify the Git installation by checking the version.  
```bash
git --version
```  

1. Configure user information (this ensures that your commits are correctly attributed to you)
    ```bash
    git config --global user.name "Your Name"
    git config --global user.email "user@example.com"
    ```

2. Confirm the configuration
    ```bash
    git config --list
    ```

## 2. Initialise a Git Repository
To facilitate this demo, we'll use a simple "To-Do List Tracker", a basic text-based to-do list. We'll use Git to track changes while demonstrating commands like init, add, commit, log, branch, merge, and push. 
1. Create a new project folder:
   ```bash
   mkdir git-demo-todo-list 
   cd git-demo-todo-list
   ```
2. Initialise Git:
   ```bash
   git init
   ```
3. Verify that Git has been initialised by listing all files (including hidden ones):
   ```bash
   ls -la
   ```
   The `.git` folder is where Git stores all information about your repository. It acts as Git’s brain, tracking changes, storing history, and managing branches.

## 3. Tracking Files in Git
1. Let's start by creating a simple to-do file. 
    ```bash
    touch todo.txt
    echo "Initial To-Do List" > todo.txt
    ```
2. Check the current Git status of our repository.  
   ```bash
   git status
   ```  
        What we see:  
        - Branch: main  
            - `main` branch is the default one.  
        - No commits  
        - Untracked todo.txt  
3. Add the file to staging.  
   ```bash
   git add todo.txt
   ```
4. Commit the file:  
   ```bash
   git commit -m "Add initial todo list"
   ```
![Commit Changes to Git](/assets/img/graphics/feb-2025/250203-git-post/git-post-commit-2.png){:.image-500.center-image}

## 4. Making Changes and Checking History
1. Modify todo.txt:  
   ```bash
   echo "- Learn Git basics" >> todo.txt
   ```
2. Check differences:  
   ```bash
   git diff
   ```
3. Add & commit changes: 
   ```bash
   git add todo.txt
   git commit -m "Add new todo item"
   ```
4. View commit history: 
   ```bash
   git log
   ```

## 5. Creating and Switching Branches
1. Create a new branch: 
   ```bash
   git branch feature-branch
   ```
2. Switch to the new branch: 
   ```bash
   git checkout feature-branch
   ```
3. Modify & commit changes: 
   ```bash
   echo "Feature branch update" > feature.txt
   git add feature.txt
   git commit -m "Added feature.txt"
   ```
![Branching](/assets/img/graphics/feb-2025/250203-git-post/git-post-branch-6.png){:.image-500.center-image}

## 6. Merging Branches
1. Switch back to main: 
   ```bash
   git checkout main
   ```
2. Merge feature-branch: 
   ```bash
   git merge feature-branch
   ```
3. Delete the merged branch: 
   ```bash
   git branch -d feature-branch
   ```

## 7. Using Git Stash
Sometimes, you may need to temporarily save your changes without committing them.
1. Create and switch to a new branch: 
   ```bash
   git checkout -b stash-branch
   ```
2. Modify todo.txt:  
   ```bash
   echo "- Learn Git Stash" >> todo.txt
   ```
   At this point, you might want to switch to main branch to work on something else. Git Stash allows you to save your uncommitted changes and restore them later.
3. Stash your changes:
   ```bash
   git stash
   ```
   This saves your changes and restores your working directory to a clean state. You can safely switch branches or pull changes without worrying about losing your work.
   
   Alternatively, you could stash with a name to make it easier to identify a specific stash.
   ```bash
   git stash push -m "Working on Git Stash"
   ```
4. View your stashed changes:
   ```bash
   git stash list
   ```
   Each stash is saved with an index (e.g., stash@{0}) and optionally a name, making it easy to identify and retrieve later.
5. Using the stashed changes:  
   When you come back to use your changes at a later point, you have a few options:

   -  Apply the most recent stashed changes while keeping the stash entry in the list:
   ```bash
   git stash apply
   ```
   - Apply a specific stash from the list by using its index:
   ```bash
   git stash apply stash@{1}
   ```
   - Apply the most recent stash and remove the entry from the list:
   ```bash
   git stash pop
   ```
   - Drop a specific stash when you no longer need it:
   ```bash
   git stash drop stash@{1}
   ```
6. To clear all stashed changes, use:
   ```bash
   git stash clear
   ```

## 8. Working with a Remote Repository (GitHub)
For this tutorial, we'll use GitHub. You will need to create an account. 

1. To confirm your username and email settings, use:
    ```bash
    git config user.name
    git config user.email
    ```
    You can change the config at any time for a particular repository by omitting the `--global` flag.
    ```bash
    git config user.name "Your GitHub User Name"
    git config user.email "Your GitHub Email"
    ```
2. Create a remote repository on GitHub and copy the url to the repository.  
3. Link the local repository to the remote: 
   ```bash
   git remote add origin <repo-url>
   ```
4. Push code: 
   ```bash
   git push -u origin main
   ```
5. Pull changes: 
   ```bash
   git pull origin main
   ```

![Push Commits to Remote](/assets/img/graphics/feb-2025/250203-git-post/git-post-push-4.png){:.image-500.center-image}


You’ve now covered the essentials of Git, from setting up a repository to branching, merging, and syncing with GitHub. These skills lay the foundation for effective version control and collaboration.

Coming soon in Part 2, we’ll tackle collaboration workflows, undoing mistakes, and resolving merge conflicts — key skills for working on real-world projects. Stay tuned!

<!-- In Part 2, we’ll tackle collaboration workflows, undoing mistakes, and resolving merge conflicts — key skills for working on real-world projects. [Continue to Part 2]()-->