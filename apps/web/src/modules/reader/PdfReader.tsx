/**
 * Module Lecture PDF — visionneuse basée directement sur pdfjs-dist.
 *
 * Pourquoi pdfjs-dist "brut" plutôt que react-pdf :
 *   - contrôle fin du zoom/recherche/couches de texte,
 *   - pas de double encapsulation (react-pdf enveloppe déjà pdf.js),
 *   - chargement du worker compatible Vite via `?url`.
 *
 * Fonctionnalités MVP+ :
 *   - ouverture fichier local (bouton OU glisser-déposer) — 100 % local,
 *     aucun PDF ne quitte la machine de l'utilisateur,
 *   - rendu page à page SUR DEMANDE (IntersectionObserver) : les documents
 *     de plusieurs centaines de pages restent fluides,
 *   - zoom (boutons, presets, Ctrl+molette), navigation clavier (←/→, PgUp/PgDn),
 *   - sommaire/bookmarks (outline pdf.js) avec saut à la page,
 *   - recherche plein-texte : extraction des textes de pages en parallèle,
 *     compteur d'occurrences et navigation entre résultats.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import type { PDFDocumentProxy } from 'pdfjs-dist'
// Le worker est chargé en tant qu'asset Vite (URL résolue au build).
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl

export interface OutlineItem {
  title: string
  /** Numéro de page cible (1-based) ou null si destination non résoluble. */
  pageNumber: number | null
  depth: number
}

interface SearchResult {
  page: number
  /** Occurrences trouvées sur la page. */
  count: number
  /** Aperçu du premier match (contexte élargi, texte normalisé). */
  snippet: string
}

/* ------------------------------------------------------------------ */
/*  Rendu d'une page, monté uniquement quand elle approche du viewport */
/* ------------------------------------------------------------------ */

interface PageViewProps {
  pdf: PDFDocumentProxy
  pageNumber: number
  scale: number
  /** Si false, la page reste un emplacement vide (lazy rendering). */
  active: boolean
  onActive: (page: number) => void
}

