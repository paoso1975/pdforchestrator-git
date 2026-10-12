from __future__ import annotations

import argparse
from pathlib import Path

import qrcode
from barcode import Code128
from barcode.writer import ImageWriter
from PIL import Image, ImageDraw, ImageFont
from pypdf import PdfReader, PdfWriter
from reportlab.lib.pagesizes import A3, A4, LETTER
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas


def main() -> None:
    parser = argparse.ArgumentParser(); parser.add_argument("--output", default="tests/fixtures"); args = parser.parse_args()
    output = Path(args.output).resolve(); output.mkdir(parents=True, exist_ok=True)
    qr_path = output / "qr.png"; qrcode.make("PDFORCHESTRATOR-QR-TEST").save(qr_path)
    barcode_path = Path(Code128("5901234123457", writer=ImageWriter()).save(str(output / "barcode")))
    scan_path = output / "scan.png"; image = Image.new("RGB", (1400, 1900), "white"); draw = ImageDraw.Draw(image)
    draw.text((110, 160), "SCANSIONE DI TEST PDFORCHESTRATOR", fill="black", font=ImageFont.truetype("arial.ttf", 48) if Path("C:/Windows/Fonts/arial.ttf").exists() else None)
    draw.text((110, 260), "Numero pratica: 2026-1042", fill="black"); image.save(scan_path)

    mixed = output / "mixed-text-qr-barcode-scanned.pdf"; document = canvas.Canvas(str(mixed))
    document.setTitle("PDFOrchestrator test fixture"); document.setAuthor("PDFOrchestrator QA"); document.setSubject("Mixed page sizes, QR, barcode and scanned page")
    for size, title in ((A4, "Pagina A4 con testo"), (A3, "Pagina A3 con QR"), (LETTER, "Pagina Letter con barcode"), (A4, "Pagina A4 scansione")):
        document.setPageSize(size); width, height = size; document.setFont("Helvetica", 18); document.drawString(48, height - 56, title)
        if "QR" in title: document.drawImage(ImageReader(str(qr_path)), 60, height - 300, width=180, height=180)
        elif "barcode" in title: document.drawImage(ImageReader(str(barcode_path)), 60, height - 230, width=320, height=140, preserveAspectRatio=True)
        elif "scansione" in title: document.drawImage(ImageReader(str(scan_path)), 48, 48, width=width - 96, height=height - 140, preserveAspectRatio=True, anchor="c")
        else: document.drawString(48, height - 100, "Testo ricercabile: fattura PDF numero 1042.")
        document.showPage()
    document.save()
    reader = PdfReader(str(mixed)); writer = PdfWriter(); writer.clone_document_from_reader(reader); writer.add_outline_item("Copertina", 0); writer.add_outline_item("QR code", 1); writer.add_outline_item("Barcode", 2)
    with mixed.open("wb") as stream: writer.write(stream)

    text = output / "text-and-bookmarks.pdf"; c = canvas.Canvas(str(text), pagesize=A4); c.setTitle("Metadata test"); c.setAuthor("Test suite")
    for index in range(3): c.drawString(72, 760, f"Pagina di test {index + 1}: testo ricercabile"); c.showPage()
    c.save(); reader = PdfReader(str(text)); writer = PdfWriter(); writer.clone_document_from_reader(reader)
    for index in range(3): writer.add_outline_item(f"Pagina {index + 1}", index)
    with text.open("wb") as stream: writer.write(stream)

    # Deterministic inputs for the published integration workflow:
    # input.pdf-list -> pdf.merge -> pdf.qr.readAll -> logic.if ->
    # pdf.page.delete -> pdf.ocr -> pdf.page.normalize -> pdf.convert.pdfa -> pdf.output.
    scanned = output / "pipeline-scan-page.pdf"
    document = canvas.Canvas(str(scanned), pagesize=A3)
    document.setTitle("Pipeline scan input")
    document.drawImage(ImageReader(str(scan_path)), 52, 52, width=A3[0] - 104, height=A3[1] - 130, preserveAspectRatio=True, anchor="c")
    document.showPage(); document.save()

    qr_page = output / "pipeline-qr-page.pdf"
    pipeline_qr = output / "pipeline-qr.png"
    qrcode.make("PIPELINE-QR-TEST").save(pipeline_qr)
    document = canvas.Canvas(str(qr_page), pagesize=A4)
    document.setTitle("Pipeline QR input")
    document.drawString(48, A4[1] - 56, "This page is removed by the integration workflow.")
    document.drawImage(ImageReader(str(pipeline_qr)), 80, A4[1] - 340, width=220, height=220)
    document.showPage(); document.save()

    (output / "pipeline-corrupt.pdf").write_bytes(b"%PDF-1.7\nthis is deliberately not a valid PDF object graph\n")
    qr_path.unlink(missing_ok=True); barcode_path.unlink(missing_ok=True); scan_path.unlink(missing_ok=True); pipeline_qr.unlink(missing_ok=True)
    print(f"Generated fixtures in {output}")


if __name__ == "__main__": main()
