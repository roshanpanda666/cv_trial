"""Generates the toolbar icons (a hanger on a gradient tile). Run: python3 scripts/make-icons.py"""
from pathlib import Path
from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / "public" / "icon"
S = 512  # draw large, downscale for smooth edges

def make() -> Image.Image:
    grad = Image.new("RGB", (S, S))
    px = grad.load()
    a, b = (217, 70, 239), (124, 58, 237)  # fuchsia-500 -> violet-600
    for y in range(S):
        for x in range(S):
            t = (x + y) / (2 * S)
            px[x, y] = tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))
    mask = Image.new("L", (S, S), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, S - 1, S - 1), radius=S // 5, fill=255)
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    img.paste(grad, (0, 0), mask)

    d = ImageDraw.Draw(img)
    w = S // 16
    white = (255, 255, 255, 255)
    # hanger hook
    d.arc((S * 0.40, S * 0.16, S * 0.60, S * 0.36), start=180, end=90, fill=white, width=w)
    d.line((S * 0.5, S * 0.36, S * 0.5, S * 0.42), fill=white, width=w)
    # hanger body
    d.line((S * 0.5, S * 0.42, S * 0.16, S * 0.70), fill=white, width=w)
    d.line((S * 0.5, S * 0.42, S * 0.84, S * 0.70), fill=white, width=w)
    d.line((S * 0.16, S * 0.70, S * 0.84, S * 0.70), fill=white, width=w)
    for cx in (S * 0.16, S * 0.84):
        d.ellipse((cx - w / 2, S * 0.70 - w / 2, cx + w / 2, S * 0.70 + w / 2), fill=white)
    return img

OUT.mkdir(parents=True, exist_ok=True)
big = make()
for size in (16, 32, 48, 96, 128):
    big.resize((size, size), Image.LANCZOS).save(OUT / f"{size}.png")
print("icons written to", OUT)
