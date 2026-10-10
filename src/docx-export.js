import {
  Document, Packer, Paragraph, TextRun, ImageRun, Table, TableRow, TableCell,
  HeadingLevel, WidthType, AlignmentType, ExternalHyperlink, LevelFormat,
} from "docx";

const FONT = { ascii: "Calibri", hAnsi: "Calibri", eastAsia: "Microsoft YaHei", cs: "Microsoft YaHei" };
const CONTENT_WIDTH = 697;

async function imageRun(image) {
  const match = /^data:image\/(png|jpe?g|gif|bmp);base64,(.+)$/s.exec(image.src);
  let data;
  let type;
  if (match) {
    data = Uint8Array.from(atob(match[2]), (character) => character.charCodeAt(0));
    type = /^jpe?g$/.test(match[1]) ? "jpg" : match[1];
  } else {
    // The export root has already decoded images; use PNG for other formats.
    const canvas = image.ownerDocument.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    canvas.getContext("2d").drawImage(image, 0, 0);
    data = Uint8Array.from(atob(canvas.toDataURL("image/png").split(",")[1]), (character) => character.charCodeAt(0));
    type = "png";
  }
  const width = image.width || image.naturalWidth;
  const height = image.height || image.naturalHeight;
  const scale = Math.min(1, CONTENT_WIDTH / width, 950 / height);
  return new ImageRun({ type, data, transformation: { width: width * scale, height: height * scale }, altText: { title: image.alt || "图表", description: image.alt || "图表", name: image.alt || "图表" } });
}

async function inlineRuns(node, style = {}) {
  if (node.nodeType === 3) return [new TextRun({ text: node.textContent, ...style })];
  if (node.nodeType !== 1) return [];
  const tag = node.tagName.toLowerCase();
  if (tag === "br") return [new TextRun({ break: 1 })];
  if (tag === "img") return [await imageRun(node)];
  const next = { ...style };
  if (tag === "strong" || tag === "b") next.bold = true;
  if (tag === "em" || tag === "i") next.italics = true;
  if (tag === "del" || tag === "s") next.strike = true;
  if (tag === "code") { next.font = { ...FONT, ascii: "Consolas", hAnsi: "Consolas" }; next.shading = { fill: "F6F8FA" }; }
  const children = (await Promise.all([...node.childNodes].map((child) => inlineRuns(child, next)))).flat();
  if (tag === "a" && /^https?:\/\//i.test(node.getAttribute("href") || "")) {
    return [new ExternalHyperlink({ link: node.getAttribute("href"), children })];
  }
  return children;
}

async function blocks(root, context, level = 0) {
  if (["TD", "TH"].includes(root.tagName) && ![...root.children].some((node) => ["P", "UL", "OL", "PRE", "TABLE"].includes(node.tagName))) {
    return [new Paragraph({ children: await inlineRuns(root, root.tagName === "TH" ? { bold: true } : {}) })];
  }
  const result = [];
  for (const node of root.childNodes) {
    if (node.nodeType === 3) {
      if (node.textContent.trim()) result.push(new Paragraph({ children: await inlineRuns(node) }));
      continue;
    }
    if (node.nodeType !== 1) continue;
    const tag = node.tagName.toLowerCase();
    if (tag === "table") {
      const rows = [...node.rows];
      const columns = Math.max(...rows.map((row) => [...row.cells].reduce((sum, cell) => sum + cell.colSpan, 0)));
      const tableRows = [];
      for (const row of rows) {
        const cells = [];
        for (const cell of row.cells) {
          const children = await blocks(cell, context);
          cells.push(new TableCell({
            children: children.length ? children : [new Paragraph("")],
            columnSpan: cell.colSpan > 1 ? cell.colSpan : undefined,
            shading: cell.tagName === "TH" ? { fill: "F6F8FA" } : undefined,
            width: { size: 100 * cell.colSpan / columns, type: WidthType.PERCENTAGE },
          }));
        }
        tableRows.push(new TableRow({ children: cells, tableHeader: row.parentElement.tagName === "THEAD", cantSplit: true }));
      }
      result.push(new Table({ rows: tableRows, width: { size: 100, type: WidthType.PERCENTAGE } }));
      result.push(new Paragraph(""));
    } else if (tag === "ul" || tag === "ol") {
      const reference = `list-${++context.listId}`;
      context.numbering.push({ reference, levels: Array.from({ length: 9 }, (_, index) => ({ level: index, format: LevelFormat.DECIMAL, text: `%${index + 1}.`, start: Number(node.getAttribute("start")) || 1, alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 360 * (index + 1), hanging: 260 } } } })) });
      for (const item of [...node.children].filter((item) => item.tagName === "LI")) {
        const inline = [...item.childNodes].filter((child) => !["UL", "OL"].includes(child.tagName));
        result.push(new Paragraph({ children: (await Promise.all(inline.map((child) => inlineRuns(child)))).flat(), ...(tag === "ul" ? { bullet: { level: Math.min(level, 8) } } : { numbering: { reference, level: Math.min(level, 8) } }) }));
        for (const nested of [...item.children].filter((child) => ["UL", "OL"].includes(child.tagName))) {
          result.push(...await blocks({ childNodes: [nested] }, context, level + 1));
        }
      }
    } else if (/^h[1-6]$/.test(tag)) {
      result.push(new Paragraph({ heading: HeadingLevel[`HEADING_${tag[1]}`], children: await inlineRuns(node), keepNext: true }));
    } else if (tag === "pre") {
      const runs = [];
      for (const [index, line] of node.textContent.split(/\r?\n/).entries()) {
        runs.push(new TextRun({ text: line, ...(index ? { break: 1 } : {}), font: { ...FONT, ascii: "Consolas", hAnsi: "Consolas" }, size: 19 }));
      }
      result.push(new Paragraph({ children: runs, shading: { fill: "F6F8FA" }, spacing: { after: 180 } }));
    } else if (tag === "p" || tag === "img") {
      result.push(new Paragraph({ children: await inlineRuns(node), spacing: { after: 180 }, ...(tag === "img" ? { alignment: AlignmentType.CENTER } : {}), ...(tag === "pre" ? { shading: { fill: "F6F8FA" } } : {}) }));
    } else if (tag === "blockquote") {
      result.push(...await blocks(node, context, level));
    } else if (tag === "hr") {
      result.push(new Paragraph({ border: { bottom: { color: "D0D7DE", size: 6, style: "single" } } }));
    } else {
      // Inline HTML in table cells remains one editable paragraph.
      if (["strong", "em", "code", "a", "span"].includes(tag)) result.push(new Paragraph({ children: await inlineRuns(node) }));
      else result.push(...await blocks(node, context, level));
    }
  }
  return result;
}

export async function createDocxBase64(root) {
  const context = { listId: 0, numbering: [] };
  const children = await blocks(root, context);
  const document = new Document({
    styles: { default: { document: { run: { font: FONT, size: 22, color: "1F2328" }, paragraph: { spacing: { after: 160, line: 330 } } } } },
    numbering: { config: context.numbering },
    sections: [{ properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 800, right: 720, bottom: 800, left: 720 } } }, children }],
  });
  return Packer.toBase64String(document);
}
