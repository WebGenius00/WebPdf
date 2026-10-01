"""
Rendu PDF : Doc JSON (sortie de structurizer.py) → HTML sémantique → PDF (WeasyPrint).

Qualité éditoriale visée :
  - Page de titre, table des matières paginée automatiquement (CSS target-counter)
  - Hiérarchie visuelle H1/H2/H3, aération, veuves/orphelines corrigées
  - Encadrés (note / astuce / warning), listes, tableaux zébrés, blocs code
  - Pieds de page avec pagination "Page X sur Y"
Entrées (mutuellement exclusives) :
  python3 renderer.py --stdin out.pdf            ← pipeline HTTP (doc sur stdin)
  python3 renderer.py doc.json out.pdf           ← usage CLI / debug
Options :
  --theme {editorial|corporate|academic}         ← palette typographique
  --paper {a4|letter}                            ← format de page
  --css theme.css                                ← CSS additionnel (personnalisation)
"""

from __future__ import annotations

import html
import json
import sys
from typing import Any

DEFAULT_CSS = """
@page {
  size: A4;
  margin: 26mm 21mm 24mm;
  @top-left {
    content: "PDF STUDIO";
    font: 700 7.5pt 'Liberation Sans', 'Nimbus Sans', Arial, sans-serif;
    letter-spacing: 1pt; color: #4f46e5;
    vertical-align: bottom; padding-bottom: 2.2mm;
    border-bottom: 0.6pt solid #dbe2ea;
  }
  @top-right {
    content: string(sectiontitle);
    font: 8pt 'Liberation Sans', 'Nimbus Sans', Arial, sans-serif;
    color: #64748b; text-align: right;
    vertical-align: bottom; padding-bottom: 2.2mm;
    border-bottom: 0.6pt solid #dbe2ea;
  }
  @bottom-left {
    content: string(doctitle);
    font: 8pt 'Liberation Sans', 'Nimbus Sans', Arial, sans-serif;
    color: #7b8495;
    vertical-align: top; padding-top: 2.2mm;
    border-top: 0.6pt solid #dbe2ea;
  }
  @bottom-right {
    content: "Page " counter(page) " sur " counter(pages);
    font: 8pt 'Liberation Sans', 'Nimbus Sans', Arial, sans-serif;
    color: #475569; text-align: right;
    vertical-align: top; padding-top: 2.2mm;
    border-top: 0.6pt solid #dbe2ea;
  }
}
@page :first {
  margin: 22mm 21mm;
  @top-left { content: none; border: 0; }
  @top-right { content: none; border: 0; }
  @bottom-left { content: none; border: 0; }
  @bottom-right { content: none; border: 0; }
}

html {
  font-family: 'Liberation Serif', 'Nimbus Roman', Georgia, serif;
  font-size: 10.7pt; color: #253044;
}
body { line-height: 1.62; }

/* ---------- Page de titre ---------- */
.cover { page: cover; text-align: center; padding: 42% 10mm 0; break-after: page; }
.cover::before {
  content: "PDF STUDIO"; display: block; margin-bottom: 11mm;
  font: 700 8pt 'Liberation Sans', 'Nimbus Sans', Arial, sans-serif;
  letter-spacing: 1.6pt; color: #4f46e5;
}
.cover h1.doc-title {
  font: 700 29pt/1.16 'Liberation Serif', 'Nimbus Roman', Georgia, serif;
  color: #172033; border: none; margin: 0 0 6mm;
  break-before: auto; string-set: doctitle content();
}
.cover h1.doc-title::after {
  content: ""; display: block; width: 18mm;
  border-top: 2.5pt solid #4f46e5; margin: 7mm auto 0;
}
.cover .author { font-size: 12pt; color: #64748b; font-style: italic; }
.cover .date { font-size: 9.5pt; color: #8b95a7; margin-top: 4mm; }

/* ---------- Sommaire ---------- */
nav.toc { break-after: page; }
nav.toc h2 {
  font: 700 21pt/1.2 'Liberation Serif', 'Nimbus Roman', Georgia, serif;
  color: #172033; margin: 0 0 8mm; padding-bottom: 3mm;
  border-bottom: 1pt solid #dbe2ea;
}
nav.toc ul { list-style: none; padding: 0; margin: 0; }
nav.toc li { margin: 2.2mm 0; font-size: 10pt; line-height: 1.45; }
nav.toc li.l2 { padding-left: 7mm; color: #475569; }
nav.toc li.l3 { padding-left: 14mm; color: #64748b; font-size: 9.5pt; }
nav.toc a { text-decoration: none; color: inherit; }
nav.toc a::after {
  content: leader('.') target-counter(attr(href), page);
  color: #94a3b8;
}

/* ---------- Titres ---------- */
h1, h2, h3 {
  font-family: 'Liberation Sans', 'Nimbus Sans', Arial, sans-serif;
  color: #172033; break-after: avoid;
}
h1 {
  font-size: 18pt; font-weight: 700; line-height: 1.22;
  border-bottom: 0.9pt solid #cbd5e1; padding-bottom: 2.8mm;
  margin: 10mm 0 5mm; break-before: page;
  string-set: sectiontitle content();
}
h1.first { break-before: auto; }
h2 { font-size: 14pt; line-height: 1.28; margin: 7mm 0 3mm; color: #334155; }
h3 { font-size: 11pt; line-height: 1.3; margin: 5mm 0 2.5mm; color: #475569; }
.heading-number { color: #4f46e5; margin-right: 2.5mm; font-weight: 600; }

/* ---------- Paragraphes & listes ---------- */
p { margin: 0 0 3.8mm; text-align: justify; orphans: 2; widows: 2; hyphens: auto; }
ul, ol { margin: 0 0 4mm; padding-left: 7mm; }
li { margin-bottom: 1.4mm; }
li::marker { color: #4f46e5; }

/* ---------- Définitions ---------- */
dl dt { font-weight: bold; color: #172033; margin-top: 2.5mm; }
dl dd { margin: 0 0 2mm 6mm; color: #475569; }

/* ---------- Tableaux ---------- */
table { border-collapse: collapse; width: 100%; margin: 4mm 0; font-size: 9.5pt; break-inside: auto; }
thead { display: table-header-group; }
th {
  background: #263774; color: white;
  font: 700 8.5pt 'Liberation Sans', 'Nimbus Sans', Arial, sans-serif;
  letter-spacing: 0.2pt;
}
th, td { border: 0.5pt solid #d6deea; padding: 2mm 2.5mm; text-align: left; }
tbody tr:nth-child(even) { background: #f4f6fa; }
tr { break-inside: avoid; }

/* ---------- Encadrés ---------- */
.callout { border-left: 3pt solid #4f46e5; background: #f3f4ff; padding: 3.5mm 4mm; margin: 4mm 0; break-inside: avoid; font-size: 10pt; }
.callout.note    { border-color: #0e7490; background: #ecfeff; }
.callout.warning { border-color: #d97706; background: #fffbeb; }
.callout.info    { border-color: #4f46e5; background: #f3f4ff; }
.callout .label {
  font: 700 8pt 'Liberation Sans', 'Nimbus Sans', Arial, sans-serif;
  text-transform: uppercase; letter-spacing: 0.5pt;
  display: block; margin-bottom: 1mm; color: #475569;
}

/* ---------- Code ---------- */
pre.code { font-family: 'Liberation Mono', 'Nimbus Mono PS', monospace; font-size: 8.8pt; background: #f6f7fb;
           border: 0.5pt solid #dbe2ea; border-radius: 2mm; padding: 3mm; margin: 3.5mm 0;
           white-space: pre-wrap; word-break: break-word; break-inside: avoid; }
"""


