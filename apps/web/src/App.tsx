/**
 * PDF Studio — coquille applicative (SPA React + Vite).
 * Le parcours de génération suit : Contenu → Structure → Présentation → Export.
 */
import { lazy, startTransition, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { DEFAULT_RENDER_OPTIONS, health, type RenderOptions } from './lib/api'
import { downloadPreviewPdf } from './lib/previewPdf'
import { inspectPreviewQuality, type PreviewQualityIssue } from './lib/previewQuality'
import type { Doc } from './lib/doc'
import { Generator } from './modules/generator/Generator'
import { DocPreview } from './modules/generator/DocPreview'
import './app.css'

const loadPdfReader = () => import('./modules/reader/PdfReader')
const PdfReader = lazy(() => loadPdfReader().then((m) => ({ default: m.PdfReader })))
type Tab = 'generate' | 'read'
type Theme = 'auto' | 'light' | 'dark'
type GenerationStage = 1 | 2 | 3 | 4
const THEME_LABEL: Record<Theme, string> = { auto: 'Thème : système', light: 'Thème : clair', dark: 'Thème : vert-noir' }
const NEXT_THEME: Record<Theme, Theme> = { auto: 'dark', light: 'auto', dark: 'light' }
function readStoredTheme(): Theme {
  try { const v = localStorage.getItem('pdf-studio-theme'); return v === 'light' || v === 'dark' ? v : 'dark' } catch { return 'dark' }
}
const Icon = {
  doc: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/></svg>,
  pen: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>,
  book: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M2 4h6a4 4 0 0 1 4 4v13a3 3 0 0 0-3-3H2z"/><path d="M22 4h-6a4 4 0 0 0-4 4v13a3 3 0 0 1 3-3h7z"/></svg>,
  sun: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>,
  moon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>,
  auto: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 3v18"/><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" stroke="none"/></svg>,
}

export default function App() {
  const [tab, setTab] = useState<Tab>('generate')
  const [doc, setDoc] = useState<Doc | null>(null)
  const [apiUp, setApiUp] = useState<boolean | null>(null)
  const [theme, setTheme] = useState<Theme>(readStoredTheme)
  const [downloadMessage, setDownloadMessage] = useState('')
  const [downloadBusy, setDownloadBusy] = useState(false)
  const [downloadProgress, setDownloadProgress] = useState(0)
  const [qualityIssues, setQualityIssues] = useState<PreviewQualityIssue[]>([])
  const [qualityOverride, setQualityOverride] = useState(false)
  const [cursorContext, setCursorContext] = useState('')
  const [generationStage, setGenerationStage] = useState<GenerationStage>(1)
  const previewPageRef = useRef<HTMLElement>(null)
  const switchTab = useCallback((nextTab: Tab) => {
    startTransition(() => setTab(nextTab))
  }, [])
  const prefetchReader = useCallback(() => { void loadPdfReader() }, [])

  useEffect(() => {
    const root = document.documentElement
    if (theme === 'auto') root.removeAttribute('data-theme'); else root.setAttribute('data-theme', theme)
    try { localStorage.setItem('pdf-studio-theme', theme) } catch { /* stockage indisponible */ }
  }, [theme])
  const [renderOptions, setRenderOptions] = useState<RenderOptions>(DEFAULT_RENDER_OPTIONS)
  const handleDocChange = (nextDoc: Doc | null) => {
    setDoc(nextDoc)
    setQualityIssues([])
    setQualityOverride(false)
  }
  const handleOptionsChange = (nextOptions: RenderOptions) => {
    setRenderOptions(nextOptions)
    setQualityIssues([])
    setQualityOverride(false)
  }

  useEffect(() => {
    let alive = true
    const check = () => void health().then((up) => alive && setApiUp(up))
    check(); const id = setInterval(check, 15_000)
    return () => { alive = false; clearInterval(id) }
  }, [])

  const handleDownload = async (ignoreQuality = false) => {
    if (!previewPageRef.current || !doc) return
    if (!ignoreQuality) {
      const issues = inspectPreviewQuality(previewPageRef.current)
      if (issues.length > 0) {
        setQualityIssues(issues)
        setQualityOverride(true)
        return
      }
    }
    setQualityIssues([])
    setQualityOverride(false)
    setDownloadMessage('')
    setDownloadProgress(0)
    setDownloadBusy(true)
    try {
      await downloadPreviewPdf(previewPageRef.current, renderOptions.paper ?? 'a4', doc.metadata.title ?? 'document', renderOptions.orientation ?? 'portrait', setDownloadProgress)
      setDownloadMessage('PDF téléchargé avec succès.')
    } catch (error) {
      setDownloadMessage(`Échec du téléchargement : ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setDownloadBusy(false)
    }
  }
  return (
    <div className="app">
      <header className="app-header">
        <h1 className="brand"><span className="brand-mark">{Icon.doc}</span><span>PDF Studio<small>Lire · Structurer · Générer</small></span></h1>
        <nav className="tabs" role="tablist" aria-label="Modules PDF Studio">
          <button role="tab" id="tab-generate" aria-controls="panel-generate" aria-selected={tab === 'generate'} className={tab === 'generate' ? 'active' : ''} onClick={() => switchTab('generate')}>{Icon.pen}<span>Générer un PDF</span></button>
          <button role="tab" id="tab-read" aria-controls="panel-read" aria-selected={tab === 'read'} className={tab === 'read' ? 'active' : ''} onPointerEnter={prefetchReader} onFocus={prefetchReader} onClick={() => switchTab('read')}>{Icon.book}<span>Lire un PDF</span></button>
        </nav>
        <div className="header-right">
          <span className={`api-status ${apiUp ? 'up' : 'down'}`} aria-live="polite" title={apiUp ? 'API disponible' : 'API indisponible — mode local'}>{apiUp ? 'API disponible' : apiUp === false ? 'Mode local' : 'Connexion…'}</span>
          <button className="theme-toggle" onClick={() => setTheme(NEXT_THEME[theme])} title={THEME_LABEL[theme]} aria-label={THEME_LABEL[theme]}>{theme === 'light' ? Icon.sun : theme === 'dark' ? Icon.moon : Icon.auto}</button>
        </div>
      </header>
      <main className={`app-main tab-panel-${tab}`} id={tab === 'generate' ? 'panel-generate' : 'panel-read'} role="tabpanel" aria-labelledby={`tab-${tab}`}>
        <section className="hero">
          {tab === 'generate' ? <><h2>Du texte brut à un <span>PDF professionnel</span></h2><p>Un parcours guidé pour écrire, structurer, vérifier, personnaliser puis télécharger.</p></> : <><h2>Lisez vos PDF, <span>sans rien envoyer</span></h2><p>Visionneuse 100 % locale : zoom, sommaire, recherche plein texte.</p></>}
        </section>
        {tab === 'generate' ? <div className="editor-stage"><ol className="flow-steps" aria-label="Progression de génération">
          {['Contenu', 'Structure', 'Présentation', 'Export'].map((label, index) => <li key={label} className={index + 1 === generationStage ? 'current' : index + 1 < generationStage ? 'complete' : ''}><span>{index + 1}</span>{label}</li>)}
        </ol><div className="generator-workspace"><Generator doc={doc} onDoc={handleDocChange} onStage={setGenerationStage} options={renderOptions} onOptions={handleOptionsChange} onPreview={() => setGenerationStage(4)} onCursorContext={setCursorContext}/><section className="live-preview-panel" aria-label="Aperçu PDF en direct"><div className="live-preview-header"><div><p className="eyebrow">Aperçu en direct</p><h2>Votre PDF</h2><p className="muted">La version téléchargée sera capturée ici, telle qu’elle est affichée.</p></div><button type="button" className="btn primary" onClick={() => void handleDownload(qualityOverride)} disabled={!doc || downloadBusy} aria-busy={downloadBusy}>{downloadBusy ? `Génération ${downloadProgress}%` : qualityOverride ? 'Télécharger malgré tout' : downloadMessage.startsWith('Échec') ? 'Réessayer' : downloadMessage ? '✓ PDF téléchargé' : '⬇ Télécharger le PDF'}</button></div>{downloadBusy && <div className="download-progress-panel" role="status" aria-live="polite"><div className="download-progress-copy"><span>{downloadProgress < 48 ? 'Capture de l’aperçu…' : 'Assemblage des pages PDF…'}</span><strong>{downloadProgress}%</strong></div><div className="download-progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={downloadProgress} aria-label="Progression de la génération du PDF"><span style={{ width: `${downloadProgress}%` }}/></div></div>}{qualityIssues.length > 0 && <div className="quality-warning" role="alert"><strong>Contrôle qualité avant téléchargement</strong><ul>{qualityIssues.map((issue, index) => <li key={`${issue.type}-${issue.page}-${index}`}>{issue.message}</li>)}</ul><span>Corrigez le contenu ou confirmez avec « Télécharger malgré tout ».</span></div>}{downloadMessage && <p className={`success-message${downloadMessage.startsWith('Échec') ? ' download-error' : ''}`} role="status" aria-live="polite">{downloadMessage}</p>}<DocPreview doc={doc} layout={renderOptions.layout} paper={renderOptions.paper} orientation={renderOptions.orientation} font={renderOptions.font} focusText={cursorContext} pageRef={(node) => { previewPageRef.current = node }}/></section></div></div> : <div id="panel-read"><Suspense fallback={<p className="muted" style={{ padding: '2rem' }} role="status">Chargement du lecteur…</p>}><PdfReader/></Suspense></div>}
      </main>
      <footer className="app-footer muted">PDF Studio · schéma doc/0.1</footer>
    </div>
  )
}
