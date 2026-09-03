const { Client } = require("@notionhq/client");
const { execFileSync } = require("child_process");
const path = require("path");

const notion = new Client({
  auth: process.env.NOTION_ACCESS_TOKEN,
});

const dataSourceId = process.env.BLOG_DATA_SOURCE_ID;
const shouldPublish = process.argv.includes("--publish");

function getTitle(page) {
  const titleProperty = Object.values(page.properties || {})
    .find(property => property.type === "title");

  if (!titleProperty) return "(untitled)";

  return titleProperty.title
    .map(item => item.plain_text)
    .join("")
    .trim();
}

async function main() {
  if (!process.env.NOTION_ACCESS_TOKEN) {
    throw new Error("Missing NOTION_ACCESS_TOKEN");
  }

  if (!dataSourceId) {
    throw new Error("Missing BLOG_DATA_SOURCE_ID");
  }

  const response = await notion.dataSources.query({
    data_source_id: dataSourceId,
    filter: {
      property: "Publish request",
      checkbox: {
        equals: true,
      },
    },
    page_size: 100,
  });

  if (!response.results.length) {
    console.log("No blog posts awaiting publication.");
    return;
  }

  console.log(`Found ${response.results.length} publish request(s).\n`);

  for (const page of response.results) {
    const title = getTitle(page);

    console.log(`Processing: ${title}`);
    console.log(`Page ID: ${page.id}`);

    if (!shouldPublish) {
      console.log("Dry run: would publish this post.\n");
      continue;
    }

    execFileSync(
      process.execPath,
      [
        path.join(__dirname, "blog-publish.js"),
        page.url,
        "--publish",
      ],
      {
        cwd: process.cwd(),
        stdio: "inherit",
        env: process.env,
      }
    );

    // Only clear the request after publishing succeeds.
    await notion.pages.update({
      page_id: page.id,
      properties: {
        "Publish request": {
          checkbox: false,
        },
      },
    });

    console.log(`Cleared Publish request for: ${title}\n`);
  }
}

main().catch(error => {
  console.error("\nPoll failed:");
  console.error(error.message);
  process.exit(1);
});
