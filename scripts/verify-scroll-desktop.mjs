import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

// Verifies per-document scroll memory in the real desktop WebView: scrolling one
// document must not move another one, and each tab must return to where it was.
const directory = path.resolve("artifacts/scroll-verification");
await mkdir(directory, { recursive: true });
const longPath = path.join(directory, "long.md");
const shortPath = path.join(directory, "short.md");
const longBody = Array.from({ length: 120 }, (_, i) => `## 长文档第 ${i + 1} 节\n\n这是用于滚动验证的正文段落，编号 ${i + 1}。`).join("\n\n");
await writeFile(longPath, `# 长文档\n\n${longBody}\n`);
await writeFile(shortPath, `# 短文档\n\n${Array.from({ length: 12 }, (_, i) => `第 ${i + 1} 段。`).join("\n\n")}\n`);

const pages = await (await fetch("http://127.0.0.1:9224/json")).json();
const socket = new WebSocket(pages.find((page) => page.type === "page").webSocketDebuggerUrl);
await new Promise((resolve) => socket.addEventListener("open", resolve, { once: true }));
let id = 0;
const pending = new Map();
socket.addEventListener("message", ({ data }) => {
  const message = JSON.parse(data);
  if (message.id) { pending.get(message.id)?.(message); pending.delete(message.id); }
});
const command = (method, params = {}) => new Promise((resolve) => {
  pending.set(++id, resolve); socket.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (expression) => {
  const reply = await command("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (reply.result?.exceptionDetails) throw new Error(JSON.stringify(reply.result.exceptionDetails));
  return reply.result?.result?.value;
};
const waitFor = async (expression) => {
  for (let attempt = 0; attempt < 80; attempt++) {
    if (await evaluate(expression)) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out: ${expression}`);
};
const pause = () => evaluate(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);

// Real trusted wheel input, so CodeMirror and the preview scroll natively.
async function wheel(selector, deltaY) {
  const box = await evaluate(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  await command("Input.dispatchMouseEvent", { type: "mouseWheel", x: box.x, y: box.y, deltaX: 0, deltaY });
  await pause();
}

const scrollState = () => evaluate(`(() => {
  const pane = document.querySelector('#markdown');
  const scroller = document.querySelector('.cm-scroller');
  return {
    preview: Math.round(pane.scrollTop),
    editor: Math.round(scroller.scrollTop),
    active: document.querySelector('.tab.active .tab-label')?.textContent || null,
  };
})()`);
const activate = (label) => evaluate(`(() => {
  const tab = [...document.querySelectorAll('.tab')].find(item => item.querySelector('.tab-label').textContent === ${JSON.stringify(label)});
  tab.click();
})()`);

await waitFor(`document.readyState === 'complete' && !!document.querySelector('#open-btn')`);
await evaluate(`(() => {
  const original = window.fetch.bind(window);
  window.scrollFixture = { next: ${JSON.stringify(longPath)} };
  window.fetch = (url, options) => {
    if (decodeURIComponent(String(url)).includes('plugin:dialog|open')) {
      return Promise.resolve(new Response(JSON.stringify(scrollFixture.next), { headers: { 'Content-Type': 'application/json', 'Tauri-Response': 'ok' } }));
    }
    return original(url, options);
  };
  document.querySelector('#open-btn').click();
})()`);
await waitFor(`document.querySelector('.tab.active .tab-label')?.textContent === 'long.md'`);
await evaluate(`scrollFixture.next = ${JSON.stringify(shortPath)}; document.querySelector('#open-btn').click()`);
await waitFor(`document.querySelector('.tab.active .tab-label')?.textContent === 'short.md'`);
await evaluate(`document.querySelector('#view-split-btn').click()`);
await pause();

assert.deepEqual(await scrollState(), { preview: 0, editor: 0, active: "short.md" }, "a freshly opened document must start at the top");

// Scroll the long document in both panes, then check the short one stays put.
await activate("long.md");
await pause();
await wheel("#markdown", 900);
await wheel(".cm-scroller", 700);
const longScrolled = await scrollState();
assert.ok(longScrolled.preview > 100, `preview should scroll, got ${longScrolled.preview}`);
assert.ok(longScrolled.editor > 100, `editor should scroll, got ${longScrolled.editor}`);

await activate("short.md");
await pause();
const shortAfterSwitch = await scrollState();
assert.deepEqual(
  { preview: shortAfterSwitch.preview, editor: shortAfterSwitch.editor, active: shortAfterSwitch.active },
  { preview: 0, editor: 0, active: "short.md" },
  "switching documents must not inherit the previous document's scroll offset",
);

// Scroll the short document, then confirm both documents keep their own offset.
await wheel("#markdown", 240);
const shortScrolled = await scrollState();
assert.ok(shortScrolled.preview > 0, `short preview should scroll, got ${shortScrolled.preview}`);

await activate("long.md");
await pause();
const longRestored = await scrollState();
assert.equal(longRestored.active, "long.md");
assert.ok(
  Math.abs(longRestored.preview - longScrolled.preview) <= 2,
  `long.md preview should return to ${longScrolled.preview}, got ${longRestored.preview}`,
);
assert.ok(
  Math.abs(longRestored.editor - longScrolled.editor) <= 2,
  `long.md editor should return to ${longScrolled.editor}, got ${longRestored.editor}`,
);

await activate("short.md");
await pause();
const shortRestored = await scrollState();
assert.equal(shortRestored.active, "short.md");
assert.ok(
  Math.abs(shortRestored.preview - shortScrolled.preview) <= 2,
  `short.md preview should return to ${shortScrolled.preview}, got ${shortRestored.preview}`,
);

// Typing in one document must not shift the other document's remembered position.
await activate("long.md");
await pause();
await wheel("#markdown", 400);
const longBeforeEdit = await scrollState();
await evaluate(`document.querySelector('.cm-content').focus()`);
await command("Input.insertText", { text: "\n新增一行。\n" });
await pause();
await new Promise((resolve) => setTimeout(resolve, 600));
const longAfterEdit = await scrollState();
assert.ok(
  Math.abs(longAfterEdit.preview - longBeforeEdit.preview) <= 2,
  `editing must not reset the preview offset (${longBeforeEdit.preview} -> ${longAfterEdit.preview})`,
);

await activate("short.md");
await pause();
assert.deepEqual(
  await evaluate(`({ preview: Math.round(document.querySelector('#markdown').scrollTop), editor: Math.round(document.querySelector('.cm-scroller').scrollTop) })`),
  { preview: shortScrolled.preview, editor: shortRestored.editor },
  "the other document must still keep its own offsets after an edit",
);

console.log(JSON.stringify({
  success: true,
  long: longScrolled,
  short: shortScrolled,
  longRestored,
  shortRestored,
  longAfterEdit,
}, null, 2));
socket.close();