def esc(s: str) -> str:
    return html.escape(s, quote=False)


def inline_markup(s: str) -> str:
    """Markdown inline minimal : **gras**, *italie*, `code`."""
    out = esc(s)
    out = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", out)
    out = re.sub(r"(?<!\*)\*([^*]+?)\*(?!\*)", r"<em>\1</em>", out)
    out = re.sub(r"`([^`]+?)`", r"<code>\1</code>", out)
    return out


import re  # noqa: E402  (utilisé par inline_markup)


def render_block(b: dict[str, Any], first_h1_done: bool) -> tuple[str, bool]:
    t = b["type"]
    if t == "heading":
        lvl = b["level"]
        num = b.get("number")
        anchor = f' id="{b["id"]}"' if b.get("id") else ""
        num_html = f'<span class="heading-number">{num}</span>' if num and lvl > 1 else ""
        cls = ' class="first"' if (lvl == 1 and not first_h1_done) else ""
        note_first = lvl == 1 and not first_h1_done
        return f"<h{lvl}{anchor}{cls}>{num_html}{inline_markup(b['text'])}</h{lvl}>", note_first
    if t == "paragraph":
        return f"<p>{inline_markup(b['text'])}</p>", first_h1_done
    if t == "list":
        tag = "ol" if b.get("ordered") else "ul"
        items = "".join(f"<li>{inline_markup(i)}</li>" for i in b["items"])
        return f"<{tag}>{items}</{tag}>", first_h1_done
    if t == "definition":
        return f"<dl><dt>{inline_markup(b['term'])}</dt><dd>{inline_markup(b['text'])}</dd></dl>", first_h1_done
    if t == "callout":
        variant = b.get("variant", "info")
        label = {"note": "Note", "warning": "Attention", "info": "À savoir"}.get(variant, "Note")
        return (f'<div class="callout {variant}"><span class="label">{label}</span>'
                f"{inline_markup(b['text'])}</div>"), first_h1_done
    if t == "table":
        head = "".join(f"<th>{inline_markup(c)}</th>" for c in b["header"])
        body = "".join(
            "<tr>" + "".join(f"<td>{inline_markup(c)}</td>" for c in row) + "</tr>"
            for row in b["rows"]
        )
        return f"<table><thead><tr>{head}</tr></thead><tbody>{body}</tbody></table>", first_h1_done
    if t == "code":
        return f'<pre class="code">{esc(b["text"])}</pre>', first_h1_done
    return "", first_h1_done


