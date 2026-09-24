const assert = require("node:assert/strict");
const test = require("node:test");

const {
  getRequestedMode,
  pollBlogPosts,
  requestFilter,
  sanitizeFailure,
} = require("./blog-poll");

function page({
  id = "11111111-1111-1111-1111-111111111111",
  title = "Test Post",
  publishRequest = false,
  updateRequest = false,
  status = "Draft",
  automationState = "Ready",
  retryRequest = false,
} = {}) {
  return {
    id,
    url: `https://notion.so/${id.replaceAll("-", "")}`,
    properties: {
      Name: {
        type: "title",
        title: [{ plain_text: title }],
      },
      "Publish request": {
        type: "checkbox",
        checkbox: publishRequest,
      },
      "Update request": {
        type: "checkbox",
        checkbox: updateRequest,
      },
      "Publication status": {
        type: "select",
        select: { name: status },
      },
      "Automation state": {
        type: "select",
        select: automationState ? { name: automationState } : null,
      },
      "Last failure": {
        type: "rich_text",
        rich_text: [],
      },
      "Failed at": {
        type: "date",
        date: null,
      },
      "Retry request": {
        type: "checkbox",
        checkbox: retryRequest,
      },
    },
  };
}

function notionClient(results) {
  const queries = [];
  const updates = [];

  return {
    queries,
    updates,
    dataSources: {
      async query(query) {
        queries.push(query);
        return { results };
      },
    },
    pages: {
      async update(update) {
        updates.push(update);
      },
    },
  };
}

function logger() {
  const logs = [];
  const errors = [];

  return {
    logs,
    errors,
    log(value) {
      logs.push(String(value));
    },
    error(value) {
      errors.push(String(value));
    },
  };
}

async function runPoll(results, options = {}) {
  const notion = options.notion || notionClient(results);
  const execs = [];
  const output = options.logger || logger();
  const env = {
    NOTION_ACCESS_TOKEN: "notion-test-secret",
    GITHUB_SERVER_URL: "https://github.com",
    GITHUB_REPOSITORY: "example/blog",
    GITHUB_RUN_ID: "123",
  };

  const promise = pollBlogPosts({
    notionClient: notion,
    dataSourceId: "data-source-id",
    shouldPublish: options.shouldPublish ?? true,
    execFile(command, args, execOptions) {
      execs.push({ command, args, execOptions });
      if (options.execFile) return options.execFile(command, args, execOptions);
      return { stdout: "publisher completed", stderr: "" };
    },
    nodePath: "/usr/local/bin/node",
    scriptPath: "/repo/scripts/blog-publish.js",
    cwd: "/repo",
    env,
    now: () => new Date("2026-09-24T00:00:00.000Z"),
    logger: output,
  });

  return { notion, execs, output, promise };
}

test("poller filter selects pending non-failed rows or explicit retries", () => {
  assert.deepEqual(requestFilter, {
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
  });
});

test("initial publish and update success use their own modes", async () => {
  const publishPage = page({ publishRequest: true });
  const updatePage = page({
    id: "22222222-2222-2222-2222-222222222222",
    updateRequest: true,
    status: "Published",
  });
  const result = await runPoll([publishPage, updatePage]);

  await result.promise;
  assert.deepEqual(
    result.execs.map(call => call.args.at(-1)),
    ["--publish", "--update"]
  );
  assert.equal(result.notion.updates.length, 0);
});

test("failed article is recorded and suppressed on subsequent polling", async () => {
  const first = await runPoll([page({ publishRequest: true })], {
    execFile() {
      const error = new Error("publisher exited");
      error.stderr = Buffer.from("Missing excerpt");
      throw error;
    },
  });

  await assert.rejects(first.promise, /1 publication failure/);
  assert.equal(first.notion.updates.length, 1);
  assert.equal(
    first.notion.updates[0].properties["Automation state"].select.name,
    "Failed"
  );
  assert.equal(
    first.notion.updates[0].properties["Publish request"],
    undefined
  );

  const second = await runPoll([
    page({
      publishRequest: true,
      automationState: "Failed",
      retryRequest: false,
    }),
  ]);
  await second.promise;
  assert.equal(second.execs.length, 0);
});

