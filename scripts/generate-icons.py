"""Regenerate committed PWA icons with Python + Pillow (not needed to build)."""
from pathlib import Path
from PIL import Image, ImageDraw

root = Path(__file__).resolve().parent.parent / 'public' / 'icons'
root.mkdir(parents=True, exist_ok=True)
for name, size, maskable in [('icon-192.png', 192, False), ('icon-512.png', 512, False), ('maskable-512.png', 512, True), ('apple-touch-icon.png', 180, False)]:
    canvas = Image.new('RGB', (1024, 1024), '#3964fe')
    draw = ImageDraw.Draw(canvas)
    draw.line([(300, 355), (455, 510), (300, 665)], fill='white', width=70, joint='curve')
    draw.line([(565, 660), (750, 660)], fill='white', width=70)
    for x, y in [(300, 355), (300, 665), (565, 660), (750, 660)]:
        draw.ellipse((x-35, y-35, x+35, y+35), fill='white')
    canvas.resize((size, size), Image.Resampling.LANCZOS).save(root / name, optimize=True)
