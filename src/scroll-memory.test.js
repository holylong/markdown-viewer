import { test } from "node:test";
import assert from "node:assert/strict";
import { createScrollMemory, clampScrollTop, maxScrollTop } from "./scroll-memory.js";

test("maxScrollTop reports no scrollable range for short or invalid content", () => {
  assert.equal(maxScrollTop(400, 800), 0);
  assert.equal(maxScrollTop(800, 800), 0);
  assert.equal(maxScrollTop(3200, 800), 2400);
  assert.equal(maxScrollTop(Number.NaN, 800), 0);
  assert.equal(maxScrollTop(3200, Number.NaN), 0);
});

test("clampScrollTop keeps positions inside the pane and rejects junk", () => {
  assert.equal(clampScrollTop(1200, 2400), 1200);
  assert.equal(clampScrollTop(9000, 2400), 2400);
  assert.equal(clampScrollTop(-40, 2400), 0);
  assert.equal(clampScrollTop(Number.NaN, 2400), 0);
  assert.equal(clampScrollTop(500, -1), 0);
  // An unusable limit means "the pane has no scrollable range", so stay at the top.
  assert.equal(clampScrollTop(500, Number.POSITIVE_INFINITY), 0);
});

test("scroll memory keeps one position per document", () => {
  const memory = createScrollMemory();
  memory.save(1, { editor: 900, preview: 1400 });
  memory.save(2, { editor: 120, preview: 0 });

  assert.deepEqual(memory.read(1), { editor: 900, preview: 1400 });
  assert.deepEqual(memory.read(2), { editor: 120, preview: 0 });
  assert.deepEqual(memory.read(3), { editor: 0, preview: 0 });

  memory.save(1, { editor: 1800, preview: 2600 });
  assert.deepEqual(memory.read(1), { editor: 1800, preview: 2600 });
  assert.deepEqual(memory.read(2), { editor: 120, preview: 0 });
});

test("scrolling back to the top forgets a document position", () => {
  const memory = createScrollMemory();
  memory.save("a", { editor: 700, preview: 300 });
  memory.save("a", { editor: 0, preview: 0 });
  assert.deepEqual(memory.read("a"), { editor: 0, preview: 0 });

  memory.save("a", { editor: 700, preview: 300 });
  memory.forget("a");
  assert.deepEqual(memory.read("a"), { editor: 0, preview: 0 });
});

test("a remembered position is clamped against the pane being restored", () => {
  const memory = createScrollMemory();
  memory.save("report.md", { editor: 5200, preview: 6100 });

  const stored = memory.read("report.md");
  const shortDocument = maxScrollTop(1200, 800);
  assert.deepEqual(
    { editor: clampScrollTop(stored.editor, shortDocument), preview: clampScrollTop(stored.preview, shortDocument) },
    { editor: 400, preview: 400 },
  );

  const tallDocument = maxScrollTop(8000, 800);
  assert.equal(clampScrollTop(stored.preview, tallDocument), 6100);
});
