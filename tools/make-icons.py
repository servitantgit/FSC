"""Генерація PNG-іконок для PWA «Дитячий розклад».

Дизайн: велика літера «Р» на градієнті синього кольору (акцент застосунку).
Без зовнішніх залежностей — тільки stdlib.

Запуск:
    cd tools
    python3 make-icons.py

Створює icons/ у корені репозиторію:
    icons/icon-192.png
    icons/icon-512.png
    icons/icon-512-maskable.png
    icons/apple-touch-icon.png (180x180)
    icons/favicon.png (64x64)
"""

import os
import struct
import zlib


# ---------- PNG (мінімальний енкодер, без залежностей) ----------

def make_png(size, pixels):
    """pixels — список рядків, кожен рядок список (r,g,b,a)."""

    def chunk(tag, data):
        c = struct.pack('>I', len(data)) + tag + data
        return c + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff)

    raw = b''
    for row in pixels:
        raw += b'\x00'  # тип фільтра = 0 (None)
        for r, g, b, a in row:
            raw += struct.pack('BBBB', r, g, b, a)

    ihdr = struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0)
    return (b'\x89PNG\r\n\x1a\n'
            + chunk(b'IHDR', ihdr)
            + chunk(b'IDAT', zlib.compress(raw, 9))
            + chunk(b'IEND', b''))


# ---------- Утиліти ----------

def lerp(a, b, t):
    return int(a + (b - a) * t)


def blend(dst, src):
    """Змішування src (з альфою) поверх dst (непрозорий)."""
    sa = src[3] / 255.0
    return (
        int(dst[0] * (1 - sa) + src[0] * sa),
        int(dst[1] * (1 - sa) + src[1] * sa),
        int(dst[2] * (1 - sa) + src[2] * sa),
        255,
    )


def inside_rounded_rect(x, y, x0, y0, x1, y1, r):
    if x < x0 or x > x1 or y < y0 or y > y1:
        return False
    cx = max(x0 + r, min(x, x1 - r))
    cy = max(y0 + r, min(y, y1 - r))
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r


# ---------- Гліф літери «Р» ----------
# Конструкція: вертикальна ніжка на всю висоту + петля-«стадіон»
# (пряма ліва сторона, півколо праворуч) з отвором такої самої форми,
# що дає рівномірну товщину штриха по всьому контуру петлі.

def inside_stadium(x, y, x0, y0, x1, y1):
    """Форма з прямою лівою стороною і напівколом праворуч.
    Прямокутник [x0,x1]x[y0,y1], права межа заокруглена радіусом (y1-y0)/2.
    """
    if y1 <= y0 or x1 <= x0:
        return False
    r = (y1 - y0) / 2.0
    cy = (y0 + y1) / 2.0
    straight_x1 = x1 - r
    if x < x0:
        return False
    if x <= straight_x1:
        return y0 <= y <= y1
    cx = straight_x1
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r


def inside_letter_R(px, py, x0, y0, size):
    """px,py — глобальні пікселі; x0,y0,size — область для літери."""
    # локальні координати в межах гліфа [0..1]
    u = (px - x0) / size
    v = (py - y0) / size
    if u < 0 or u > 1 or v < 0 or v > 1:
        return False

    # Вертикальна ніжка на всю висоту
    stem_left = 0.20
    stem_right = 0.40
    if stem_left <= u <= stem_right and 0.02 <= v <= 0.98:
        return True

    # Петля (bowl) зверху: зовнішній і внутрішній «стадіон»
    # з однаковою товщиною штриха по всьому контуру.
    bowl_top = 0.03
    bowl_bottom = 0.58
    outer_right = 0.85
    stroke = 0.17

    outer = inside_stadium(u, v, stem_left, bowl_top, outer_right, bowl_bottom)
    inner = inside_stadium(
        u, v,
        stem_right, bowl_top + stroke,
        outer_right - stroke, bowl_bottom - stroke,
    )

    if outer and not inner:
        return True

    return False


# ---------- Рендер ----------

def render_icon(size, maskable=False):
    """Малює квадратну іконку size x size."""

    # Для maskable — safe zone: усе важливе в межах центральних ~80%
    # (icon має «повне полотно», але край може обрізатись у різних масках).
    m = int(size * 0.10) if maskable else 0

    # Кольори градієнту (акцент застосунку -> темніший синій)
    top_color = (0x4C, 0x8D, 0xF6)     # --accent
    bottom_color = (0x1E, 0x3C, 0x72)  # темний синій

    # Дефолтний радіус скруглення (не використовується для maskable,
    # бо OS сама обріже під свою маску)
    corner = int(size * 0.22) if not maskable else 0

    # Область для літери
    letter_size = int(size * (0.60 if not maskable else 0.55))
    letter_x0 = (size - letter_size) // 2
    letter_y0 = (size - letter_size) // 2

    letter_color = (0xFF, 0xFF, 0xFF, 255)
    shadow_color = (0x00, 0x00, 0x00, 60)
    shadow_offset = max(1, size // 128)

    px = []
    for y in range(size):
        row = []
        for x in range(size):
            # Прозорий фон, якщо не потрапляємо у скруглений прямокутник
            if not maskable:
                if not inside_rounded_rect(x, y, 0, 0, size - 1, size - 1, corner):
                    row.append((0, 0, 0, 0))
                    continue

            # Градієнт зверху донизу
            t = y / max(1, size - 1)
            r = lerp(top_color[0], bottom_color[0], t)
            g = lerp(top_color[1], bottom_color[1], t)
            b = lerp(top_color[2], bottom_color[2], t)
            pixel = (r, g, b, 255)

            # Тінь літери
            if inside_letter_R(x - shadow_offset, y - shadow_offset,
                               letter_x0, letter_y0, letter_size):
                pixel = blend(pixel, shadow_color)

            # Сама літера
            if inside_letter_R(x, y, letter_x0, letter_y0, letter_size):
                pixel = blend(pixel, letter_color)

            row.append(pixel)
        px.append(row)

    return px


# ---------- Головна ----------

def main():
    # Шлях: скрипт лежить у tools/, іконки — в корені у icons/
    script_dir = os.path.dirname(os.path.abspath(__file__))
    root = os.path.abspath(os.path.join(script_dir, os.pardir))
    icons_dir = os.path.join(root, 'icons')
    os.makedirs(icons_dir, exist_ok=True)

    outputs = [
        (192, 'icon-192.png', False),
        (512, 'icon-512.png', False),
        (512, 'icon-512-maskable.png', True),
        (180, 'apple-touch-icon.png', False),
        (64, 'favicon.png', False),
    ]

    for size, name, maskable in outputs:
        path = os.path.join(icons_dir, name)
        with open(path, 'wb') as f:
            f.write(make_png(size, render_icon(size, maskable)))
        rel = os.path.relpath(path, root)
        kind = ' (maskable)' if maskable else ''
        print(f'{rel} -> OK ({size}x{size}){kind}')

    print('ALL_ICONS_OK')


if __name__ == '__main__':
    main()