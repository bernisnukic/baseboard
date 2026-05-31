#!/usr/bin/env python3
"""Generate build/icon.png — the Baseboard app icon.

A microchip glyph (the "baseboard"/BMC motif) on a navy rounded-square badge,
using the app's palette (navy #1a1a2e / cyan accent #4fc3f7). Rendered at 4x and
downscaled with Lanczos for anti-aliasing. electron-builder derives the macOS
.icns and Windows .ico from this single 1024px PNG.

Requires Pillow:  python3 scripts/generate-icon.py
"""
from PIL import Image, ImageDraw

SCALE = 4
OUT = 1024
S = OUT * SCALE  # render resolution

# Palette (matches src/style.css)
GRAD_TOP = (36, 49, 86)     # #243156
GRAD_BOTTOM = (16, 24, 46)  # #10182e
CHIP_FILL = (30, 42, 71)    # #1e2a47  (--bg-card)
CYAN = (79, 195, 247)       # #4fc3f7  (--accent)


def rrect(draw, box, radius, fill):
    """Filled rounded rectangle, with a fallback for older Pillow."""
    if hasattr(draw, "rounded_rectangle"):
        draw.rounded_rectangle(box, radius=radius, fill=fill)
        return
    x0, y0, x1, y1 = box
    r = radius
    draw.rectangle([x0 + r, y0, x1 - r, y1], fill=fill)
    draw.rectangle([x0, y0 + r, x1, y1 - r], fill=fill)
    draw.pieslice([x0, y0, x0 + 2 * r, y0 + 2 * r], 180, 270, fill=fill)
    draw.pieslice([x1 - 2 * r, y0, x1, y0 + 2 * r], 270, 360, fill=fill)
    draw.pieslice([x0, y1 - 2 * r, x0 + 2 * r, y1], 90, 180, fill=fill)
    draw.pieslice([x1 - 2 * r, y1 - 2 * r, x1, y1], 0, 90, fill=fill)


# --- badge background: vertical navy gradient masked to a rounded square ---
grad = Image.new("RGB", (S, S))
gd = ImageDraw.Draw(grad)
for y in range(S):
    t = y / (S - 1)
    gd.line(
        [(0, y), (S, y)],
        fill=tuple(round(GRAD_TOP[i] + (GRAD_BOTTOM[i] - GRAD_TOP[i]) * t) for i in range(3)),
    )

margin = int(0.07 * S)
badge = [margin, margin, S - margin, S - margin]
badge_r = int(0.215 * (S - 2 * margin))
mask = Image.new("L", (S, S), 0)
rrect(ImageDraw.Draw(mask), badge, badge_r, 255)

img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
img.paste(grad, (0, 0), mask)
d = ImageDraw.Draw(img)

# --- chip body ---
c = S / 2
half = 0.225 * S
chip = [c - half, c - half, c + half, c + half]
chip_r = int(0.085 * S)
stroke = int(0.014 * S)
rrect(d, chip, chip_r, CYAN)  # border
rrect(d, [chip[0] + stroke, chip[1] + stroke, chip[2] - stroke, chip[3] - stroke],
      max(1, chip_r - stroke), CHIP_FILL)  # interior

# --- pins: 4 per side ---
pin_w = 0.05 * S
pin_len = 0.062 * S
overlap = 0.01 * S
pin_r = int(pin_w * 0.42)
for f in (0.235, 0.412, 0.588, 0.765):
    px = chip[0] + (chip[2] - chip[0]) * f
    py = chip[1] + (chip[3] - chip[1]) * f
    # top / bottom
    rrect(d, [px - pin_w / 2, chip[1] - pin_len, px + pin_w / 2, chip[1] + overlap], pin_r, CYAN)
    rrect(d, [px - pin_w / 2, chip[3] - overlap, px + pin_w / 2, chip[3] + pin_len], pin_r, CYAN)
    # left / right
    rrect(d, [chip[0] - pin_len, py - pin_w / 2, chip[0] + overlap, py + pin_w / 2], pin_r, CYAN)
    rrect(d, [chip[2] - overlap, py - pin_w / 2, chip[2] + pin_len, py + pin_w / 2], pin_r, CYAN)

# --- centre "die" + pin-1 marker ---
die = 0.085 * S
die_box = [c - die, c - die, c + die, c + die]
rrect(d, die_box, int(0.22 * die), CYAN)
dot_r = 0.022 * S
dot_c = (c - die * 0.5, c - die * 0.5)
d.ellipse([dot_c[0] - dot_r, dot_c[1] - dot_r, dot_c[0] + dot_r, dot_c[1] + dot_r], fill=CHIP_FILL)

img.resize((OUT, OUT), Image.LANCZOS).save("build/icon.png")
print("wrote build/icon.png (%dx%d)" % (OUT, OUT))