function PageView({ pdf, pageNumber, scale, active, onActive }: PageViewProps) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const renderTaskRef = useRef<{ cancel: () => void } | null>(null)
  const [rendered, setRendered] = useState(false)
  // Dimensions logiques de la page (réserve l'emplacement avant le rendu).
  const [size, setSize] = useState<{ w: number; h: number } | null>(null)

  // Observation d'intersection : active la page quand elle approche du champ.
  useEffect(() => {
    const el = wrapRef.current
    if (!el || active) return
    const io = new IntersectionObserver(
      (entries) => entries[0]?.isIntersecting && onActive(pageNumber),
      { rootMargin: '600px 0px' }, // pré-rend ce qui arrive bientôt
    )
    io.observe(el)
    return () => io.disconnect()
  }, [active, onActive, pageNumber])

  // Récupère la taille une seule fois (par page et par échelle).
  useEffect(() => {
    let cancelled = false
    void pdf.getPage(pageNumber).then((p) => {
      if (cancelled) return
      const vp = p.getViewport({ scale })
      setSize({ w: Math.floor(vp.width), h: Math.floor(vp.height) })
    })
    return () => { cancelled = true }
  }, [pdf, pageNumber, scale])

  // Rendu effectif sur canvas (annulé si re-scale pendant le rendu).
  useEffect(() => {
    if (!active || !size) return
    let cancelled = false
    void (async () => {
      const page = await pdf.getPage(pageNumber)
      if (cancelled) return
      const canvas = canvasRef.current
      const ctx = canvas?.getContext('2d')
      if (!canvas || !ctx) return
      const viewport = page.getViewport({ scale })
      const dpr = window.devicePixelRatio || 1
      canvas.width = Math.floor(viewport.width * dpr)
      canvas.height = Math.floor(viewport.height * dpr)
      canvas.style.width = `${Math.floor(viewport.width)}px`
      canvas.style.height = `${Math.floor(viewport.height)}px`
      renderTaskRef.current?.cancel()
      const task = page.render({
        canvasContext: ctx,
        viewport,
        transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
      })
      renderTaskRef.current = task
      try {
        await task.promise
        if (!cancelled) setRendered(true)
      } catch (err) {
        if (!/cancel/i.test(String(err))) console.error('Erreur de rendu pdf.js', err)
      }
    })()
    return () => {
      cancelled = true
      renderTaskRef.current?.cancel()
      setRendered(false)
    }
  }, [active, size, pdf, pageNumber, scale])

  return (
    <div
      ref={wrapRef}
      className="page-frame"
      data-page={pageNumber}
      style={{ width: size?.w ?? 595, minHeight: size?.h ?? 842 }}
      aria-label={`Page ${pageNumber}`}
    >
      <canvas ref={canvasRef} className="page-canvas" />
      {active && !rendered && <div className="page-loading">Rendu page {pageNumber}…</div>}
      {!active && <div className="page-loading">Page {pageNumber}</div>}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Visionneuse complète                                                */
/* ------------------------------------------------------------------ */

const MIN_SCALE = 0.4
const MAX_SCALE = 4
const ZOOM_PRESETS = [0.75, 1, 1.25, 1.75, 2.5]

/** Normalise pour la recherche : minuscules, sans accents, espaces unifiés. */
function fold(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ')
}

export function PdfReader() {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null)
  const [docName, setDocName] = useState<string>('')
  const [numPages, setNumPages] = useState(0)
  const [page, setPage] = useState(1)
  const [scale, setScale] = useState(1.25)
  const [outline, setOutline] = useState<OutlineItem[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [dragging, setDragging] = useState(false)
  // Pages dont le rendu a été demandé au moins une fois (jeu lazy).
  const [activePages, setActivePages] = useState<Set<number>>(new Set([1]))
  // Recherche plein-texte.
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [hitIndex, setHitIndex] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)
  const docSeqRef = useRef(0) // protège contre les chargements concurrents

  /** Charge un buffer PDF et extrait nom + sommaire (bookmarks). */
  const load = useCallback(async (data: ArrayBuffer, name: string) => {
    const seq = ++docSeqRef.current
    setLoading(true)
    setError(null)
    setResults(null)
    setQuery('')
    try {
      const doc = await pdfjsLib.getDocument({ data }).promise
      if (seq !== docSeqRef.current) { void doc.destroy(); return }
      setPdf(doc)
      setDocName(name)
      setNumPages(doc.numPages)
      setPage(1)
      setActivePages(new Set([1]))
      // Sommaire natif (bookmarks) — destinations résolues vers n° de page.
      const outlineRaw = await doc.getOutline().catch(() => null)
      const flat: OutlineItem[] = []
      if (outlineRaw?.length) {
        const walk = async (items: typeof outlineRaw, depth: number) => {
          for (const item of items) {
            let pageNumber: number | null = null
            try {
              const dest = typeof item.dest === 'string'
                ? await doc.getDestination(item.dest)
                : item.dest
              if (dest && Array.isArray(dest) && dest[0]) {
                const pageIndex = await doc.getPageIndex(dest[0] as never)
                pageNumber = pageIndex + 1
              }
            } catch { /* destination exotique */ }
            flat.push({ title: item.title, pageNumber, depth })
            if (item.items?.length) await walk(item.items, depth + 1)
          }
        }
        await walk(outlineRaw, 0)
      }
      setOutline(flat)
    } catch (err) {
      setError(`Impossible d'ouvrir ce PDF : ${String(err)}`)
      setPdf(null)
    } finally {
      if (seq === docSeqRef.current) setLoading(false)
    }
  }, [])

  const openFile = useCallback((file: File) => {
    if (!/pdf$/i.test(file.type) && !/\.pdf$/i.test(file.name)) {
      setError('Fichier non reconnu : seuls les PDF sont acceptés.')
      return
    }
    void file.arrayBuffer().then((buf) => load(buf, file.name))
  }, [load])

  const onFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (file) openFile(file)
      e.target.value = '' // permet de ré-ouvrir le même fichier
    },
    [openFile],
  )

  /** Glisser-déposer d'un PDF n'importe où sur la zone de lecture. */
  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files?.[0]
    if (file) openFile(file)
  }, [openFile])

  const activate = useCallback((n: number) => {
    setActivePages((prev) => (prev.has(n) ? prev : new Set(prev).add(n)))
  }, [])

  const gotoPage = useCallback((n: number) => {
    const target = Math.min(numPages, Math.max(1, n))
    setPage(target)
    activate(target)
    requestAnimationFrame(() => {
      containerRef.current
        ?.querySelector(`[data-page="${target}"]`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }, [numPages, activate])

  /** Zoom clavier : Ctrl + molette dans la zone de lecture. */
  const onWheel = useCallback((e: React.WheelEvent) => {
    if (!e.ctrlKey) return
    e.preventDefault()
    setScale((s) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s * (e.deltaY < 0 ? 1.1 : 0.9))))
  }, [])

  /** Navigation clavier globale quand un document est ouvert. */
  useEffect(() => {
    if (!pdf) return
    const handler = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT') return
      if (e.key === 'ArrowRight' || e.key === 'PageDown') { gotoPage(page + 1); e.preventDefault() }
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { gotoPage(page - 1); e.preventDefault() }
      else if (e.key === 'Home') gotoPage(1)
      else if (e.key === 'End') gotoPage(numPages)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [pdf, page, numPages, gotoPage])

  /** Recherche plein-texte : extraction des pages en parallèle (8 max). */
  const runSearch = useCallback(async () => {
    if (!pdf) return
    const q = fold(query.trim())
    if (!q) { setResults(null); return }
    setSearching(true)
    setResults(null)
    try {
      const found: SearchResult[] = []
      const CONCURRENCY = 8
      let cursor = 0
      const worker = async () => {
        while (cursor < pdf.numPages) {
          const i = ++cursor
          const pageObj = await pdf.getPage(i)
          const content = await pageObj.getTextContent()
          const text = fold(content.items.map((it) => ('str' in it ? it.str : '')).join(' '))
          const idx = text.indexOf(q)
          if (idx >= 0) {
            let count = 0
            for (let k = idx; k >= 0; k = text.indexOf(q, k + 1)) count++
            const start = Math.max(0, idx - 20)
            found.push({ page: i, count, snippet: `…${text.slice(start, idx + q.length + 20)}…` })
          }
        }
      }
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, pdf.numPages) }, worker))
      found.sort((a, b) => a.page - b.page)
      setResults(found)
      setHitIndex(0)
      if (found[0]) gotoPage(found[0].page)
    } finally {
      setSearching(false)
    }
  }, [pdf, query, gotoPage])

  const totalHits = useMemo(
    () => (results ?? []).reduce((acc, r) => acc + r.count, 0),
    [results],
  )

  const nextHit = useCallback((dir: 1 | -1) => {
    if (!results?.length) return
    const idx = (hitIndex + dir + results.length) % results.length
    setHitIndex(idx)
    gotoPage(results[idx].page)
  }, [results, hitIndex, gotoPage])

  return (
    <section
      className="reader"
      onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      <header className="toolbar">
        <label className="btn">
          📂 Ouvrir un PDF
          <input type="file" accept="application/pdf,.pdf" onChange={onFileInput} hidden />
        </label>
        {pdf && <span className="muted" title={docName}>{docName} · {numPages} pages</span>}
        {pdf && (
          <>
            <span className="pager">
              <button onClick={() => gotoPage(page - 1)} disabled={page <= 1} aria-label="Page précédente">◀</button>
              <input
                type="number"
                min={1}
                max={numPages}
                value={page}
                onChange={(e) => gotoPage(Number(e.target.value) || 1)}
                aria-label="Numéro de page"
              />
              <span>/ {numPages}</span>
              <button onClick={() => gotoPage(page + 1)} disabled={page >= numPages} aria-label="Page suivante">▶</button>
            </span>
            <span className="zoom">
              <button onClick={() => setScale((s) => Math.max(MIN_SCALE, s / 1.2))} aria-label="Dézoomer">−</button>
              <select
                value={ZOOM_PRESETS.includes(scale) ? String(scale) : ''}
                onChange={(e) => e.target.value && setScale(Number(e.target.value))}
                aria-label="Niveau de zoom"
              >
                <option value="" disabled>{Math.round(scale * 100)} %</option>
                {ZOOM_PRESETS.map((z) => (
                  <option key={z} value={String(z)}>{Math.round(z * 100)} %</option>
                ))}
              </select>
              <button onClick={() => setScale((s) => Math.min(MAX_SCALE, s * 1.2))} aria-label="Zoomer">+</button>
            </span>
            <span className="search-box">
              <input
                type="search"
                placeholder="Rechercher dans le document…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void runSearch()}
                aria-label="Terme de recherche"
              />
              <button onClick={() => void runSearch()} disabled={searching} aria-label="Lancer la recherche">
                {searching ? '…' : '🔍'}
              </button>
              {results && results.length > 0 && (
                <>
                  <span className="muted" title={results[hitIndex]?.snippet}>
                    {totalHits} occurrence{totalHits > 1 ? 's' : ''} · p. {results[hitIndex]?.page}
                  </span>
                  <button onClick={() => nextHit(-1)} aria-label="Résultat précédent">↑</button>
                  <button onClick={() => nextHit(1)} aria-label="Résultat suivant">↓</button>
                </>
              )}
              {results && results.length === 0 && !searching && <span className="muted">Aucun résultat</span>}
            </span>
          </>
        )}
        {loading && <span className="muted">Chargement…</span>}
      </header>

      {error && <p className="error">{error}</p>}

      <div className="reader-body">
        {pdf && outline.length > 0 && (
          <nav className="outline" aria-label="Sommaire du document">
            <h3>Sommaire</h3>
            <ul>
              {outline.map((item, i) => (
                <li key={i} style={{ paddingLeft: `${item.depth * 12}px` }}>
                  <button
                    disabled={item.pageNumber === null}
                    onClick={() => item.pageNumber && gotoPage(item.pageNumber)}
                    title={item.pageNumber ? `Page ${item.pageNumber}` : 'Destination inconnue'}
                  >
                    {item.title}
                  </button>
                </li>
              ))}
            </ul>
          </nav>
        )}

        <div className="pages" ref={containerRef} onWheel={onWheel}>
          {!pdf && !loading && (
            <div className={`dropzone${dragging ? ' dragging' : ''}`}>
              <p><strong>Déposez un PDF ici</strong> ou utilisez « Ouvrir un PDF ».</p>
              <p className="muted">
                Tous formats, toutes tailles — le fichier est lu <em>entièrement en local</em>,
                jamais envoyé sur un serveur.
              </p>
            </div>
          )}
          {pdf &&
            Array.from({ length: numPages }, (_, i) => (
              <PageView
                key={`${docName}-${i + 1}`}
                pdf={pdf}
                pageNumber={i + 1}
                scale={scale}
                active={activePages.has(i + 1)}
                onActive={activate}
              />
            ))}
        </div>
      </div>
    </section>
  )
}