def doc_to_html(doc: dict[str, Any], css: str = DEFAULT_CSS) -> str:
    meta = doc.get("metadata", {})
    title = esc(meta.get("title", "Document"))

    cover = (
        '<section class="cover">'
        f'<h1 class="doc-title">{title}</h1>'
        + (f'<div class="author">{esc(meta["author"])}</div>' if meta.get("author") else "")
        + "</section>"
    )

    toc_items = []
    for e in doc.get("toc", []):
        toc_items.append(
            f'<li class="l{e["level"]}"><a href="#{e["id"]}">'
            f'{e["number"]}&ensp;{esc(e["text"])}</a></li>'
        )
    toc = ('<nav class="toc"><h2>Sommaire</h2><ul>' + "".join(toc_items) + "</ul></nav>") if toc_items else ""

    blocks_html = []
    first_h1_done = False
    for b in doc.get("blocks", []):
        h, first_h1_done = render_block(b, first_h1_done)
        blocks_html.append(h)

    return f"""<!DOCTYPE html>
<html lang="{meta.get('language', 'fr')}">
<head><meta charset="utf-8"><title>{title}</title><style>{css}</style></head>
<body>{cover}{toc}<main>{''.join(blocks_html)}</main></body>
</html>"""


# ---------------------------------------------------------------------------
# Thèmes & formats : surcouche CSS appliquée par-dessus DEFAULT_CSS.
# Chaque thème ne redéfinit que les tokens (couleurs/typographie) pour
# rester compatible avec les règles structurelles du CSS par défaut.
# ---------------------------------------------------------------------------

THEMES: dict[str, str] = {
    # Palette par défaut (bleu éditorial) — héritée de DEFAULT_CSS.
    "editorial": "",
    "corporate": """
h1 { border-bottom-color: #0f766e !important; }
.heading-number { color: #0f766e !important; }
h2 { color: #115e59 !important; }
th { background: #134e4a !important; }
.cover h1.doc-title { color: #0f172a; }
.cover::before { color: #0f766e; }
""",
    "academic": """
h1 { border-bottom: 1.4pt solid #111827 !important; font-variant: small-caps; }
.heading-number { color: #374151 !important; }
h2, h3 { color: #111827 !important; }
th { background: #374151 !important; }
p { text-align: justify; }
.cover h1.doc-title { font-variant: small-caps; letter-spacing: 0.5pt; }
.cover::before { color: #374151; }
""",
}

PAPERS: dict[str, str] = {
    "a4": "@page { size: A4; }",
    "letter": "@page { size: Letter; }",
}


def build_css(theme: str = "editorial", paper: str = "a4", extra: str | None = None) -> str:
    """Compose le CSS final : base + overrides format + thème + personnalisation."""
    parts = [DEFAULT_CSS, PAPERS.get(paper.lower(), ""), THEMES.get(theme.lower(), "")]
    if extra:
        parts.append(extra)
    return "\n".join(p for p in parts if p.strip())


def render_pdf(doc: dict[str, Any], out_path: str, css: str | None = None) -> str:
    """Doc JSON → PDF. `css` : CSS complet déjà composé (sinon thème editorial/A4)."""
    from weasyprint import HTML
    html_str = doc_to_html(doc, css or build_css())
    HTML(string=html_str).write_pdf(out_path)
    return out_path


def parse_args(argv: list[str]) -> dict[str, str]:
    """Mini-parseur CLI sans dépendance : positions + options nommées."""
    opts = {"theme": "editorial", "paper": "a4", "css": "", "doc": "", "out": ""}
    positional: list[str] = []
    i = 0
    while i < len(argv):
        a = argv[i]
        if a == "--theme":
            i += 1; opts["theme"] = argv[i]
        elif a == "--paper":
            i += 1; opts["paper"] = argv[i]
        elif a == "--css":
            i += 1; opts["css"] = argv[i]
        else:
            positional.append(a)
        i += 1
    if len(positional) < 2:
        raise SystemExit("Usage : renderer.py (--stdin|doc.json) out.pdf [--theme X] [--paper Y] [--css f.css]")
    opts["doc"], opts["out"] = positional[0], positional[1]
    return opts


def main() -> None:
    opts = parse_args(sys.argv[1:])
    # Source du Doc JSON : stdin (pipeline HTTP) ou fichier (CLI/debug).
    if opts["doc"] == "--stdin":
        doc = json.load(sys.stdin)
    else:
        with open(opts["doc"], encoding="utf-8") as f:
            doc = json.load(f)
    extra_css = ""
    if opts["css"]:
        with open(opts["css"], encoding="utf-8") as f:
            extra_css = f.read()
    css = build_css(opts["theme"], opts["paper"], extra_css or None)
    out = render_pdf(doc, opts["out"], css)
    print(f"PDF généré : {out}")


if __name__ == "__main__":
    main()
