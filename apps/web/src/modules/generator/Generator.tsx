/**
 * Module Génération PDF — colonne de gauche : saisie/import du texte brut.
 *
 * Flux :
 *   1. l'utilisateur colle/importe un texte (.txt/.md),
 *      ou charge le document d'exemple pour découvrir le moteur,
 *   2. "Structurer" appelle POST /api/structure → Doc JSON (aperçu à droite),
 *   3. "Télécharger le PDF" appelle POST /api/generate en envoyant le Doc
 *      JSON déjà validé : le PDF est strictement fidèle à l'aperçu,
 *   4. thème & format papier sont choisis ici et passés au renderer.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  DEFAULT_RENDER_OPTIONS,
  generatePdf,
  structureText,
  type PageFurniture,
  type RenderOptions,
} from '../../lib/api'
import type { Doc } from '../../lib/doc'
import { SAMPLE_TEXT } from './sample'

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
  options: RenderOptions
  onOptions: (o: RenderOptions) => void
}

export function Generator({ doc, onDoc, options, onOptions }: GeneratorProps) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState<'structure' | 'pdf' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [fallbackMode, setFallbackMode] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const header = options.header ?? DEFAULT_RENDER_OPTIONS.header!
  const footer = options.footer ?? DEFAULT_RENDER_OPTIONS.footer!
  const layout = options.layout ?? DEFAULT_RENDER_OPTIONS.layout!

  const updateFurniture = (kind: 'header' | 'footer', patch: Partial<PageFurniture>) => {
    const current = options[kind] ?? DEFAULT_RENDER_OPTIONS[kind]!
    onOptions({ ...options, [kind]: { ...current, ...patch } })
  }

  /** Import fichier .txt / .md côté client (lecture locale, aucun upload). */
  const importFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    void file.text().then((content) => {
      setText(content)
      setError(null)
      onDoc(null) // le texte a changé : l'ancien aperçu n'est plus valable
    })
  }, [onDoc])

  /** Structure le texte : backend prioritaire, repli 100 % client si indisponible. */
  const structure = useCallback(async () => {
    if (!text.trim()) return
    setBusy('structure')
    setError(null)
    try {
      onDoc(await structureText(text))
    } catch (err) {
      // Repli statique (Cloudflare Pages) : moteur de structuration JS local.
      try {
        const { structureTextClient } = await import('../../lib/structurizerClient')
        onDoc(structureTextClient(text))
        setFallbackMode(true)
      } catch {
        setError(String(err instanceof Error ? err.message : err))
        onDoc(null)
      }
    } finally {
      setBusy(null)
    }
  }, [text, onDoc])

  // L’aperçu se met à jour automatiquement après une courte pause de saisie.
  useEffect(() => {
    if (!text.trim()) return
    const timer = window.setTimeout(() => {
      if (!busy) void structure()
    }, 700)
    return () => window.clearTimeout(timer)
  }, [text, busy, structure])

  /** Télécharge le Blob PDF sous un nom dérivé du titre du document. */
  const download = useCallback(async () => {
    if (!text.trim()) return
    setBusy('pdf')
    setError(null)
    try {
      // Sans Doc structuré, on le produit d'abord (indispensable au rendu).
      let current = doc
      if (!current) {
        try {
          current = await structureText(text)
        } catch {
          const { structureTextClient } = await import('../../lib/structurizerClient')
          current = structureTextClient(text)
          setFallbackMode(true)
        }
        onDoc(current)
      }
      // jsPDF n'est chargé qu'au moment de générer.
      const { backendCanGenerate, renderDocClient } = await import('../../lib/renderClient')
      if (fallbackMode || !(await backendCanGenerate())) {
        setFallbackMode(true)
        renderDocClient(current, options) // moteur jsPDF local
        return
      }
      const blob = await generatePdf(text, options, current)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      const title = current.metadata.title ?? 'document'
      a.href = url
      a.download = `${title.toLowerCase().replace(/[^\wà-ÿ-]+/g, '-').slice(0, 60)}.pdf`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err))
    } finally {
      setBusy(null)
    }
  }, [text, doc, options, onDoc, fallbackMode])

  return (
    <section className="generator">
      <div className="gen-toolbar">
        <button className="btn" onClick={() => fileRef.current?.click()}>
          Importer .txt / .md
        </button>
        <input ref={fileRef} type="file" accept=".txt,.md,text/plain" onChange={importFile} hidden />
        <button
          className="btn"
          onClick={() => { setText(SAMPLE_TEXT); onDoc(null); setError(null) }}
          title="Charger un document exemple pour tester le moteur"
        >
          ✨ Exemple
        </button>
        <span className="spacer" />
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
      </div>

      <div className="gen-toolbar">
        <button className="btn primary" onClick={structure} disabled={busy !== null || !text.trim()}>
          {busy === 'structure' ? 'Structuration…' : '✦ Structurer'}
        </button>
        <button className="btn" onClick={download} disabled={busy !== null || !text.trim()}>
          {busy === 'pdf' ? 'Génération…' : '⬇ Télécharger le PDF'}
        </button>
        {doc && !fallbackMode && <span className="muted">Aperçu structuré prêt — le PDF reprendra exactement cette structure.</span>}
        {fallbackMode && (
          <span className="muted" title="Le backend Python est injoignable : structuration et rendu PDF exécutés localement dans le navigateur.">
            ⚡ Mode local (navigateur) — activez l'API pour le rendu serveur premium.
          </span>
        )}
      </div>

      <details className="print-customizer">
        <summary>Personnaliser les en-têtes et pieds de page</summary>
        <p className="muted furniture-help">
          Variables : <code>{'{title}'}</code> titre du document · <code>{'{section}'}</code> section ·{' '}
          <code>{'{page}'}</code> page actuelle · <code>{'{pages}'}</code> nombre total de pages.
        </p>
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
      </details>

      <details className="print-customizer layout-customizer">
        <summary>Contrôler la mise en page avant génération</summary>
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
      </details>

      {error && <p className="error">{error}</p>}

      <textarea
        className="source"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={
          'Collez ici votre texte brut…\n\n' +
          'Le moteur détecte automatiquement titres, listes, tableaux, encadrés,\n' +
          'et génère une mise en page professionnelle avec table des matières.\n\n' +
          'Astuce : cliquez sur "✨ Exemple" pour voir ce que fait le moteur.'
        }
        spellCheck={false}
      />
      <p className="muted stats">
        {text.trim() ? `${text.trim().split(/\s+/).length} mots · ${text.length} caractères` : 'Aucun texte saisi'}
      </p>
    </section>
  )
}
