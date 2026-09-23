/**
 * Module Génération PDF — colonne de gauche : saisie/import du texte brut.
 *
 * Flux :
 *   1. l'utilisateur colle/importe un texte (.txt/.md),
 *   2. "Structurer" appelle POST /api/structure → Doc JSON,
 *   3. l'aperçu (DocPreview) affiche le résultat éditablement,
 *   4. "Télécharger le PDF" appelle POST /api/generate → Blob PDF.
 *
 * L'état (texte + doc) vit ici et est remonté à App via les props pour
 * partager l'aperçu entre les deux panneaux sans refaire d'appel API.
 */

import { useCallback, useRef, useState } from 'react'
import { generatePdf, structureText } from '../../lib/api'
import type { Doc } from '../../lib/doc'

interface GeneratorProps {
  doc: Doc | null
  onDoc: (doc: Doc | null) => void
}

export function Generator({ doc, onDoc }: GeneratorProps) {
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
    })
  }, [])

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
      const blob = await generatePdf(text)
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
  }, [text, doc])

  return (
    <section className="generator">
      <div className="gen-toolbar">
        <button className="btn" onClick={() => fileRef.current?.click()}>
          Importer .txt / .md
        </button>
        <input ref={fileRef} type="file" accept=".txt,.md,text/plain" onChange={importFile} hidden />
        <span className="spacer" />
        <button className="btn primary" onClick={structure} disabled={busy !== null || !text.trim()}>
          {busy === 'structure' ? 'Structuration…' : '✦ Structurer'}
        </button>
        <button className="btn" onClick={download} disabled={busy !== null || !text.trim()}>
          {busy === 'pdf' ? 'Génération…' : '⬇ Télécharger le PDF'}
        </button>
      </div>

      {error && <p className="error">{error}</p>}

      <textarea
        className="source"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={
          'Collez ici votre texte brut…\n\n' +
          'Le moteur détecte automatiquement titres, listes, tableaux, encadrés,\n' +
          'et génère une mise en page professionnelle avec table des matières.'
        }
        spellCheck={false}
      />
      <p className="muted stats">
        {text.trim() ? `${text.trim().split(/\s+/).length} mots` : 'Aucun texte saisi'}
      </p>
    </section>
  )
}
