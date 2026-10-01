/**
 * Module Génération PDF — colonne de gauche : saisie/import du texte brut.
 *
 * Flux :
 *   1. l'utilisateur colle/importe un texte (.txt/.md),
 *      ou charge le document d'exemple pour découvrir le moteur,
 *   2. "Structurer" appelle POST /api/structure → Doc JSON,
 *   3. l’aperçu A4/Letter calibré s’affiche en direct à droite,
 *   4. le téléchargement capture cette feuille visible, sans second renderer.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  DEFAULT_RENDER_OPTIONS,
  structureText,
  type PageFurniture,
  type RenderOptions,
} from '../../lib/api'
import type { Doc } from '../../lib/doc'
import { SAMPLE_TEXT } from './sample'
import { structureTextClient } from '../../lib/structurizerClient'

interface FurnitureEditorProps {
  title: string
  value: PageFurniture
  onChange: (patch: Partial<PageFurniture>) => void
}

function FurnitureEditor({ title, value, onChange }: FurnitureEditorProps) {
  const zones = [
    { key: 'left', label: 'Gauche', placeholder: 'PDF STUDIO' },
    { key: 'center', label: 'Centre', placeholder: 'Optionnel' },
    { key: 'right', label: 'Droite', placeholder: '{section}' },
  ] as const

  return (
    <fieldset className="furniture-group">
      <legend>{title}</legend>
      <div className="furniture-toggles">
        <label>
          <input
            type="checkbox"
            checked={value.enabled}
            onChange={(e) => onChange({ enabled: e.target.checked })}
          />
          Afficher
        </label>
        <label>
          <input
            type="checkbox"
            checked={value.onCover}
            disabled={!value.enabled}
            onChange={(e) => onChange({ onCover: e.target.checked })}
          />
          Aussi sur la couverture
        </label>
      </div>
      <div className="furniture-fields">
        {zones.map(({ key, label, placeholder }) => (
          <label key={key}>
            <span>{label}</span>
            <input
              type="text"
              value={value[key]}
              maxLength={120}
              disabled={!value.enabled}
              placeholder={placeholder}
              onChange={(e) => onChange({ [key]: e.target.value })}
            />
          </label>
        ))}
      </div>
    </fieldset>
  )
}

interface GeneratorProps {
  doc: Doc | null
  onDoc: (doc: Doc | null) => void
  onStage?: (stage: 1 | 2 | 3 | 4) => void
  options: RenderOptions
  onOptions: (o: RenderOptions) => void
  onPreview?: () => void
  onCursorContext?: (context: string) => void
}

const AUTOSAVE_KEY = 'pdf-studio-draft-v1'

export function Generator({ doc, onDoc, onStage, options, onOptions, onPreview, onCursorContext }: GeneratorProps) {
  const [text, setText] = useState(() => { try { return localStorage.getItem(AUTOSAVE_KEY) ?? '' } catch { return '' } })
  const [history, setHistory] = useState<string[]>(() => [(() => { try { return localStorage.getItem(AUTOSAVE_KEY) ?? '' } catch { return '' } })()])
  const [historyIndex, setHistoryIndex] = useState(0)
  const [query, setQuery] = useState('')
  const [replacement, setReplacement] = useState('')
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [busy, setBusy] = useState<'structure' | 'pdf' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [fallbackMode, setFallbackMode] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const sourceRef = useRef<HTMLTextAreaElement>(null)
  const restoredRef = useRef(false)
  const furnitureRef = useRef<HTMLDetailsElement>(null)
  const layoutRef = useRef<HTMLDetailsElement>(null)
  const searchRef = useRef<HTMLDetailsElement>(null)
  const formatRef = useRef<HTMLDivElement>(null)
  const header = options.header ?? DEFAULT_RENDER_OPTIONS.header!
  const footer = options.footer ?? DEFAULT_RENDER_OPTIONS.footer!
  const layout = options.layout ?? DEFAULT_RENDER_OPTIONS.layout!

  const updateFurniture = (kind: 'header' | 'footer', patch: Partial<PageFurniture>) => {
    const current = options[kind] ?? DEFAULT_RENDER_OPTIONS[kind]!
    onOptions({ ...options, [kind]: { ...current, ...patch } })
  }

  const updateText = useCallback((value: string, record = true) => {
    setText(value)
    setError(null)
    onStage?.(1)
    onDoc(value.trim() ? structureTextClient(value) : null)
    if (record) {
      setHistory((current) => [...current.slice(0, historyIndex + 1), value].slice(-80))
      setHistoryIndex((current) => Math.min(current + 1, 79))
    }
  }, [historyIndex, onDoc, onStage])

  useEffect(() => {
    if (restoredRef.current) return
    restoredRef.current = true
    if (!text.trim()) return
    onDoc(structureTextClient(text))
  }, [onDoc, text])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try { localStorage.setItem(AUTOSAVE_KEY, text); setSavedAt(Date.now()) } catch { /* stockage indisponible */ }
    }, 500)
    return () => window.clearTimeout(timer)
  }, [text])

  /** Import fichier .txt / .md côté client (lecture locale, aucun upload). */
  const importFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    void file.text().then((content) => {
      updateText(content)
      setFallbackMode(false)
    })
  }, [updateText])

  /** Structure le texte : backend prioritaire, repli 100 % client si indisponible. */
  const structure = useCallback(async (reveal = false) => {
    if (!text.trim()) return
    onStage?.(2)
    setBusy('structure')
    setError(null)
    try {
      onDoc(await structureText(text))
      onStage?.(3)
      if (reveal) onPreview?.()
    } catch {
      // Repli statique (Cloudflare Pages) : moteur de structuration JS local.
      onDoc(structureTextClient(text))
      onStage?.(3)
      if (reveal) onPreview?.()
      setFallbackMode(true)
    } finally {
      setBusy(null)
    }
  }, [text, onDoc, onPreview, onStage])

  const undo = () => {
    if (historyIndex <= 0) return
    const nextIndex = historyIndex - 1
    setHistoryIndex(nextIndex)
    updateText(history[nextIndex], false)
  }

  const redo = () => {
    if (historyIndex >= history.length - 1) return
    const nextIndex = historyIndex + 1
    setHistoryIndex(nextIndex)
    updateText(history[nextIndex], false)
  }

  const replaceAll = () => {
    if (!query) return
    const next = text.split(query).join(replacement)
    if (next !== text) updateText(next)
  }

  const reportCursorContext = () => {
    const input = sourceRef.current
    if (!input || !onCursorContext) return
    const before = text.slice(0, input.selectionStart)
    const paragraphs = before.split(/\n\s*\n/)
    onCursorContext((paragraphs[paragraphs.length - 1] ?? '').trim().slice(0, 120))
  }

  const closeShortcut = (target: HTMLElement | null) => {
    if (!target) return
    target.classList.add('shortcut-closing')
    window.setTimeout(() => {
      target.classList.remove('shortcut-visible', 'shortcut-closing')
      if (target instanceof HTMLDetailsElement) target.open = false
    }, 220)
  }

  const openShortcut = (target: HTMLElement | null) => {
    if (!target) return
    const wasOpen = target instanceof HTMLDetailsElement ? target.open : target.classList.contains('shortcut-visible')
    document.querySelectorAll<HTMLElement>('.shortcut-only, .shortcut-tools').forEach((panel) => {
      if (panel !== target) {
        if (panel instanceof HTMLDetailsElement ? panel.open : panel.classList.contains('shortcut-visible')) closeShortcut(panel)
      }
    })
    if (wasOpen) { closeShortcut(target); return }
    if (target instanceof HTMLDetailsElement) target.open = true
    else target.classList.add('shortcut-visible')
    target.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }

  const formatSelection = (marker: '**' | '*' | '++') => {
    const input = sourceRef.current
    if (!input) return
    const start = input.selectionStart
    const end = input.selectionEnd
    const selected = text.slice(start, end) || 'texte'
    const next = `${text.slice(0, start)}${marker}${selected}${marker}${text.slice(end)}`
    updateText(next)
    requestAnimationFrame(() => {
      input.focus()
      input.setSelectionRange(start + marker.length, start + marker.length + selected.length)
    })
  }

  const clearDocument = () => {
    setText('')
    setHistory([''])
    setHistoryIndex(0)
    setFallbackMode(false)
    setError(null)
    onStage?.(1)
    onDoc(null)
  }

  return (
    <section className="generator">
      <div className="gen-toolbar">
        <span className="toolbar-label">Document</span>
        <button className="btn" onClick={() => fileRef.current?.click()}>
          Importer .txt / .md
        </button>
        <input ref={fileRef} type="file" accept=".txt,.md,text/plain" onChange={importFile} hidden />
        <button
          className="btn"
          onClick={() => updateText(SAMPLE_TEXT)}
          title="Charger un document exemple pour tester le moteur"
        >
          ✨ Exemple
        </button>
        <button className="btn subtle-action" onClick={clearDocument} disabled={!text} title="Effacer le contenu et recommencer">
          Effacer
        </button>
        <button className="btn subtle-action" onClick={undo} disabled={historyIndex === 0} title="Annuler (Ctrl+Z)">↶ Annuler</button>
        <button className="btn subtle-action" onClick={redo} disabled={historyIndex >= history.length - 1} title="Rétablir (Ctrl+Y)">↷ Rétablir</button>
        <span className="spacer" />
        <span className="toolbar-label">Présentation</span>
        <label className="muted">
          Thème{' '}
          <select
            value={options.theme ?? 'editorial'}
            onChange={(e) => onOptions({ ...options, theme: e.target.value as RenderOptions['theme'] })}
          >
            <option value="editorial">Éditorial</option>
            <option value="corporate">Corporate</option>
            <option value="academic">Académique</option>
          </select>
        </label>
        <label className="muted">
          Format{' '}
          <select
            value={options.paper ?? 'a4'}
            onChange={(e) => onOptions({ ...options, paper: e.target.value as RenderOptions['paper'] })}
          >
            <option value="a4">A4</option>
            <option value="letter">Letter</option>
          </select>
        </label>
        <label className="muted">
          Police{' '}
          <select
            value={options.font ?? 'serif'}
            onChange={(e) => onOptions({ ...options, font: e.target.value as RenderOptions['font'] })}
          >
            <option value="serif">Sérif classique</option>
            <option value="sans">Sans sérif</option>
            <option value="modern">Moderne</option>
            <option value="mono">Monospace</option>
          </select>
        </label>
        <label className="muted">
          Orientation{' '}
          <select
            value={options.orientation ?? 'portrait'}
            onChange={(e) => onOptions({ ...options, orientation: e.target.value as RenderOptions['orientation'] })}
          >
            <option value="portrait">Portrait</option>
            <option value="landscape">Paysage</option>
          </select>
        </label>
      </div>

      <div className="gen-toolbar">
        <span className="toolbar-label">Action principale</span>
        {!doc ? <button className="btn primary" onClick={() => void structure(true)} disabled={busy !== null || !text.trim()} aria-busy={busy === 'structure'}>
          {busy === 'structure' ? 'Structuration…' : '✦ Structurer le document'}
        </button> : <span className="live-preview-hint">Aperçu en direct à droite</span>}
        <span className="document-state" role="status" aria-live="polite">
          <span className={`state-dot ${doc ? 'ready' : text.trim() ? 'attention' : ''}`} aria-hidden="true" />
          {!text.trim() ? 'Brouillon : ajoutez votre contenu' : !doc ? 'Structure à actualiser' : 'Aperçu prêt à vérifier'}
        </span>
        {fallbackMode && (
          <span className="muted" role="status" title="Le backend Python est injoignable : structuration et rendu PDF exécutés localement dans le navigateur.">
            ⚡ Mode local (navigateur) — activez l'API pour le rendu serveur premium.
          </span>
        )}
      </div>

      <details className="quick-drawer">
        <summary aria-label="Afficher les accès rapides">☷ <span>Options</span></summary>
        <nav className="quick-shortcuts" aria-label="Accès rapides aux options">
          <button type="button" className="quick-shortcut" onClick={() => openShortcut(formatRef.current)}>Aa <span>Formatage</span></button>
          <button type="button" className="quick-shortcut" onClick={() => openShortcut(searchRef.current)}>⌕ <span>Rechercher</span></button>
          <button type="button" className="quick-shortcut" onClick={() => openShortcut(layoutRef.current)}>▦ <span>Mise en page</span></button>
          <button type="button" className="quick-shortcut" onClick={() => openShortcut(furnitureRef.current)}>☷ <span>En-tête / pied</span></button>
        </nav>
      </details>

      <details ref={furnitureRef} className="print-customizer shortcut-only">
        <summary>Zones de page — en-tête et pied de page</summary>
        <p className="muted furniture-help">
          Variables : <code>{'{title}'}</code> titre du document · <code>{'{section}'}</code> section ·{' '}
          <code>{'{page}'}</code> page actuelle · <code>{'{pages}'}</code> nombre total de pages.
        </p>
        <div className="customizer-grid">
          <FurnitureEditor
            title="En-tête"
            value={header}
            onChange={(patch) => updateFurniture('header', patch)}
          />
          <FurnitureEditor
            title="Pied de page"
            value={footer}
            onChange={(patch) => updateFurniture('footer', patch)}
          />
        </div>
        <button
          type="button"
          className="btn reset-furniture"
          onClick={() => onOptions({
            ...options,
            header: { ...DEFAULT_RENDER_OPTIONS.header! },
            footer: { ...DEFAULT_RENDER_OPTIONS.footer! },
          })}
        >
          Réinitialiser les en-têtes et pieds de page
        </button>
        <button type="button" className="shortcut-close" onClick={() => closeShortcut(furnitureRef.current)}>Fermer les options</button>
      </details>

      <details ref={layoutRef} className="print-customizer layout-customizer shortcut-only">
        <summary>Rythme du document — espacement et texte</summary>
        <p className="muted furniture-help">Modifiez ces réglages pour corriger les espacements et l’équilibre du document avant de télécharger le PDF.</p>
        <div className="layout-controls">
          <label>Densité
            <select value={layout.density} onChange={(e) => onOptions({ ...options, layout: { ...layout, density: e.target.value as typeof layout.density } })}>
              <option value="compact">Compacte</option><option value="standard">Standard</option><option value="airy">Aérée</option>
            </select>
          </label>
          <label>Paragraphes
            <select value={layout.paragraphAlign} onChange={(e) => onOptions({ ...options, layout: { ...layout, paragraphAlign: e.target.value as typeof layout.paragraphAlign } })}>
              <option value="justify">Justifiés</option><option value="left">Alignés à gauche</option>
            </select>
          </label>
          <label>Espacement des titres
            <select value={layout.titleSpacing} onChange={(e) => onOptions({ ...options, layout: { ...layout, titleSpacing: e.target.value as typeof layout.titleSpacing } })}>
              <option value="compact">Serré</option><option value="standard">Standard</option><option value="airy">Aéré</option>
            </select>
          </label>
        </div>
        <button type="button" className="btn reset-furniture" onClick={() => onOptions({ ...options, layout: { ...DEFAULT_RENDER_OPTIONS.layout! } })}>
          Réinitialiser la mise en page
        </button>
        <button type="button" className="shortcut-close" onClick={() => closeShortcut(layoutRef.current)}>Fermer les options</button>
      </details>

      {error && <p className="error">{error}</p>}

      <label className="source-label" htmlFor="document-source">Contenu du document</label>
      <div ref={formatRef} className="editor-tools shortcut-tools" role="toolbar" aria-label="Outils de mise en forme du texte">
        <span className="editor-tools-label">Mise en forme</span>
        <button type="button" className="format-tool" onClick={() => formatSelection('**')} title="Gras">G</button>
        <button type="button" className="format-tool italic" onClick={() => formatSelection('*')} title="Italique">I</button>
        <button type="button" className="format-tool underline" onClick={() => formatSelection('++')} title="Souligner la sélection">S</button>
        <span className="muted format-help">Sélectionnez un passage puis choisissez un outil</span>
        <button type="button" className="shortcut-close" onClick={() => closeShortcut(formatRef.current)}>Fermer</button>
      </div>
      <details ref={searchRef} className="search-replace shortcut-only">
        <summary>Rechercher et remplacer</summary>
        <div className="search-replace-fields">
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Texte à rechercher" aria-label="Texte à rechercher" />
          <input value={replacement} onChange={(e) => setReplacement(e.target.value)} placeholder="Remplacer par" aria-label="Remplacer par" />
          <button type="button" className="btn" onClick={replaceAll} disabled={!query}>Remplacer tout</button>
        </div>
        {query && <span className="muted search-count">{text.split(query).length - 1} occurrence(s)</span>}
        <button type="button" className="shortcut-close" onClick={() => closeShortcut(searchRef.current)}>Fermer les options</button>
      </details>
      <textarea
        ref={sourceRef}
        id="document-source"
        className="source"
        value={text}
        onChange={(e) => updateText(e.target.value)}
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo() }
          if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); redo() }
        }}
        onSelect={reportCursorContext}
        onKeyUp={reportCursorContext}
        onClick={reportCursorContext}
        placeholder={
          'Collez ici votre texte brut…\n\n' +
          'Le moteur détecte automatiquement titres, listes, tableaux, encadrés,\n' +
          'et génère une mise en page professionnelle avec table des matières.\n\n' +
          'Astuce : cliquez sur "✨ Exemple" pour voir ce que fait le moteur.'
        }
        spellCheck={false}
        aria-describedby="document-source-help"
        aria-busy={busy === 'structure'}
      />
      <p id="document-source-help" className="muted stats">
        {text.trim() ? `${text.trim().split(/\s+/).length} mots · ${text.length} caractères` : 'Aucun texte saisi'}
        {savedAt ? ` · Brouillon sauvegardé à ${new Date(savedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}
      </p>
    </section>
  )
}
