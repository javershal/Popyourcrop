#!/usr/bin/env python3
"""
Pack one day's photo into a self-contained index.html.

  python3 tools/pack.py photos/beach.jpg
  python3 tools/pack.py photos/beach.jpg --date 2026-08-25
  python3 tools/pack.py --placeholder

Reads app.html (the editable source, no image data in it), splices the day's
image in as a base64 data: URI, writes dist/index.html.

Why base64 and not a sibling <img src="beach.jpg"> (§4): an image loaded from a
different origin -- or from file:// -- taints the canvas, and canvas.toBlob()
then throws a SecurityError. That produces NO cropped output at all, and it
fails at the very last step of the flow, after the player has done all the work.
Data URIs are same-origin by definition and do not taint.

One day per file (deliberate): a 30-day date->image map runs 15-90 MB of base64
depending on photo detail, which is not an openable file on a phone. This keeps
each build at 1-3 MB. A useful side effect is that clock skew can no longer show
a tester a *different photo* than their group chat -- there is only one photo in
the file -- so §4's open question shrinks to just the day label and lock key.
"""

import argparse
import base64
import datetime
import io
import os
import random
import re
import sys

try:
    from PIL import Image, ImageOps, ImageDraw
except ImportError:
    sys.exit("Pillow is required:  python3 -m pip install --user Pillow")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TEMPLATE = os.path.join(ROOT, "app.html")
OUT_DIR = os.path.join(ROOT, "dist")
OUT = os.path.join(OUT_DIR, "index.html")

START = "/* IMAGE_DATA_START */"
END = "/* IMAGE_DATA_END */"

LONG_EDGE = 3000      # §4 -- enough that a zoomed crop still looks good
QUALITY = 82


def today_pacific():
    """Day id in America/Los_Angeles (§4).

    zoneinfo is stdlib on 3.9+. On older interpreters fall back to the system
    clock and say so, rather than hardcoding a UTC offset -- Pacific is UTC-8
    for part of the year and UTC-7 for the rest, and offset math silently
    shifts the rollover twice a year.
    """
    try:
        from zoneinfo import ZoneInfo
        return datetime.datetime.now(ZoneInfo("America/Los_Angeles")).strftime("%Y-%m-%d")
    except ImportError:
        pass
    try:
        import pytz
        return datetime.datetime.now(pytz.timezone("America/Los_Angeles")).strftime("%Y-%m-%d")
    except ImportError:
        print("  ! no zoneinfo/pytz -- using local system date for the default",
              file=sys.stderr)
        return datetime.date.today().strftime("%Y-%m-%d")


