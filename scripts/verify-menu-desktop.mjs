import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
const directory = path.resolve('artifacts/menu-verification');
await mkdir(directory, { recursive: true });
const firstPath = path.join(directory, 'first.md');
const secondPath = path.join(directory, 'second.md');
await writeFile(firstPath, '# First document');
await writeFile(secondPath, '# Second document');
const pages = await (await fetch('http://127.0.0.1:9224/json')).json();
const socket = new WebSocket(pages.find(page => page.type === 'page').webSocketDebuggerUrl);
await new Promise(resolve => socket.addEventListener('open', resolve, { once: true }));
let id = 0;
const pending = new Map();
socket.addEventListener('message', ({ data }) => {
  const message = JSON.parse(data);
  if (message.id) { pending.get(message.id)?.(message); pending.delete(message.id); }
});
const command = (method, params = {}) => new Promise(resolve => {
  pending.set(++id, resolve); socket.send(JSON.stringify({ id, method, params }));
});
const evaluate = async expression => {
  const reply = await command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (reply.result?.exceptionDetails) throw new Error(JSON.stringify(reply.result.exceptionDetails));
  return reply.result?.result?.value;
};
const waitFor = async expression => {
  for (let attempt = 0; attempt < 60; attempt++) {
    if (await evaluate(expression)) return;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out: ${expression}`);
};
await waitFor(`document.readyState === 'complete' && !!document.querySelector('#open-btn')`);
await evaluate(`(() => {
  window.menuFixture = { first: ${JSON.stringify(firstPath)}, second: ${JSON.stringify(secondPath)}, directory: ${JSON.stringify(directory)}, selected: ${JSON.stringify(firstPath)}, calls: [], copied: null };
  const original = window.fetch.bind(window);
  window.menuOriginalFetch = original;
  window.fetch = (url, options) => {
    const decoded = decodeURIComponent(String(url));
    if (decoded.includes('plugin:dialog|open')) {
      const directory = JSON.parse(options.body).options.directory;
      return Promise.resolve(new Response(JSON.stringify(directory ? menuFixture.directory : menuFixture.selected), { headers: { 'Content-Type': 'application/json', 'Tauri-Response': 'ok' } }));
    }
    if (decoded.includes('reveal_in_folder')) {
      menuFixture.calls.push(JSON.parse(options.body));
      // Verify dispatch without opening extra Explorer windows during UI tests.
      return Promise.resolve(new Response('null', { headers: { 'Content-Type': 'application/json', 'Tauri-Response': 'ok' } }));
    }
    return original(url, options);
  };
  Object.defineProperty(navigator.clipboard, 'writeText', { configurable: true, value: async text => { menuFixture.copied = text; } });
  document.querySelector('#open-btn').click();
})()`);
await waitFor(`[...document.querySelectorAll('.tab-label')].some(node => node.textContent === 'first.md')`);
await evaluate(`menuFixture.selected = menuFixture.second; document.querySelector('#open-btn').click()`);
await waitFor(`document.querySelector('.tab.active .tab-label')?.textContent === 'second.md'`);
await evaluate(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
await evaluate(`(() => {
  const tab = [...document.querySelectorAll('.tab')].find(tab => tab.querySelector('.tab-label').textContent === 'first.md');
  tab.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: innerWidth - 1, clientY: innerHeight - 1 }));
})()`);
assert.equal(await evaluate(`document.querySelector('#app-dialog').open`), false);
assert.equal(await evaluate(`document.querySelector('.document-context-menu').hidden`), false);
assert.equal(await evaluate(`document.querySelector('.tab.active .tab-label').textContent`), 'second.md');
assert.deepEqual(await evaluate(`[...document.querySelectorAll('.document-context-menu button')].map(button => button.textContent)`), ['重命名', '打开所在文件夹', '复制文件路径', '关闭文档']);
assert.equal(await evaluate(`(() => { const b=document.querySelector('.document-context-menu').getBoundingClientRect(); return b.right <= innerWidth && b.bottom <= innerHeight; })()`), true);
await evaluate(`document.querySelector('.document-context-menu button').focus(); document.querySelector('.document-context-menu button').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));`);
assert.equal(await evaluate(`document.activeElement.textContent`), '打开所在文件夹');
await evaluate(`document.activeElement.click()`);
assert.equal(await evaluate(`menuFixture.calls[0].path`), firstPath);
await evaluate(`(() => { const tab=[...document.querySelectorAll('.tab')].find(tab=>tab.querySelector('.tab-label').textContent==='first.md'); tab.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:120,clientY:100})); document.querySelectorAll('.document-context-menu button')[2].click(); })()`);
assert.equal(await evaluate(`menuFixture.copied`), firstPath);
await evaluate(`(() => { const tab=[...document.querySelectorAll('.tab')].find(tab=>tab.querySelector('.tab-label').textContent==='first.md'); tab.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true})); document.querySelector('.document-context-menu button').click(); })()`);
await waitFor(`document.querySelector('#app-dialog').open`);
assert.equal(await evaluate(`document.querySelector('#dialog-input').value`), 'first.md');
await evaluate(`document.querySelector('#dialog-cancel').click(); document.querySelector('#open-folder-btn').click();`);
await waitFor(`document.querySelectorAll('#file-tree .file-row').length === 2`);
await evaluate(`document.querySelector('#file-tree .file-row').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:100,clientY:220}))`);
assert.equal(await evaluate(`document.querySelector('.document-context-menu button').textContent`), '打开文档');
assert.equal(await evaluate(`document.querySelector('#app-dialog').open`), false);
await evaluate(`document.querySelector('.document-context-menu button').click()`);
await waitFor(`document.querySelector('.tab.active .tab-label').textContent === 'first.md'`);
const savedCount = await evaluate(`document.querySelectorAll('.tab').length`);
await evaluate(`document.querySelector('#new-btn').click(); document.querySelector('.tab.active').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:180,clientY:100}));`);
assert.deepEqual(await evaluate(`[...document.querySelectorAll('.document-context-menu button')].map(button=>button.disabled)`), [false, true, true, false]);
await evaluate(`document.querySelector('.document-context-menu').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
assert.equal(await evaluate(`document.querySelector('.document-context-menu').hidden`), true);
await evaluate(`document.querySelector('.tab.active').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:180,clientY:100})); document.querySelectorAll('.document-context-menu button')[3].click()`);
await waitFor(`document.querySelectorAll('.tab').length === ${savedCount}`);
await evaluate(`document.querySelector('.tab.active').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:180,clientY:100}))`);
const screenshot = await command('Page.captureScreenshot');
await writeFile(path.join(directory, 'context-menu.png'), Buffer.from(screenshot.result.data, 'base64'));
console.log('Verified tab/tree menus, rename target, reveal/copy target, untitled disabled actions, close, keyboard dismissal and viewport bounds.');
if (process.argv.includes('--reveal')) {
  const report = path.resolve('docs/export-sample 中文示例.md');
  await evaluate(`window.fetch = window.menuOriginalFetch; window.__TAURI_INTERNALS__.invoke('reveal_in_folder', { path: ${JSON.stringify(report)} })`);
  console.log('Native reveal command executed for the report with Chinese characters and spaces.');
}
socket.close();
