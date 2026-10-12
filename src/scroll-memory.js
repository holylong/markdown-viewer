// The editor view and the preview pane are single shared DOM nodes, so their
// scroll offsets would otherwise leak from one tab to the next. These helpers
// keep one remembered position per document and clamp it to the pane that is
// currently rendered.

export function maxScrollTop(scrollHeight, clientHeight) {
  const limit = Number(scrollHeight) - Number(clientHeight);
  return Number.isFinite(limit) && limit > 0 ? limit : 0;
}

export function clampScrollTop(value, limit) {
  const max = Number.isFinite(limit) && limit > 0 ? limit : 0;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;
  return Math.min(numeric, max);
}

function sanitizeOffset(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
}

function normalizePosition(position) {
  const source = position && typeof position === "object" ? position : {};
  return {
    editor: sanitizeOffset(source.editor),
    preview: sanitizeOffset(source.preview),
  };
}

export function createScrollMemory() {
  const entries = new Map();
  return {
    save(key, position) {
      if (key === null || key === undefined) return;
      const normalized = normalizePosition(position);
      if (normalized.editor === 0 && normalized.preview === 0) {
        entries.delete(key);
        return;
      }
      entries.set(key, normalized);
    },
    read(key) {
      return normalizePosition(entries.get(key));
    },
    forget(key) {
      entries.delete(key);
    },
    clear() {
      entries.clear();
    },
  };
}
