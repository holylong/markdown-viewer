import test from "node:test";
import assert from "node:assert/strict";
import { createScrollSync } from "./scroll-sync.js";

class Pane extends EventTarget {
  constructor(height, viewport = 200) {
    super();
    this.scrollHeight = height;
    this.clientHeight = viewport;
    this.scrollTop = 0;
  }
  emit(type) { this.dispatchEvent(new Event(type)); }
  scrollTo(position) { this.scrollTop = position; this.emit("scroll"); }
}

test("wheel scrolling maps progress both ways without feedback", () => {
  const editor = new Pane(1200);
  const preview = new Pane(2200);
  createScrollSync(editor, preview, () => true);
  preview.emit("wheel");
  preview.scrollTo(800);
  assert.equal(editor.scrollTop, 400);
  // CodeMirror may round or measure its layout after following the preview.
  editor.scrollTo(395);
  assert.equal(preview.scrollTop, 800);
  editor.emit("wheel");
  editor.scrollTo(600);
  assert.equal(preview.scrollTop, 1200);
  editor.scrollTo(1000);
  assert.equal(preview.scrollTop, 2000);
  preview.emit("wheel");
  preview.scrollTo(0);
  assert.equal(editor.scrollTop, 0);
});

test("restoring documents and re-rendering do not synchronize panes", () => {
  const editor = new Pane(1200);
  const preview = new Pane(2200);
  const sync = createScrollSync(editor, preview, () => true);
  preview.scrollTo(500);
  assert.equal(editor.scrollTop, 0);
  preview.emit("wheel");
  preview.scrollTo(800);
  sync.reset();
  preview.scrollTo(100);
  assert.equal(editor.scrollTop, 400);
  preview.emit("wheel");
  preview.scrollTo(600);
  assert.equal(editor.scrollTop, 300);
});

test("single-pane views, hidden panes, and short documents are safe", () => {
  const editor = new Pane(1200);
  const preview = new Pane(2200);
  let enabled = false;
  createScrollSync(editor, preview, () => enabled);
  preview.emit("wheel");
  preview.scrollTo(800);
  assert.equal(editor.scrollTop, 0);
  enabled = true;
  editor.clientHeight = 0;
  preview.scrollTo(900);
  assert.equal(editor.scrollTop, 0);
  editor.clientHeight = 200;
  preview.scrollHeight = 200;
  editor.scrollTop = 400;
  preview.scrollTo(0);
  assert.equal(editor.scrollTop, 400);
  preview.scrollHeight = 2200;
  editor.scrollHeight = 100;
  preview.scrollTo(900);
  assert.equal(editor.scrollTop, 0);
});

test("scrollbar dragging and keyboard scrolling can take control", () => {
  const editor = new Pane(1200);
  const preview = new Pane(2200);
  createScrollSync(editor, preview, () => true);
  preview.emit("pointerdown");
  preview.scrollTo(1000);
  assert.equal(editor.scrollTop, 500);
  editor.emit("keydown");
  editor.scrollTo(100);
  assert.equal(preview.scrollTop, 200);
});
