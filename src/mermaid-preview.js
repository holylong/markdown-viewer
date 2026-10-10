let mermaidPromise;
let renderQueue = Promise.resolve();
let diagramId = 0;

// Serialize configuration and rendering: Mermaid keeps global theme state.
export function renderMermaidBlocks(root, theme, isCurrent, { htmlLabels = true } = {}) {
  const blocks = [...root.querySelectorAll("pre > code.language-mermaid")];
  if (!blocks.length) return Promise.resolve();

  const job = async () => {
    if (!isCurrent()) return;
    try {
      mermaidPromise ||= import("mermaid").catch((error) => {
        mermaidPromise = undefined;
        throw error;
      });
      const { default: mermaid } = await mermaidPromise;
      if (!isCurrent()) return;
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        suppressErrorRendering: true,
        theme: theme === "dark" ? "dark" : "default",
        htmlLabels,
        flowchart: { htmlLabels },
      });
      for (const code of blocks) {
        if (!isCurrent()) return;
        try {
          const { svg } = await mermaid.render(`mdv-mermaid-${++diagramId}`, code.textContent);
          if (!isCurrent()) return;
          const container = root.ownerDocument.createElement("div");
          container.className = "mermaid-diagram";
          container.innerHTML = svg;
          code.parentElement.replaceWith(container);
        } catch (error) {
          if (!isCurrent()) return;
          showError(code, error);
        }
      }
    } catch (error) {
      if (isCurrent()) blocks.forEach((code) => showError(code, error));
    }
  };
  renderQueue = renderQueue.then(job, job);
  return renderQueue;
}

function showError(code, error) {
  const message = code.ownerDocument.createElement("div");
  message.className = "mermaid-error";
  message.setAttribute("role", "status");
  message.textContent = `Mermaid 图表渲染失败：${error?.message || String(error)}`;
  code.parentElement.after(message);
}
