import { test } from "node:test";
import assert from "node:assert/strict";
import { wordArchive, pdfPageSlices } from "./document-export.js";

test("pagination keeps diagrams and table rows together without losing content", () => {
  const pages = pdfPageSlices(3200, 1000, [{ top: 800, bottom: 1400 }, { top: 1700, bottom: 1950 }]);
  assert.deepEqual(pages, [{ offset: 0, height: 800 }, { offset: 800, height: 900 }, { offset: 1700, height: 1000 }, { offset: 2700, height: 500 }]);
  assert.equal(pages.reduce((sum, page) => sum + page.height, 0), 3200);
});

test("oversized blocks still paginate and cannot cause an endless loop", () => {
  assert.deepEqual(pdfPageSlices(2100, 1000, [{ top: 0, bottom: 2100 }]), [
    { offset: 0, height: 1000 }, { offset: 1000, height: 1000 }, { offset: 2000, height: 100 },
  ]);
});

test("Word archive preserves Chinese text and embeds PNG attachments", () => {
  const image = { src: "data:image/png;base64,aGVsbG8=", setAttribute(name, value) { this[name] = value; } };
  const clone = {
    querySelectorAll: () => [image],
    get innerHTML() { return `<p>中文报告</p><img src="${image.src}">`; },
  };
  const archive = wordArchive({ cloneNode: () => clone }, (html) => `<html>${html}</html>`);
  const boundary = /boundary="([^"]+)"/.exec(archive)[1];
  const parts = archive.split(`--${boundary}`);
  const html = Buffer.from(parts[1].split("\r\n\r\n")[1].replace(/\s/g, ""), "base64").toString("utf8");
  assert.match(html, /中文报告/);
  assert.match(html, /src="file:\/\/\/image0.png"/);
  assert.doesNotMatch(html, /data:image/);
  assert.match(parts[2], /Content-Type: image\/png/);
  assert.match(parts[2], /Content-Location: file:\/\/\/image0.png/);
  assert.match(parts[2], /aGVsbG8=/);
  assert.equal(parts[3], "--\r\n");
});
