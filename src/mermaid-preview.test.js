import { test, mock } from "node:test";
import assert from "node:assert/strict";

let render;
const themes = [];
const configs = [];
mock.module("mermaid", {
  defaultExport: {
    initialize: (config) => { themes.push(config.theme); configs.push(config); },
    render: (...args) => render(...args),
  },
});
const { renderMermaidBlocks } = await import("./mermaid-preview.js");

function fixture(...sources) {
  const replacements = [];
  const errors = [];
  const ownerDocument = { createElement: () => ({ setAttribute() {} }) };
  const blocks = sources.map((textContent) => ({
    textContent,
    ownerDocument,
    parentElement: {
      replaceWith: (node) => replacements.push(node),
      after: (node) => errors.push(node),
    },
  }));
  return { ownerDocument, querySelectorAll: () => blocks, replacements, errors };
}

test("renders multiple diagrams and continues after invalid syntax", async () => {
  render = async (id, source) => {
    if (source === "invalid") throw new Error("Invalid syntax");
    return { svg: `<svg id="${id}">${source}</svg>` };
  };
  const root = fixture("graph TD; A-->B", "invalid", "sequenceDiagram");
  await renderMermaidBlocks(root, "light", () => true);
  assert.equal(root.replacements.length, 2);
  assert.notEqual(root.replacements[0].innerHTML, root.replacements[1].innerHTML);
  assert.equal(root.errors.length, 1);
  assert.match(root.errors[0].textContent, /Invalid syntax/);
});

test("discards stale results and serializes theme changes", async () => {
  let finish;
  let started;
  const rendering = new Promise((resolve) => { started = resolve; });
  render = () => {
    started();
    return new Promise((resolve) => { finish = resolve; });
  };
  let current = true;
  const oldRoot = fixture("old");
  const oldJob = renderMermaidBlocks(oldRoot, "light", () => current);
  await rendering;
  current = false;
  const newRoot = fixture("new");
  const newJob = renderMermaidBlocks(newRoot, "dark", () => true);
  assert.equal(themes.at(-1), "default");
  render = async () => ({ svg: "<svg>new</svg>" });
  finish({ svg: "<svg>old</svg>" });
  await Promise.all([oldJob, newJob]);
  assert.equal(oldRoot.replacements.length, 0);
  assert.equal(newRoot.replacements[0].innerHTML, "<svg>new</svg>");
  assert.equal(themes.at(-1), "dark");
});

test("export uses SVG labels and subsequent preview restores HTML labels", async () => {
  render = async () => ({ svg: "<svg>diagram</svg>" });
  await renderMermaidBlocks(fixture("export"), "light", () => true, { htmlLabels: false });
  assert.equal(configs.at(-1).htmlLabels, false);
  assert.equal(configs.at(-1).flowchart.htmlLabels, false);
  await renderMermaidBlocks(fixture("preview"), "dark", () => true);
  assert.equal(configs.at(-1).htmlLabels, true);
  assert.equal(configs.at(-1).flowchart.htmlLabels, true);
});
