const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const { Client } = require("@notionhq/client");

const notion = new Client({
  auth: process.env.NOTION_ACCESS_TOKEN,
});

function pageIdFromUrl(input) {
  const match = input.match(/[0-9a-fA-F]{32}/);
  if (!match) throw new Error("Could not find a Notion page ID.");
  return match[0];
}

function richTextToMarkdown(richText = []) {
  return richText.map(part => {
    let text = part.plain_text;

    if (part.href) {
      text = `[${text}](${part.href}){:target="_blank"}`;
    }

    const a = part.annotations || {};

    if (a.code) text = `\`${text}\``;
    if (a.bold) text = `**${text}**`;
    if (a.italic) text = `*${text}*`;
    if (a.strikethrough) text = `~~${text}~~`;

    return text;
  }).join("");
}

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function getAllChildren(blockId) {
  const results = [];
  let cursor;

  do {
    const response = await notion.blocks.children.list({
      block_id: blockId,
      page_size: 100,
      start_cursor: cursor,
    });

    results.push(...response.results);
    cursor = response.has_more ? response.next_cursor : undefined;
  } while (cursor);

  return results;
}

function blockToMarkdown(block) {
  const data = block[block.type];

  switch (block.type) {
    case "paragraph":
      return richTextToMarkdown(data.rich_text);

    case "heading_1":
      return `# ${richTextToMarkdown(data.rich_text)}`;

    case "heading_2":
      return `## ${richTextToMarkdown(data.rich_text)}`;

    case "heading_3":
      return `### ${richTextToMarkdown(data.rich_text)}`;

    case "bulleted_list_item":
      return `- ${richTextToMarkdown(data.rich_text)}`;

    case "numbered_list_item":
      return `1. ${richTextToMarkdown(data.rich_text)}`;

    case "quote":
      return `> ${richTextToMarkdown(data.rich_text)}`;

    case "divider":
      return "---";

    case "code":
      return `\`\`\`${data.language || ""}\n${richTextToMarkdown(data.rich_text)}\n\`\`\``;

    default:
      return `<!-- Unsupported Notion block: ${block.type} -->`;
  }
}

function escapeYaml(value) {
  return `"${value
    .replaceAll("\\", "\\\\")
    .replaceAll('"', '\\"')
    .replaceAll("\n", " ")}"`;
}

function run(command, cwd) {
  return execSync(command, {
    cwd,
    encoding: "utf8",
    stdio: ["inherit", "pipe", "pipe"],
  }).trim();
}