def make_placeholder():
    """Synthetic stand-in with detail at several scales, so zoom bounds and
    framing are actually testable before real photos land."""
    random.seed(11)
    w, h = LONG_EDGE, int(LONG_EDGE * 2 / 3)
    im = Image.new("RGB", (w, h))
    d = ImageDraw.Draw(im)
    for y in range(0, h, 3):
        t = y / h
        d.rectangle([0, y, w, y + 3],
                    fill=(int(28 + 120 * t), int(52 + 90 * t), int(130 - 50 * t)))
    # coarse -> fine, so there is something to see at every zoom level
    for radius, count in ((260, 14), (90, 60), (30, 260), (9, 1400), (3, 5000)):
        for _ in range(count):
            x, y = random.randrange(w), random.randrange(h)
            c = tuple(random.randrange(35, 245) for _ in range(3))
            d.ellipse([x - radius, y - radius, x + radius, y + radius], fill=c)
    for i in range(1, 3):
        d.line([(i * w // 3, 0), (i * w // 3, h)], fill=(255, 255, 255), width=3)
        d.line([(0, i * h // 3), (w, i * h // 3)], fill=(255, 255, 255), width=3)
    return im


def load(path):
    try:
        im = Image.open(path)
    except OSError as e:
        if path.lower().endswith((".heic", ".heif")):
            sys.exit(
                "HEIC is not readable by this Pillow build. Convert first:\n"
                "  heif-convert in.heic out.jpg      (libheif-examples)\n"
                "  or export as JPEG from Photos.")
        sys.exit("could not open %s: %s" % (path, e))
    # iPhone photos carry EXIF orientation; without this, portraits pack sideways
    # and every crop coordinate is computed against a rotated source.
    im = ImageOps.exif_transpose(im)
    return im.convert("RGB")


def pack(im, quality=QUALITY, long_edge=LONG_EDGE):
    if max(im.size) > long_edge:
        scale = long_edge / float(max(im.size))
        im = im.resize((max(1, int(round(im.width * scale))),
                        max(1, int(round(im.height * scale)))), Image.LANCZOS)
    buf = io.BytesIO()
    # strip EXIF on save -- the transpose above already baked in orientation,
    # and personal photos carry GPS tags we should not be publishing.
    im.save(buf, "JPEG", quality=quality, optimize=True, progressive=True)
    return im, buf.getvalue()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("photo", nargs="?", help="source image (jpg/png)")
    ap.add_argument("--placeholder", action="store_true",
                    help="use a generated test image instead of a photo")
    ap.add_argument("--date", help="day id to bind this image to (YYYY-MM-DD)")
    ap.add_argument("--quality", type=int, default=QUALITY)
    ap.add_argument("--long-edge", type=int, default=LONG_EDGE)
    a = ap.parse_args()

    if not a.photo and not a.placeholder:
        ap.error("give a photo path, or --placeholder")

    day = a.date or today_pacific()
    if not re.match(r"^\d{4}-\d{2}-\d{2}$", day):
        sys.exit("--date must be YYYY-MM-DD, got %r" % day)

    im = make_placeholder() if a.placeholder else load(a.photo)
    src_size = im.size
    im, jpeg = pack(im, a.quality, a.long_edge)
    b64 = base64.b64encode(jpeg).decode("ascii")

    if not os.path.exists(TEMPLATE):
        sys.exit("missing template: %s" % TEMPLATE)
    html = open(TEMPLATE, encoding="utf-8").read()
    if START not in html or END not in html:
        sys.exit("template is missing the %s / %s markers" % (START, END))

    block = (
        "%s\n"
        "  // generated by tools/pack.py -- do not edit by hand\n"
        "  var DAY = {\n"
        "    id: %r,\n"
        "    w: %d,\n"
        "    h: %d,\n"
        "    src: 'data:image/jpeg;base64,%s'\n"
        "  };\n"
        "  %s" % (START, day, im.width, im.height, b64, END)
    )
    html = re.sub(re.escape(START) + r".*?" + re.escape(END), lambda m: block,
                  html, flags=re.S)

    os.makedirs(OUT_DIR, exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        f.write(html)

    size = os.path.getsize(OUT)
    print("  day        %s" % day)
    print("  source     %dx%d -> %dx%d" % (src_size[0], src_size[1], im.width, im.height))
    print("  jpeg       %.2f MB  (q%d)" % (len(jpeg) / 1e6, a.quality))
    print("  index.html %.2f MB" % (size / 1e6))
    print("  -> %s" % OUT)
    if size > 6e6:
        print("  ! over 6 MB -- slow on mobile data. Try --quality 75 or --long-edge 2400.")

    # §5.3 -- max zoom is derived from a minimum acceptable OUTPUT dimension, so
    # a small source silently collapses the zoom range: the cap lands below
    # fit-to-frame, app.html clamps max down to min, and the crop tool stops
    # being able to crop. Catch that here rather than on a tester's phone.
    MIN_OUT = 900          # keep in step with CFG.minOutPx in app.html
    short = min(im.width, im.height)
    if short < MIN_OUT * 1.5:
        usable = short / float(MIN_OUT)
        print("")
        print("  ! SOURCE TOO SMALL -- short edge %dpx" % short)
        if usable <= 1.0:
            print("    Zoom will be DISABLED. The output cap (%dpx) sits below fit-to-frame,"
                  % MIN_OUT)
            print("    so there is no legal zoom range at all and the crop cannot move.")
        else:
            print("    Only ~%.1fx zoom available before the %dpx output floor."
                  % (usable, MIN_OUT))
        print("    §4 wants ~3000px on the long edge. Either use a bigger photo, or drop")
        print("    'min out px' in the dev panel to ~%d to make this one testable"
              % max(120, int(short / 2.5)))
        print("    (shared output will be small and soft at that setting).")


if __name__ == "__main__":
    main()
