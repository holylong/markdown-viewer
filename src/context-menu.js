export function createContextMenu(document, onError) {
  const window = document.defaultView;
  const menu = document.createElement("div");
  menu.className = "document-context-menu";
  menu.setAttribute("role", "menu");
  menu.setAttribute("aria-label", "文档操作");
  menu.hidden = true;
  document.body.append(menu);
  let trigger;

  function hide(restoreFocus = false) {
    if (menu.hidden) return;
    menu.hidden = true;
    if (restoreFocus && trigger?.isConnected) trigger.focus({ preventScroll: true });
  }

  menu.addEventListener("keydown", (event) => {
    const buttons = [...menu.querySelectorAll("button:not(:disabled)")];
    const current = buttons.indexOf(document.activeElement);
    let next;
    if (event.key === "ArrowDown") next = (current + 1) % buttons.length;
    if (event.key === "ArrowUp") next = (current - 1 + buttons.length) % buttons.length;
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = buttons.length - 1;
    if (next !== undefined) { event.preventDefault(); buttons[next]?.focus(); }
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); hide(true); }
    if (event.key === "Tab") hide(true);
  });
  document.addEventListener("pointerdown", (event) => {
    if (!menu.contains(event.target)) hide();
  }, true);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !menu.hidden) { event.preventDefault(); hide(true); }
  });
  window.addEventListener("resize", () => hide());
  window.addEventListener("blur", () => hide());
  document.addEventListener("scroll", (event) => {
    if (!menu.contains(event.target)) hide();
  }, true);

  return {
    hide,
    show(event, items) {
      event.preventDefault();
      event.stopPropagation();
      trigger = event.currentTarget;
      menu.replaceChildren();
      for (const item of items) {
        const button = document.createElement("button");
        button.type = "button";
        button.setAttribute("role", "menuitem");
        button.textContent = item.label;
        button.disabled = Boolean(item.disabled);
        button.addEventListener("click", async () => {
          hide(true);
          try { await item.action(); } catch (error) { await onError(error); }
        });
        menu.append(button);
      }
      menu.hidden = false;
      menu.style.maxHeight = `${Math.max(0, window.innerHeight - 16)}px`;
      const bounds = menu.getBoundingClientRect();
      const anchor = trigger.getBoundingClientRect();
      const keyboard = event.clientX === 0 && event.clientY === 0;
      const x = keyboard ? anchor.left : event.clientX;
      const y = keyboard ? anchor.bottom : event.clientY;
      menu.style.left = `${Math.max(8, Math.min(x, window.innerWidth - bounds.width - 8))}px`;
      menu.style.top = `${Math.max(8, Math.min(y, window.innerHeight - bounds.height - 8))}px`;
      menu.querySelector("button:not(:disabled)")?.focus({ preventScroll: true });
    },
  };
}
