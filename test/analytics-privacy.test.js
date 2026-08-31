"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

test("Google Analyticsへ送るURLと参照元から試算条件を除外する", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "../common/analytics.js"),
    "utf8",
  );
  const appended = [];
  const context = {
    URL,
    window: {
      location: {
        href: "https://example.test/finance/gift/?estate=10000&ages=20,18#result",
      },
    },
    document: {
      referrer: "https://example.test/finance/assetSimulator/?asset=5000#chart",
      createElement: () => ({}),
      head: { appendChild: (node) => appended.push(node) },
    },
  };

  vm.runInNewContext(source, context);

  const config = context.window.dataLayer.find((args) => args[0] === "config");
  assert.ok(config, "Analyticsのconfigが呼ばれていない");
  assert.strictEqual(
    config[2].page_location,
    "https://example.test/finance/gift/",
  );
  assert.strictEqual(
    config[2].page_referrer,
    "https://example.test/finance/assetSimulator/",
  );
  assert.strictEqual(appended.length, 1, "計測タグが読み込まれていない");
});
