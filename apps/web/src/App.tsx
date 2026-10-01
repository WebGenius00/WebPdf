/**
 * PDF Studio — Coquille applicative (SPA React + Vite).
 *
 * Deux modules, deux onglets :
 *   📖 Lecture  → PdfReader   (pdfjs-dist, local, aucun upload serveur)
 *   ✍️ Générer  → Generator + DocPreview (API Fastify → workers Python)
 *
 * L'état `doc` est remonté ici pour que l'aperçu reste visible même si on
 * change d'onglet, et pour éviter de re-interroger l'API.
 */

import { lazy, Suspense, useEffect, useState } from 'react'
import { DEFAULT_RENDER_OPTIONS, health, type RenderOptions } from './lib/api'
import type { Doc } from './lib/doc'
import { Generator } from './modules/generator/Generator'
import { DocPreview } from './modules/generator/DocPreview'
import './app.css'

// Le lecteur (pdf.js, ~1 Mo) n'est chargé qu'à l'ouverture de l'onglet « Lire ».
const PdfReader = lazy(() =>
  import('./modules/reader/PdfReader').then((m) => ({ default: m.PdfReader })),
)

type Tab = 'generate' | 'read'
type Theme = 'auto' | 'light' | 'dark'

const Icon = {
  doc: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5M9 13h6M9 17h4" />
    </svg>
  ),
  pen: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
    </svg>
  ),
  book: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M2 4h6a4 4 0 0 1 4 4v13a3 3 0 0 0-3-3H2z" />
      <path d="M22 4h-6a4 4 0 0 0-4 4v13a3 3 0 0 1 3-3h7z" />
    </svg>
  ),
  sun: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  ),
  moon: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
    </svg>
  ),
  auto: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 3v18" />
      <path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" stroke="none" />
    </svg>
  ),
}

const THEME_LABEL: Record<Theme, string> = { auto: 'Thème : automatique', light: 'Thème : clair', dark: 'Thème : sombre' }
const NEXT_THEME: Record<Theme, Theme> = { auto: 'light', light: 'dark', dark: 'auto' }

function readStoredTheme(): Theme {
  try {
    const v = localStorage.getItem('pdf-studio-theme')
    return v === 'light' || v === 'dark' ? v : 'auto'
  } catch {
    return 'auto'
  }
}

export default function App() {
  const [tab, setTab] = useState<Tab>('generate')
  const [doc, setDoc] = useState<Doc | null>(null)
  const [apiUp, setApiUp] = useState<boolean | null>(null)
  const [theme, setTheme] = useState<Theme>(readStoredTheme)

  // Applique le thème sur <html> (auto = suit le système) et le mémorise.
  useEffect(() => {
    const root = document.documentElement
    if (theme === 'auto') root.removeAttribute('data-theme')
    else root.setAttribute('data-theme', theme)
    try {
      localStorage.setItem('pdf-studio-theme', theme)
    } catch {
      /* stockage indisponible : le thème reste valable pour la session */
    }
  }, [theme])
  // Options de rendu partagées entre le générateur (UI) et l'API.
  const [renderOptions, setRenderOptions] = useState<RenderOptions>(DEFAULT_RENDER_OPTIONS)

  // Sonde backend périodique : bandeau d'avertissement si API injoignable.
  useEffect(() => {
    let alive = true
    const check = () => void health().then((up) => alive && setApiUp(up))
    check()
    const id = setInterval(check, 15_000)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [])

  return (
    <div className="app">
      <header className="app-header">
        <h1 className="brand">
          <span className="brand-mark">{Icon.doc}</span>
          <span>
            PDF Studio
            <small>Lire · Structurer · Générer</small>
          </span>
        </h1>
        <nav className="tabs" role="tablist">
          <button
            role="tab"
            aria-selected={tab === 'generate'}
            className={tab === 'generate' ? 'active' : ''}
            onClick={() => setTab('generate')}
          >
            {Icon.pen}
            <span>Générer un PDF</span>
          </button>
          <button
            role="tab"
            aria-selected={tab === 'read'}
            className={tab === 'read' ? 'active' : ''}
            onClick={() => setTab('read')}
          >
            {Icon.book}
            <span>Lire un PDF</span>
          </button>
        </nav>
        <div className="header-right">
          <span
            className={`api-status ${apiUp ? 'up' : 'down'}`}
            title={apiUp ? 'Backend joignable' : 'Backend injoignable — mode local (navigateur)'}
          >
            {apiUp ? 'API en ligne' : 'Mode local'}
          </span>
          <button
            className="theme-toggle"
            onClick={() => setTheme(NEXT_THEME[theme])}
            title={THEME_LABEL[theme]}
            aria-label={THEME_LABEL[theme]}
          >
            {theme === 'light' ? Icon.sun : theme === 'dark' ? Icon.moon : Icon.auto}
          </button>
        </div>
      </header>



      <main className="app-main" key={tab}>
        <section className="hero">
          {tab === 'generate' ? (
            <>
              <h2>
                Du texte brut à un <span>PDF professionnel</span>
              </h2>
              <p>Collez votre texte : titres, listes, tableaux et encadrés sont détectés, puis mis en page avec table des matières.</p>
            </>
          ) : (
            <>
              <h2>
                Lisez vos PDF, <span>sans rien envoyer</span>
              </h2>
              <p>Visionneuse 100 % locale : zoom, sommaire, recherche plein texte. Vos fichiers restent dans votre navigateur.</p>
            </>
          )}
        </section>
        {tab === 'generate' ? (
          <div className="split">
            <Generator doc={doc} onDoc={setDoc} options={renderOptions} onOptions={setRenderOptions} />
            <DocPreview doc={doc} layout={renderOptions.layout} />
          </div>
        ) : (
          <Suspense fallback={<p className="muted" style={{ padding: '2rem' }}>Chargement du lecteur…</p>}>
            <PdfReader />
          </Suspense>
        )}
      </main>

      <footer className="app-footer muted">
        PDF Studio · schéma doc/0.1
      </footer>
    </div>
  )
}
