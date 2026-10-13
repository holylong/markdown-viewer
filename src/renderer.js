import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open, save } from "@tauri-apps/plugin-dialog";
import { EditorState, Compartment } from "@codemirror/state";
import { markdown as cmMarkdown } from "@codemirror/lang-markdown";
import { oneDark } from "@codemirror/theme-one-dark";
import { EditorView, basicSetup } from "codemirror";
import DOMPurify from "dompurify";
import hljs from "highlight.js/lib/core";
import { jsPDF } from "jspdf";
import html2canvas from "html2canvas";
import { pdfPageSlices } from "./document-export.js";
import { rasterizeDiagram } from "./diagram-export.js";
import { normalizeMarkdown, cjkStrong } from "./markdown-rendering.js";
import { createContextMenu } from "./context-menu.js";
import { createScrollMemory, clampScrollTop, maxScrollTop } from "./scroll-memory.js";
import { createScrollSync } from "./scroll-sync.js";
import bash from "highlight.js/lib/languages/bash";
import c from "highlight.js/lib/languages/c";
import cpp from "highlight.js/lib/languages/cpp";
import csharp from "highlight.js/lib/languages/csharp";
import css from "highlight.js/lib/languages/css";
import diff from "highlight.js/lib/languages/diff";
import go from "highlight.js/lib/languages/go";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import kotlin from "highlight.js/lib/languages/kotlin";
import markdown from "highlight.js/lib/languages/markdown";
import php from "highlight.js/lib/languages/php";
import python from "highlight.js/lib/languages/python";
import ruby from "highlight.js/lib/languages/ruby";
import rust from "highlight.js/lib/languages/rust";
import shell from "highlight.js/lib/languages/shell";
import sql from "highlight.js/lib/languages/sql";
import swift from "highlight.js/lib/languages/swift";
import toml from "highlight.js/lib/languages/ini";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";
import { marked } from "marked";
import { renderMermaidBlocks } from "./mermaid-preview.js";

const languages = {
  javascript,
  js: javascript,
  jsx: javascript,
  typescript,
  ts: typescript,
  python,
  py: python,
  rust,
  java,
  c,
  cpp,
  csharp,
  cs: csharp,
  go,
  json,
  yaml,
  yml: yaml,
  xml,
  html: xml,
  css,
  bash,
  sh: bash,
  shell,
  sql,
  markdown,
  md: markdown,
  ruby,
  php,
  swift,
  kotlin,
  toml,
  ini: toml,
  diff,
};

for (const [name, language] of Object.entries(languages)) {
  hljs.registerLanguage(name, language);
}

function escapeHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

marked.use({
  extensions: [cjkStrong],
  gfm: true,
  breaks: false,
  renderer: {
    code(code, infostring) {
      const language = (infostring || "").match(/\S*/)?.[0] || "";
      if (language.toLowerCase() === "mermaid") {
        return `<pre><code class="language-mermaid">${escapeHtml(code)}</code></pre>`;
      }
      if (language && hljs.getLanguage(language)) {
        try {
          const value = hljs.highlight(code, { language }).value;
          return `<pre><code class="hljs language-${language}">${value}</code></pre>`;
        } catch {
          // Use escaped plain text if a highlighter cannot process the block.
        }
      }
      return `<pre><code>${escapeHtml(code)}</code></pre>`;
    },
  },
});

const elements = Object.fromEntries(
  [
    "new-btn",
    "new-tab-btn",
    "empty-new-btn",
    "open-btn",
    "empty-open-btn",
    "save-btn",
    "save-as-btn",
    "open-folder-btn",
    "sidebar-open-folder-btn",
    "empty-folder-btn",
    "sidebar-btn",
    "sidebar",
    "activity-files-btn",
    "activity-history-btn",
    "activity-plugins-btn",
    "activity-settings-btn",
    "activity-history-list",
    "clear-history-btn",
    "browse-plugins-btn",
    "settings-light-btn",
    "settings-dark-btn",
    "refresh-folder-btn",
    "folder-name",
    "folder-stats",
    "file-filter",
    "file-tree",
    "tabs-bar",
    "tabs",
    "empty",
    "workspace",
    "editor-pane",
    "pane-resizer",
    "markdown",
    "statusbar",
    "file-path",
    "save-state",
    "cursor-position",
    "document-stats",
    "view-edit-btn",
    "view-split-btn",
    "view-preview-btn",
    "export-btn",
    "export-popover",
    "export-pdf-btn",
    "export-doc-btn",
    "export-html-btn",
    "theme-btn",
    "drop-overlay",
    "recent-section",
    "recent-list",
  ].map((id) => [id, document.getElementById(id)]),
);

const dialogEl = document.getElementById("app-dialog");
const dialogMessage = document.getElementById("dialog-message");
const dialogInput = document.getElementById("dialog-input");
const dialogOk = document.getElementById("dialog-ok");
const dialogCancel = document.getElementById("dialog-cancel");

function showConfirm(message) {
  return new Promise((resolve) => {
    dialogMessage.textContent = message;
    dialogInput.hidden = true;
    dialogCancel.hidden = false;
    dialogOk.textContent = "确定";
    dialogEl.showModal();
    function cleanup(result) {
      dialogEl.close();
      dialogOk.removeEventListener("click", onOk);
      dialogCancel.removeEventListener("click", onCancel);
      dialogEl.removeEventListener("click", onBackdrop);
      resolve(result);
    }
    function onOk() { cleanup(true); }
    function onCancel() { cleanup(false); }
    function onBackdrop(e) { if (e.target === dialogEl) cleanup(false); }
    dialogOk.addEventListener("click", onOk);
    dialogCancel.addEventListener("click", onCancel);
    dialogEl.addEventListener("click", onBackdrop);
  });
}

function showMessage(message) {
  return new Promise((resolve) => {
    dialogMessage.textContent = message;
    dialogInput.hidden = true;
    dialogCancel.hidden = true;
    dialogOk.textContent = "确定";
    dialogEl.showModal();
    function cleanup() {
      dialogEl.close();
      dialogOk.removeEventListener("click", onOk);
      dialogEl.removeEventListener("click", onBackdrop);
      resolve();
    }
    function onOk() { cleanup(); }
    function onBackdrop(e) { if (e.target === dialogEl) cleanup(); }
    dialogOk.addEventListener("click", onOk);
    dialogEl.addEventListener("click", onBackdrop);
  });
}

function showPrompt(message, defaultValue = "") {
  return new Promise((resolve) => {
    dialogMessage.textContent = message;
    dialogInput.hidden = false;
    dialogInput.value = defaultValue;
    dialogCancel.hidden = false;
    dialogOk.textContent = "确定";
    dialogEl.showModal();
    requestAnimationFrame(() => {
      dialogInput.focus();
      dialogInput.select();
    });
    function cleanup(result) {
      const value = dialogInput.value;
      dialogEl.close();
      dialogInput.hidden = true;
      dialogOk.removeEventListener("click", onOk);
      dialogCancel.removeEventListener("click", onCancel);
      dialogEl.removeEventListener("click", onBackdrop);
      dialogInput.removeEventListener("keydown", onKeydown);
      resolve(result ? value : null);
    }
    function onOk() { cleanup(true); }
    function onCancel() { cleanup(false); }
    function onBackdrop(e) { if (e.target === dialogEl) cleanup(false); }
    function onKeydown(e) {
      if (e.key === "Enter") {
        e.preventDefault();
        cleanup(true);
      } else if (e.key === "Escape") {
        e.preventDefault();
        cleanup(false);
      }
      e.stopPropagation();
    }
    dialogOk.addEventListener("click", onOk);
    dialogCancel.addEventListener("click", onCancel);
    dialogEl.addEventListener("click", onBackdrop);
    dialogInput.addEventListener("keydown", onKeydown);
  });
}

