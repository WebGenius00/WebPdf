/**
 * Moteur de rendu PDF 100 % CLIENT — repli automatique quand le backend
 * Python/WeasyPrint est injoignable (déploiement statique Cloudflare Pages,
 * ou simple panne du serveur local).
 *
 * Choix d'implémentation : jsPDF en dessin natif vectoriel (text, rect,
 * line) avec césure mot à mot manuelle — zéro dépendance DOM/html2canvas,
 * texte sélectionnable dans le PDF final, pagination fluide par flux.
 * C'est ce qui se rapproche le plus du rendu serveur pour un PDF « publiable ».
 *
 * NB : les fonds de blocs (callout, code) sont peints AVANT leur contenu
 * (mesure de hauteur au brouillon, puis peinture réelle) pour éviter tout
 * recouvrement — jsPDF compose dans l'ordre d'ajout.
 */

import { jsPDF } from 'jspdf'
import type { Block, Doc } from './doc'
import type { RenderOptions } from './api'

/* ─── Géométrie & typographie ──────────────────────────────────────────── */

const PAPER: Record<string, { w: number; h: number }> = {
  a4: { w: 210, h: 297 },
  letter: { w: 215.9, h: 279.4 },
}

interface Palette {
  accent: [number, number, number]
  ink: [number, number, number]
  muted: [number, number, number]
  calloutBg: [number, number, number]
  codeBg: [number, number, number]
  serif: string
  sans: string
}

const THEMES: Record<NonNullable<RenderOptions['theme']>, Palette> = {
  editorial: { accent: [31, 78, 121], ink: [26, 26, 26], muted: [110, 110, 110], calloutBg: [240, 244, 249], codeBg: [246, 246, 243], serif: 'times', sans: 'helvetica' },
  corporate: { accent: [16, 68, 108], ink: [33, 37, 41], muted: [108, 117, 125], calloutBg: [233, 240, 247], codeBg: [244, 244, 244], serif: 'helvetica', sans: 'helvetica' },
  academic: { accent: [80, 40, 40], ink: [0, 0, 0], muted: [90, 90, 90], calloutBg: [245, 242, 235], codeBg: [245, 245, 245], serif: 'times', sans: 'helvetica' },
}

const MARGIN = 22 // mm
const LINE_H = 1.45 // multiplicateur de taille de police

/** Enlève les accents (jsPDF polices standard = encoding latin-1 OK, mais
 *  ces helpers sécurisent les cas limites et normalisent la typo FR). */
function clean(s: string): string {
  return s.replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ')
}

/* ─── Engine ───────────────────────────────────────────────────────────── */

class PdfWriter {
  private pdf: jsPDF
  private y: number
  private readonly pageH: number
  private readonly contentW: number
  private readonly pal: Palette
  pageNum = 0

  constructor(paper: 'a4' | 'letter', theme: keyof typeof THEMES) {
    const p = PAPER[paper] ?? PAPER.a4
    this.pdf = new jsPDF({ unit: 'mm', format: paper === 'letter' ? 'letter' : 'a4' })
    this.pageH = p.h
    this.contentW = p.w - 2 * MARGIN
    this.pal = THEMES[theme] ?? THEMES.editorial
    this.y = MARGIN
  }

  /* -- primitives -------------------------------------------------------- */

  private ensure(h: number): void {
    if (this.y + h > this.pageH - MARGIN) this.newPage()
  }

  private newPage(): void {
    this.pdf.addPage()
    this.pageNum += 1
    this.y = MARGIN
  }

  private setFont(family: string, style: string, size: number): void {
    this.pdf.setFont(family, style)
    this.pdf.setFontSize(size)
  }

  /** Paragraphe fluide avec césure mot à mot. mode: 'draw' peint, 'measure' compte uniquement. */
  private flow(text: string, family: string, style: string, size: number, color: [number, number, number], indent = 0, lineH = LINE_H, mode: 'draw' | 'measure' = 'draw'): void {
    this.setFont(family, style, size)
    if (mode === 'draw') this.pdf.setTextColor(...color)
    const words = clean(text).split(' ').filter(Boolean)
    let line = ''
    const maxW = this.contentW - indent
    const put = (l: string): void => {
      if (mode === 'draw') {
        this.ensure(size * lineH)
        this.pdf.text(l, MARGIN + indent, this.y)
      } else {
        this.ensure(0) // déclenche newPage() en mesure pour un comptage fidèle
      }
      this.y += size * lineH * 0.3527
    }
    for (const w of words) {
      const test = line ? `${line} ${w}` : w
      if (this.pdf.getTextWidth(test) > maxW && line) {
        put(line)
        line = w
      } else {
        line = test
      }
    }
    if (line) put(line)
  }

  private gap(mm: number): void {
    this.y += mm
  }

  private rule(color: [number, number, number], width = 0.4): void {
    this.ensure(2)
    this.pdf.setDrawColor(...color)
    this.pdf.setLineWidth(width)
    this.pdf.line(MARGIN, this.y, MARGIN + this.contentW, this.y)
    this.gap(2.5)
  }

