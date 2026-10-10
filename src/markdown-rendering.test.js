import { test } from "node:test";
import assert from "node:assert/strict";
import { marked } from "marked";
import { normalizeMarkdown, cjkStrong } from "./markdown-rendering.js";
marked.use({ extensions: [cjkStrong] });

test("repeated BOMs do not turn the report heading into plain text", () => {
  assert.match(marked.parse(normalizeMarkdown("\uFEFF\uFEFF# 中文报告")), /^<h1>中文报告<\/h1>/);
});

test("CJK punctuation emphasis renders while code stays literal", () => {
  const html = marked.parse("**报告日期：**2026\n\n**部署结论：**建议采用混合架构。\n\n**推荐方案。**后续验证。\n\n`**代码：**`\n\n**English** text");
  assert.match(html, /<strong>报告日期：<\/strong>2026/);
  assert.match(html, /<strong>部署结论：<\/strong>建议/);
  assert.match(html, /<strong>推荐方案。<\/strong>后续/);
  assert.match(html, /<code>\*\*代码：\*\*<\/code>/);
  assert.match(html, /<strong>English<\/strong> text/);
  assert.equal(marked.parse("**English** and **中文：**内容"), "<p><strong>English</strong> and <strong>中文：</strong>内容</p>\n");
});
