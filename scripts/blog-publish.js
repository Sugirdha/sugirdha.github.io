const fs = require("fs");
const path = require("path");
const { execSync, execFileSync } = require("child_process");
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
  return richText
    .map(part => {
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
    })
    .join("");
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

async function blockToMarkdown(
  block,
  {
    blogRepo,
    assetDate,
    assetSlug,
    imageIndex,
    generatedFiles,
    shouldUpdate,
  }
) {
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

    case "image": {
      const url = imageUrlFromBlock(block);

      if (!url) {
        return "<!-- Unable to read Notion image -->";
      }

      const ext = extensionFromUrl(url);
      const datePrefix = assetDate.replaceAll("-", "");

      const assetName =
        imageIndex === 0
          ? `${datePrefix}-${assetSlug}-header${ext}`
          : `${datePrefix}-${assetSlug}-image-${String(imageIndex).padStart(2, "0")}${ext}`;

      const relativePath = `assets/img/${assetName}`;
      const absolutePath = path.join(blogRepo, relativePath);

      if (fs.existsSync(absolutePath) && !shouldUpdate) {
        throw new Error(`Image already exists: ${absolutePath}`);
      }

      await downloadImage(url, absolutePath);
      generatedFiles.push(absolutePath);

      const caption = richTextToMarkdown(block.image.caption || []);

      let markdown = `![](/${relativePath}){:.center-image}`;

      if (caption) {
        markdown += `\n\n*${caption}*`;
      }

      return markdown;
    }

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

function getRichTextProperty(page, name) {
  const property = page.properties[name];

  if (!property || property.type !== "rich_text") {
    return "";
  }

  return property.rich_text
    .map(item => item.plain_text)
    .join("")
    .trim();
}

function getDateProperty(page, name) {
  const property = page.properties[name];

  if (!property || property.type !== "date") {
    return "";
  }

  return property.date?.start || "";
}

function getMultiSelectProperty(page, name) {
  const property = page.properties[name];

  if (!property || property.type !== "multi_select") {
    return [];
  }

  return property.multi_select.map(item => item.name);
}

function getCheckboxProperty(page, name) {
  const property = page.properties[name];

  if (!property || property.type !== "checkbox") {
    throw new Error(`Missing checkbox property: ${name}`);
  }

  return property.checkbox;
}

function getStatusProperty(page, name) {
  const property = page.properties[name];

  if (!property) {
    return "";
  }

  if (property.type === "status") {
    return property.status?.name || "";
  }

  // Allow an older Select property without changing the workflow.
  if (property.type === "select") {
    return property.select?.name || "";
  }

  return "";
}

function getFileProperty(page, name) {
  const property = page.properties[name];

  if (!property || property.type !== "files") {
    return null;
  }

  const item = property.files?.[0];

  if (!item) {
    return null;
  }

  if (item.type === "file") {
    return {
      name: item.name,
      url: item.file.url,
    };
  }

  if (item.type === "external") {
    return {
      name: item.name,
      url: item.external.url,
    };
  }

  return null;
}

async function downloadImage(url, destination) {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(
      `Failed to download image: ${response.status} ${response.statusText}`
    );
  }

  const buffer = Buffer.from(await response.arrayBuffer());

  fs.mkdirSync(path.dirname(destination), {
    recursive: true,
  });

  fs.writeFileSync(destination, buffer);
}

function imageUrlFromBlock(block) {
  const image = block.image;

  if (!image) return "";

  if (image.type === "file") {
    return image.file?.url || "";
  }

  if (image.type === "external") {
    return image.external?.url || "";
  }

  return "";
}

function extensionFromUrl(url) {
  try {
    const pathname = new URL(url).pathname;
    const ext = path.extname(pathname);

    if (ext && ext.length <= 6) {
      return ext.toLowerCase();
    }
  } catch {}

  return ".png";
}

function richTextValue(content) {
  return [
    {
      type: "text",
      text: { content },
    },
  ];
}

function guessPublishedUrl(filename) {
  const slug = filename
    .replace(/^\d{4}-\d{2}-\d{2}-/, "")
    .replace(/\.md$/, "");

  return `https://sugirdha.github.io/${slug}/`;
}

