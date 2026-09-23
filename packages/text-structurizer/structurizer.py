"""
Moteur de structuration de texte brut → document structuré (schéma JSON "Doc").

Pipeline :
  1. normalize()      — nettoyage, unification des sauts de ligne, espaces
  2. split_blocks()   — découpage en blocs (paragraphes, listes, code, titres…)
  3. classify()       — détection hiérarchie de titres (T1 > T2 > T3) + listes + encadrés
  4. build_document() — assemblage du Doc JSON + table des matières

Aucune dépendance externe (stdlib uniquement) pour rester testable partout.
Le schéma de sortie est le contrat partagé avec le backend Node (pdf-renderer).
"""

from __future__ import annotations

import json
import re
import unicodedata
from dataclasses import dataclass, field
from typing import Optional

SCHEMA_VERSION = "doc/0.1"


# --------------------------------------------------------------------------
# 1. Normalisation typographique
# --------------------------------------------------------------------------

def normalize(text: str) -> str:
    """Nettoie le texte brut : fins de ligne, guillemets, tirets, espaces."""
    # Unify line endings
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    # Strip trailing spaces on each line
    text = "\n".join(line.rstrip() for line in text.split("\n"))
    # Collapse 3+ blank lines to max 2
    text = re.sub(r"\n{3,}", "\n\n", text)
    # Typographic niceties (French-friendly)
    text = text.replace("...", "…")
    text = re.sub(r"(?<=\s)--(?=\s)", "—", text)   # standalone -- → em dash
    text = re.sub(r'(^|\s)"', "\\1« ", text)        # straight quotes → « »
    text = re.sub(r'"(\s|$)', " »\\1", text)
    # Non-breaking space before ; ! ? (typographie française)
    text = re.sub(r"\s+([;!?\u00a0!])", "\u00a0\\1", text)
    return text.strip()


# --------------------------------------------------------------------------
# 2. Découpage en blocs bruts
# --------------------------------------------------------------------------

@dataclass
class RawLine:
    text: str
    number: int


def _lines(text: str) -> list[RawLine]:
    return [RawLine(t, i + 1) for i, t in enumerate(text.split("\n"))]


# Regex de détection -------------------------------------------------------

RE_ATX_HEADING = re.compile(r"^(#{1,6})\s+(.+)$")                 # # Titre
RE_SETEXT_HEADING = re.compile(r"^[=\-~]{3,}\s*$")                # soulignement
RE_UPPER_HEADING = re.compile(r"^[A-ZÀ-ÖØ-Þ][\wÀ-ÿ ,;:'’\-\.&()]{2,80}$")
RE_NUMBERED_HEADING = re.compile(
    r"^((?:\d+[\.\)])*\d+|Partie\s+[IVXLCDM]+|Chapitre\s+\d+|Section\s+\d+|Annexe\s+[A-Z])"
    r"[\s:\.\-–—]\s*(.+)$",
    re.IGNORECASE,
)
RE_BULLET = re.compile(r"^\s*[-•*‣▪◦]\s+(.*)$")
RE_NUMBERED_ITEM = re.compile(r"^\s*\(?\d+[\.\)]\)?\s+(.*)$")
RE_LETTER_ITEM = re.compile(r"^\s*[a-z]{1,2}[\.\)]\s+(.*)$")
RE_COLON_LABEL = re.compile(r"^([A-ZÀ-Ý][^:\n]{2,60}):\s+(.+)$")  # Définitions
RE_TABLE_ROW = re.compile(r"^\s*\|.*\|\s*$")
RE_FENCE = re.compile(r"^\s*```")
RE_CAPTION = re.compile(r"^(Figure|Tableau|Schéma|Encadré|Note|Remarque|Attention|Avertissement)\s*[:\.]?\s", re.IGNORECASE)
RE_SENTENCE_END = re.compile(r"[.!?…\u00a0!\u00a0?\u00a0!]['\"»\)]?\s*$")


