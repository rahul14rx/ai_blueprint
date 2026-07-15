import assert from "node:assert/strict";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders Blueprint Studio prompt workflow", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /Blueprint Studio/);
  assert.match(html, /AI prompt to validated 2D plan/);
  assert.match(html, /Describe your home/);
  assert.match(html, /Live AI requirement parser/);
  assert.match(html, /No room overlaps/);
  assert.match(html, /Structured room coordinates/);
  assert.match(html, /Understand this request/);
  assert.match(html, /40 ft x 60 ft east-facing plot/);
});

test("rendered shell is the real app, not the disposable preview skeleton", async () => {
  const response = await render();
  const html = await response.text();

  assert.doesNotMatch(html, /codex-preview/);
  assert.doesNotMatch(html, /Your site is taking shape/);
  assert.doesNotMatch(html, /Codex is working/);
  assert.doesNotMatch(html, /react-loading-skeleton/);
  assert.match(html, /prompt-only/);
  assert.match(html, /accuracy-rules/);
  assert.match(html, /PHASE 1/);
});