  /** Boîte de fond peinte AVANT le contenu (mesure au brouillon → fond → dessin). */
  private boxed(bg: [number, number, number], pad: number, draw: (mode: 'draw' | 'measure') => void): void {
    const startPage = this.pdf.getCurrentPageInfo().pageNumber
    const startY = this.y
    draw('measure') // passe 1 : avance y comme si on dessinait (sans rien peindre)
    const endPage = this.pdf.getCurrentPageInfo().pageNumber
    const endY = this.y
    if (endPage === startPage) {
      // fond une seule fois, puis vrai dessin par-dessus
      this.pdf.setFillColor(...bg)
      this.pdf.setDrawColor(...bg)
      this.pdf.roundedRect(MARGIN - pad, startY - 1.5, this.contentW + pad * 2, endY - startY + 1, 1.5, 1.5, 'F')
    }
    this.pdf.setPage(startPage)
    this.y = startY
    draw('draw') // passe 2 : peinture réelle (repasse les mêmes sauts de page)
  }

  /* -- blocs ------------------------------------------------------------- */

  heading(level: 1 | 2 | 3, text: string, number?: string): void {
    const sizes = { 1: 20, 2: 15, 3: 12.5 } as const
    const size = sizes[level]
    this.ensure(size * 2.2)
    if (level === 1 && this.pageNum > 0) this.newPage()
    this.gap(level === 1 ? 6 : 4)
    const label = number ? `${number}  ${text}` : text
    this.flow(label, this.pal.serif, level === 3 ? 'normal' : 'bold', size, this.pal.accent)
    if (level <= 2) this.rule(this.pal.accent, level === 1 ? 0.8 : 0.3)
    else this.gap(1)
  }

  paragraph(text: string): void {
    this.flow(text, this.pal.serif, 'normal', 10.5, this.pal.ink)
    this.gap(3)
  }

  list(items: string[], ordered: boolean): void {
    items.forEach((item, i) => {
      const bullet = ordered ? `${i + 1}.` : '•'
      this.ensure(6)
      this.setFont(this.pal.serif, 'normal', 10.5)
      this.pdf.setTextColor(...this.pal.accent)
      this.pdf.text(bullet, MARGIN + 2, this.y)
      this.flow(item, this.pal.serif, 'normal', 10.5, this.pal.ink, 8)
      this.gap(1.2)
    })
    this.gap(2)
  }

  quote(text: string, cite?: string): void {
    this.ensure(12)
    const start = this.y
    this.gap(1.5)
    this.flow(`« ${clean(text)} »`, this.pal.serif, 'italic', 10.5, this.pal.muted, 8)
    if (cite) this.flow(`— ${cite}`, this.pal.sans, 'normal', 9, this.pal.muted, 12)
    this.gap(1.5)
    this.pdf.setDrawColor(...this.pal.accent)
    this.pdf.setLineWidth(1)
    this.pdf.line(MARGIN + 3, start + 1, MARGIN + 3, this.y - 1)
    this.gap(2)
  }

  callout(variant: string, title: string | undefined, text: string): void {
    const labels: Record<string, string> = { note: 'NOTE', tip: 'ASTUCE', warning: 'ATTENTION' }
    this.ensure(16)
    this.boxed(this.pal.calloutBg, 3, (mode) => {
      this.gap(2.5)
      this.flow(labels[variant] ?? 'NOTE', this.pal.sans, 'bold', 8, this.pal.accent, 4, LINE_H, mode)
      if (title) this.flow(title, this.pal.sans, 'bold', 10, this.pal.ink, 4, LINE_H, mode)
      this.flow(text, this.pal.sans, 'normal', 9.5, this.pal.ink, 4, LINE_H, mode)
      this.gap(2.5)
    })
    this.gap(2)
  }

  table(header: string[], rows: string[][]): void {
    const cols = Math.max(1, header.length)
    const colW = this.contentW / cols
    const cell = (txt: string, x: number, bold: boolean): number => {
      this.setFont(this.pal.sans, bold ? 'bold' : 'normal', 8.5)
      const lines = this.pdf.splitTextToSize(clean(txt), colW - 3) as string[]
      lines.forEach((l, i) => this.pdf.text(l, x + 1.5, this.y + 3.5 + i * 3.4))
      return Math.max(7, lines.length * 3.4 + 3)
    }
    this.ensure(10)
    let hMax = cell(header[0] ?? '', MARGIN, true)
    for (let c = 1; c < cols; c++) hMax = Math.max(hMax, cell(header[c] ?? '', MARGIN + c * colW, true))
    this.pdf.setFillColor(...this.pal.accent)
    this.pdf.rect(MARGIN, this.y, this.contentW, hMax, 'F')
    this.pdf.setTextColor(255, 255, 255)
    this.y += hMax
    for (const row of rows) {
      this.ensure(hMax + 4)
      let rMax = 6
      for (let c = 0; c < cols; c++) rMax = Math.max(rMax, cell(row[c] ?? '', MARGIN + c * colW, false))
      this.pdf.setTextColor(...this.pal.ink)
      this.pdf.setDrawColor(...this.pal.muted)
      this.pdf.setLineWidth(0.15)
      this.pdf.line(MARGIN, this.y + rMax, MARGIN + this.contentW, this.y + rMax)
      this.y += rMax
    }
    this.gap(4)
  }

