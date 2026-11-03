"""Draws the TorqDrop mark (orange badge with a gauge) and writes splash and launcher icons.

Usage: python3 scripts/brand-assets.py [out_dir]   (default assets/images). Needs Pillow and Noto Sans Bold.
"""
import math
import sys
from PIL import Image, ImageDraw, ImageFont

OUT = sys.argv[1] if len(sys.argv) > 1 else "assets/images"
ORANGE = (255, 106, 26, 255)
INK = (20, 10, 3, 255)  # onPrimary
BG = (11, 13, 16, 255)  # dark background
WHITE = (242, 244, 247, 255)
SS = 4  # supersampling for smooth edges
FONT = "/usr/share/fonts/truetype/noto/NotoSans-Bold.ttf"


def gauge(draw, cx, cy, r, color, stroke):
    """A 240-degree speedometer arc with ticks, a needle pointing high, and a hub."""
    box = [cx - r, cy - r, cx + r, cy + r]
    draw.arc(box, start=150, end=390, fill=color, width=stroke)
    for deg in (150, 210, 270, 330, 390):
        a = math.radians(deg)
        r1, r2 = r - stroke * 1.6, r - stroke * 2.6
        draw.line([cx + r1 * math.cos(a), cy + r1 * math.sin(a), cx + r2 * math.cos(a), cy + r2 * math.sin(a)], fill=color, width=int(stroke * 0.55))
    a = math.radians(300)  # needle up and to the right, between ticks: torque
    tip = (cx + (r - stroke * 1.7) * math.cos(a), cy + (r - stroke * 1.7) * math.sin(a))
    draw.line([cx, cy, *tip], fill=color, width=int(stroke * 0.8))
    hub = stroke * 0.95
    draw.ellipse([cx - hub, cy - hub, cx + hub, cy + hub], fill=color)


def badge(size, radius_frac=0.24, glyph=INK, fill=ORANGE):
    """Rounded orange square with the gauge, at `size` px."""
    s = size * SS
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([0, 0, s - 1, s - 1], radius=int(s * radius_frac), fill=fill)
    gauge(d, s / 2, s * 0.54, s * 0.32, glyph, int(s * 0.075))
    return img.resize((size, size), Image.LANCZOS)


def glyph_only(size, scale, color):
    """Just the gauge, centred, for adaptive-icon foregrounds."""
    s = size * SS
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    gauge(d, s / 2, s * 0.53, s * scale, color, int(s * scale * 0.23))
    return img.resize((size, size), Image.LANCZOS)


# Splash: badge above the wordmark, on transparent; the splash background colour fills the rest.
W, H = 1200, 1200
splash = Image.new("RGBA", (W, H), (0, 0, 0, 0))
mark = badge(520)
splash.alpha_composite(mark, ((W - 520) // 2, 170))
font = ImageFont.truetype(FONT, 150)
d = ImageDraw.Draw(splash)
torq, drop = "Torq", "Drop"
wt, wd = d.textlength(torq, font=font), d.textlength(drop, font=font)
x = (W - (wt + wd)) / 2
d.text((x, 760), torq, font=font, fill=WHITE)
d.text((x + wt, 760), drop, font=font, fill=ORANGE)
splash.save(f"{OUT}/splash-icon.png")

# iOS / store icon: full-bleed orange (iOS rounds the corners itself).
icon = Image.new("RGBA", (1024, 1024), ORANGE)
icon.alpha_composite(badge(1024, radius_frac=0))
icon.convert("RGB").save(f"{OUT}/icon.png")

# Android adaptive icon: orange background, dark gauge inside the 66% safe zone, white monochrome.
Image.new("RGBA", (1024, 1024), ORANGE).save(f"{OUT}/android-icon-background.png")
glyph_only(1024, 0.22, INK).save(f"{OUT}/android-icon-foreground.png")
glyph_only(1024, 0.22, (255, 255, 255, 255)).save(f"{OUT}/android-icon-monochrome.png")

# Web favicon.
badge(48).save(f"{OUT}/favicon.png")

# Preview on the real splash background, for checking only.
preview = Image.new("RGBA", (W, H), BG)
preview.alpha_composite(splash)
preview.convert("RGB").save("/tmp/torqdrop-splash-preview.png")
print("ok")
