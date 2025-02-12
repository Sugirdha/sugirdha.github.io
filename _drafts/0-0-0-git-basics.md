---
layout: post
title: "Git Started: Undoing Mistakes"
subtitle: "Undoing Mistakes in Git"
thumbnail-img: /assets/img/graphics/feb-2025/250203-git-post/git-post-1.png
share-img: /assets/img/graphics/feb-2025/250203-git-post/git-post-1.png
author: Sugirdha
# excerpt: ""
tags: step-by-step tutorial git back-to-basics
---
## Undoing Mistakes in Git
   ```bash
   git checkout <commit-hash>
   ```
   This puts the repository in a "detached HEAD" state, where you can view the older version without making permanent changes.  
   To go back to the latest commit:
   ```bash
   git checkout main
   ```
   
Step 1: Setup the Project
    1. Create a new project directory and initialize Git: 
mkdir git-undo-demo && cd git-undo-demo
git init
    1. Create a file and add some content: 
echo "Task 1: Learn Git" > tasks.txt
echo "Task 2: Practice Git Commands" >> tasks.txt
    1. Add and commit the file: 
git add tasks.txt
git commit -m "Add initial task list"

Step 2: Undo git add Before Committing
    1. Modify the file and add it to the staging area:
echo "Task 3: Undo mistakes in Git" >> tasks.txt
git add tasks.txt
    2. Check git status:
git status

→ It should show tasks.txt as staged.
    3. Undo git add and check status again:
git reset HEAD tasks.txt
git status

→ tasks.txt should now be unstaged but changes remain.

Step 3: Undo the Last Commit Without Losing Work
    1. Stage and commit again:
git add tasks.txt
git commit -m "Added Task 3"
    2. Undo the last commit but keep changes staged:
git reset --soft HEAD~1
git status

→ The commit is undone, but changes are still staged.
    3. Undo the last commit and unstage changes:
git reset HEAD~1
git status

→ The commit is undone, and changes are now unstaged.

Step 4: Discard Changes Completely (Be Careful!)
    1. Modify the file again: 
echo "Task 4: Discard changes" >> tasks.txt
    2. Check changes: 
git diff
    3. Discard changes: 
git checkout -- tasks.txt
    4. Check the file content: 
cat tasks.txt

→ The last change (Task 4) should be gone!

Step 5: Revert a Committed Change (Safe Way to Undo a Commit)
    1. Modify and commit:
echo "Task 5: Revert a commit" >> tasks.txt
git add tasks.txt
git commit -m "Added Task 5"
    2. Undo this commit while keeping a record (safe method):
git revert HEAD
        ○ This creates a new commit that reverses the previous commit.
    3. Check the Git log:
git log --oneline

→ You should see a new commit like "Revert "Added Task 5"".

Challenge: Fix a Mistaken Commit Message
    1. Modify the file and commit with a wrong message: 
echo "Task 6: Fix commit messages" >> tasks.txt
git add tasks.txt
git commit -m "Wrong commit message"
    2. Correct the last commit message: 
git commit --amend -m "Added Task 6: Fix commit messages"
    3. Check commit history: 
git log --oneline

→ The last commit message should now be updated.







## 11. Undoing Mistakes in Git
### **1. Viewing Past Commits Without Changing Anything**
```bash
git checkout <commit-hash>
```
This allows you to temporarily view an older version of your repository. To return to the latest commit:
```bash
git checkout main
```

### **2. Undo `git add` Before Committing**
1. Modify a file and stage it:
    ```bash
    echo "Task: Undo mistakes in Git" >> tasks.txt
    git add tasks.txt
    ```
2. Check status:
    ```bash
    git status
    ```
3. Undo the `git add` command:
    ```bash
    git reset HEAD tasks.txt
    ```

### **3. Undo the Last Commit Without Losing Work**
1. Stage and commit changes:
    ```bash
    git add tasks.txt
    git commit -m "Added Task"
    ```
2. Undo the last commit but keep changes staged:
    ```bash
    git reset --soft HEAD~1
    ```
3. Undo the last commit and unstage changes:
    ```bash
    git reset HEAD~1
    ```

### **4. Discard Changes Completely (Be Careful!)**
1. Modify a file:
    ```bash
    echo "Task: Discard changes" >> tasks.txt
    ```
2. Check changes:
    ```bash
    git diff
    ```
3. Discard changes:
    ```bash
    git checkout -- tasks.txt
    ```

### **5. Revert a Committed Change**
1. Modify and commit:
    ```bash
    echo "Task: Revert a commit" >> tasks.txt
    git add tasks.txt
    git commit -m "Added Task"
    ```
2. Undo this commit while keeping a record:
    ```bash
    git revert HEAD
    ```
    This creates a new commit that reverses the previous commit.
3. View the Git log:
    ```bash
    git log --oneline
    ```

### **6. Fixing a Mistaken Commit Message**
1. Commit with an incorrect message:
    ```bash
    git commit -m "Wrong commit message"
    ```
2. Correct the last commit message:
    ```bash
    git commit --amend -m "Updated commit message"
    ```
