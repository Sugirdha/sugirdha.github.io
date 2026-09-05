const assert = require("node:assert/strict");
const test = require("node:test");

const {
  getRequestedMode,
  pollBlogPosts,
  requestFilter,
} = require("./blog-poll");

function page({
  id = "page-id",
  title = "Test Post",
  publishRequest = false,
  updateRequest = false,
  status = "Draft",
} = {}) {
  return {
    id,
    url: `https://notion.so/${id.replaceAll("-", "")}`,
    properties: {
      Name: {
        type: "title",
        title: [
          {
            plain_text: title,
          },
        ],
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
        select: {
          name: status,
        },
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
        return {
          results,
        };
      },
    },
    pages: {
      async update(update) {
        updates.push(update);
      },
    },
  };
}

async function runPoll(results, options = {}) {
  const notion = notionClient(results);
  const execs = [];

  await pollBlogPosts({
    notionClient: notion,
    dataSourceId: "data-source-id",
    shouldPublish: options.shouldPublish ?? true,
    execFile(command, args, execOptions) {
      execs.push({
        command,
        args,
        execOptions,
      });
    },
    nodePath: "/usr/local/bin/node",
    scriptPath: "/repo/scripts/blog-publish.js",
    cwd: "/repo",
    env: {
      NOTION_ACCESS_TOKEN: "secret",
    },
  });

  return {
    notion,
    execs,
  };
}

test("poller uses a Notion OR filter for publish or update requests", () => {
  assert.deepEqual(requestFilter, {
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
  });
});

test("Publish request only on unpublished row selects --publish", () => {
  assert.deepEqual(
    getRequestedMode(
      page({
        publishRequest: true,
        updateRequest: false,
        status: "Draft",
      })
    ),
    {
      valid: true,
      mode: "publish",
      title: "Test Post",
    }
  );
});

test("Update request only on Published row selects --update", () => {
  assert.deepEqual(
    getRequestedMode(
      page({
        publishRequest: false,
        updateRequest: true,
        status: "Published",
      })
    ),
    {
      valid: true,
      mode: "update",
      title: "Test Post",
    }
  );
});

test("both flags true is rejected", () => {
  const result = getRequestedMode(
    page({
      publishRequest: true,
      updateRequest: true,
      status: "Draft",
    })
  );

  assert.equal(result.valid, false);
  assert.match(result.reason, /Both Publish request and Update request/);
});

test("Publish request on Published row is rejected", () => {
  const result = getRequestedMode(
    page({
      publishRequest: true,
      updateRequest: false,
      status: "Published",
    })
  );

  assert.equal(result.valid, false);
  assert.match(result.reason, /already Published/);
});

test("Update request on unpublished row is rejected", () => {
  const result = getRequestedMode(
    page({
      publishRequest: false,
      updateRequest: true,
      status: "Draft",
    })
  );

  assert.equal(result.valid, false);
  assert.match(result.reason, /unpublished row/);
});

test("multiple valid publish and update rows are handled independently", async () => {
  const publishPage = page({
    id: "11111111-1111-1111-1111-111111111111",
    title: "Publish Me",
    publishRequest: true,
    status: "Draft",
  });
  const updatePage = page({
    id: "22222222-2222-2222-2222-222222222222",
    title: "Update Me",
    updateRequest: true,
    status: "Published",
  });

  const { notion, execs } = await runPoll([
    publishPage,
    updatePage,
  ]);

  assert.equal(execs.length, 2);
  assert.equal(execs[0].args.at(-1), "--publish");
  assert.equal(execs[1].args.at(-1), "--update");
  assert.equal(notion.updates.length, 1);
  assert.deepEqual(notion.updates[0], {
    page_id: publishPage.id,
    properties: {
      "Publish request": {
        checkbox: false,
      },
    },
  });
});

test("invalid rows are skipped without invoking blog-publish", async () => {
  await assert.rejects(
    runPoll([
      page({
        publishRequest: true,
        updateRequest: true,
        status: "Draft",
      }),
    ]),
    /Skipped 1 invalid/
  );
});

test("invalid rows do not prevent other rows from using their own modes", async () => {
  const notion = notionClient([
    page({
      title: "Ambiguous",
      publishRequest: true,
      updateRequest: true,
      status: "Draft",
    }),
    page({
      id: "33333333-3333-3333-3333-333333333333",
      title: "Valid Publish",
      publishRequest: true,
      status: "Draft",
    }),
    page({
      id: "44444444-4444-4444-4444-444444444444",
      title: "Valid Update",
      updateRequest: true,
      status: "Published",
    }),
  ]);
  const execs = [];

  await assert.rejects(
    pollBlogPosts({
      notionClient: notion,
      dataSourceId: "data-source-id",
      shouldPublish: true,
      execFile(command, args) {
        execs.push({
          command,
          args,
        });
      },
      nodePath: "/usr/local/bin/node",
      scriptPath: "/repo/scripts/blog-publish.js",
      cwd: "/repo",
      env: {
        NOTION_ACCESS_TOKEN: "secret",
      },
    }),
    /Skipped 1 invalid/
  );

  assert.equal(execs.length, 2);
  assert.equal(execs[0].args.at(-1), "--publish");
  assert.equal(execs[1].args.at(-1), "--update");
});