def _looks_like_heading(line: str) -> Optional[int]:
    """Retourne le niveau (1..3) si la ligne ressemble à un titre, sinon None."""
    m = RE_ATX_HEADING.match(line)
    if m:
        return min(len(m.group(1)), 3)
    # Numérotation explicite : "1." / "2.3" / "Chapitre 1 :"
    # (exclut les numéros de ligne > 15 — ce sont des items de liste)
    m = RE_NUMBERED_HEADING.match(line)
    if m and len(line) <= 90:
        first_num = re.match(r"\d+", m.group(1))
        if not (first_num and int(first_num.group()) > 15):
            depth = len(re.findall(r"(?:\d+[\.\)])*\d+", m.group(1)))
            return 1 if depth <= 1 else (2 if depth == 2 else 3)
    # Tout en majuscules, court, pas de point final
    if (
        len(line) <= 60
        and not line.endswith((".", "!", "?", ":", ";"))
        and RE_UPPER_HEADING.match(line)
        and line.upper() == line
        and sum(c.isalpha() for c in line) >= 3
    ):
        return 1
    # Ligne "haute" : courte, sans ponctuation finale → titre candidat (H2).
    # Les candidats sont re-vérifiés ensuite globalement (voir _promote_title_candidate).
    if (
        len(line) <= 50
        and not re.search(r"[.;:!,]$", line)
        and RE_SENTENCE_END.search(line) is None
    ):
        words = line.split()
        if 1 < len(words) <= 8 and line[0].isupper():
            return 2
    return None


def _heading_title(line: str, level: int) -> str:
    m = RE_ATX_HEADING.match(line)
    if m:
        return m.group(2).strip()
    return line.strip().rstrip(":").strip()


# --------------------------------------------------------------------------
# 3. Classification → nœuds du document
# --------------------------------------------------------------------------

def build_blocks(lines: list[RawLine]) -> list[dict]:
    blocks: list[dict] = []
    para: list[str] = []
    i = 0

    def flush_para():
        nonlocal para
        if para:
            text = " ".join(para).strip()
            if text:
                m = RE_COLON_LABEL.match(text)
                if m and len(m.group(1)) < 60:
                    blocks.append({"type": "definition", "term": m.group(1).strip(),
                                   "text": m.group(2).strip()})
                elif RE_CAPTION.match(text):
                    kind = RE_CAPTION.match(text).group(1).lower()
                    callout_type = {"remarque": "note", "attention": "warning",
                                    "avertissement": "warning", "note": "note",
                                    "encadré": "info"}.get(kind, "info")
                    blocks.append({"type": "callout", "variant": callout_type,
                                   "text": text})
                else:
                    blocks.append({"type": "paragraph", "text": text})
            para = []

    while i < len(lines):
        raw = lines[i]
        stripped = raw.text.strip()

        # Blank line → fin de paragraphe
        if not stripped:
            flush_para()
            i += 1
            continue

        # Bloc de code fenced
        if RE_FENCE.match(stripped):
            flush_para()
            lang = stripped[3:].strip() or None
            code: list[str] = []
            i += 1
            while i < len(lines) and not RE_FENCE.match(lines[i].text.strip()):
                code.append(lines[i].text)
                i += 1
            i += 1  # skip closing fence
            blocks.append({"type": "code", "lang": lang, "text": "\n".join(code)})
            continue

        # Tableau Markdown
        if RE_TABLE_ROW.match(stripped):
            flush_para()
            rows: list[list[str]] = []
            while i < len(lines) and RE_TABLE_ROW.match(lines[i].text.strip()):
                r = lines[i].text.strip().strip("|")
                cells = [c.strip() for c in r.split("|")]
                if not all(re.fullmatch(r":?-{2,}:?", c) for c in cells):  # skip separator row
                    rows.append(cells)
                i += 1
            if rows:
                blocks.append({"type": "table",
                               "header": rows[0], "rows": rows[1:]})
            continue

        # Setext heading (ligne suivante === ou ---)
        if (i + 1 < len(lines) and RE_SETEXT_HEADING.match(lines[i + 1].text.strip())
                and stripped and _is_plain_title(stripped)):
            flush_para()
            level = 1 if lines[i + 1].text.strip()[0] == "=" else 2
            blocks.append({"type": "heading", "level": level, "text": stripped})
            i += 2
            continue

        # Listes
        mb = RE_BULLET.match(raw.text)
        mn = RE_NUMBERED_ITEM.match(raw.text)
        ml = RE_LETTER_ITEM.match(raw.text) if not mn else None
        if mb or mn or ml:
            flush_para()
            ordered = bool(mn or ml)
            items: list[str] = []
            while i < len(lines):
                t = lines[i].text
                mm = RE_BULLET.match(t) or RE_NUMBERED_ITEM.match(t) or RE_LETTER_ITEM.match(t)
                if mm:
                    items.append(mm.group(1).strip())
                    i += 1
                elif lines[i].text.startswith(("  ", "\t")) and items:  # continuation indentée
                    items[-1] += " " + lines[i].text.strip()
                    i += 1
                else:
                    break
            blocks.append({"type": "list", "ordered": ordered, "items": items})
            continue

        # Titre détecté
        lvl = _looks_like_heading(stripped)
        if lvl and not para:  # un titre ne coupe pas un paragraphe en cours
            flush_para()
            blocks.append({"type": "heading", "level": lvl,
                           "text": _heading_title(stripped, lvl)})
            i += 1
            continue

        # Sinon : ligne de paragraphe
        para.append(stripped)
        i += 1

    flush_para()
    return blocks