const DOCUMENT_FILTERS = [
  { name: "Markdown", extensions: ["md", "markdown", "mdown", "mkd"] },
  { name: "文本", extensions: ["txt"] },
];
const SESSION_KEY = "mdv-session-v2";
const RECENT_KEY = "mdv-recent-v2";
const FOLDER_KEY = "mdv-folder-v2";
const SIDEBAR_KEY = "mdv-sidebar-v2";
const SIDEBAR_PANEL_KEY = "mdv-sidebar-panel-v1";
const HISTORY_KEY = "mdv-activity-history-v1";
const SPLIT_RATIO_KEY = "mdv-split-ratio-v1";
const MAX_RECENT = 8;
const MAX_HISTORY = 30;
const SIDEBAR_PANELS = ["files", "history", "plugins", "settings"];

let documents = [];
let activeDocumentId = null;
let documentId = 0;
let untitledId = 0;
let renderTimer = null;
let currentFolder = null;
let folderTree = [];
let expandedFolders = new Set();
let currentTheme = localStorage.getItem("mdv-theme") || "light";
let activeSidebarPanel = SIDEBAR_PANELS.includes(localStorage.getItem(SIDEBAR_PANEL_KEY))
  ? localStorage.getItem(SIDEBAR_PANEL_KEY)
  : "files";
let splitRatio = Number.parseFloat(localStorage.getItem(SPLIT_RATIO_KEY)) || 50;
let closeRequestPending = false;
// The editor view and the preview pane are single shared DOM nodes, so without
// extra bookkeeping every tab would inherit the scroll offset of the document
// that was scrolled last. Each document keeps its own remembered position.
const scrollMemory = createScrollMemory();
const editorScrollSnapshots = new Map();
let previewRestorePending = null;

