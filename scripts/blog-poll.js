const { Client } = require("@notionhq/client");
const { execFileSync } = require("child_process");
const path = require("path");

const notion = new Client({ auth: process.env.NOTION_ACCESS_TOKEN });

const requestFilter = {
  and: [
    {
      or: [
        { property: "Publish request", checkbox: { equals: true } },
        { property: "Update request", checkbox: { equals: true } },
      ],
    },
    {
      or: [
        {
          property: "Automation state",
          select: { equals: "Ready" },
        },
        {
          property: "Automation state",
          select: { is_empty: true },
        },
        { property: "Retry request", checkbox: { equals: true } },
      ],
    },
  ],
};

const retryPropertySchema = {
  "Automation state": "select",
  "Last failure": "rich_text",
  "Failed at": "date",
  "Retry request": "checkbox",
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

  if (!property) return "";
  if (property.type === "status") return property.status?.name || "";
  if (property.type === "select") return property.select?.name || "";
  return "";
}

function validateRetrySchema(page) {
  const problems = [];

  for (const [name, type] of Object.entries(retryPropertySchema)) {
    const property = page.properties?.[name];

    if (!property) {
      problems.push(`${name} is missing`);
    } else if (property.type !== type) {
      problems.push(`${name} must be ${type}, found ${property.type}`);
    }
  }

  if (problems.length) {
    throw new Error(
      `Notion retry schema is not ready for ${getTitle(page)}: ${problems.join(
        "; "
      )}`
    );
  }
}

function getRequestedMode(page) {
  const publishRequested = getCheckboxProperty(page, "Publish request");
  const updateRequested = getCheckboxProperty(page, "Update request");
  const publicationStatus = getStatusProperty(page, "Publication status");
  const automationState = getStatusProperty(page, "Automation state");
  const retryRequested = getCheckboxProperty(page, "Retry request");
  const title = getTitle(page);

  if (automationState === "Failed" && !retryRequested) {
    return {
      valid: false,
      suppressed: true,
      reason: "A previous failure is awaiting an explicit Retry request.",
    };
  }

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

    return { valid: true, mode: "publish", title, retryRequested };
  }

  if (updateRequested) {
    if (publicationStatus !== "Published") {
      return {
        valid: false,
        reason:
          "Update request is checked on an unpublished row. Publish it first.",
      };
    }

    return { valid: true, mode: "update", title, retryRequested };
  }

  return {
    valid: false,
    reason:
      "No publish or update request is checked. This row should not have matched the poll query.",
  };
}