def _is_plain_title(s: str) -> bool:
    return len(s) <= 80 and not s.endswith((".", "!", "?")) and "\n" not in s


# --------------------------------------------------------------------------
# 4. Assemblage du document + TOC + métadonnées
# --------------------------------------------------------------------------

def _infer_metadata(blocks: list[dict], text: str, raw_text: str) -> dict:
    title = None
    author = None
    # 1er titre H1 → titre du doc ; sinon première ligne "haute" du texte BRUT
    # (une ligne isolée en tête de document est presque toujours le titre)
    for b in blocks:
        if b["type"] == "heading" and b["level"] == 1:
            title = b["text"]
            break
    if not title:
        raw_lines = [ln.strip() for ln in raw_text.replace("\r\n", "\n").replace("\r", "\n").split("\n")]
        first_content = next((i for i, ln in enumerate(raw_lines) if ln), None)
        if first_content is not None:
            candidate = raw_lines[first_content]
            # "par X" / "de X" = ligne d'auteur → le titre est la ligne précédente isolée
            if re.match(r"^(par|de|auteur\s*[:\-]|by)\s+", candidate, re.IGNORECASE):
                prev_idx = next((j for j in range(first_content - 1, -1, -1) if raw_lines[j]), None)
                if prev_idx is not None:
                    candidate = raw_lines[prev_idx]
            nxt = next((i for i in range(first_content + 1, len(raw_lines)) if raw_lines[i]), None)
            gap_ok = nxt is None or nxt - first_content > 1
            short_ok = 0 < len(candidate) <= 80 and not candidate.endswith((".", "!", "?", ";", ","))
            author_line = bool(re.match(r"^(par|de|auteur\s*[:\-]|by)\s+", candidate, re.IGNORECASE))
            if short_ok and not author_line and (gap_ok or first_content == 0):
                title = candidate
    if not title:
        for b in blocks:
            if b["type"] == "heading":
                title = b["text"]
                break
    m = re.search(r"^\s*(?:par|de|auteur\s*[:\-]|by)\s+(.+)$", text, re.MULTILINE | re.IGNORECASE)
    if m:
        author = m.group(1).strip()
    return {
        "title": title,
        "author": author,
        "wordCount": len(re.findall(r"\w+", text)),
        "language": "fr" if re.search(r"\b(le|la|les|des|une|est|dans|pour|que|qui)\b", text[:2000], re.I) else "en",
    }


def _rebalance_levels(blocks: list[dict]) -> list[dict]:
    """S'assure qu'il n'y a pas de saut de niveau brutal (H1 → H3)."""
    last_level = 0
    for b in blocks:
        if b["type"] == "heading":
            if last_level and b["level"] > last_level + 1:
                b["level"] = last_level + 1
            last_level = b["level"]
    return blocks


RE_AUTHOR_LINE = re.compile(r"^(par|de|auteur\s*[:\-]|by)\s+(.+)$", re.IGNORECASE)