function basename(path) {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

function stem(path) {
  const base = basename(path);
  const index = base.lastIndexOf(".");
  return index > 0 ? base.slice(0, index) : base;
}

function normalizePath(path) {
  return path.replace(/\\/g, "/").replace(/\/$/, "").toLocaleLowerCase();
}

function pathInsideFolder(path, folder) {
  const normalizedPath = normalizePath(path);
  const normalizedFolder = normalizePath(folder);
  return (
    normalizedPath === normalizedFolder ||
    normalizedPath.startsWith(`${normalizedFolder}/`)
  );
}

function isSupportedDocument(path) {
  return /\.(md|markdown|mdown|mkd|txt)$/i.test(path);
}

function activeDocument() {
  return documents.find((document) => document.id === activeDocumentId) || null;
}

function documentByPath(path) {
  const normalized = normalizePath(path);
  return (
    documents.find(
      (document) => document.path && normalizePath(document.path) === normalized,
    ) || null
  );
}

function dirname(path) {
  const index = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return index > 0 ? path.slice(0, index) : "";
}

function joinPath(dir, name) {
  const separator = dir.includes("\\") ? "\\" : "/";
  return dir ? `${dir}${separator}${name}` : name;
}

function replaceRecentPath(oldPath, newPath) {
  try {
    const normalized = normalizePath(oldPath);
    const paths = loadRecentPaths().map((item) =>
      normalizePath(item) === normalized ? newPath : item,
    );
    localStorage.setItem(RECENT_KEY, JSON.stringify(paths.slice(0, MAX_RECENT)));
  } catch {
    // Recent list is best-effort; ignore storage errors.
  }
  renderRecentFiles();
}

async function renameFileAtPath(oldPath) {
  if (!oldPath) {
    await renameActiveDocument();
    return;
  }
  const oldName = basename(oldPath);
  const input = await showPrompt(`重命名“${oldName}”（仅文件名，不含路径）`, oldName);
  if (input === null) return;
  let newName = input.trim();
  if (!newName || newName === oldName) return;
  if (/[\\/:\*\?"<>\|]/.test(newName)) {
    await showMessage("文件名不能包含 \\ / : * ? \" < > | 这些字符。");
    return;
  }
  if (!newName.includes(".")) {
    const dot = oldName.lastIndexOf(".");
    if (dot > 0) newName += oldName.slice(dot);
  }
  if (!isSupportedDocument(newName)) {
    await showMessage("请保留 .md / .markdown / .txt 这类文档扩展名。");
    return;
  }
  const newPath = joinPath(dirname(oldPath), newName);
  if (normalizePath(newPath) === normalizePath(oldPath)) return;
  if (documentByPath(newPath)) {
    await showMessage("目标文件名已在另一个标签页中打开。");
    return;
  }
  try {
    await invoke("rename_file", { oldPath, newPath });
  } catch (error) {
    console.error(error);
    await showError("重命名失败", error);
    return;
  }
  const opened = documentByPath(oldPath);
  if (opened) {
    opened.path = newPath;
    opened.name = newName;
  }
  replaceRecentPath(oldPath, newPath);
  if (currentFolder && pathInsideFolder(oldPath, currentFolder)) {
    await refreshFolder({ silent: true });
  }
  renderTabs();
  updateStatusBar();
  updateWindowTitle();
  persistSession();
  recordActivity("save", `重命名为 ${newName}`, newPath);
}

async function renameActiveDocument() {
  const document = activeDocument();
  if (!document) return;
  if (!document.path) {
    const input = await showPrompt("重命名当前未保存文档", document.name);
    if (input === null) return;
    const newName = input.trim();
    if (!newName) return;
    document.name = newName;
    renderTabs();
    updateWindowTitle();
    return;
  }
  await renameFileAtPath(document.path);
}

const themeCompartment = new Compartment();

function createEditorState(contents) {
  return EditorState.create({
    doc: contents,
    extensions: [
      basicSetup,
      cmMarkdown(),
      themeCompartment.of(currentTheme === "dark" ? oneDark : []),
      EditorView.updateListener.of(handleEditorUpdate),
    ],
  });
}

const editorView = new EditorView({
  parent: elements["editor-pane"],
  state: createEditorState(""),
});

const scrollSync = createScrollSync(editorView.scrollDOM, elements.markdown, () =>
  activeDocumentId !== null && !elements.workspace.hidden && elements.workspace.dataset.view === "split",
);

function handleEditorUpdate(update) {
  const document = activeDocument();
  if (!document) return;

  document.state = update.state;
  if (update.docChanged) {
    const wasDirty = document.dirty;
    document.dirty = true;
    if (!wasDirty) renderTabs();
    updateWindowTitle();
    clearTimeout(renderTimer);
    renderTimer = setTimeout(renderPreview, 120);
  }
  if (update.docChanged || update.selectionSet) updateStatusBar();
}

function createDocument({ path = null, contents = "" } = {}) {
  const name = path ? basename(path) : `未命名 ${++untitledId}`;
  return {
    id: ++documentId,
    path,
    name,
    dirty: false,
    state: createEditorState(contents),
  };
}

function documentText(document = activeDocument()) {
  return document?.state.doc.toString() || "";
}

let previewRevision = 0;

async function renderPreview() {
  const revision = ++previewRevision;
  const document = activeDocument();
  if (!document) {
    elements.markdown.innerHTML = "";
    return;
  }
  const rendered = marked.parse(normalizeMarkdown(documentText(document)));
  // Replacing the preview HTML resets its scroll offset, so keep the previous
  // position for an in-place re-render and the remembered one for a tab switch.
  const inPlaceScroll = elements.markdown.scrollTop;
  elements.markdown.innerHTML = DOMPurify.sanitize(rendered, {
    USE_PROFILES: { html: true },
  });
  const restoring = previewRestorePending === document.id;
  if (restoring) previewRestorePending = null;
  const targetScroll = restoring ? scrollMemory.read(document.id).preview : inPlaceScroll;
  applyPreviewScroll(targetScroll);
  await renderMermaidBlocks(elements.markdown, currentTheme, () => revision === previewRevision);
  // Diagram rendering changes the pane height, so re-apply the remembered offset.
  if (revision === previewRevision) applyPreviewScroll(targetScroll);
}

function rememberDocumentScroll(id) {
  if (id === null || id === undefined) return;
  const previous = scrollMemory.read(id);
  const pane = elements.markdown;
  const editorScroller = editorView.scrollDOM;
  // Hidden panes report a scroll offset of 0; keep the remembered value then.
  const preview = pane.clientHeight > 0 ? pane.scrollTop : previous.preview;
  const editor = editorScroller && editorScroller.clientHeight > 0 ? editorScroller.scrollTop : previous.editor;
  scrollMemory.save(id, { editor, preview });
  const snapshot = editorScroller && editorScroller.clientHeight > 0 ? captureEditorScrollSnapshot() : null;
  if (snapshot) editorScrollSnapshots.set(id, snapshot);
}

function captureEditorScrollSnapshot() {
  try {
    return editorView.scrollSnapshot();
  } catch {
    // scrollSnapshot is only meaningful for a laid-out editor.
    return null;
  }
}

function resetEditorScrollToTop() {
  const editorScroller = editorView.scrollDOM;
  if (editorScroller) {
    editorScroller.scrollTop = 0;
    editorScroller.scrollLeft = 0;
  }
  editorView.requestMeasure();
}

function applyEditorScroll(position) {
  const editorScroller = editorView.scrollDOM;
  if (!editorScroller) return;
  editorScroller.scrollTop = clampScrollTop(
    position,
    maxScrollTop(editorScroller.scrollHeight, editorScroller.clientHeight),
  );
}

function restoreEditorScroll(id) {
  scrollSync.reset();
  const snapshot = id === null || id === undefined ? null : editorScrollSnapshots.get(id);
  if (snapshot) {
    try {
      // A snapshot encodes both the line and the pixel offset, so it survives
      // variable line heights and rendered diagrams.
      editorView.dispatch({ effects: snapshot });
    } catch {
      // A snapshot only applies to the document it was taken from.
      resetEditorScrollToTop();
    }
  } else {
    // No snapshot (for example the first time this tab is shown): fall back to
    // the remembered pixel offset, or the top of the document.
    const remembered = id === null || id === undefined ? 0 : scrollMemory.read(id).editor;
    resetEditorScrollToTop();
    // The pixel fallback needs a measured editor, so wait for CodeMirror's own
    // measure pass and skip it if the user switched tabs again in the meantime.
    if (remembered > 0) {
      requestAnimationFrame(() => {
        if (activeDocumentId === id) applyEditorScroll(remembered);
      });
    }
  }
  // CodeMirror replays the last observed scroll offset whenever the editor
  // regains focus at offset 0, which would otherwise resurrect the document
  // that was scrolled before this one.
  const inputState = editorView.inputState;
  if (inputState) {
    inputState.lastScrollTop = 0;
    inputState.lastScrollLeft = 0;
  }
}

function applyPreviewScroll(position) {
  scrollSync.reset();
  const pane = elements.markdown;
  pane.scrollTop = clampScrollTop(position, maxScrollTop(pane.scrollHeight, pane.clientHeight));
}

function forgetDocumentScroll(id) {
  scrollMemory.forget(id);
  editorScrollSnapshots.delete(id);
}

function switchDocument(id, { focus = true } = {}) {
  const document = documents.find((item) => item.id === id);
  if (!document) return;

  clearTimeout(renderTimer);
  const changed = activeDocumentId !== id;
  if (changed && activeDocumentId !== null) rememberDocumentScroll(activeDocumentId);
  activeDocumentId = id;
  if (!changed) {
    // Re-activating the current tab must not rewind it to a stale position.
    if (focus && elements.workspace.dataset.view !== "preview") {
      requestAnimationFrame(() => editorView.focus());
    }
    return;
  }
  elements.empty.hidden = true;
  elements.workspace.hidden = false;
  elements["tabs-bar"].hidden = false;
  elements.statusbar.hidden = false;
  setDocumentActionsEnabled(true);
  // Restore only after the panes are visible, otherwise they have no layout
  // and every remembered offset would clamp to zero.
  editorView.setState(document.state);
  restoreEditorScroll(id);
  previewRestorePending = id;
  renderPreview();
  renderTabs();
  renderFileTree();
  updateStatusBar();
  updateWindowTitle();
  persistSession();

  if (focus && elements.workspace.dataset.view !== "preview") {
    requestAnimationFrame(() => editorView.focus());
  }
}

function showEmptyState() {
  activeDocumentId = null;
  previewRestorePending = null;
  clearTimeout(renderTimer);
  editorView.setState(createEditorState(""));
  restoreEditorScroll(null);
  elements.empty.hidden = false;
  elements.workspace.hidden = true;
  elements["tabs-bar"].hidden = true;
  elements.statusbar.hidden = true;
  elements.markdown.innerHTML = "";
  setDocumentActionsEnabled(false);
  renderTabs();
  renderFileTree();
  updateWindowTitle();
  persistSession();
}

const documentMenu = createContextMenu(window.document, (error) => showError("文档操作失败", error));

function showDocumentMenu(event, { path, id }) {
  const opened = id ? documents.find((item) => item.id === id) : documentByPath(path);
  const items = [];
  if (!id) items.push({ label: "打开文档", action: () => openDocument(path) });
  items.push({ label: "重命名", action: async () => {
    if (path) await renameFileAtPath(path);
    else if (opened) {
      switchDocument(opened.id, { focus: false });
      await renameActiveDocument();
    }
  } });
  items.push({ label: "打开所在文件夹", disabled: !path, action: () => invoke("reveal_in_folder", { path }) });
  items.push({ label: "复制文件路径", disabled: !path, action: () => navigator.clipboard.writeText(path) });
  if (opened) items.push({ label: "关闭文档", action: () => closeDocument(opened.id) });
  documentMenu.show(event, items);
}

function renderTabs() {
  elements.tabs.replaceChildren();
  for (const item of documents) {
    const tab = window.document.createElement("button");
    tab.className = "tab";
    tab.type = "button";
    tab.role = "tab";
    tab.ariaSelected = String(item.id === activeDocumentId);
    tab.classList.toggle("active", item.id === activeDocumentId);
    tab.title = `${item.path || item.name}（右键打开菜单，双击重命名）`;
    tab.setAttribute("aria-haspopup", "menu");
    tab.addEventListener("click", () => switchDocument(item.id));
    tab.addEventListener("dblclick", (event) => {
      event.preventDefault();
      switchDocument(item.id, { focus: false });
      if (item.path) renameFileAtPath(item.path);
      else renameActiveDocument();
    });
    tab.addEventListener("contextmenu", (event) => {
      showDocumentMenu(event, { path: item.path, id: item.id });
    });

    const icon = window.document.createElement("span");
    icon.className = "tab-icon";
    icon.textContent = "M";
    const label = window.document.createElement("span");
    label.className = "tab-label";
    label.textContent = item.name;
    const state = window.document.createElement("span");
    state.className = "tab-state";
    state.textContent = item.dirty ? "●" : "";
    state.setAttribute("aria-label", item.dirty ? "未保存" : "已保存");
    const close = window.document.createElement("span");
    close.className = "tab-close";
    close.textContent = "×";
    close.title = "关闭";
    close.addEventListener("click", (event) => {
      event.stopPropagation();
      closeDocument(item.id);
    });

    tab.append(icon, label, state, close);
    elements.tabs.append(tab);
  }

  requestAnimationFrame(() => {
    elements.tabs.querySelector(".tab.active")?.scrollIntoView({
      block: "nearest",
      inline: "nearest",
    });
  });
}

async function openDocument(path, { activate = true, silent = false } = {}) {
  const existing = documentByPath(path);
  if (existing) {
    if (activate) switchDocument(existing.id);
    return existing;
  }

  try {
    const contents = await invoke("read_text_file", { path });
    const document = createDocument({ path, contents });
    documents.push(document);
    rememberRecent(path);
    if (activate || !activeDocument()) {
      switchDocument(document.id, { focus: activate });
    } else {
      renderTabs();
      persistSession();
    }
    if (!silent) recordActivity("open", `打开 ${document.name}`, path);
    return document;
  } catch (error) {
    console.error(error);
    if (!silent) await showError("无法打开文件", error);
    return null;
  }
}

function newDocument() {
  const document = createDocument();
  documents.push(document);
  switchDocument(document.id);
  recordActivity("new", `新建 ${document.name}`, "未保存文档");
}

async function openWithDialog() {
  try {
    const selected = await open({
      multiple: true,
      directory: false,
      filters: DOCUMENT_FILTERS,
    });
    const paths = Array.isArray(selected) ? selected : selected ? [selected] : [];
    for (const [index, path] of paths.entries()) {
      await openDocument(path, { activate: index === paths.length - 1 });
    }
  } catch (error) {
    console.error(error);
    await showError("无法选择文件", error);
  }
}

async function saveDocument(saveAs = false) {
  const document = activeDocument();
  if (!document) return false;

  let target = document.path;
  if (saveAs || !target) {
    const defaultName = `${stem(document.name)}.md`;
    const defaultPath = currentFolder
      ? `${currentFolder}${currentFolder.includes("\\") ? "\\" : "/"}${defaultName}`
      : defaultName;
    const selected = await save({
      defaultPath,
      filters: [{ name: "Markdown", extensions: ["md", "markdown", "txt"] }],
    });
    if (!selected) return false;
    const conflict = documentByPath(selected);
    if (conflict && conflict.id !== document.id) {
      await showMessage("该文件已经在另一个标签页中打开。");
      switchDocument(conflict.id);
      return false;
    }
    target = selected;
  }

  const contents = documentText(document);
  try {
    await invoke("save_text_file", { path: target, contents });
    document.path = target;
    document.name = basename(target);
    document.dirty = documentText(document) !== contents;
    rememberRecent(target);
    renderTabs();
    renderFileTree();
    updateStatusBar();
    updateWindowTitle();
    persistSession();
    if (currentFolder && pathInsideFolder(target, currentFolder)) {
      refreshFolder({ silent: true });
    }
    recordActivity("save", `保存 ${document.name}`, target);
    return true;
  } catch (error) {
    console.error(error);
    await showError("保存失败", error);
    return false;
  }
}

async function closeDocument(id) {
  const index = documents.findIndex((document) => document.id === id);
  if (index < 0) return false;
  const target = documents[index];
  if (target.dirty) {
    const shouldClose = await showConfirm(
      `"${target.name}"还有未保存的修改。关闭后将丢失这些修改，仍要关闭吗？`,
    );
    if (!shouldClose) return false;
  }

  documents.splice(index, 1);
  forgetDocumentScroll(target.id);
  if (target.id === activeDocumentId) {
    // Clear first so the closed document is not remembered again on switch.
    activeDocumentId = null;
    const next = documents[Math.min(index, documents.length - 1)];
    if (next) switchDocument(next.id);
    else showEmptyState();
  } else {
    renderTabs();
    persistSession();
  }
  return true;
}

function cycleDocument(direction) {
  if (documents.length < 2) return;
  const index = documents.findIndex((document) => document.id === activeDocumentId);
  const nextIndex = (index + direction + documents.length) % documents.length;
  switchDocument(documents[nextIndex].id);
}

function setDocumentActionsEnabled(enabled) {
  for (const id of [
    "save-btn",
    "save-as-btn",
    "export-btn",
    "export-pdf-btn",
    "export-doc-btn",
    "export-html-btn",
  ]) {
    elements[id].disabled = !enabled;
  }
}

function updateWindowTitle() {
  const document = activeDocument();
  window.document.title = document
    ? `${document.dirty ? "● " : ""}${document.name} — Markdown Viewer`
    : "Markdown Viewer";
}

function updateStatusBar() {
  const document = activeDocument();
  if (!document) return;
  const text = documentText(document);
  const head = document.state.selection.main.head;
  const line = document.state.doc.lineAt(head);
  const words = text.match(/[\p{Script=Han}]|[\p{L}\p{N}_]+/gu)?.length || 0;

  elements["file-path"].textContent = document.path || "尚未保存到磁盘";
  elements["file-path"].title = document.path || "";
  elements["save-state"].textContent = document.dirty ? "未保存" : "已保存";
  elements["save-state"].classList.toggle("dirty", document.dirty);
  elements["cursor-position"].textContent = `行 ${line.number}，列 ${head - line.from + 1}`;
  elements["document-stats"].textContent = `${words} 字 · ${text.length} 字符`;
}

function setView(mode) {
  scrollSync.reset();
  const validMode = ["edit", "split", "preview"].includes(mode) ? mode : "split";
  rememberDocumentScroll(activeDocumentId);
  elements.workspace.dataset.view = validMode;
  for (const [buttonId, buttonMode] of [
    ["view-edit-btn", "edit"],
    ["view-split-btn", "split"],
    ["view-preview-btn", "preview"],
  ]) {
    const active = validMode === buttonMode;
    elements[buttonId].classList.toggle("active", active);
    elements[buttonId].setAttribute("aria-pressed", String(active));
  }
  for (const button of document.querySelectorAll("[data-settings-view]")) {
    const active = button.dataset.settingsView === validMode;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  }
  localStorage.setItem("mdv-view", validMode);
  const document = activeDocument();
  if (document && validMode !== "edit") {
    previewRestorePending = document.id;
    renderPreview();
  }
  // A hidden editor pane loses its offset, so re-apply the remembered one.
  if (document && validMode !== "preview") restoreEditorScroll(document.id);
  if (validMode !== "preview" && activeDocument()) {
    requestAnimationFrame(() => editorView.focus());
  }
  requestAnimationFrame(() => editorView.requestMeasure());
}

function setSplitRatio(ratio, { persist = true } = {}) {
  splitRatio = Math.min(85, Math.max(15, Number(ratio) || 50));
  elements.workspace.style.setProperty("--editor-ratio", `${splitRatio}%`);
  elements["pane-resizer"].setAttribute("aria-valuenow", String(Math.round(splitRatio)));
  elements["pane-resizer"].setAttribute(
    "aria-valuetext",
    `编辑区 ${Math.round(splitRatio)}%，预览区 ${Math.round(100 - splitRatio)}%`,
  );
  if (persist) localStorage.setItem(SPLIT_RATIO_KEY, String(splitRatio));
  editorView.requestMeasure();
}

function bindPaneResizer() {
  const resizer = elements["pane-resizer"];

  function updateFromPointer(event) {
    const bounds = elements.workspace.getBoundingClientRect();
    if (bounds.width <= 0) return;
    setSplitRatio(((event.clientX - bounds.left) / bounds.width) * 100);
  }

  function finishResize(event) {
    if (resizer.hasPointerCapture(event.pointerId)) {
      resizer.releasePointerCapture(event.pointerId);
    }
    resizer.classList.remove("dragging");
    document.body.classList.remove("resizing-panes");
  }

  resizer.addEventListener("pointerdown", (event) => {
    if (elements.workspace.dataset.view !== "split") return;
    event.preventDefault();
    resizer.setPointerCapture(event.pointerId);
    resizer.classList.add("dragging");
    document.body.classList.add("resizing-panes");
    updateFromPointer(event);
  });
  resizer.addEventListener("pointermove", (event) => {
    if (!resizer.hasPointerCapture(event.pointerId)) return;
    updateFromPointer(event);
  });
  resizer.addEventListener("pointerup", finishResize);
  resizer.addEventListener("pointercancel", finishResize);
  resizer.addEventListener("dblclick", () => setSplitRatio(50));
  resizer.addEventListener("keydown", (event) => {
    const step = event.shiftKey ? 10 : 2;
    if (event.key === "ArrowLeft") setSplitRatio(splitRatio - step);
    else if (event.key === "ArrowRight") setSplitRatio(splitRatio + step);
    else if (event.key === "Home") setSplitRatio(15);
    else if (event.key === "End") setSplitRatio(85);
    else return;
    event.preventDefault();
  });
}

function applyTheme(theme) {
  currentTheme = theme === "dark" ? "dark" : "light";
  document.documentElement.setAttribute("data-theme", currentTheme);
  localStorage.setItem("mdv-theme", currentTheme);
  const extension = currentTheme === "dark" ? oneDark : [];
  for (const document of documents) {
    if (document.id === activeDocumentId) continue;
    document.state = document.state.update({
      effects: themeCompartment.reconfigure(extension),
    }).state;
  }
  editorView.dispatch({
    effects: themeCompartment.reconfigure(extension),
  });
  elements["theme-btn"].textContent = currentTheme === "dark" ? "☀" : "◐";
  elements["theme-btn"].title = currentTheme === "dark" ? "切换到浅色主题" : "切换到深色主题";
  elements["settings-light-btn"].classList.toggle("active", currentTheme === "light");
  elements["settings-dark-btn"].classList.toggle("active", currentTheme === "dark");
  renderPreview();
}

async function openFolderDialog() {
  try {
    const selected = await open({ multiple: false, directory: true });
    if (typeof selected === "string") await loadFolder(selected);
  } catch (error) {
    console.error(error);
    await showError("无法选择文件夹", error);
  }
}

async function loadFolder(path, { silent = false } = {}) {
  try {
    const tree = await invoke("list_markdown_files", { path });
    currentFolder = path;
    folderTree = tree;
    expandedFolders = new Set();
    elements["folder-name"].textContent = basename(path);
    elements["folder-name"].title = path;
    elements["file-filter"].disabled = false;
    elements["refresh-folder-btn"].disabled = false;
    localStorage.setItem(FOLDER_KEY, path);
    setSidebarVisible(true);
    renderFileTree();
    if (!silent) recordActivity("folder", `打开文件夹 ${basename(path)}`, path);
    return true;
  } catch (error) {
    console.error(error);
    if (!silent) await showError("无法打开文件夹", error);
    if (currentFolder === path || !currentFolder) {
      localStorage.removeItem(FOLDER_KEY);
    }
    return false;
  }
}

async function refreshFolder({ silent = false } = {}) {
  if (!currentFolder) return;
  const previousExpanded = expandedFolders;
  try {
    folderTree = await invoke("list_markdown_files", { path: currentFolder });
    expandedFolders = previousExpanded;
    renderFileTree();
  } catch (error) {
    console.error(error);
    if (!silent) await showError("刷新文件夹失败", error);
  }
}

function countDocuments(nodes) {
  return nodes.reduce(
    (total, node) => total + (node.is_dir ? countDocuments(node.children) : 1),
    0,
  );
}

function treeNodeMatches(node, query) {
  if (!query) return true;
  return (
    node.name.toLocaleLowerCase().includes(query) ||
    (node.is_dir && node.children.some((child) => treeNodeMatches(child, query)))
  );
}

function renderFileTree() {
  if (!currentFolder) return;
  const query = elements["file-filter"].value.trim().toLocaleLowerCase();
  elements["file-tree"].replaceChildren();

  const visibleNodes = folderTree.filter((node) => treeNodeMatches(node, query));
  if (visibleNodes.length === 0) {
    const empty = window.document.createElement("div");
    empty.className = "tree-empty";
    empty.textContent = query ? "没有匹配的文档" : "此文件夹中没有 Markdown 文档";
    elements["file-tree"].append(empty);
  } else {
    const branch = buildTreeBranch(visibleNodes, query, 0);
    elements["file-tree"].append(branch);
  }

  const total = countDocuments(folderTree);
  elements["folder-stats"].textContent = `${total} 个文档 · 本地工作区`;
}

function buildTreeBranch(nodes, query, depth) {
  const fragment = window.document.createDocumentFragment();
  const current = activeDocument();
  for (const node of nodes) {
    if (!treeNodeMatches(node, query)) continue;

    if (node.is_dir) {
      const details = window.document.createElement("details");
      details.className = "tree-directory";
      details.open = Boolean(query) || expandedFolders.has(node.path);
      details.addEventListener("toggle", () => {
        if (details.open) expandedFolders.add(node.path);
        else expandedFolders.delete(node.path);
      });

      const summary = window.document.createElement("summary");
      summary.className = "tree-row directory-row";
      summary.style.setProperty("--tree-depth", depth);
      const chevron = window.document.createElement("span");
      chevron.className = "tree-chevron";
      chevron.textContent = "›";
      const icon = window.document.createElement("span");
      icon.className = "tree-folder-icon";
      icon.textContent = "◇";
      const label = window.document.createElement("span");
      label.className = "tree-label";
      label.textContent = node.name;
      summary.append(chevron, icon, label);
      details.append(summary, buildTreeBranch(node.children, query, depth + 1));
      fragment.append(details);
    } else {
      const button = window.document.createElement("button");
      button.type = "button";
      button.className = "tree-row file-row";
      button.style.setProperty("--tree-depth", depth);
      button.title = `${node.path}（右键打开菜单）`;
      button.setAttribute("aria-haspopup", "menu");
      button.classList.toggle(
        "active",
        Boolean(current?.path && normalizePath(current.path) === normalizePath(node.path)),
      );
      button.addEventListener("click", () => openDocument(node.path));
      button.addEventListener("contextmenu", (event) => {
        showDocumentMenu(event, { path: node.path });
      });
      const icon = window.document.createElement("span");
      icon.className = "tree-file-icon";
      icon.textContent = "M";
      const label = window.document.createElement("span");
      label.className = "tree-label";
      label.textContent = node.name;
      button.append(icon, label);
      fragment.append(button);
    }
  }
  return fragment;
}

function setSidebarVisible(visible) {
  elements.sidebar.classList.toggle("collapsed", !visible);
  elements["sidebar-btn"].classList.toggle("active", visible);
  elements["sidebar-btn"].setAttribute("aria-pressed", String(visible));
  updateActivityButtons();
  localStorage.setItem(SIDEBAR_KEY, visible ? "open" : "closed");
}

function updateActivityButtons() {
  const sidebarVisible = !elements.sidebar.classList.contains("collapsed");
  for (const button of document.querySelectorAll("[data-sidebar-target]")) {
    const active = sidebarVisible && button.dataset.sidebarTarget === activeSidebarPanel;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  }
}

function setSidebarPanel(panel, { show = true } = {}) {
  activeSidebarPanel = SIDEBAR_PANELS.includes(panel) ? panel : "files";
  for (const section of document.querySelectorAll("[data-sidebar-panel]")) {
    section.hidden = section.dataset.sidebarPanel !== activeSidebarPanel;
  }
  localStorage.setItem(SIDEBAR_PANEL_KEY, activeSidebarPanel);
  if (show) setSidebarVisible(true);
  else updateActivityButtons();
}

function loadActivityHistory() {
  try {
    const history = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
    return Array.isArray(history) ? history : [];
  } catch {
    return [];
  }
}

function recordActivity(action, title, detail = "") {
  const history = loadActivityHistory();
  history.unshift({ action, title, detail, timestamp: Date.now() });
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, MAX_HISTORY)));
  renderActivityHistory();
}

