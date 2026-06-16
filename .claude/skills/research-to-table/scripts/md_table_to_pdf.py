#!/usr/bin/env python3
"""Convert a Markdown file (with tables) into a landscape-A4 PDF — no browser, no network.

Why this exists: in sandboxed/remote environments you often can't download headless Chromium
(blocked CDN) or install wkhtmltopdf/weasyprint (no apt). This path uses only pip packages
(`markdown` + `fpdf2`) plus the system DejaVu fonts, so it works almost anywhere.

Usage:
    pip install markdown fpdf2
    python md_table_to_pdf.py INPUT.md OUTPUT.pdf
"""
import sys
import os
import re
import markdown
from fpdf import FPDF

FONT_CANDIDATES = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/TTF/DejaVuSans.ttf",
    "/Library/Fonts/Arial Unicode.ttf",
]

# glyphs not present in DejaVu Sans -> supported equivalents (extend as needed)
GLYPH_FIX = {"⭐": "★", "✅": "✓", "⬜": "", "⏳": "", "◐": ""}


def _find_font():
    for p in FONT_CANDIDATES:
        if os.path.exists(p):
            return p
    return None


def convert(src, out):
    text = open(src, encoding="utf-8").read()
    for a, b in GLYPH_FIX.items():
        text = text.replace(a, b)

    html = markdown.markdown(text, extensions=["tables", "fenced_code", "sane_lists"])

    # Give the first table reasonable column widths for landscape (small first col if it's an index).
    m = re.search(r"<thead>.*?</thead>", html, flags=re.S)
    if m:
        head = m.group(0)
        n = len(re.findall(r"<th", head))
        if n:
            index_first = bool(re.search(r"<th>\s*(#|id|n[ºo]\.?|item)\s*</th>", head, re.I))
            if index_first and n > 1:
                widths = [5] + [round(95 / (n - 1))] * (n - 1)
            else:
                widths = [round(100 / n)] * n
            idx = [0]

            def repl(mm):
                w = widths[idx[0]] if idx[0] < len(widths) else None
                idx[0] += 1
                return f'<th width="{w}%">' if w else "<th>"

            html = html.replace(head, re.sub(r"<th>", repl, head), 1)

    # fpdf2's write_html cannot render <strong>/<em> nested INSIDE table cells -> unwrap them there
    # (bold/italics in normal paragraphs are kept).
    def _unwrap(seg):
        return re.sub(r"</?(strong|em|b|i|code)\b[^>]*>", "", seg)

    html = re.sub(
        r"(<t[dh][^>]*>)(.*?)(</t[dh]>)",
        lambda mm: mm.group(1) + _unwrap(mm.group(2)) + mm.group(3),
        html,
        flags=re.S,
    )

    reg = _find_font()
    family = "DejaVu" if reg else "helvetica"
    if reg:
        bold = reg.replace("DejaVuSans.ttf", "DejaVuSans-Bold.ttf")
        if not os.path.exists(bold):
            bold = reg
        html = f'<font face="DejaVu">{html}</font>'

    pdf = FPDF(orientation="L", unit="mm", format="A4")
    if reg:
        pdf.add_font("DejaVu", "", reg)
        pdf.add_font("DejaVu", "B", bold)
        pdf.add_font("DejaVu", "I", reg)   # synthetic italic (DejaVu Oblique often absent)
        pdf.add_font("DejaVu", "BI", bold)
    pdf.set_auto_page_break(True, margin=12)
    pdf.set_margins(10, 10, 10)
    pdf.add_page()
    pdf.set_font(family, size=8.5)
    pdf.write_html(html, table_line_separators=True)
    pdf.output(out)
    print(f"PDF written: {out} ({os.path.getsize(out)} bytes, {pdf.pages_count} pages)")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print(__doc__)
        sys.exit(1)
    convert(sys.argv[1], sys.argv[2])
