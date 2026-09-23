/**
 * Contrat "Doc JSON" (schéma doc/0.1) — source de vérité partagée entre :
 *   - packages/text-structurizer/structurizer.py  (émetteur, côté serveur)
 *   - apps/web (aperçu éditable + rendu HTML côté client)
 *   - packages/text-structurizer/renderer.py      (consommateur → PDF)
 *
 * Toute évolution du schéma doit être rétro-compatible ou versionnée
 * (champ `schema` explicite).
 */

export const SCHEMA_VERSION = 'doc/0.1'

/** Métadonnées document (extraites heuristiquement ou saisies par l'utilisateur). */
export interface DocMetadata {
  title?: string
  subtitle?: string
  author?: string
  date?: string
  /** Nombre de mots estimé (statistique éditoriale). */
  wordCount?: number
}

/** Entrée de table des matières (générée depuis les headings). */
export interface TocEntry {
  level: 1 | 2 | 3
  /** Numérotation automatique type "1", "1.2", "Annexe A"… */
  number: string
  text: string
  id: string
}

/** Types de blocs supportés par le renderer (PDF et aperçu web). */
export type BlockType =
  | 'heading'
  | 'paragraph'
  | 'list'
  | 'definition'
  | 'callout'
  | 'table'
  | 'code'
  | 'quote'
  | 'image'

export interface HeadingBlock {
  type: 'heading'
  level: 1 | 2 | 3
  text: string
  number?: string
  id?: string
}

export interface ParagraphBlock {
  type: 'paragraph'
  text: string
}

export interface ListBlock {
  type: 'list'
  ordered: boolean
  items: string[]
}

export interface DefinitionBlock {
  type: 'definition'
  term: string
  text: string
}

/** Encadré éditorial : note / astuce / avertissement. */
export interface CalloutBlock {
  type: 'callout'
  variant: 'note' | 'tip' | 'warning'
  title?: string
  text: string
}

export interface TableBlock {
  type: 'table'
  header: string[]
  rows: string[][]
  caption?: string
}

export interface CodeBlock {
  type: 'code'
  language?: string
  text: string
}

export interface QuoteBlock {
  type: 'quote'
  text: string
  cite?: string
}

export interface ImageBlock {
  type: 'image'
  src: string
  alt?: string
  caption?: string
}

export type Block =
  | HeadingBlock
  | ParagraphBlock
  | ListBlock
  | DefinitionBlock
  | CalloutBlock
  | TableBlock
  | CodeBlock
  | QuoteBlock
  | ImageBlock

/** Document structuré complet — racine du contrat. */
export interface Doc {
  schema: typeof SCHEMA_VERSION | string
  metadata: DocMetadata
  toc: TocEntry[]
  blocks: Block[]
}

/** Garde de type légère : valide la forme minimale d'un Doc reçu de l'API. */
export function isDoc(value: unknown): value is Doc {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Partial<Doc>
  return (
    typeof v.schema === 'string' &&
    Array.isArray(v.blocks) &&
    Array.isArray(v.toc) &&
    typeof v.metadata === 'object' &&
    v.metadata !== null
  )
}
