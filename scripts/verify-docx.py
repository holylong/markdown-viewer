"""Validate the public sample DOCX export's embedded images and content."""
import sys
from io import BytesIO
from zipfile import ZipFile
from xml.etree import ElementTree as ET
from PIL import Image

filename = sys.argv[1] if len(sys.argv) > 1 else "artifacts/export-verification/report.docx"
ns = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main", "a": "http://schemas.openxmlformats.org/drawingml/2006/main"}
with ZipFile(filename) as archive:
    xml = ET.fromstring(archive.read("word/document.xml"))
    images = [name for name in archive.namelist() if name.startswith("word/media/") and name.endswith(".png")]
    assert len(images) == 3, f"Expected 3 embedded images, found {len(images)}"
    assert len(xml.findall(".//a:blip", ns)) == 3, "Images are not referenced by the document"
    assert len(xml.findall(".//w:tbl", ns)) == 6, "Report tables are missing"
    text = "".join(node.text or "" for node in xml.findall(".//w:t", ns))
    assert "Markdown Viewer 导出示例" in text and "六、兼容性检查" in text
    for name in images:
        image = Image.open(BytesIO(archive.read(name))).convert("RGBA")
        assert image.getextrema()[3] == (255, 255), f"Transparent image: {name}"
        pixels = image.resize((100, 100)).getdata()
        assert sum(min(r, g, b) < 200 for r, g, b, alpha in pixels) > 100, f"Blank diagram: {name}"
    rels = ET.fromstring(archive.read("word/_rels/document.xml.rels"))
    image_rels = [rel for rel in rels if rel.attrib.get("Type", "").endswith("/image")]
    assert len(image_rels) == 3 and all("TargetMode" not in rel.attrib for rel in image_rels), "Images must be embedded, not linked"
print("DOCX verified: 3 visible embedded diagrams, 6 tables, report text present.")
