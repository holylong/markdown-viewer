import { readFile, writeFile, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
const source = path.resolve('docs/export-sample 中文示例.md');
const format = process.argv[2] === 'docx' ? 'docx' : 'pdf';
const output = path.resolve(`artifacts/export-verification/desktop-report.${format}`);
await unlink(output).catch(error => { if (error.code !== 'ENOENT') throw error; });
const pages = await (await fetch('http://127.0.0.1:9224/json')).json();
const page = pages.find(item => item.type === 'page');
if (!page) throw new Error('Desktop WebView not available');
const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise(resolve => socket.addEventListener('open', resolve, { once: true }));
let id = 0;
const pending = new Map();
socket.addEventListener('message', ({ data }) => {
  const message = JSON.parse(data);
  if (message.id) { pending.get(message.id)?.(message); pending.delete(message.id); }
  if (message.method === 'Runtime.exceptionThrown') console.log(JSON.stringify(message.params));
});
const command = (method, params = {}) => new Promise(resolve => {
  pending.set(++id, resolve); socket.send(JSON.stringify({ id, method, params }));
});
await command('Runtime.enable');
await command('Log.enable');
const evaluate = async (expression) => {
  const result = await command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.result?.exceptionDetails) throw new Error(JSON.stringify(result.result.exceptionDetails));
  return result.result?.result?.value;
};
for (let attempt = 0; attempt < 60; attempt++) {
  if (await evaluate(`document.readyState === 'complete' && !!document.querySelector('#open-btn')`)) break;
  if (attempt === 59) throw new Error('Desktop app failed to load');
  await new Promise(resolve => setTimeout(resolve, 1000));
}
await evaluate(`(() => {
  const fetch = window.fetch.bind(window);
  window.fetch = (url, options) => {
    const command = decodeURIComponent(String(url));
    if (command.includes('plugin:dialog|open')) return Promise.resolve(new Response(JSON.stringify(${JSON.stringify(source)}), { headers: { 'Content-Type': 'application/json', 'Tauri-Response': 'ok' } }));
    if (command.includes('plugin:dialog|save')) return Promise.resolve(new Response(JSON.stringify(${JSON.stringify(output)}), { headers: { 'Content-Type': 'application/json', 'Tauri-Response': 'ok' } }));
    return fetch(url, options);
  };
  document.querySelector('#open-btn').click();
})()`);
for (let attempt = 0; attempt < 60; attempt++) {
  const ready = await evaluate(`!document.querySelector('#export-pdf-btn').disabled && document.querySelectorAll('#markdown .mermaid-diagram').length === 3`);
  if (attempt % 10 === 0) console.log(await evaluate(`({ title: document.title, diagrams: document.querySelectorAll('.mermaid-diagram').length, errors: [...document.querySelectorAll('.mermaid-error, dialog[open]')].map(node => node.textContent), preview: document.querySelector('#markdown')?.innerHTML.slice(0, 100) })`));
  if (ready) break;
  if (attempt === 59) throw new Error('Report failed to open/render');
  await new Promise(resolve => setTimeout(resolve, 1000));
}
console.log('Report opened by desktop app, three preview diagrams rendered.');
await evaluate(`document.querySelector('#export-${format === 'docx' ? 'doc' : 'pdf'}-btn').click()`);
for (let attempt = 0; attempt < 90; attempt++) {
  try {
    const info = await stat(output);
    if (info.size > 1000) {
      const bytes = await readFile(output);
      if (format === 'pdf' ? bytes.subarray(0, 5).toString() !== '%PDF-' : bytes.subarray(0, 2).toString() !== 'PK') throw new Error('Invalid document header');
      const screenshot = await command('Page.captureScreenshot');
      await writeFile('artifacts/export-verification/desktop-app.png', Buffer.from(screenshot.result.data, 'base64'));
      console.log(JSON.stringify({ success: true, output, bytes: info.size }));
      socket.close(); process.exit(0);
    }
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  await new Promise(resolve => setTimeout(resolve, 1000));
}
console.log(await evaluate(`({ dialogs: [...document.querySelectorAll('dialog')].map(d => d.textContent), status: document.querySelector('#markdown')?.innerHTML.slice(0, 200) })`));
socket.close(); throw new Error('Desktop document export timed out');
