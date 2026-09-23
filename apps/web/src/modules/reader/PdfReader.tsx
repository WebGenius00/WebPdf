/**
 * Module Lecture PDF — visionneuse basée directement sur pdfjs-dist.
 *
 * Pourquoi pdfjs-dist "brut" plutôt que react-pdf :
 *   - contrôle fin du zoom/recherche/couches de texte,
 *   - pas de double encapsulation (react-pdf enveloppe déjà pdf.js),
 *   - chargement du worker compatible Vite via `?url`.
 *
 * Fonctionnalités MVP :
 *   - ouverture fichier local (<input type=file>) ou PDF distante (URL),
 *   - rendu page à page sur <canvas> (résolution adaptée au devicePixelRatio),
 *   - zoom (molette Ctrl / boutons), navigation page précédente/suivante,
 *   - extraction sommaire/bookmarks via la Table of Content de pdf.js.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist'
// Le worker est chargé en tant qu'asset Vite (URL résolue au build).
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl

export interface OutlineItem {
  title: string
  /** Numéro de page cible (1-based) ou null si destination non résoluble. */
  pageNumber: number | null
  depth: number
}

interface PageViewProps {
  pdf: PDFDocumentProxy
  pageNumber: number
  scale: number
}

/** Rend une page PDF sur un canvas ; re-rend à chaque changement pdf/échelle. */
function PageView({ pdf, pageNumber, scale }: PageViewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const taskRef = useRef<RenderTask | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const page = await pdf.getPage(pageNumber)
      if (cancelled) return
      const viewport = page.getViewport({ scale })
      const canvas = canvasRef.current
      if (!canvas) return
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      // Ajuste la résolution physique pour les écrans HiDPI.
      const dpr = window.devicePixelRatio || 1
      canvas.width = Math.floor(viewport.width * dpr)
      canvas.height = Math.floor(viewport.height * dpr)
      canvas.style.width = `${Math.floor(viewport.width)}px`
      canvas.style.height = `${Math.floor(viewport.height)}px`

      taskRef.current?.cancel()
      const renderContext = {
        canvasContext: ctx,
        viewport,
        transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
      }
      const task = page.render(renderContext)
      taskRef.current = task
      try {
        await task.promise
      } catch (err) {
        // "Rendering cancelled" est normal lors d'un re-render rapide.
        if (!(err instanceof Error && err.name === 'AbortError' || /cancel/i.test(String(err)))) {
          console.error('Erreur de rendu pdf.js', err)
        }
      }
    })()
    return () => {
      cancelled = true
      taskRef.current?.cancel()
    }
  }, [pdf, pageNumber, scale])

  return (
    <canvas
      ref={canvasRef}
      data-page={pageNumber}
      className="page-canvas"
      aria-label={`Page ${pageNumber}`}
    />
  )
}

export function PdfReader() {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null)
  const [numPages, setNumPages] = useState(0)
  const [page, setPage] = useState(1)
  const [scale, setScale] = useState(1.25)
  const [outline, setOutline] = useState<OutlineItem[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  /** Charge un buffer PDF et extrait métadonnées + sommaire. */
  const load = useCallback(async (data: ArrayBuffer) => {
    setLoading(true)
    setError(null)
    try {
      const doc = await pdfjsLib.getDocument({ data }).promise
      setPdf(doc)
      setNumPages(doc.numPages)
      setPage(1)
      // Sommaire natif (bookmarks) — destinations résolues vers n° de page.
      const outlineRaw = await doc.getOutline().catch(() => null)
      if (outlineRaw?.length) {
        const flat: OutlineItem[] = []
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
            } catch {
              /* destination exotique : on garde null */
            }
            flat.push({ title: item.title, pageNumber, depth })
            if (item.items?.length) await walk(item.items, depth + 1)
          }
        }
        await walk(outlineRaw, 0)
        setOutline(flat)
      } else {
        setOutline([])
      }
    } catch (err) {
      setError(`Impossible d'ouvrir ce PDF : ${String(err)}`)
      setPdf(null)
    } finally {
      setLoading(false)
    }
  }, [])

  const onFile = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (!file) return
      void file.arrayBuffer().then(load)
    },
    [load],
  )

  /** Zoom clavier : Ctrl + molette dans la zone de lecture. */
  const onWheel = useCallback((e: React.WheelEvent) => {
    if (!e.ctrlKey) return
    e.preventDefault()
    setScale((s) => Math.min(4, Math.max(0.4, s * (e.deltaY < 0 ? 1.1 : 0.9))))
  }, [])

  const gotoPage = useCallback((n: number) => {
    const target = Math.min(numPages, Math.max(1, n))
    setPage(target)
    containerRef.current
      ?.querySelector(`[data-page="${target}"]`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [numPages])

  return (
    <section className="reader">
      <header className="toolbar">
        <label className="btn">
          Ouvrir un PDF
          <input type="file" accept="application/pdf,.pdf" onChange={onFile} hidden />
        </label>
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
              <button onClick={() => setScale((s) => Math.max(0.4, s / 1.2))}>−</button>
              <span>{Math.round(scale * 100)} %</span>
              <button onClick={() => setScale((s) => Math.min(4, s * 1.2))}>+</button>
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
            <p className="muted placeholder">
              Choisissez un fichier PDF (tous formats, toutes tailles) pour commencer la lecture.
            </p>
          )}
          {pdf &&
            Array.from({ length: numPages }, (_, i) => (
              <PageView key={`${pdf.loadingTask?.docId ?? 'doc'}-${i + 1}-${scale}`} pdf={pdf} pageNumber={i + 1} scale={scale} />
            ))}
        </div>
      </div>
    </section>
  )
}