function sanitizeFailure(value, env = process.env) {
  let text = String(value || "Publication failed.");
  const secrets = [
    env.NOTION_ACCESS_TOKEN,
    env.GITHUB_TOKEN,
    env.GH_TOKEN,
  ].filter(secret => typeof secret === "string" && secret.length >= 6);

  for (const secret of secrets) {
    text = text.split(secret).join("[REDACTED]");
  }

  text = text
    .replace(/(?:secret_|ntn_|gh[pousr]_)[A-Za-z0-9_-]+/gi, "[REDACTED]")
    .replace(/(authorization\s*[:=]\s*)(?:bearer\s+)?\S+/gi, "$1[REDACTED]")
    .replace(/(https?:\/\/[^\s?]+)\?\S+/gi, "$1?[REDACTED]")
    .replace(/[\t\r]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  text = text
    .split("\n")
    .filter(line => {
      const trimmed = line.trim();
      return (
        !/^(?:request|response)\s+(?:body|headers?)\s*:/i.test(trimmed) &&
        !/^(?:set-cookie|cookie)\s*:/i.test(trimmed) &&
        !(trimmed.startsWith("{") && trimmed.endsWith("}"))
      );
    })
    .slice(-12)
    .join("\n")
    .trim();

  return text.slice(0, 1600) || "Publication failed.";
}

function githubRunUrl(env) {
  if (!env.GITHUB_SERVER_URL || !env.GITHUB_REPOSITORY || !env.GITHUB_RUN_ID) {
    return "";
  }

  return `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`;
}

function failureSummary(error, env) {
  const stderr = error?.stderr?.toString?.() || "";
  const message = stderr || error?.message || error;
  const runUrl = githubRunUrl(env);
  const summary = sanitizeFailure(message, env);

  return runUrl ? `${summary}\n\nGitHub run: ${runUrl}` : summary;
}

async function markFailed(notionClient, pageId, summary, now) {
  await notionClient.pages.update({
    page_id: pageId,
    properties: {
      "Automation state": { select: { name: "Failed" } },
      "Last failure": {
        rich_text: [
          { type: "text", text: { content: summary } },
        ],
      },
      "Failed at": { date: { start: now().toISOString() } },
      "Retry request": { checkbox: false },
    },
  });
}

async function consumeRetry(notionClient, pageId) {
  await notionClient.pages.update({
    page_id: pageId,
    properties: {
      "Retry request": { checkbox: false },
    },
  });
}

function emitChildOutput(result, env, logger) {
  const rawStdout = result?.stdout?.toString?.() || "";
  const rawStderr = result?.stderr?.toString?.() || "";
  const stdout = rawStdout.trim() ? sanitizeFailure(rawStdout, env) : "";
  const stderr = rawStderr.trim() ? sanitizeFailure(rawStderr, env) : "";

  if (stdout) logger.log(stdout);
  if (stderr) logger.error(stderr);
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
  now = () => new Date(),
  logger = console,
} = {}) {
  if (!env.NOTION_ACCESS_TOKEN) throw new Error("Missing NOTION_ACCESS_TOKEN");
  if (!dataSourceId) throw new Error("Missing BLOG_DATA_SOURCE_ID");

  const response = await notionClient.dataSources.query({
    data_source_id: dataSourceId,
    filter: requestFilter,
    page_size: 100,
  });

  if (!response.results.length) {
    logger.log("No blog posts awaiting publication or update.");
    return { processed: 0, failed: 0, invalid: 0 };
  }

  // Refuse all real publication until every returned row exposes the new schema.
  for (const page of response.results) validateRetrySchema(page);

  logger.log(`Found ${response.results.length} publish/update request(s).\n`);

  let processedCount = 0;
  let failedCount = 0;
  let invalidCount = 0;

  for (const page of response.results) {
    const title = getTitle(page);
    const requestedMode = getRequestedMode(page);

    logger.log(`Processing: ${title}`);
    logger.log(`Page ID: ${page.id}`);

    if (requestedMode.suppressed) {
      logger.log(`Suppressed ${title}: ${requestedMode.reason}\n`);
      continue;
    }

    if (!requestedMode.valid) {
      invalidCount++;
      const summary = sanitizeFailure(requestedMode.reason, env);
      logger.error(`Skipping ${title}: ${summary}\n`);

      if (shouldPublish) {
        try {
          await markFailed(notionClient, page.id, summary, now);
        } catch (stateError) {
          logger.error(
            `Could not record invalid request for ${title}: ${sanitizeFailure(
              stateError?.message,
              env
            )}`
          );
        }
      }
      continue;
    }

    if (!shouldPublish) {
      logger.log(`Dry run: would ${requestedMode.mode} this post.\n`);
      continue;
    }

    try {
      if (requestedMode.retryRequested) {
        // Keep state Failed until success so interruption cannot auto-retry.
        await consumeRetry(notionClient, page.id);
      }

      const result = execFile(
        nodePath,
        [scriptPath, page.url, `--${requestedMode.mode}`],
        {
          cwd,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
          maxBuffer: 10 * 1024 * 1024,
          env,
        }
      );

      emitChildOutput(result, env, logger);
      processedCount++;
      logger.log(`${requestedMode.mode === "publish" ? "Published" : "Updated"}: ${title}\n`);
    } catch (error) {
      failedCount++;
      const summary = failureSummary(error, env);
      logger.error(`Failed ${title}: ${summary}\n`);

      try {
        await markFailed(notionClient, page.id, summary, now);
      } catch (stateError) {
        logger.error(
          `Could not record failure for ${title}: ${sanitizeFailure(
            stateError?.message,
            env
          )}`
        );
      }
    }
  }

  if (failedCount || invalidCount) {
    throw new Error(
      `Blog poll completed with ${failedCount} publication failure(s) and ${invalidCount} invalid request(s).`
    );
  }

  return { processed: processedCount, failed: failedCount, invalid: invalidCount };
}

if (require.main === module) {
  pollBlogPosts().catch(error => {
    console.error("\nPoll failed:");
    console.error(sanitizeFailure(error.message));
    process.exit(1);
  });
}

module.exports = {
  failureSummary,
  getRequestedMode,
  pollBlogPosts,
  requestFilter,
  retryPropertySchema,
  sanitizeFailure,
  validateRetrySchema,
};
