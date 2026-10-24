#!/usr/bin/env python3
"""Draw the placeholder launcher icon (original design: a jet flame under a
round helmet) at every Android density. Replace with real art later."""
import os, sys
from PIL import Image, ImageDraw

SIZES = {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}
out = sys.argv[1]
for density, px in SIZES.items():
    s = px * 4  # draw large, then downscale for smooth edges
    im = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.rounded_rectangle([0, 0, s - 1, s - 1], radius=s // 5, fill=(29, 43, 68, 255))
    cx = s // 2
    d.polygon([(cx - s * 0.12, s * 0.62), (cx + s * 0.12, s * 0.62), (cx, s * 0.92)], fill=(255, 170, 60, 255))
    d.ellipse([cx - s * 0.24, s * 0.22, cx + s * 0.24, s * 0.68], fill=(224, 184, 79, 255))
    d.rectangle([cx - s * 0.26, s * 0.36, cx + s * 0.26, s * 0.44], fill=(29, 43, 68, 255))
    im = im.resize((px, px), Image.LANCZOS)
    path = os.path.join(out, "mipmap-" + density)
    os.makedirs(path, exist_ok=True)
    im.save(os.path.join(path, "ic_launcher.png"))
