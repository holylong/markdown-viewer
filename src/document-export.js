// Keep paragraphs, table rows and diagrams together when they fit on one page.
export function pdfPageSlices(totalHeight, pageHeight, blocks = []) {
  const pages = [];
  let offset = 0;
  while (offset < totalHeight) {
    let end = Math.min(offset + pageHeight, totalHeight);
    if (end < totalHeight) {
      const crossing = blocks.filter((block) => block.top < end && block.bottom > end && block.bottom - block.top <= pageHeight);
      const boundary = Math.floor(Math.min(end, ...crossing.map((block) => block.top)));
      if (boundary > offset) end = boundary;
    }
    pages.push({ offset, height: end - offset });
    offset = end;
  }
  return pages;
}

// Word's HTML importer reads embedded images from a MIME archive (.doc).
export function wordArchive(root, wrapHtml) {
  const clone = root.cloneNode(true);
  const boundary = "mdv-" + globalThis.crypto.randomUUID();
  const parts = [];
  for (const image of clone.querySelectorAll("img")) {
    const match = /^data:(image\/[\w.+-]+);base64,(.+)$/s.exec(image.src);
    if (!match) continue;
    const location = `file:///image${parts.length}.png`;
    image.setAttribute("src", location);
    parts.push(`--${boundary}\r\nContent-Type: ${match[1]}\r\nContent-Transfer-Encoding: base64\r\nContent-Location: ${location}\r\n\r\n${match[2].match(/.{1,76}/g).join("\r\n")}\r\n`);
  }
  const bytes = new TextEncoder().encode(wrapHtml(clone.innerHTML));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const html = btoa(binary).match(/.{1,76}/g).join("\r\n");
  return `MIME-Version: 1.0\r\nContent-Type: multipart/related; boundary="${boundary}"\r\n\r\n--${boundary}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\nContent-Location: file:///document.htm\r\n\r\n${html}\r\n${parts.join("")}--${boundary}--\r\n`;
}
