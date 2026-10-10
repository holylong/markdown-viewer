import { writeFile } from 'node:fs/promises';
const debugPort = process.env.VERIFY_DEBUG_PORT || '9223';
const pages = await (await fetch(`http://127.0.0.1:${debugPort}/json`)).json();
const tab = pages.find(page => page.type === 'page');
const socket = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise(resolve => socket.addEventListener('open', resolve, { once: true }));
let id = 0;
const pending = new Map();
socket.addEventListener('message', ({ data }) => {
  const result = JSON.parse(data);
  if (result.method === 'Runtime.exceptionThrown') console.log(JSON.stringify(result.params));
  if (result.method === 'Log.entryAdded') console.log(JSON.stringify(result.params));
  if (result.id) { pending.get(result.id)?.(result); pending.delete(result.id); }
});
const command = (method, params = {}) => new Promise(resolve => {
  pending.set(++id, resolve); socket.send(JSON.stringify({ id, method, params }));
});
await command('Page.enable');
await command('Runtime.enable');
await command('Log.enable');
await command('Page.navigate', { url: 'http://127.0.0.1:1421/scripts/verify-export.html' });
for (let attempt = 0; attempt < 120; attempt++) {
  await new Promise(resolve => setTimeout(resolve, 1000));
  const response = await command('Runtime.evaluate', { expression: 'window.verifyResult', returnByValue: true });
  const result = response.result?.result?.value;
  if (result) {
    console.log(JSON.stringify(result));
    const screenshot = await command('Page.captureScreenshot');
    await writeFile('artifacts/export-verification/browser.png', Buffer.from(screenshot.result.data, 'base64'));
    socket.close(); process.exit(result.success ? 0 : 1);
  }
}
socket.close(); throw new Error('Export verification timed out');