function renderActivityHistory() {
  const history = loadActivityHistory();
  elements["activity-history-list"].replaceChildren();
  if (history.length === 0) {
    const empty = document.createElement("div");
    empty.className = "history-empty";
    empty.textContent = "还没有操作记录。打开、编辑或导出文档后会显示在这里。";
    elements["activity-history-list"].append(empty);
    return;
  }

  const actionMarks = {
    new: "新",
    open: "开",
    save: "存",
    folder: "夹",
    export: "出",
    theme: "色",
  };
  const formatter = new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  for (const entry of history) {
    const item = document.createElement("div");
    item.className = "history-item";
    const mark = document.createElement("span");
    mark.className = "history-mark";
    mark.textContent = actionMarks[entry.action] || "记";
    const content = document.createElement("div");
    content.className = "history-content";
    const title = document.createElement("div");
    title.className = "history-title";
    title.textContent = entry.title || "操作记录";
    const detail = document.createElement("div");
    detail.className = "history-detail";
    detail.textContent = entry.detail || "Markdown Viewer";
    detail.title = entry.detail || "";
    const meta = document.createElement("div");
    meta.className = "history-meta";
    const time = document.createElement("span");
    time.className = "history-time";
    time.textContent = formatter.format(new Date(entry.timestamp || Date.now()));
    meta.append(time);
    content.append(title, detail, meta);
    item.append(mark, content);
    elements["activity-history-list"].append(item);
  }
}

