#!/usr/bin/env python3
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parent
SOURCE = ROOT / "images" / "source"
OUTPUT = ROOT / "images" / "en"
FONT_REGULAR = "/System/Library/Fonts/Helvetica.ttc"
FONT_BOLD = "/System/Library/Fonts/Helvetica.ttc"


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(FONT_BOLD if bold else FONT_REGULAR, size, index=1 if bold else 0)


def centered_text(draw: ImageDraw.ImageDraw, xy, text, face, fill, anchor="mm"):
    draw.text(xy, text, font=face, fill=fill, anchor=anchor)


def render(source_name: str, output_name: str, title: str, stages):
    source = Image.open(SOURCE / source_name).convert("RGB")
    width, height = source.size
    top = 112
    bottom = 122
    canvas = Image.new("RGB", (width, height + top + bottom), "#061326")
    canvas.paste(source, (0, top))
    draw = ImageDraw.Draw(canvas, "RGBA")

    draw.rectangle((0, 0, width, top), fill=(5, 17, 35, 255))
    centered_text(draw, (width / 2, 50), title, font(35, bold=True), "#F4F8FF")
    draw.line((width * 0.36, 87, width * 0.64, 87), fill="#27D9FF", width=3)

    draw.rectangle((0, height + top, width, height + top + bottom), fill=(5, 17, 35, 245))
    segment_width = width / len(stages)
    for index, (heading, subtitle, color) in enumerate(stages):
        center_x = segment_width * (index + 0.5)
        if index:
            draw.line((segment_width * index, height + top + 24,
                       segment_width * index, height + top + bottom - 24),
                      fill=(80, 115, 165, 100), width=2)
        centered_text(draw, (center_x, height + top + 42), heading,
                      font(22, bold=True), color)
        centered_text(draw, (center_x, height + top + 78), subtitle,
                      font(17), "#B9C9DF")

    OUTPUT.mkdir(parents=True, exist_ok=True)
    canvas.save(OUTPUT / output_name, optimize=True)


render(
    "01-data-islands.png",
    "01-data-islands-en.png",
    "FROM FRAGMENTED SaaS TO A CONTINUOUS AGENT WORKFLOW",
    [
        ("FRAGMENTED SaaS", "Manual transfers and lost context", "#FF765F"),
        ("CONTINUOUS AGENT WORKFLOW", "One context, many deliverables", "#36DFFF"),
    ],
)

render(
    "02-agent-office-loop.png",
    "02-agent-office-loop-en.png",
    "THE AGENT OFFICE LOOP",
    [
        ("1  CONTINUOUS DATA", "Keep facts and sources connected", "#41E3DC"),
        ("2  TASK-DRIVEN RETRIEVAL", "Build trustworthy context", "#4BC8F7"),
        ("3  NATIVE EXECUTION", "Act inside real tools", "#9D7CFF"),
        ("4  LIVING DELIVERABLES", "Update as the data changes", "#5D9CFF"),
    ],
)

render(
    "03-office-automation.png",
    "03-office-automation-en.png",
    "FROM FILE GENERATION TO IN-EDITOR EXECUTION",
    [
        ("HTML CONVERSION", "Fast file generation", "#46CEFF"),
        ("OOXML AUTOMATION", "Precise file structure", "#8D77FF"),
        ("NATIVE EDITOR APIs", "Context-aware, incremental work", "#52E2C3"),
    ],
)

render(
    "04-living-data-app.png",
    "04-living-data-app-en.png",
    "FROM STATIC OUTPUT TO A LIVING DELIVERABLE",
    [
        ("COMPLEX SPREADSHEET", "Logic buried in formulas", "#49D8FF"),
        ("STATIC DASHBOARD", "A snapshot that goes stale", "#FF9854"),
        ("LIVING DATA APP", "Always connected to the source", "#55E9E1"),
    ],
)

print(f"Rendered four English diagrams in {OUTPUT}")