async function main() {
  const input = process.argv[2];

  const repoArg = process.argv.find(arg => arg.startsWith("--repo="));

  const blogRepo = repoArg
    ? path.resolve(repoArg.replace("--repo=", "").trim())
    : process.cwd();
    
  const tagsArg = process.argv.find(arg => arg.startsWith("--tags="));

  const tags = tagsArg
    ? tagsArg
        .replace("--tags=", "")
        .split(",")
        .map(tag => tag.trim())
        .filter(Boolean)
    : [];

  const excerptArg = process.argv.find(arg => arg.startsWith("--excerpt="));

  const excerpt = excerptArg
    ? excerptArg.replace("--excerpt=", "").trim()
    : "";

  const imageArg = process.argv.find(arg => arg.startsWith("--image="));

  const image = imageArg
    ? imageArg.replace("--image=", "").trim()
    : "";

  const dateArg = process.argv.find(arg => arg.startsWith("--date="));

  const publishDate = dateArg
    ? dateArg.replace("--date=", "").trim()
    : new Date().toISOString().slice(0, 10);

  const featuredArg = process.argv.find(arg =>
    arg.startsWith("--featured=")
  );

  if (!featuredArg) {
    throw new Error("Missing --featured=true|false");
  }

  const featuredValue = featuredArg
    .replace("--featured=", "")
    .trim()
    .toLowerCase();

  if (!["true", "false"].includes(featuredValue)) {
    throw new Error("--featured must be true or false");
  }

  const featured = featuredValue === "true";
  
  const shouldPublish = process.argv.includes("--publish");

  if (!input) {
    console.error("Usage: node build-post.js <notion-page-url>");
    process.exit(1);
  }

  const pageId = pageIdFromUrl(input);

  const page = await notion.pages.retrieve({
    page_id: pageId,
  });

  const titleProperty = Object.values(page.properties)
    .find(property => property.type === "title");

  const title = titleProperty
    ? richTextToMarkdown(titleProperty.title)
    : "(untitled)";

  const slug = slugify(title);
  const filename = `${publishDate}-${slug}.md`;

  const blocks = await getAllChildren(pageId);

  // Treat first italic-only paragraph as subtitle.
  let subtitle = "";
  let bodyBlocks = [...blocks];

  const first = blocks[0];

  if (
    first?.type === "paragraph" &&
    first.paragraph.rich_text.length > 0 &&
    first.paragraph.rich_text.every(x => x.annotations?.italic)
  ) {
    subtitle = first.paragraph.rich_text
      .map(x => x.plain_text)
      .join("");

    bodyBlocks = blocks.slice(1);

    // If the subtitle is followed by a divider in Notion,
    // drop that divider from the article body.
    if (bodyBlocks[0]?.type === "divider") {
      bodyBlocks = bodyBlocks.slice(1);
    }
  }

  const body = bodyBlocks
    .map(blockToMarkdown)
    .join("\n\n")
    .trim();

  const lines = [];

  lines.push("---");
  lines.push("layout: post");
  lines.push(`title: ${escapeYaml(title)}`);

  if (subtitle) {
    lines.push(`subtitle: ${escapeYaml(subtitle)}`);
  }

  if (image) {
    lines.push(`thumbnail-img: ${image}`);
    lines.push(`share-img: ${image}`);
  }

  lines.push("author: Sugirdha");

  lines.push(`featured: ${featured}`);

  if (excerpt) {
    lines.push(`excerpt: ${escapeYaml(excerpt)}`);
  }

  if (tags.length) {
    lines.push(`tags: [${tags.join(", ")}]`);
  }

  lines.push("---");
  lines.push("");
  lines.push(body);
  lines.push("");

  const postContent = lines.join("\n");

  const postsDir = path.join(blogRepo, "_posts");

  if (!fs.existsSync(postsDir)) {
    throw new Error(`Could not find Jekyll _posts directory: ${postsDir}`);
  }

  if (shouldPublish) {
    const existingChanges = run("git status --porcelain", blogRepo);

    if (existingChanges) {
      throw new Error(
        `Blog repo has existing changes. Commit or remove them before publishing:\n${existingChanges}`
      );
    }

    const branch = run("git branch --show-current", blogRepo);

    if (branch !== "main") {
      throw new Error(
        `Publishing is only allowed from main. Current branch: ${branch}`
      );
    }
    
    console.log("Syncing with origin/main...");

    execSync("git pull --ff-only origin main", {
      cwd: blogRepo,
      stdio: "inherit",
    });
  }

  const outputPath = path.join(postsDir, filename);

  // Never silently replace an existing published post.
  if (fs.existsSync(outputPath)) {
    throw new Error(`Post already exists: ${outputPath}`);
  }

  fs.writeFileSync(outputPath, postContent, "utf8");

  console.log(`Created: ${outputPath}`);

  if (!shouldPublish) {
    console.log("Dry run only. Nothing committed or pushed.");
    return;
  }

  console.log("\nValidating Jekyll build...");

  execSync("bundle exec jekyll build", {
    cwd: blogRepo,
    stdio: "inherit",
  });

  console.log("\nJekyll build passed.");

  const relativePostPath = path.relative(blogRepo, outputPath);

  execSync(`git add -- "${relativePostPath}"`, {
    cwd: blogRepo,
    stdio: "inherit",
  });

  const stagedFiles = run("git diff --cached --name-only", blogRepo);

  if (stagedFiles !== relativePostPath) {
    throw new Error(
      `Unexpected staged files detected:\n${stagedFiles}`
    );
  }

  execSync(
    `git commit -m ${JSON.stringify(`Publish: ${title}`)}`,
    {
      cwd: blogRepo,
      stdio: "inherit",
    }
  );

  console.log("\nPushing to GitHub...");

  execSync("git push", {
    cwd: blogRepo,
    stdio: "inherit",
  });

  console.log(`\nPublished: ${title}`);
}

main().catch(error => {
  console.error("\nFailed:");
  console.error(error.message);
  process.exit(1);
});