test("explicit retry authorises one attempt and repeated failure consumes it", async () => {
  const retry = await runPoll([
    page({
      publishRequest: true,
      automationState: "Failed",
      retryRequest: true,
    }),
  ], {
    execFile() {
      throw new Error("still broken");
    },
  });

  await assert.rejects(retry.promise, /1 publication failure/);
  assert.equal(retry.execs.length, 1);
  assert.equal(retry.notion.updates.length, 2);
  assert.deepEqual(retry.notion.updates[0].properties, {
    "Retry request": { checkbox: false },
  });
  assert.equal(
    retry.notion.updates[1].properties["Automation state"].select.name,
    "Failed"
  );
  assert.equal(
    retry.notion.updates[1].properties["Retry request"].checkbox,
    false
  );
});

test("one failed article does not prevent an unrelated valid article", async () => {
  const failedPage = page({ publishRequest: true, title: "Broken" });
  const validPage = page({
    id: "33333333-3333-3333-3333-333333333333",
    publishRequest: true,
    title: "Valid",
  });
  const result = await runPoll([failedPage, validPage], {
    execFile(_command, args) {
      if (args[1] === failedPage.url) throw new Error("bad article");
      return { stdout: "ok", stderr: "" };
    },
  });

  await assert.rejects(result.promise, /1 publication failure/);
  assert.equal(result.execs.length, 2);
  assert.match(result.output.logs.join("\n"), /Published: Valid/);
});

test("failure before publisher starts is recorded for only that row", async () => {
  const result = await runPoll([page({ publishRequest: true })], {
    execFile() {
      const error = new Error("spawn ENOENT");
      error.code = "ENOENT";
      throw error;
    },
  });

  await assert.rejects(result.promise, /1 publication failure/);
  assert.match(
    result.notion.updates[0].properties["Last failure"].rich_text[0].text.content,
    /spawn ENOENT/
  );
});

test("both request flags are invalid and become suppressed", async () => {
  const invalid = page({ publishRequest: true, updateRequest: true });
  const result = await runPoll([invalid]);

  await assert.rejects(result.promise, /1 invalid request/);
  assert.equal(result.execs.length, 0);
  assert.equal(
    result.notion.updates[0].properties["Automation state"].select.name,
    "Failed"
  );
});

test("missing retry schema blocks the complete batch before publication", async () => {
  const incomplete = page({ publishRequest: true });
  delete incomplete.properties["Last failure"];
  const valid = page({
    id: "44444444-4444-4444-4444-444444444444",
    publishRequest: true,
  });
  const result = await runPoll([incomplete, valid]);

  await assert.rejects(result.promise, /Last failure is missing/);
  assert.equal(result.execs.length, 0);
});

test("failure records and logs redact credentials", async () => {
  const secret = "ntn_private-credential-123";
  const result = await runPoll([page({ publishRequest: true })], {
    execFile() {
      const error = new Error("request failed");
      error.stderr = Buffer.from(
        `Authorization: Bearer ${secret}\nNotion token notion-test-secret`
      );
      throw error;
    },
  });

  await assert.rejects(result.promise);
  const recorded =
    result.notion.updates[0].properties["Last failure"].rich_text[0].text.content;
  const logged = result.output.errors.join("\n");

  assert.doesNotMatch(recorded, /credential|notion-test-secret/);
  assert.doesNotMatch(logged, /credential|notion-test-secret/);
  assert.match(recorded, /\[REDACTED\]/);
  assert.equal(sanitizeFailure(secret), "[REDACTED]");
});

test("publish on Published and update on Draft remain invalid", () => {
  assert.equal(
    getRequestedMode(page({ publishRequest: true, status: "Published" })).valid,
    false
  );
  assert.equal(
    getRequestedMode(page({ updateRequest: true, status: "Draft" })).valid,
    false
  );
});
