/**
 * Port TypeScript du moteur de structuration Python (structurizer.py).
 * Utilisé comme REPLI 100 % client quand le backend Fastify/Python est
 * injoignable (déploiement statique Cloudflare Pages, panne locale…).
 *
 * Règles volontairement alignées sur la version Python pour que le Doc JSON
 * produit soit identique quel que soit le moteur (contrat doc/0.1).
 */

import { SCHEMA_VERSION, type Block, type Doc, type HeadingBlock, type TocEntry } from './doc'

/* ─── Regex partagées avec le Python ───────────────────────────────────── */

const RE_ATX_HEADING = /^(#{1,6})\s+(.+)$/
const RE_SETEXT_HEADING = /^[=\-~]{3,}\s*$/
const RE_UPPER_HEADING = /^[A-ZÀ-ÖØ-Þ][\wÀ-ÿ ,;:'’\-\.&()]{2,80}$/
const RE_NUMBERED_HEADING =
  /^((?:\d+[.\)])*\d+|Partie\s+[IVXLCDM]+|Chapitre\s+\d+|Section\s+\d+|Annexe\s+[A-Z])[\s:.\-–—]\s*(.+)$/i
const RE_BULLET = /^\s*[-•*‣▪◦]\s+(.*)$/
const RE_NUMBERED_ITEM = /^\s*\(?\d+[.)]\)?\s+(.*)$/
const RE_LETTER_ITEM = /^\s*[a-z]{1,2}[.)]\s+(.*)$/
const RE_COLON_LABEL = /^([A-ZÀ-Ý][^:\n]{2,60}):\s+(.+)$/
const RE_TABLE_ROW = /^\s*\|.*\|\s*$/
const RE_FENCE = /^\s*```/
const RE_CAPTION =
  /^(Figure|Tableau|Schéma|Encadré|Note|Remarque|Attention|Avertissement)\s*[:.]?\s/i
const RE_SENTENCE_END = /[.!?[…]['"»)]?\s*$/
const RE_AUTHOR_LINE = /^(par|de|auteur\s*[:\-]|by)\s+(.+)$/i

/* ─── 1. Normalisation typographique ───────────────────────────────────── */

export function normalize(text: string): string {
  text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  text = text.split('\n').map((l) => l.replace(/\s+$/, '')).join('\n')
  text = text.replace(/\n{3,}/g, '\n\n')
  text = text.replaceAll('...', '…')
  text = text.replace(/(\s)--(\s)/g, '$1—$2')
  text = text.replace(/(^|\s)"/g, '$1« ')
  text = text.replace(/"(\s|$)/g, ' »$1')
  text = text.replace(/\s+([;!?\u00a0!])/g, '\u00a0$1')
  return text.trim()
}

/* ─── 2. Détection de titres ───────────────────────────────────────────── */

function looksLikeHeading(line: string): 1 | 2 | 3 | null {
  const atx = RE_ATX_HEADING.exec(line)
  if (atx) return Math.min(atx[1].length, 3) as 1 | 2 | 3
  const num = RE_NUMBERED_HEADING.exec(line)
  if (num && line.length <= 90) {
    const first = /\d+/.exec(num[1])
    if (!(first && parseInt(first[0], 10) > 15)) {
      const depth = (num[1].match(/(?:\d+[.\)])*\d+/g) ?? ['1']).length
      return depth <= 1 ? 1 : depth === 2 ? 2 : 3
    }
  }
  if (
    line.length <= 60 &&
    !/[.!?:;]$/.test(line) &&
    RE_UPPER_HEADING.test(line) &&
    line.toUpperCase() === line &&
    [...line].filter((c) => /[a-zA-ZÀ-ÿ]/.test(c)).length >= 3
  )
    return 1
  if (line.length <= 50 && !/[.;:!,]$/.test(line) && !RE_SENTENCE_END.test(line)) {
    const words = line.split(/\s+/)
    if (words.length > 1 && words.length <= 8 && words[0][0] === words[0][0].toUpperCase())
      return 2
  }
  return null
}

function headingTitle(line: string): string {
  const atx = RE_ATX_HEADING.exec(line)
  return (atx ? atx[2] : line).trim().replace(/:$/, '').trim()
}

const isPlainTitle = (s: string): boolean => s.length <= 80 && !/[.!?]$/.test(s)

/* ─── 3. Classification en blocs ───────────────────────────────────────── */

type RawLine = { text: string }

function buildBlocks(lines: RawLine[]): Record<string, unknown>[] {
  const blocks: Record<string, unknown>[] = []
  let para: string[] = []
  let i = 0

  const flushPara = (): void => {
    if (!para.length) return
    const text = para.join(' ').trim()
    para = []
    if (!text) return
    const def = RE_COLON_LABEL.exec(text)
    const cap = RE_CAPTION.exec(text)
    if (def && def[1].length < 60) {
      blocks.push({ type: 'definition', term: def[1].trim(), text: def[2].trim() })
    } else if (cap) {
      const kind = cap[1].toLowerCase()
      const variant =
        kind === 'remarque' || kind === 'note' ? 'note'
        : kind === 'attention' || kind === 'avertissement' ? 'warning'
        : 'note'
      blocks.push({ type: 'callout', variant, text })
    } else {
      blocks.push({ type: 'paragraph', text })
    }
  }

  while (i < lines.length) {
    const raw = lines[i]
    const stripped = raw.text.trim()

    if (!stripped) { flushPara(); i++; continue }

    if (RE_FENCE.test(stripped)) {
      flushPara()
      const lang = stripped.slice(3).trim() || undefined
      const code: string[] = []
      i++
      while (i < lines.length && !RE_FENCE.test(lines[i].text.trim())) {
        code.push(lines[i].text)
        i++
      }
      i++ // fence fermante
      blocks.push({ type: 'code', language: lang, text: code.join('\n') })
      continue
    }

    if (RE_TABLE_ROW.test(stripped)) {
      flushPara()
      const rows: string[][] = []
      while (i < lines.length && RE_TABLE_ROW.test(lines[i].text.trim())) {
        const cells = lines[i].text.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim())
        if (!cells.every((c) => /^:?-{2,}:?$/.test(c))) rows.push(cells)
        i++
      }
      if (rows.length) blocks.push({ type: 'table', header: rows[0], rows: rows.slice(1) })
      continue
    }

    if (
      i + 1 < lines.length &&
      RE_SETEXT_HEADING.test(lines[i + 1].text.trim()) &&
      stripped &&
      isPlainTitle(stripped)
    ) {
      flushPara()
      blocks.push({
        type: 'heading',
        level: lines[i + 1].text.trim()[0] === '=' ? 1 : 2,
        text: stripped,
      })
      i += 2
      continue
    }

    const mb = RE_BULLET.exec(raw.text)
    const mn = RE_NUMBERED_ITEM.exec(raw.text)
    const ml = !mn ? RE_LETTER_ITEM.exec(raw.text) : null
    if (mb || mn || ml) {
      flushPara()
      const ordered = Boolean(mn || ml)
      const items: string[] = []
      while (i < lines.length) {
        const t = lines[i].text
        const mm = RE_BULLET.exec(t) ?? RE_NUMBERED_ITEM.exec(t) ?? RE_LETTER_ITEM.exec(t)
        if (mm) { items.push(mm[1].trim()); i++ }
        else if (/^( {2}|\t)/.test(t) && items.length) { items[items.length - 1] += ' ' + t.trim(); i++ }
        else break
      }
      blocks.push({ type: 'list', ordered, items })
      continue
    }

    const lvl = looksLikeHeading(stripped)
    if (lvl && !para.length) {
      flushPara()
      blocks.push({ type: 'heading', level: lvl, text: headingTitle(stripped) })
      i++
      continue
    }

    para.push(stripped)
    i++
  }
  flushPara()
  return blocks
}

/* ─── 4. Assemblage Doc ────────────────────────────────────────────────── */

function inferMetadata(blocks: Record<string, unknown>[], text: string, rawText: string) {
  let title: string | undefined
  let author: string | undefined
  for (const b of blocks) {
    if (b.type === 'heading' && b.level === 1) { title = b.text as string; break }
  }
  if (!title) {
    const rawLines = rawText.replace(/\r\n?/g, '\n').split('\n').map((l) => l.trim())
    const firstContent = rawLines.findIndex((l) => l.length > 0)
    if (firstContent >= 0) {
      let candidate = rawLines[firstContent]
      if (RE_AUTHOR_LINE.test(candidate)) {
        for (let j = firstContent - 1; j >= 0; j--) {
          if (rawLines[j]) { candidate = rawLines[j]; break }
        }
      }
      let nxt = -1
      for (let k = firstContent + 1; k < rawLines.length; k++) {
        if (rawLines[k]) { nxt = k; break }
      }
      const gapOk = nxt < 0 || nxt - firstContent > 1
      const shortOk = candidate.length > 0 && candidate.length <= 80 && !/[.!?,;]$/.test(candidate)
      const authorLine = RE_AUTHOR_LINE.test(candidate)
      if (shortOk && !authorLine && (gapOk || firstContent === 0)) title = candidate
    }
  }
  if (!title) {
    for (const b of blocks) if (b.type === 'heading') { title = b.text as string; break }
  }
  const m = text.match(/^[\t ]*(?:par|de|auteur[\s]*[:\-]|by)\s+(.+)$/im)
  if (m) author = m[1].trim()
  return {
    title,
    author,
    wordCount: (text.match(/\w+/gu) ?? []).length,
    language: /\b(le|la|les|des|une|est|dans|pour|que|qui)\b/i.test(text.slice(0, 2000)) ? 'fr' : 'en',
  }
}

function slug(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

/** Point d'entrée : texte brut → Doc JSON (schéma doc/0.1), conforme au Python. */
export function structureTextClient(rawText: string): Doc {
  const text = normalize(rawText)
  let blocks = buildBlocks(text.split('\n').map((t) => ({ text: t })))

  // Promotion de la ligne-tête en titre documentaire
  let docTitle: string | undefined
  if (blocks.length) {
    const first = blocks[0]
    let candidate: string | undefined
    if (first.type === 'heading') candidate = first.text as string
    else if (first.type === 'paragraph' && (first.text as string).length <= 50 && !/[.;:!,]$/.test(first.text as string)) {
      const words = (first.text as string).split(/\s+/)
      if (words.length > 1 && words.length <= 8) {
        candidate = first.text as string
        const am = RE_AUTHOR_LINE.exec(candidate)
        if (am) {
          const head = candidate.slice(0, am.index).trim()
          if (head) candidate = head
        }
      }
    }
    if (candidate) {
      let rest = blocks.slice(1)
      if (rest.length && rest[0].type === 'paragraph' && RE_AUTHOR_LINE.test(rest[0].text as string) && (rest[0].text as string).length <= 60) {
        rest = rest.slice(1)
      }
      blocks = rest
      docTitle = candidate
    }
  }

  // Re-équilibrage des niveaux (pas de saut H1→H3)
  let lastLevel = 0
  for (const b of blocks) {
    if (b.type === 'heading') {
      if (lastLevel && (b.level as number) > lastLevel + 1) b.level = lastLevel + 1
      lastLevel = b.level as number
    }
  }
  // Aucun H1 mais des H2 → promeut le premier
  if (!blocks.some((b) => b.type === 'heading' && b.level === 1)) {
    for (const b of blocks) if (b.type === 'heading') { b.level = 1; break }
  }

  // Numérotation + TOC
  const toc: TocEntry[] = []
  const counter = [0, 0, 0, 0]
  const numbered: Record<string, unknown>[] = []
  for (const b of blocks) {
    if (b.type === 'heading') {
      const lvl = b.level as 1 | 2 | 3
      counter[lvl]++
      for (let d = lvl + 1; d <= 3; d++) counter[d] = 0
      const prefix = counter.slice(1, lvl + 1).join('.')
      const id = `h-${slug(b.text as string)}-${toc.length + 1}`
      numbered.push({ ...b, number: prefix, id })
      toc.push({ level: lvl, number: prefix, text: b.text as string, id })
    } else numbered.push(b)
  }

  const meta = inferMetadata(numbered, text, rawText)
  if (docTitle) meta.title = docTitle

  // Nettoyage : retirer la ligne titre absorbée dans le 1er paragraphe
  let cleaned = numbered
  if (meta.title) {
    const t = meta.title.replace(/\s+/g, ' ').toLowerCase()
    cleaned = []
    for (const b of numbered) {
      if (b.type === 'paragraph') {
        const txt = (b.text as string).replace(/\s+/g, ' ')
        if (txt.toLowerCase().startsWith(t)) {
          let rest = txt.slice(t.length).trim()
          rest = rest.replace(/^(par|de|auteur\s*[:\-]|by)\s+.{0,60}$/i, '').trim()
          if (!rest) continue
          cleaned.push({ ...b, text: rest })
          continue
        }
      }
      cleaned.push(b)
    }
  }

  return {
    schema: SCHEMA_VERSION,
    metadata: meta,
    toc,
    blocks: cleaned as unknown as Block[],
  } satisfies Doc & { blocks: unknown } as Doc
}

// Ré-export utilitaire pour tests futurs
export type { HeadingBlock }
