import { createServer } from 'vite';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const out = path.resolve('artifacts/export-verification');
await mkdir(out, { recursive: true });
const report = await readFile(path.resolve('docs/export-sample 中文示例.md'), 'utf8');
const server = await createServer({
  optimizeDeps: { entries: ['scripts/verify-export.html'] },
  server: { port: 1421, strictPort: true, host: '127.0.0.1', watch: { ignored: ['**/artifacts/**', '**/src-tauri/**'] } },
  plugins: [{ name: 'verify-export', configureServer(server) {
    server.middlewares.use('/verify-source', async (_req, res) => {
      res.setHeader('Content-Type', 'text/plain');
      res.end(await readFile('src/renderer.js', 'utf8'));
    });
    server.middlewares.use('/verify-input', (_req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ report }));
    });
    server.middlewares.use('/verify-output', async (req, res) => {
      try {
        let body = '';
        for await (const chunk of req) body += chunk;
        const { name, base64, metadata } = JSON.parse(body);
        if (!/^[\w.-]+$/.test(name)) throw new Error('Invalid artifact name');
        await writeFile(path.join(out, name), base64 ? Buffer.from(base64, 'base64') : JSON.stringify(metadata, null, 2));
        res.end('ok');
      } catch (error) { res.statusCode = 500; res.end(String(error)); }
    });
  } }],
});
await server.listen();
console.log('Verification server: http://127.0.0.1:1421/scripts/verify-export.html');
