import { clampScrollTop, maxScrollTop } from "./scroll-memory.js";

// Only the pane receiving user input drives synchronization. Scroll events
// from the following pane (including CodeMirror's measurement passes) must
// never feed back into the pane the user is scrolling.
export function createScrollSync(editor, preview, isEnabled) {
  let source = null;
  for (const pane of [editor, preview]) {
    const takeControl = () => { source = pane; };
    pane.addEventListener("wheel", takeControl, { passive: true });
    pane.addEventListener("pointerdown", takeControl, { passive: true });
    pane.addEventListener("keydown", takeControl);
    pane.addEventListener("scroll", () => {
      if (source !== pane || !isEnabled()) return;
      const target = pane === editor ? preview : editor;
      if (pane.clientHeight <= 0 || target.clientHeight <= 0) return;
      const sourceLimit = maxScrollTop(pane.scrollHeight, pane.clientHeight);
      // A short pane has no progress to map; don't rewind the other pane.
      if (!sourceLimit) return;
      const targetLimit = maxScrollTop(target.scrollHeight, target.clientHeight);
      const position = clampScrollTop(pane.scrollTop, sourceLimit) / sourceLimit * targetLimit;
      if (Math.abs(target.scrollTop - position) > 1) target.scrollTop = position;
    }, { passive: true });
  }
  return {
    // Tab/view restoration and preview re-rendering are programmatic scrolls.
    reset() { source = null; },
  };
}
