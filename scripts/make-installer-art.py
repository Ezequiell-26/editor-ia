"""Genera las imagenes del instalador NSIS con la identidad visual de Editor IA.

Usa el logo real (icons/128x128.png) sobre la paleta de styles/tokens.css.

Salidas (BMP 24 bits, formato que exige NSIS):
  apps/desktop/src-tauri/installer/header.bmp    150x57   barra superior
  apps/desktop/src-tauri/installer/sidebar.bmp   164x314  panel lateral de marca

Requiere Pillow:  pip install pillow
"""

from __future__ import annotations

import os

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
OUT = os.path.join(ROOT, 'apps', 'desktop', 'src-tauri', 'installer')
LOGO = os.path.join(ROOT, 'apps', 'desktop', 'src-tauri', 'icons', '128x128.png')
os.makedirs(OUT, exist_ok=True)

BG = (7, 9, 13)
PANEL = (17, 23, 32)
PANEL_2 = (13, 18, 25)
BORDER = (35, 46, 59)
TEXT = (237, 242, 248)
MUTED = (152, 168, 186)
ACCENT = (94, 234, 212)
ACCENT_STRONG = (45, 212, 191)

FONTS = r'C:\Windows\Fonts'
REG = os.path.join(FONTS, 'segoeui.ttf')
BOLD = os.path.join(FONTS, 'segoeuib.ttf')
SEMI = os.path.join(FONTS, 'seguisb.ttf')


def font(path: str, size: int):
    for candidate in (path, REG):
        try:
            return ImageFont.truetype(candidate, size)
        except OSError:
            continue
    return ImageFont.load_default()


def vertical_gradient(size, top, bottom):
    w, h = size
    img = Image.new('RGB', (w, h), top)
    draw = ImageDraw.Draw(img)
    for y in range(h):
        t = y / max(1, h - 1)
        color = tuple(round(top[i] + (bottom[i] - top[i]) * t) for i in range(3))
        draw.line([(0, y), (w, y)], fill=color)
    return img


def paste_logo(img: Image.Image, x: int, y: int, size: int) -> None:
    """Pega el logo real recortado a un cuadrado, con esquinas redondeadas."""
    if not os.path.isfile(LOGO):
        return
    with Image.open(LOGO).convert('RGBA') as raw:
        logo = raw.resize((size, size), Image.LANCZOS)
    mask = Image.new('L', (size, size), 0)
    mask_draw = ImageDraw.Draw(mask)
    radius = max(3, size // 5)
    mask_draw.rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
    img.paste(logo, (x, y), mask)


def check(draw, x: int, y: int, color=ACCENT) -> None:
    draw.line([(x, y + 3), (x + 3, y + 6), (x + 8, y - 2)], fill=color, width=2)


# --------------------------------------------------------------------------- #
def make_header() -> None:
    w, h = 150, 57
    img = vertical_gradient((w, h), PANEL, BG)
    draw = ImageDraw.Draw(img)
    draw.line([(0, h - 1), (w, h - 1)], fill=BORDER)
    draw.rectangle([0, 0, 3, h], fill=ACCENT_STRONG)

    paste_logo(img, 9, 14, 28)
    draw.text((44, 11), 'EDITOR IA', font=font(BOLD, 16), fill=TEXT)
    draw.text((44, 30), 'instalador · v0.1.0', font=font(REG, 9), fill=MUTED)
    draw.text((44, 42), 'edicion de video local', font=font(REG, 8), fill=ACCENT)

    img.save(os.path.join(OUT, 'header.bmp'), 'BMP')


def make_sidebar() -> None:
    w, h = 164, 314
    img = vertical_gradient((w, h), PANEL_2, BG)
    draw = ImageDraw.Draw(img)

    # borde de acento
    draw.rectangle([0, 0, 3, h], fill=ACCENT_STRONG)

    # marca con el logo real
    paste_logo(img, 16, 16, 34)
    draw.text((58, 18), 'EDITOR IA', font=font(BOLD, 15), fill=TEXT)
    draw.text((58, 36), 'v0.1.0', font=font(REG, 9), fill=MUTED)

    draw.line([(16, 60), (w - 16, 60)], fill=BORDER)
    draw.text((16, 68), 'ESTO SE INSTALA', font=font(SEMI, 8), fill=ACCENT)

    items = [
        'Editor de video multipista',
        'FFmpeg y FFprobe incluidos',
        'yt-dlp listo para usar',
        'Subtitulos, guion y voz IA',
        'Render local verificado',
        'Servidores MCP',
        'Extension de Chrome',
    ]
    y = 84
    for item in items:
        check(draw, 16, y + 4)
        draw.text((30, y), item, font=font(REG, 8.5), fill=TEXT)
        y += 16

    draw.line([(16, h - 78), (w - 16, h - 78)], fill=BORDER)
    draw.text((16, h - 70), 'SIN CUENTA · SIN NUBE', font=font(SEMI, 7), fill=ACCENT)
    draw.text((16, h - 58), 'Windows 10/11 · 64 bits', font=font(REG, 8), fill=MUTED)
    draw.text((16, h - 46), 'WebView2 (se instala si falta)', font=font(REG, 8), fill=MUTED)
    draw.text(
        (16, h - 32),
        'Incluye FFmpeg (GPL) y yt-dlp',
        font=font(REG, 7),
        fill=(110, 124, 140),
    )
    draw.text(
        (16, h - 22),
        '(Unlicense). Licencias en la web',
        font=font(REG, 7),
        fill=(110, 124, 140),
    )
    draw.text(
        (16, h - 10),
        'de cada proyecto.',
        font=font(REG, 7),
        fill=(110, 124, 140),
    )

    img.save(os.path.join(OUT, 'sidebar.bmp'), 'BMP')


if __name__ == '__main__':
    make_header()
    make_sidebar()
    for name in ('header.bmp', 'sidebar.bmp'):
        p = os.path.join(OUT, name)
        with Image.open(p) as im:
            print(f'{name}: {im.size[0]}x{im.size[1]} {im.mode} {os.path.getsize(p)} bytes')
