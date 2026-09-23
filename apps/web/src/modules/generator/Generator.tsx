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

import { useCallback, useRef, useState } from 'react'
import { generatePdf, structureText, type RenderOptions } from '../../lib/api'
import type { Doc } from '../../lib/doc'
import { SAMPLE_TEXT } from './sample'

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
  const fileRef = useRef<HTMLInputElement>(null)

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

  const structure = useCallback(async () => {
    if (!text.trim()) return
    setBusy('structure')
    setError(null)
    try {
      onDoc(await structureText(text))
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err))
      onDoc(null)
    } finally {
      setBusy(null)
    }
  }, [text, onDoc])

  /** Télécharge le Blob PDF sous un nom dérivé du titre du document. */
  const download = useCallback(async () => {
    if (!text.trim()) return
    setBusy('pdf')
    setError(null)
    try {
      const blob = await generatePdf(text, options, doc)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      const title = doc?.metadata.title ?? 'document'
      a.href = url
      a.download = `${title.toLowerCase().replace(/[^\wà-ÿ-]+/g, '-').slice(0, 60)}.pdf`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err))
    } finally {
      setBusy(null)
    }
  }, [text, doc, options])

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
        {doc && <span className="muted">Aperçu structuré prêt — le PDF reprendra exactement cette structure.</span>}
      </div>

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
