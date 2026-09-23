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

import { useEffect, useState } from 'react'
import { health, type RenderOptions } from './lib/api'
import type { Doc } from './lib/doc'
import { Generator } from './modules/generator/Generator'
import { DocPreview } from './modules/generator/DocPreview'
import { PdfReader } from './modules/reader/PdfReader'
import './app.css'

type Tab = 'generate' | 'read'

export default function App() {
  const [tab, setTab] = useState<Tab>('generate')
  const [doc, setDoc] = useState<Doc | null>(null)
  const [apiUp, setApiUp] = useState<boolean | null>(null)
  // Options de rendu partagées entre le générateur (UI) et l'API.
  const [renderOptions, setRenderOptions] = useState<RenderOptions>({ theme: 'editorial', paper: 'a4' })

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
        <h1>
          <span aria-hidden>📄</span> PDF Studio
        </h1>
        <nav className="tabs" role="tablist">
          <button
            role="tab"
            aria-selected={tab === 'generate'}
            className={tab === 'generate' ? 'active' : ''}
            onClick={() => setTab('generate')}
          >
            ✍️ Générer un PDF
          </button>
          <button
            role="tab"
            aria-selected={tab === 'read'}
            className={tab === 'read' ? 'active' : ''}
            onClick={() => setTab('read')}
          >
            📖 Lire un PDF
          </button>
        </nav>
        <span
          className={`api-status ${apiUp ? 'up' : 'down'}`}
          title={apiUp ? 'Backend joignable' : 'Backend injoignable — lancez npm run dev:api'}
        >
          ● API
        </span>
      </header>

      {apiUp === false && (
        <p className="banner">
          Le backend n'est pas joignable. Démarrez-le avec <code>npm run dev:api</code> (port 4000).
        </p>
      )}

      <main className="app-main">
        {tab === 'generate' ? (
          <div className="split">
            <Generator doc={doc} onDoc={setDoc} options={renderOptions} onOptions={setRenderOptions} />
            <DocPreview doc={doc} />
          </div>
        ) : (
          <PdfReader />
        )}
      </main>

      <footer className="app-footer muted">
        PDF Studio — prototype MVP · schéma doc/0.1 · rendu WeasyPrint
      </footer>
    </div>
  )
}
