const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  publicationProperties,
  pushAndConfirm,
  snapshotFiles,
  verifyExistingPublication,
  writePublicationStateSafely,
} = require("./blog-publish");

function completedPage(filename, mode) {
  return {
    properties: {
      "Publication status": {
        type: "select",
        select: { name: "Published" },
      },
      "Published file": {
        type: "rich_text",
        rich_text: [{ plain_text: filename }],
      },
      "Published URL": {
        type: "url",
        url: `https://sugirdha.github.io/${filename
          .replace(/^\d{4}-\d{2}-\d{2}-/, "")
          .replace(/\.md$/, "")}/`,
      },
      "Publish request": {
        type: "checkbox",
        checkbox: mode === "publish" ? false : true,
      },
      "Update request": {
        type: "checkbox",
        checkbox: mode === "update" ? false : true,
      },
      "Automation state": {
        type: "select",
        select: { name: "Ready" },
      },
      "Retry request": {
        type: "checkbox",
        checkbox: false,
      },
    },
  };
}

test("publication success atomically clears request and failure state", () => {
  const publish = publicationProperties("2026-09-24-post.md", "publish");
  const update = publicationProperties("2026-09-24-post.md", "update");

  assert.equal(publish["Publish request"].checkbox, false);
  assert.equal(update["Update request"].checkbox, false);
  assert.equal(publish["Automation state"].select.name, "Ready");
  assert.deepEqual(publish["Last failure"].rich_text, []);
  assert.equal(publish["Failed at"].date, null);
  assert.equal(publish["Retry request"].checkbox, false);
});

test("post and complete asset set must byte-match for reconciliation", t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "blog-reconcile-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));

  const post = path.join(directory, "post.md");
  const image = path.join(directory, "image.png");
  fs.writeFileSync(post, "expected post");
  fs.writeFileSync(image, "expected image");

  const snapshot = snapshotFiles([post, image]);
  assert.equal(
    verifyExistingPublication(snapshot, [post, image], [post, image]),
    true
  );

  fs.writeFileSync(image, "different image");
  assert.equal(
    verifyExistingPublication(snapshot, [post, image], [post, image]),
    false
  );

  fs.writeFileSync(image, "expected image");
  const extra = path.join(directory, "extra.png");
  fs.writeFileSync(extra, "unexpected");
  assert.equal(
    verifyExistingPublication(
      snapshot,
      [post, image],
      [post, image, extra]
    ),
    false
  );
});

test("ambiguous push is accepted only when origin/main has exact local commit", () => {
  const result = pushAndConfirm("/repo", {
    exec() {
      throw new Error("connection closed after send");
    },
    read(command) {
      if (command === "git rev-parse HEAD") return "abc123";
      if (command === "git ls-remote origin refs/heads/main") {
        return "abc123\trefs/heads/main";
      }
      throw new Error(`Unexpected command: ${command}`);
    },
  });

  assert.deepEqual(result, { reconciled: true });
});

test("ambiguous push remains failed when remote commit cannot be verified", () => {
  const pushError = new Error("push failed");

  assert.throws(
    () =>
      pushAndConfirm("/repo", {
        exec() {
          throw pushError;
        },
        read(command) {
          return command === "git rev-parse HEAD"
            ? "local123"
            : "remote456\trefs/heads/main";
        },
      }),
    error => error === pushError
  );
});

test("failure after push is reconciled when Notion write actually completed", async () => {
  const filename = "2026-09-24-post.md";
  let updateCalls = 0;
  const notion = {
    pages: {
      async update() {
        updateCalls++;
        throw new Error("response lost after write");
      },
      async retrieve() {
        return completedPage(filename, "publish");
      },
    },
  };

  await writePublicationStateSafely(
    notion,
    "page-id",
    filename,
    "publish"
  );
  assert.equal(updateCalls, 1);
});

test("unverified Notion write-back failure is not treated as success", async () => {
  const notion = {
    pages: {
      async update() {
        throw new Error("Notion unavailable");
      },
      async retrieve() {
        return completedPage("2026-09-24-other.md", "update");
      },
    },
  };

  await assert.rejects(
    writePublicationStateSafely(
      notion,
      "page-id",
      "2026-09-24-post.md",
      "update"
    ),
    /Notion unavailable/
  );
});
