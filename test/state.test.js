"use strict";

const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");

const source = fs.readFileSync(
  path.join(__dirname, "../common/state.js"),
  "utf8",
);

function numberInput(value) {
  return {
    type: "number",
    tagName: "INPUT",
    value: String(value),
    min: "",
    max: "",
  };
}

function loadState(elements, options) {
  const saved = new Map(Object.entries((options && options.saved) || {}));
  const window = {
    location: { search: (options && options.search) || "" },
    localStorage: {
      getItem(key) {
        return saved.has(key) ? saved.get(key) : null;
      },
      setItem(key, value) {
        saved.set(key, String(value));
      },
      removeItem(key) {
        saved.delete(key);
      },
    },
  };
  vm.runInNewContext(source, {
    window,
    URLSearchParams,
    document: {
      getElementById(id) {
        return elements[id] || null;
      },
    },
  });
  return window.Inputs;
}

test("空欄が初期値の数値欄は共有URLから省く", () => {
  const elements = { amount: numberInput("") };
  const Inputs = loadState(elements);
  const inputs = Inputs.create({ fields: [["amount", "", "amount"]] });

  assert.equal(inputs.serialize().toString(), "");
});

test("無関係なクエリだけなら保存済みの入力を復元する", () => {
  const elements = { age: numberInput(40) };
  const Inputs = loadState(elements, {
    search: "?utm_source=example",
    saved: { simulator: "age=55" },
  });
  const inputs = Inputs.create({
    fields: [["age", 40, "age"]],
    storageKey: "simulator",
  });

  assert.equal(inputs.restore(), "saved");
  assert.equal(elements.age.value, "55");
});

test("入力項目を含む共有URLは保存済みの入力より優先する", () => {
  const elements = { age: numberInput(40) };
  const Inputs = loadState(elements, {
    search: "?age=60&utm_source=example",
    saved: { simulator: "age=55" },
  });
  const inputs = Inputs.create({
    fields: [["age", 40, "age"]],
    storageKey: "simulator",
  });

  assert.equal(inputs.restore(), "url");
  assert.equal(elements.age.value, "60");
});
