const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
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
    allowExistingAssets,
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
      return `\`\`\`${data.language || ""}\n${richTextToMarkdown(
        data.rich_text
      )}\n\`\`\``;

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
          : `${datePrefix}-${assetSlug}-image-${String(imageIndex).padStart(
              2,
              "0"
            )}${ext}`;

      const relativePath = `assets/img/${assetName}`;
      const absolutePath = path.join(blogRepo, relativePath);

      if (
        fs.existsSync(absolutePath) &&
        !shouldUpdate &&
        !allowExistingAssets
      ) {
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

function validateAutomationSchema(page) {
  const expected = {
    "Automation state": "select",
    "Last failure": "rich_text",
    "Failed at": "date",
    "Retry request": "checkbox",
  };
  const problems = [];

  for (const [name, type] of Object.entries(expected)) {
    const property = page.properties?.[name];

    if (!property) problems.push(`${name} is missing`);
    else if (property.type !== type) {
      problems.push(`${name} must be ${type}, found ${property.type}`);
    }
  }

  if (problems.length) {
    throw new Error(`Notion retry schema is not ready: ${problems.join("; ")}`);
  }
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

function publicationProperties(filename, mode) {
  return {
    "Publication status": {
      select: { name: "Published" },
    },
    "Published file": {
      rich_text: richTextValue(filename),
    },
    "Published URL": {
      url: guessPublishedUrl(filename),
    },
    [mode === "update" ? "Update request" : "Publish request"]: {
      checkbox: false,
    },
    "Automation state": {
      select: { name: "Ready" },
    },
    "Last failure": {
      rich_text: [],
    },
    "Failed at": {
      date: null,
    },
    "Retry request": {
      checkbox: false,
    },
  };
}

function publicationStateMatches(page, filename, mode) {
  return (
    getStatusProperty(page, "Publication status") === "Published" &&
    getRichTextProperty(page, "Published file") === filename &&
    page.properties?.["Published URL"]?.url === guessPublishedUrl(filename) &&
    getCheckboxProperty(
      page,
      mode === "update" ? "Update request" : "Publish request"
    ) === false &&
    getStatusProperty(page, "Automation state") === "Ready" &&
    getCheckboxProperty(page, "Retry request") === false
  );
}

async function writePublicationStateSafely(
  notionClient,
  pageId,
  filename,
  mode
) {
  try {
    await notionClient.pages.update({
      page_id: pageId,
      properties: publicationProperties(filename, mode),
    });
  } catch (writeError) {
    try {
      const currentPage = await notionClient.pages.retrieve({ page_id: pageId });

      if (publicationStateMatches(currentPage, filename, mode)) {
        console.log(
          "Notion write returned an error, but the completed state was verified."
        );
        return;
      }
    } catch {}

    throw writeError;
  }
}

function fileDigest(filename) {
  return crypto
    .createHash("sha256")
    .update(fs.readFileSync(filename))
    .digest("hex");
}

function snapshotFiles(filenames) {
  return new Map(
    filenames
      .filter(filename => fs.existsSync(filename))
      .map(filename => [path.resolve(filename), fileDigest(filename)])
  );
}

function verifyExistingPublication(snapshot, expectedFiles, relevantFiles) {
  const expected = [...new Set(expectedFiles.map(file => path.resolve(file)))].sort();
  const relevant = [...new Set(relevantFiles.map(file => path.resolve(file)))].sort();

  if (
    expected.length !== relevant.length ||
    expected.some((filename, index) => filename !== relevant[index])
  ) {
    return false;
  }

  return expected.every(
    filename =>
      snapshot.get(filename) &&
      fs.existsSync(filename) &&
      snapshot.get(filename) === fileDigest(filename)
  );
}

function pushAndConfirm(blogRepo, { exec = execSync, read = run } = {}) {
  try {
    exec("git push", {
      cwd: blogRepo,
      stdio: "inherit",
    });
    return { reconciled: false };
  } catch (pushError) {
    try {
      const localHead = read("git rev-parse HEAD", blogRepo);
      const remoteLine = read(
        "git ls-remote origin refs/heads/main",
        blogRepo
      );
      const remoteHead = remoteLine.split(/\s+/)[0];

      if (remoteHead && remoteHead === localHead) {
        console.log(
          "Push returned an error, but origin/main contains the exact commit."
        );
        return { reconciled: true };
      }
    } catch {}

    throw pushError;
  }
}

async function writePublicationState(pageId, filename, mode) {
  await writePublicationStateSafely(notion, pageId, filename, mode);
}

async function main() {
  const input = process.argv[2];
  const repoArg = process.argv.find(arg => arg.startsWith("--repo="));

  const blogRepo = repoArg
    ? path.resolve(repoArg.replace("--repo=", "").trim())
    : process.cwd();

  const shouldPublish = process.argv.includes("--publish");
  const shouldUpdate = process.argv.includes("--update");
  const shouldPush = shouldPublish || shouldUpdate;

  if (shouldPublish && shouldUpdate) {
    throw new Error("Choose either --publish or --update, not both.");
  }

  if (!input) {
    console.error(
      "Usage: node blog-publish.js <notion-page-url> [--publish | --update] [--repo=/path/to/blog]"
    );
    process.exit(1);
  }

  const postsDir = path.join(blogRepo, "_posts");

  if (!fs.existsSync(postsDir)) {
    throw new Error(`Could not find Jekyll _posts directory: ${postsDir}`);
  }

  if (shouldPush) {
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

  validateAutomationSchema(page);

  const publishDate = getDateProperty(page, "Publish date");
  const excerpt = getRichTextProperty(page, "Excerpt");
  const tags = getMultiSelectProperty(page, "Tags");
  const featured = getCheckboxProperty(page, "Featured");
  const thumbnail = getFileProperty(page, "Thumbnail");
  const publicationStatus = getStatusProperty(
    page,
    "Publication status"
  );

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

  if (shouldPublish && publicationStatus === "Published") {
    throw new Error(
      "This post has already been published. Use --update instead."
    );
  }

  let publishedFile = "";

  if (shouldUpdate) {
    publishedFile = getRichTextProperty(page, "Published file");
    const updateRequested = getCheckboxProperty(
      page,
      "Update request"
    );

    if (publicationStatus !== "Published") {
      throw new Error(
        "Only an already-published post can be updated."
      );
    }

    if (!publishedFile) {
      throw new Error("Published file is missing in Notion.");
    }

    if (!updateRequested) {
      throw new Error(
        "Update request is not checked in Notion."
      );
    }
  }

  const proposedSlug = slugify(title);
  const proposedFilename = `${publishDate}-${proposedSlug}.md`;

  const filename = shouldUpdate
    ? publishedFile
    : proposedFilename;

  if (path.basename(filename) !== filename) {
    throw new Error(
      `Published file must be a filename, not a path: ${filename}`
    );
  }

  const publishedStem = path.basename(filename, ".md");
  const assetDate = publishedStem.slice(0, 10);
  const assetSlug = publishedStem.slice(11);

  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(assetDate) ||
    !assetSlug
  ) {
    throw new Error(
      `Published file does not match YYYY-MM-DD-slug.md: ${filename}`
    );
  }

  const outputPath = path.join(postsDir, filename);
  const existingPublishCandidate =
    shouldPublish && fs.existsSync(outputPath);

  if (shouldUpdate) {
    if (!fs.existsSync(outputPath)) {
      throw new Error(
        `Published post does not exist: ${outputPath}`
      );
    }
  } else if (!shouldPublish && fs.existsSync(outputPath)) {
    throw new Error(`Post already exists: ${outputPath}`);
  }

  const assetsDir = path.join(blogRepo, "assets", "img");
  const assetPrefix =
    `${assetDate.replaceAll("-", "")}-${assetSlug}-`;

  const previousAssets =
    (shouldUpdate || existingPublishCandidate) && fs.existsSync(assetsDir)
      ? fs
          .readdirSync(assetsDir)
          .filter(name => name.startsWith(assetPrefix))
          .map(name => path.join(assetsDir, name))
      : [];

  const existingPublicationSnapshot = existingPublishCandidate
    ? snapshotFiles([outputPath, ...previousAssets])
    : null;

  let thumbnailPath = "";

  if (thumbnail) {
    const originalExt =
      path.extname(thumbnail.name) || ".png";

    const thumbnailFilename =
      `${assetDate.replaceAll("-", "")}-${assetSlug}-thumbnail${originalExt}`;

    thumbnailPath = `assets/img/${thumbnailFilename}`;

    const absoluteThumbnailPath = path.join(
      blogRepo,
      thumbnailPath
    );

    if (
      fs.existsSync(absoluteThumbnailPath) &&
      !shouldUpdate &&
      !existingPublishCandidate
    ) {
      throw new Error(
        `Thumbnail already exists: ${absoluteThumbnailPath}`
      );
    }

    await downloadImage(
      thumbnail.url,
      absoluteThumbnailPath
    );

    generatedFiles.push(absoluteThumbnailPath);

    console.log(
      `Downloaded thumbnail: ${thumbnailPath}`
    );
  }

  const blocks = await getAllChildren(pageId);

  // Treat first italic-only paragraph as subtitle.
  let subtitle = "";
  let bodyBlocks = [...blocks];

  const first = blocks[0];

  if (
    first?.type === "paragraph" &&
    first.paragraph.rich_text.length > 0 &&
    first.paragraph.rich_text.every(
      x => x.annotations?.italic
    )
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
        allowExistingAssets: existingPublishCandidate,
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
      if (
        !newAssetSet.has(path.resolve(oldFile)) &&
        fs.existsSync(oldFile)
      ) {
        fs.unlinkSync(oldFile);
        generatedFiles.push(oldFile);

        console.log(
          `Removed obsolete image: ${path.relative(
            blogRepo,
            oldFile
          )}`
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

  if (existingPublishCandidate) {
    const currentAssets = fs.existsSync(assetsDir)
      ? fs
          .readdirSync(assetsDir)
          .filter(name => name.startsWith(assetPrefix))
          .map(name => path.join(assetsDir, name))
      : [];

    if (
      !verifyExistingPublication(
        existingPublicationSnapshot,
        generatedFiles,
        [outputPath, ...currentAssets]
      )
    ) {
      throw new Error(
        `Existing post or assets do not exactly match the requested publication: ${filename}`
      );
    }

    console.log(
      "Verified that the requested post and complete asset set already exist on origin/main."
    );
  }

  console.log(
    `${shouldUpdate ? "Updated" : "Created"}: ${outputPath}`
  );

  if (!shouldPush) {
    console.log(
      "Dry run only. Nothing committed or pushed."
    );
    return;
  }

  console.log("\nValidating Jekyll build...");

  execSync("bundle exec jekyll build", {
    cwd: blogRepo,
    stdio: "inherit",
  });

  console.log("\nJekyll build passed.");

  const relativeGeneratedFiles = [
    ...new Set(
      generatedFiles.map(file =>
        path.relative(blogRepo, file)
      )
    ),
  ];

  execFileSync(
    "git",
    ["add", "--", ...relativeGeneratedFiles],
    {
      cwd: blogRepo,
      stdio: "inherit",
    }
  );

  const stagedFiles = run(
    "git diff --cached --name-only",
    blogRepo
  )
    .split("\n")
    .filter(Boolean)
    .sort();

  const allowedFiles = new Set(
    relativeGeneratedFiles
  );

  const unexpectedFiles = stagedFiles.filter(
    file => !allowedFiles.has(file)
  );

  if (unexpectedFiles.length) {
    throw new Error(
      `Unexpected staged files detected:\n${unexpectedFiles.join(
        "\n"
      )}`
    );
  }

  if (stagedFiles.length) {
    const commitPrefix = shouldUpdate ? "Update" : "Publish";

    execSync(
      `git commit -m ${JSON.stringify(`${commitPrefix}: ${title}`)}`,
      {
        cwd: blogRepo,
        stdio: "inherit",
      }
    );

    console.log("\nPushing to GitHub...");
    pushAndConfirm(blogRepo);
  } else {
    console.log(
      "No Git changes needed; regenerated post and assets match origin/main."
    );
  }

  await writePublicationState(
    pageId,
    filename,
    shouldUpdate ? "update" : "publish"
  );

  console.log(
    "Updated publication state in Notion."
  );

  console.log(
    `\n${shouldUpdate ? "Updated" : "Published"}: ${title}`
  );
}

if (require.main === module) {
  main().catch(error => {
    console.error("\nFailed:");
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = {
  publicationProperties,
  publicationStateMatches,
  pushAndConfirm,
  snapshotFiles,
  verifyExistingPublication,
  writePublicationStateSafely,
};