def _promote_title_candidate(blocks: list[dict], raw_text: str) -> tuple[list[dict], Optional[str]]:
    """Si le document commence par une ligne 'haute' (titre candidat) suivie
    éventuellement d'une ligne d'auteur, la promeut en titre du document.
    Retourne (blocks nettoyés, titre ou None)."""
    if not blocks:
        return blocks, None
    first = blocks[0]
    candidate = None
    consume = 1
    if first["type"] == "heading":
        candidate = first["text"]
    elif first["type"] == "paragraph" and len(first["text"]) <= 50 \
            and not re.search(r"[.;:!,]$", first["text"]):
        words = first["text"].split()
        if 1 < len(words) <= 8 and first["text"][0].isupper():
            candidate = first["text"]
            # Le paragraphe absorbait peut-être aussi la ligne d'auteur
            m = RE_AUTHOR_LINE.search(candidate)
            if m:
                head = candidate[:m.start()].strip()
                if head:
                    candidate = head
    if not candidate:
        return blocks, None
    rest = blocks[consume:]
    # retire une ligne d'auteur qui suivrait le titre
    if rest and rest[0]["type"] == "paragraph":
        m = RE_AUTHOR_LINE.match(rest[0]["text"])
        if m and len(rest[0]["text"]) <= 60:
            rest = rest[1:]
        else:
            # paragraphe mixte "Titre par Auteur suite…" → on nettoie seulement
            pass
    # si le premier bloc restant est un heading, on évite doublon titre/§1 :
    # on garde quand même (le h1 de contenu est légitime, ex. "Introduction")
    return rest, candidate


def build_document(raw_text: str) -> dict:
    text = normalize(raw_text)
    blocks = build_blocks(_lines(text))

    # Promotion éventuelle de la ligne de titre en tête de document
    blocks, doc_title = _promote_title_candidate(blocks, raw_text)

    blocks = _rebalance_levels(blocks)

    # Si aucun H1 mais plusieurs H2 → promeut le premier en H1
    if not any(b["type"] == "heading" and b["level"] == 1 for b in blocks):
        for b in blocks:
            if b["type"] == "heading":
                b["level"] = 1
                break

    toc: list[dict] = []
    counter = [0] * 4  # numbering 1..3

    numbered: list[dict] = []
    for b in blocks:
        if b["type"] == "heading":
            lvl = b["level"]
            counter[lvl] += 1
            for d in range(lvl + 1, 4):
                counter[d] = 0
            prefix = ".".join(str(counter[d]) for d in range(1, lvl + 1))
            b = {**b, "number": prefix, "id": f"h-{len(toc) + 1}"}
            toc.append({"level": lvl, "number": prefix, "text": b["text"], "id": b["id"]})
        numbered.append(b)

    meta = _infer_metadata(numbered, text, raw_text)
    if doc_title:
        meta["title"] = doc_title
    if meta.get("title"):
        # La ligne titre (+ ligne d'auteur éventuelle) en tête ne doit pas
        # rester absorbée dans le premier paragraphe du corps.
        t = re.sub(r"\s+", " ", meta["title"]).lower()
        cleaned = []
        for b in numbered:
            if b["type"] == "paragraph":
                txt = re.sub(r"\s+", " ", b["text"])
                if txt.lower().startswith(t):
                    rest = txt[len(t):].strip()
                    rest = re.sub(r"^(par|de|auteur\s*[:\-]|by)\s+.{0,60}$", "", rest,
                                  flags=re.IGNORECASE).strip()
                    if not rest:
                        continue  # paragraphe = titre (+ auteur) → supprimé
                    b = {**b, "text": rest}
            cleaned.append(b)
        numbered = cleaned
    return {
        "schema": SCHEMA_VERSION,
        "metadata": meta,
        "toc": toc,
        "blocks": numbered,
    }


# --------------------------------------------------------------------------
# CLI
# --------------------------------------------------------------------------

def main() -> None:
    import argparse

    p = argparse.ArgumentParser(description="Structurer un texte brut en Doc JSON.")
    p.add_argument("input", nargs="?", help="fichier texte (défaut: stdin)")
    p.add_argument("--pretty", action="store_true")
    args = p.parse_args()

    raw = open(args.input, encoding="utf-8").read() if args.input else __import__("sys").stdin.read()
    doc = build_document(raw)
    print(json.dumps(doc, ensure_ascii=False, indent=2 if args.pretty else None))


if __name__ == "__main__":
    main()