  code(text: string): void {
    this.ensure(14)
    const lines = text.replace(/\t/g, '  ').split('\n')
    this.boxed(this.pal.codeBg, 2, (mode) => {
      this.gap(1.5)
      for (const l of lines) {
        if (mode === 'draw') {
          this.ensure(4)
          this.setFont('courier', 'normal', 8.5)
          this.pdf.setTextColor(...this.pal.ink)
          this.pdf.text(clean(l).slice(0, 110), MARGIN + 3, this.y + 3)
        } else {
          this.ensure(0)
        }
        this.y += 3.8
      }
      this.gap(1.5)
    })
    this.gap(3)
  }

  definition(term: string, text: string): void {
    this.flow(`${term} — `, this.pal.serif, 'bold italic', 10.5, this.pal.ink)
    this.flow(text, this.pal.serif, 'normal', 10.5, this.pal.ink, 0)
    this.gap(3)
  }

  /* -- doc-level ---------------------------------------------------------- */

  cover(doc: Doc): void {
    const m = doc.metadata
    this.gap(50)
    this.setFont(this.pal.serif, 'bold', 28)
    this.pdf.setTextColor(...this.pal.ink)
    const t = this.pdf.splitTextToSize(clean(m.title ?? 'Document'), this.contentW) as string[]
    this.ensure(t.length * 12)
    this.pdf.text(t, MARGIN, this.y)
    this.y += t.length * 12
    if (m.subtitle) {
      this.setFont(this.pal.serif, 'italic', 14)
      this.pdf.setTextColor(...this.pal.muted)
      this.pdf.text(clean(m.subtitle), MARGIN, this.y + 4)
      this.y += 10
    }
    this.gap(8)
    this.rule(this.pal.accent, 0.8)
    this.setFont(this.pal.sans, 'normal', 10)
    this.pdf.setTextColor(...this.pal.muted)
    const meta = [m.author, m.date].filter(Boolean).join(' · ')
    if (meta) this.pdf.text(meta, MARGIN, this.y)
    this.newPage()
  }

  toc(doc: Doc): void {
    if (!doc.toc.length) return
    this.setFont(this.pal.sans, 'bold', 14)
    this.pdf.setTextColor(...this.pal.ink)
    this.ensure(20)
    this.pdf.text('Table des matières', MARGIN, this.y)
    this.y += 8
    for (const e of doc.toc) {
      this.ensure(6)
      const size = e.level === 1 ? 10.5 : 9.5
      this.setFont(this.pal.sans, e.level === 1 ? 'bold' : 'normal', size)
      this.pdf.setTextColor(...(e.level === 1 ? this.pal.ink : this.pal.muted))
      const indent = (e.level - 1) * 6
      this.pdf.text(`${e.number}  ${clean(e.text)}`, MARGIN + indent, this.y)
      this.y += size * 0.5
    }
    this.gap(6)
    this.rule(this.pal.muted, 0.2)
  }

  blocks(doc: Doc): void {
    for (const b of doc.blocks as Block[]) {
      switch (b.type) {
        case 'heading': this.heading(b.level, b.text, b.number); break
        case 'paragraph': this.paragraph(b.text); break
        case 'list': this.list(b.items, b.ordered); break
        case 'quote': this.quote(b.text, b.cite); break
        case 'callout': this.callout(b.variant, b.title, b.text); break
        case 'table': this.table(b.header, b.rows); break
        case 'code': this.code(b.text); break
        case 'definition': this.definition(b.term, b.text); break
        default: break // image : non supporté en repli client
      }
    }
  }

  footer(): void {
    const total = this.pdf.getNumberOfPages()
    const pageW = this.pdf.internal.pageSize.getWidth()
    for (let i = 1; i <= total; i++) {
      this.pdf.setPage(i)
      this.setFont(this.pal.sans, 'normal', 8)
      this.pdf.setTextColor(...this.pal.muted)
      this.pdf.text(String(i), pageW - MARGIN, this.pageH - 12, { align: 'right' })
    }
  }

  save(filename: string): void {
    this.footer()
    this.pdf.save(filename)
  }
}

/** Point d'entrée public : Doc JSON → fichier PDF téléchargé (côté client). */
export function renderDocClient(doc: Doc, options: RenderOptions = {}): void {
  const w = new PdfWriter(options.paper ?? 'a4', options.theme ?? 'editorial')
  w.cover(doc)
  w.toc(doc)
  w.blocks(doc)
  const title = doc.metadata.title ?? 'document'
  w.save(`${title.toLowerCase().replace(/[^\wà-ÿ-]+/g, '-').slice(0, 60)}.pdf`)
}

/** Vrai si un backend complet (generate) est disponible ; sinon repli client. */
export async function backendCanGenerate(): Promise<boolean> {
  try {
    const res = await fetch('/api/health', { signal: AbortSignal.timeout(2500) })
    if (!res.ok) return false
    const body = (await res.json()) as { mode?: string }
    return body.mode !== 'static'
  } catch {
    return false
  }
}