function loadRecentPaths() {
  try {
    const paths = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
    return Array.isArray(paths) ? paths.filter((path) => typeof path === "string") : [];
  } catch {
    return [];
  }
}

function rememberRecent(path) {
  const normalized = normalizePath(path);
  const paths = loadRecentPaths().filter((item) => normalizePath(item) !== normalized);
  paths.unshift(path);
  localStorage.setItem(RECENT_KEY, JSON.stringify(paths.slice(0, MAX_RECENT)));
  renderRecentFiles();
}

function renderRecentFiles() {
  const paths = loadRecentPaths().slice(0, 5);
  elements["recent-list"].replaceChildren();
  elements["recent-section"].hidden = paths.length === 0;
  for (const path of paths) {
    const button = window.document.createElement("button");
    button.type = "button";
    button.className = "recent-item";
    button.title = path;
    button.addEventListener("click", () => openDocument(path));
    const name = window.document.createElement("span");
    name.className = "recent-name";
    name.textContent = basename(path);
    const location = window.document.createElement("span");
    location.className = "recent-path";
    location.textContent = path;
    button.append(name, location);
    elements["recent-list"].append(button);
  }
}

function persistSession() {
  const active = activeDocument();
  const session = {
    paths: documents.filter((document) => document.path).map((document) => document.path),
    activePath: active?.path || null,
  };
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

function loadSession() {
  try {
    const session = JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
    return session && Array.isArray(session.paths) ? session : { paths: [], activePath: null };
  } catch {
    return { paths: [], activePath: null };
  }
}

async function restoreWorkspace() {
  renderRecentFiles();
  const folder = localStorage.getItem(FOLDER_KEY);
  if (folder) await loadFolder(folder, { silent: true });

  const session = loadSession();
  for (const path of session.paths) {
    await openDocument(path, { activate: false, silent: true });
  }
  const previousActive = session.activePath ? documentByPath(session.activePath) : null;
  if (previousActive) switchDocument(previousActive.id, { focus: false });
  else if (documents.length > 0) switchDocument(documents[0].id, { focus: false });
}

function fullDocumentHtml(bodyHtml) {
  return `<!DOCTYPE html>
<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta charset="utf-8">
<style>
  body { font-family: "Segoe UI", "Microsoft YaHei", sans-serif; font-size: 12pt; line-height: 1.65; color: #1f2328; max-width: 860px; margin: 32px auto; }
  h1, h2, h3, h4, h5, h6 { font-weight: 600; line-height: 1.3; }
  code { font-family: Consolas, "Courier New", monospace; background: #f6f8fa; padding: 1px 4px; }
  pre { background: #f6f8fa; padding: 12px; overflow: auto; }
  pre code { background: none; padding: 0; }
  blockquote { color: #656d76; border-left: 3px solid #d0d7de; padding-left: 12px; margin-left: 0; }
  table { border-collapse: collapse; } th, td { border: 1px solid #d0d7de; padding: 6px 10px; }
  img { max-width: 100%; } hr { border: 0; border-top: 1px solid #d0d7de; } a { color: #0969da; }
</style>
</head>
<body>${bodyHtml}</body>
</html>`;
}

const PDF_SAFE_STYLE_ID = "pdf-safe-style";
const PDF_SAFE_CSS = `
.pdf-export-content, .pdf-export-content * { box-shadow: none !important; text-shadow: none !important; }
.pdf-export-content { background: #ffffff !important; color: #1f2328 !important; }
.pdf-export-content h1, .pdf-export-content h2, .pdf-export-content h3,
.pdf-export-content h4, .pdf-export-content h5, .pdf-export-content h6 { color: #1f2328 !important; border-color: #d0d7de !important; }
.pdf-export-content p, .pdf-export-content li, .pdf-export-content td, .pdf-export-content th { color: #1f2328 !important; }
.pdf-export-content a { color: #0969da !important; }
.pdf-export-content code { background: #f6f8fa !important; border-color: #d0d7de !important; color: #1f2328 !important; }
.pdf-export-content pre { background: #f6f8fa !important; border-color: #d0d7de !important; }
.pdf-export-content pre code { background: transparent !important; border: 0 !important; }
.pdf-export-content blockquote { color: #656d76 !important; border-left-color: #d0d7de !important; }
.pdf-export-content table, .pdf-export-content th, .pdf-export-content td { border-color: #d0d7de !important; }
.pdf-export-content th { background: #f6f8fa !important; }
.pdf-export-content hr { border-top-color: #d0d7de !important; }
.pdf-export-content img { border: 0 !important; }
.pdf-export-content { font-family: "Segoe UI", "Microsoft YaHei", sans-serif; font-size: 16px; line-height: 1.65; }
.pdf-export-content pre { padding: 12px; white-space: pre-wrap; overflow-wrap: anywhere; }
.pdf-export-content table { border-collapse: collapse; }
.pdf-export-content td, .pdf-export-content th { padding: 6px 10px; }
.pdf-export-content, .pdf-export-content * { box-sizing: border-box !important; }
.pdf-export-content { margin: 0 !important; max-width: none !important; overflow: visible !important; overflow-wrap: break-word; }
.pdf-export-content > :first-child { margin-top: 0 !important; }
.pdf-export-content h1, .pdf-export-content h2, .pdf-export-content h3,
.pdf-export-content h4, .pdf-export-content h5, .pdf-export-content h6 { margin: 1.6em 0 0.65em !important; font-weight: 650 !important; line-height: 1.3 !important; letter-spacing: -0.015em !important; }
.pdf-export-content h1 { font-size: 2em !important; padding-bottom: 0.32em !important; border-bottom: 1px solid #d0d7de !important; }
.pdf-export-content h2 { font-size: 1.45em !important; padding-bottom: 0.3em !important; border-bottom: 1px solid #d0d7de !important; }
.pdf-export-content h3 { font-size: 1.2em !important; }
.pdf-export-content p { margin: 0 0 1em !important; }
.pdf-export-content a { text-decoration: none !important; }
.pdf-export-content code { font-family: Consolas, "Microsoft YaHei", monospace !important; font-size: 85% !important; padding: 0.16em 0.38em !important; border: 1px solid #d0d7de !important; border-radius: 5px !important; }
.pdf-export-content pre { margin: 1.2em 0 !important; padding: 12px !important; border: 1px solid #d0d7de !important; border-radius: 6px !important; line-height: 1.5 !important; overflow: visible !important; }
.pdf-export-content pre code { padding: 0 !important; font-size: 13px !important; }
.pdf-export-content blockquote { margin: 1em 0 !important; padding: 0.15em 1em !important; border-left: 3px solid #d0d7de !important; }
.pdf-export-content blockquote > :last-child { margin-bottom: 0 !important; }
.pdf-export-content table { display: table !important; width: 100% !important; max-width: 100% !important; table-layout: fixed !important; overflow: visible !important; margin: 1em 0 !important; }
.pdf-export-content th, .pdf-export-content td { padding: 6px 10px !important; border: 1px solid #d0d7de !important; overflow-wrap: anywhere !important; }
.pdf-export-content tr:nth-child(2n) { background: #f7f8fa !important; }
.pdf-export-content img { display: block !important; max-width: 100% !important; height: auto !important; margin: 16px auto !important; border-radius: 0 !important; }
.pdf-export-content hr { margin: 2em 0 !important; }
.pdf-export-content ul, .pdf-export-content ol { padding-left: 1.8em !important; }
.pdf-export-content li + li { margin-top: 0.25em !important; }
`;

function ensurePdfSafeStyle() {
  let style = window.document.getElementById(PDF_SAFE_STYLE_ID);
  if (!style) {
    style = window.document.createElement("style");
    style.id = PDF_SAFE_STYLE_ID;
    window.document.head.append(style);
  }
  style.textContent = PDF_SAFE_CSS;
  return style;
}

function sanitizeClonedDocForPdf(clonedDoc) {
  for (const node of [...clonedDoc.querySelectorAll('style, link[rel="stylesheet"]')]) {
    if (node.id !== PDF_SAFE_STYLE_ID) node.remove();
  }
  const unsafePattern = /color-mix|oklch|oklab|\blch\(|\blab\(|light-dark/i;
  const colorFuncPattern = /(^|[\s:,])color\(/i;
  for (const el of clonedDoc.querySelectorAll("*")) {
    const style = el.getAttribute("style");
    if (!style) continue;
    if (!unsafePattern.test(style) && !colorFuncPattern.test(style)) continue;
    const kept = style
      .split(";")
      .map((part) => part.trim())
      .filter((part) => part && !unsafePattern.test(part) && !colorFuncPattern.test(part));
    if (kept.length > 0) el.setAttribute("style", kept.join("; "));
    else el.removeAttribute("style");
  }
}

async function withExportRoot(callback) {
  const exportRoot = window.document.createElement("div");
  exportRoot.className = "markdown-body pdf-export-content";
  exportRoot.setAttribute(
    "style",
    "background: #ffffff; color: #1f2328; width: 760px; padding: 0; position: fixed; left: 0; top: 0; z-index: -1;",
  );
  exportRoot.innerHTML = DOMPurify.sanitize(marked.parse(normalizeMarkdown(documentText())), { USE_PROFILES: { html: true } });
  ensurePdfSafeStyle();
  window.document.body.append(exportRoot);

  try {
    await window.document.fonts.ready;
    await renderMermaidBlocks(exportRoot, "light", () => true, { htmlLabels: false });
    for (const diagram of exportRoot.querySelectorAll(".mermaid-diagram")) {
      const raster = await rasterizeDiagram(diagram.querySelector("svg"));
      const image = window.document.createElement("img");
      image.src = raster.src;
      image.width = raster.width;
      image.height = raster.height;
      image.alt = "Mermaid 图表";
      diagram.replaceWith(image);
      await image.decode();
    }
    await Promise.all([...exportRoot.querySelectorAll("img")].map((image) => image.decode()));
    return await callback(exportRoot);
  } finally {
    exportRoot.remove();
  }
}

async function createPdfBase64() {
  return withExportRoot(async (exportRoot) => {
    const pdf = new jsPDF({
      orientation: "portrait",
      unit: "pt",
      format: "a4",
      compress: true,
    });
    let blocks = [];
    const canvas = await html2canvas(exportRoot, {
        backgroundColor: "#ffffff",
        logging: false,
        scale: 2,
        useCORS: true,
        onclone: (clonedDoc) => {
          sanitizeClonedDocForPdf(clonedDoc);
          const root = clonedDoc.querySelector(".pdf-export-content");
          const origin = root.getBoundingClientRect().top;
          blocks = [...root.querySelectorAll("p, pre, tr, img, h1, h2, h3, h4, h5, h6")].map((node) => {
            const bounds = node.getBoundingClientRect();
            return { top: (bounds.top - origin) * 2, bottom: (bounds.bottom - origin) * 2 };
          });
        },
    });
    const width = pdf.internal.pageSize.getWidth() - 72;
    const pageHeight = pdf.internal.pageSize.getHeight() - 80;
    const rows = Math.floor(pageHeight * canvas.width / width);
    for (const { offset, height } of pdfPageSlices(canvas.height, rows, blocks)) {
      const page = window.document.createElement("canvas");
      page.width = canvas.width;
      page.height = height;
      page.getContext("2d").drawImage(canvas, 0, offset, canvas.width, page.height, 0, 0, page.width, page.height);
      if (offset) pdf.addPage();
      pdf.addImage(page.toDataURL("image/png"), "PNG", 36, 40, width, page.height * width / page.width);
    }
    return pdf.output("datauristring").split(",", 2)[1];
  });
}

async function exportDocument(type) {
  const document = activeDocument();
  if (!document) return;
  await renderPreview();
  const extension = type === "pdf" ? "pdf" : type === "doc" ? "docx" : "html";
  const label = type === "pdf" ? "PDF 文档" : type === "doc" ? "Word 文档" : "HTML 文档";
  try {
    const path = await save({
      defaultPath: `${stem(document.name)}.${extension}`,
      filters: [{ name: label, extensions: [extension] }],
    });
    if (path) {
      if (type === "pdf") {
        const contentsBase64 = await createPdfBase64();
        await invoke("save_binary_file", { path, contentsBase64 });
      } else if (type === "doc") {
        const { createDocxBase64 } = await import("./docx-export.js");
        const contentsBase64 = await withExportRoot(createDocxBase64);
        await invoke("save_binary_file", { path, contentsBase64 });
      } else {
        const html = fullDocumentHtml(elements.markdown.innerHTML);
        await invoke("save_text_file", { path, contents: html });
      }
      recordActivity("export", `导出 ${document.name}`, path);
    }
  } catch (error) {
    console.error(error);
    await showError("导出失败", error);
  } finally {
    elements["export-popover"].hidden = true;
  }
}

async function setupDragDrop() {
  elements["drop-overlay"].hidden = true;
  try {
    await getCurrentWebview().onDragDropEvent(async (event) => {
      const type = event.payload.type;
      if (type === "over") {
        elements["drop-overlay"].hidden = false;
      } else if (type === "drop") {
        elements["drop-overlay"].hidden = true;
        const paths = event.payload.paths || [];
        for (const path of paths) {
          if (isSupportedDocument(path)) await openDocument(path);
          else await loadFolder(path, { silent: true });
        }
      } else {
        elements["drop-overlay"].hidden = true;
      }
    });
  } catch (error) {
    console.error("drag-drop unavailable:", error);
  }
}

async function showError(title, error) {
  await showMessage(`${title}：${String(error)}`);
}

function bindEvents() {
  for (const id of ["new-btn", "new-tab-btn", "empty-new-btn"]) {
    elements[id].addEventListener("click", newDocument);
  }
  for (const id of ["open-btn", "empty-open-btn"]) {
    elements[id].addEventListener("click", openWithDialog);
  }
  for (const id of [
    "open-folder-btn",
    "sidebar-open-folder-btn",
    "empty-folder-btn",
  ]) {
    elements[id].addEventListener("click", openFolderDialog);
  }

  elements["save-btn"].addEventListener("click", () => saveDocument(false));
  elements["save-as-btn"].addEventListener("click", () => saveDocument(true));
  elements["refresh-folder-btn"].addEventListener("click", () => refreshFolder());
  elements["file-filter"].addEventListener("input", renderFileTree);
  elements["sidebar-btn"].addEventListener("click", () => {
    setSidebarVisible(elements.sidebar.classList.contains("collapsed"));
  });
  for (const button of document.querySelectorAll("[data-sidebar-target]")) {
    button.addEventListener("click", () => {
      const target = button.dataset.sidebarTarget;
      const isCurrentPanel = target === activeSidebarPanel;
      const sidebarVisible = !elements.sidebar.classList.contains("collapsed");
      if (isCurrentPanel && sidebarVisible) setSidebarVisible(false);
      else setSidebarPanel(target);
    });
  }
  elements["clear-history-btn"].addEventListener("click", () => {
    localStorage.removeItem(HISTORY_KEY);
    renderActivityHistory();
  });
  elements["browse-plugins-btn"].addEventListener("click", () => {
    showMessage("插件系统正在规划中。这个入口已经预留，后续可以接入主题、语法和导出插件。");
  });
  elements["settings-light-btn"].addEventListener("click", () => {
    if (currentTheme !== "light") {
      applyTheme("light");
      recordActivity("theme", "切换浅色主题", "设置");
    }
  });
  elements["settings-dark-btn"].addEventListener("click", () => {
    if (currentTheme !== "dark") {
      applyTheme("dark");
      recordActivity("theme", "切换深色主题", "设置");
    }
  });
  for (const button of document.querySelectorAll("[data-settings-view]")) {
    button.addEventListener("click", () => setView(button.dataset.settingsView));
  }

  elements["view-edit-btn"].addEventListener("click", () => setView("edit"));
  elements["view-split-btn"].addEventListener("click", () => setView("split"));
  elements["view-preview-btn"].addEventListener("click", () => setView("preview"));
  elements["theme-btn"].addEventListener("click", () => {
    const nextTheme = currentTheme === "dark" ? "light" : "dark";
    applyTheme(nextTheme);
    recordActivity("theme", nextTheme === "dark" ? "切换深色主题" : "切换浅色主题", "工具栏");
  });

  elements["export-btn"].addEventListener("click", (event) => {
    event.stopPropagation();
    elements["export-popover"].hidden = !elements["export-popover"].hidden;
  });
  elements["export-pdf-btn"].addEventListener("click", () => exportDocument("pdf"));
  elements["export-doc-btn"].addEventListener("click", () => exportDocument("doc"));
  elements["export-html-btn"].addEventListener("click", () => exportDocument("html"));
  window.document.addEventListener("click", (event) => {
    if (!event.target.closest(".export-menu")) elements["export-popover"].hidden = true;
  });

  window.addEventListener("keydown", (event) => {
    if (event.key === "F2" && !event.ctrlKey && !event.metaKey && !event.altKey) {
      if (dialogEl.open || event.target === dialogInput) return;
      if (activeDocumentId) {
        event.preventDefault();
        renameActiveDocument();
      }
      return;
    }
    const modifier = event.ctrlKey || event.metaKey;
    if (!modifier) return;
    const key = event.key.toLocaleLowerCase();
    if (key === "s") {
      event.preventDefault();
      saveDocument(event.shiftKey);
    } else if (key === "o") {
      event.preventDefault();
      if (event.shiftKey) openFolderDialog();
      else openWithDialog();
    } else if (key === "n") {
      event.preventDefault();
      newDocument();
    } else if (key === "w") {
      event.preventDefault();
      if (activeDocumentId) closeDocument(activeDocumentId);
    } else if (key === "tab") {
      event.preventDefault();
      cycleDocument(event.shiftKey ? -1 : 1);
    } else if (key === "b") {
      event.preventDefault();
      setSidebarVisible(elements.sidebar.classList.contains("collapsed"));
    }
  });
}

async function protectUnsavedDocuments() {
  try {
    const currentWindow = getCurrentWindow();
    await currentWindow.onCloseRequested(async (event) => {
      if (closeRequestPending) {
        event.preventDefault();
        return;
      }

      const dirtyDocuments = documents.filter((document) => document.dirty);
      if (dirtyDocuments.length === 0) return;

      event.preventDefault();
      closeRequestPending = true;
      try {
        const shouldClose = await showConfirm(
          `还有 ${dirtyDocuments.length} 个文档未保存。退出后将丢失这些修改，仍要退出吗？`,
        );
        if (shouldClose) await currentWindow.destroy();
      } finally {
        closeRequestPending = false;
      }
    });
  } catch (error) {
    console.error("window close protection unavailable:", error);
  }
}

bindEvents();
bindPaneResizer();
setSplitRatio(splitRatio, { persist: false });
setView(localStorage.getItem("mdv-view") || "split");
setSidebarPanel(activeSidebarPanel, { show: false });
setSidebarVisible(localStorage.getItem(SIDEBAR_KEY) !== "closed");
applyTheme(currentTheme);
renderActivityHistory();
setDocumentActionsEnabled(false);
setupDragDrop();
protectUnsavedDocuments();
restoreWorkspace();
