const { Client } = require("@notionhq/client");
const { execFileSync } = require("child_process");
const path = require("path");

const notion = new Client({
  auth: process.env.NOTION_ACCESS_TOKEN,
});

const requestFilter = {
  or: [
    {
      property: "Publish request",
      checkbox: {
        equals: true,
      },
    },
    {
      property: "Update request",
      checkbox: {
        equals: true,
      },
    },
  ],
};

function getTitle(page) {
  const titleProperty = Object.values(page.properties || {})
    .find(property => property.type === "title");

  if (!titleProperty) return "(untitled)";

  return titleProperty.title
    .map(item => item.plain_text)
    .join("")
    .trim();
}

function getCheckboxProperty(page, name) {
  const property = page.properties?.[name];

  if (!property || property.type !== "checkbox") {
    throw new Error(`Missing checkbox property: ${name}`);
  }

  return property.checkbox;
}

function getStatusProperty(page, name) {
  const property = page.properties?.[name];

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

function getRequestedMode(page) {
  const publishRequested = getCheckboxProperty(page, "Publish request");
  const updateRequested = getCheckboxProperty(page, "Update request");
  const publicationStatus = getStatusProperty(page, "Publication status");
  const title = getTitle(page);

  if (publishRequested && updateRequested) {
    return {
      valid: false,
      reason:
        "Both Publish request and Update request are checked. Clear one request flag before retrying.",
    };
  }

  if (publishRequested) {
    if (publicationStatus === "Published") {
      return {
        valid: false,
        reason:
          "Publish request is checked on an already Published row. Use Update request instead.",
      };
    }

    return {
      valid: true,
      mode: "publish",
      title,
    };
  }

  if (updateRequested) {
    if (publicationStatus !== "Published") {
      return {
        valid: false,
        reason:
          "Update request is checked on an unpublished row. Publish it first.",
      };
    }

    return {
      valid: true,
      mode: "update",
      title,
    };
  }

  return {
    valid: false,
    reason:
      "No publish or update request is checked. This row should not have matched the poll query.",
  };
}

async function pollBlogPosts({
  notionClient = notion,
  dataSourceId = process.env.BLOG_DATA_SOURCE_ID,
  shouldPublish = process.argv.includes("--publish"),
  execFile = execFileSync,
  nodePath = process.execPath,
  scriptPath = path.join(__dirname, "blog-publish.js"),
  cwd = process.cwd(),
  env = process.env,
} = {}) {
  if (!env.NOTION_ACCESS_TOKEN) {
    throw new Error("Missing NOTION_ACCESS_TOKEN");
  }

  if (!dataSourceId) {
    throw new Error("Missing BLOG_DATA_SOURCE_ID");
  }

  const response = await notionClient.dataSources.query({
    data_source_id: dataSourceId,
    filter: requestFilter,
    page_size: 100,
  });

  if (!response.results.length) {
    console.log("No blog posts awaiting publication or update.");
    return;
  }

  console.log(
    `Found ${response.results.length} publish/update request(s).\n`
  );

  let invalidCount = 0;

  for (const page of response.results) {
    const title = getTitle(page);
    const requestedMode = getRequestedMode(page);

    console.log(`Processing: ${title}`);
    console.log(`Page ID: ${page.id}`);

    if (!requestedMode.valid) {
      invalidCount++;
      console.error(
        `Skipping ${title}: ${requestedMode.reason}\n`
      );
      continue;
    }

    if (!shouldPublish) {
      console.log(
        `Dry run: would ${requestedMode.mode} this post.\n`
      );
      continue;
    }

    execFile(
      nodePath,
      [
        scriptPath,
        page.url,
        `--${requestedMode.mode}`,
      ],
      {
        cwd,
        stdio: "inherit",
        env,
      }
    );

    if (requestedMode.mode === "publish") {
      // Only clear the request after publishing succeeds.
      await notionClient.pages.update({
        page_id: page.id,
        properties: {
          "Publish request": {
            checkbox: false,
          },
        },
      });

      console.log(`Cleared Publish request for: ${title}\n`);
    } else {
      console.log(
        `Update request clearing is handled by blog-publish.js for: ${title}\n`
      );
    }
  }

  if (invalidCount > 0) {
    throw new Error(
      `Skipped ${invalidCount} invalid publish/update request(s).`
    );
  }
}

if (require.main === module) {
  pollBlogPosts().catch(error => {
    console.error("\nPoll failed:");
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = {
  getRequestedMode,
  pollBlogPosts,
  requestFilter,
};
