"""Small isolated subprocess entry point for native QR decoding."""
from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any


def decode(image_path: str, preprocess: str) -> list[dict[str, Any]]:
    if preprocess not in {"none", "grayscale", "autocontrast"}:
        raise ValueError("preprocess non supportato")
    import zxingcpp
    from PIL import Image, ImageOps

    with Image.open(Path(image_path)) as source:
        image = source.convert("RGB")
    if preprocess == "grayscale":
        image = ImageOps.grayscale(image)
    elif preprocess == "autocontrast":
        image = ImageOps.autocontrast(ImageOps.grayscale(image))
    decoded = zxingcpp.read_barcodes(image, formats=zxingcpp.BarcodeFormat.QRCode)
    codes: list[dict[str, Any]] = []
    for symbol in decoded:
        if not symbol.valid or not symbol.text:
            continue
        points = symbol.position
        corners = [points.top_left, points.top_right, points.bottom_right, points.bottom_left]
        xs, ys = [point.x for point in corners], [point.y for point in corners]
        codes.append({
            "value": symbol.text,
            "format": "QR_CODE",
            "bbox": {"x": min(xs), "y": min(ys), "width": max(xs) - min(xs), "height": max(ys) - min(ys)},
        })
        if len(codes) >= 1000:
            break
    codes.sort(key=lambda item: (item["bbox"]["y"], item["bbox"]["x"], item["value"]))
    return codes


def main() -> int:
    try:
        if len(sys.argv) != 3:
            return 2
        print(json.dumps({"codes": decode(sys.argv[1], sys.argv[2])}, ensure_ascii=False, separators=(",", ":")))
        return 0
    except Exception as error:
        print(json.dumps({"error": str(error)[:500]}, ensure_ascii=False, separators=(",", ":")), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