async function writePublicationState(pageId, filename) {
  await notion.pages.update({
    page_id: pageId,
    properties: {
      "Publication status": {
        status: { name: "Published" },
      },
      "Published file": {
        rich_text: richTextValue(filename),
      },
      "Published URL": {
        url: guessPublishedUrl(filename),
      },
    },
  });
}

async function clearUpdateRequest(pageId) {
  await notion.pages.update({
    page_id: pageId,
    properties: {
      "Update request": {
        checkbox: false,
      },
    },
  });
}

async function main() {
  const input = process.argv[2];
  const repoArg = process.argv.find(arg => arg.startsWith("--repo="));

  const blogRepo = repoArg
    ? path.resolve(repoArg.replace("--repo=", "").trim())
    : process.cwd();

  const shouldPublish = process.argv.includes("--publish");
  const shouldUpdate = process.argv.includes("--update");

  if (shouldUpdate && !shouldPublish) {
    throw new Error("--update must be used together with --publish.");
  }

  if (!input) {
    console.error(
      "Usage: node blog-publish.js <notion-page-url> [--publish] [--update] [--repo=/path/to/blog]"
    );
    process.exit(1);
  }

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

  const generatedFiles = [];
  const pageId = pageIdFromUrl(input);

  const page = await notion.pages.retrieve({
    page_id: pageId,
  });

  const publishDate = getDateProperty(page, "Publish date");
  const excerpt = getRichTextProperty(page, "Excerpt");
  const tags = getMultiSelectProperty(page, "Tags");
  const featured = getCheckboxProperty(page, "Featured");
  const thumbnail = getFileProperty(page, "Thumbnail");

  if (!publishDate) {
    throw new Error("Publish date is missing in Notion.");
  }

  if (!excerpt) {
    throw new Error("Excerpt is missing in Notion.");
  }

  if (!tags.length) {
    throw new Error("At least one tag is required in Notion.");
  }

  const titleProperty = Object.values(page.properties).find(
    property => property.type === "title"
  );

  const title = titleProperty
    ? richTextToMarkdown(titleProperty.title)
    : "(untitled)";

  let publishedFile = "";

  if (shouldUpdate) {
    const publicationStatus = getStatusProperty(page, "Publication status");
    publishedFile = getRichTextProperty(page, "Published file");
    const updateRequested = getCheckboxProperty(page, "Update request");

    if (publicationStatus !== "Published") {
      throw new Error("Only an already-published post can be updated.");
    }

    if (!publishedFile) {
      throw new Error("Published file is missing in Notion.");
    }

    if (!updateRequested) {
      throw new Error("Update request is not checked in Notion.");
    }
  }

  const proposedSlug = slugify(title);
  const proposedFilename = `${publishDate}-${proposedSlug}.md`;
  const filename = shouldUpdate ? publishedFile : proposedFilename;

  if (path.basename(filename) !== filename) {
    throw new Error(`Published file must be a filename, not a path: ${filename}`);
  }

  const publishedStem = path.basename(filename, ".md");
  const assetDate = publishedStem.slice(0, 10);
  const assetSlug = publishedStem.slice(11);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(assetDate) || !assetSlug) {
    throw new Error(
      `Published file does not match YYYY-MM-DD-slug.md: ${filename}`
    );
  }

  const outputPath = path.join(postsDir, filename);

  if (shouldUpdate) {
    if (!fs.existsSync(outputPath)) {
      throw new Error(`Published post does not exist: ${outputPath}`);
    }
  } else if (fs.existsSync(outputPath)) {
    throw new Error(`Post already exists: ${outputPath}`);
  }

  const assetsDir = path.join(blogRepo, "assets", "img");
  const assetPrefix = `${assetDate.replaceAll("-", "")}-${assetSlug}-`;

  const previousAssets =
    shouldUpdate && fs.existsSync(assetsDir)
      ? fs
          .readdirSync(assetsDir)
          .filter(name => name.startsWith(assetPrefix))
          .map(name => path.join(assetsDir, name))
      : [];

  let thumbnailPath = "";

  if (thumbnail) {
    const originalExt = path.extname(thumbnail.name) || ".png";
    const thumbnailFilename = `${assetDate.replaceAll("-", "")}-${assetSlug}-thumbnail${originalExt}`;

    thumbnailPath = `assets/img/${thumbnailFilename}`;

    const absoluteThumbnailPath = path.join(blogRepo, thumbnailPath);

    if (fs.existsSync(absoluteThumbnailPath) && !shouldUpdate) {
      throw new Error(`Thumbnail already exists: ${absoluteThumbnailPath}`);
    }

    await downloadImage(thumbnail.url, absoluteThumbnailPath);
    generatedFiles.push(absoluteThumbnailPath);

    console.log(`Downloaded thumbnail: ${thumbnailPath}`);
  }

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
    subtitle = first.paragraph.rich_text.map(x => x.plain_text).join("");
    bodyBlocks = blocks.slice(1);

    // If the subtitle is followed by a divider in Notion,
    // drop that divider from the article body.
    if (bodyBlocks[0]?.type === "divider") {
      bodyBlocks = bodyBlocks.slice(1);
    }
  }

  const markdownBlocks = [];
  let imageIndex = 0;

  for (const block of bodyBlocks) {
    markdownBlocks.push(
      await blockToMarkdown(block, {
        blogRepo,
        assetDate,
        assetSlug,
        imageIndex,
        generatedFiles,
        shouldUpdate,
      })
    );

    if (block.type === "image") {
      imageIndex++;
    }
  }

  if (shouldUpdate) {
    const newAssetSet = new Set(
      generatedFiles.map(file => path.resolve(file))
    );

    for (const oldFile of previousAssets) {
      if (!newAssetSet.has(path.resolve(oldFile)) && fs.existsSync(oldFile)) {
        fs.unlinkSync(oldFile);
        generatedFiles.push(oldFile);

        console.log(
          `Removed obsolete image: ${path.relative(blogRepo, oldFile)}`
        );
      }
    }
  }

  const body = markdownBlocks.join("\n\n").trim();
  const lines = [];

  lines.push("---");
  lines.push("layout: post");
  lines.push(`title: ${escapeYaml(title)}`);

  if (subtitle) {
    lines.push(`subtitle: ${escapeYaml(subtitle)}`);
  }

  if (thumbnailPath) {
    lines.push(`thumbnail-img: ${thumbnailPath}`);
    lines.push(`share-img: ${thumbnailPath}`);
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

  fs.writeFileSync(outputPath, postContent, "utf8");
  generatedFiles.push(outputPath);

  console.log(`${shouldUpdate ? "Updated" : "Created"}: ${outputPath}`);

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

  const relativeGeneratedFiles = [
    ...new Set(generatedFiles.map(file => path.relative(blogRepo, file))),
  ];

  execFileSync("git", ["add", "--", ...relativeGeneratedFiles], {
    cwd: blogRepo,
    stdio: "inherit",
  });

const stagedFiles = run("git diff --cached --name-only", blogRepo)
  .split("\n")
  .filter(Boolean)
  .sort();

  const allowedFiles = new Set(relativeGeneratedFiles);

  const unexpectedFiles = stagedFiles.filter(
    file => !allowedFiles.has(file)
  );

  if (unexpectedFiles.length) {
    throw new Error(
      `Unexpected staged files detected:\n${unexpectedFiles.join("\n")}`
    );
  }

  if (!stagedFiles.length) {
    throw new Error("No changes detected to publish.");
  }
  
  const commitPrefix = shouldUpdate ? "Update" : "Publish";

  execSync(
    `git commit -m ${JSON.stringify(`${commitPrefix}: ${title}`)}`,
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

  await writePublicationState(pageId, filename);
  console.log("Updated publication state in Notion.");

  if (shouldUpdate) {
    await clearUpdateRequest(pageId);
    console.log("Cleared Update request in Notion.");
  }

  console.log(`\n${shouldUpdate ? "Updated" : "Published"}: ${title}`);
}

main().catch(error => {
  console.error("\nFailed:");
  console.error(error.message);
  process.exit(1);
});
