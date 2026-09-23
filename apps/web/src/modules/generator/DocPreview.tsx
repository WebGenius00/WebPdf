/**
 * Aperçu web du Doc JSON (schéma doc/0.1).
 *
 * Objectif : montrer EXACTEMENT la structure que le renderer PDF va mettre
 * en page (mêmes blocs, même hiérarchie). Le style "page A4" imite le CSS
 * de packages/text-structurizer/renderer.py pour éviter toute surprise
 * entre l'aperçu écran et le PDF final.
 */

import type { Block, Doc } from '../../lib/doc'

/** Rend un bloc selon son type — exhaustive par construction du switch. */
function BlockView({ block }: { block: Block }) {
  switch (block.type) {
    case 'heading': {
      const Tag = (`h${Math.min(block.level, 3)}`) as 'h1' | 'h2' | 'h3'
      return (
        <Tag id={block.id}>
          {block.number && <span className="num">{block.number} </span>}
          {block.text}
        </Tag>
      )
    }
    case 'paragraph':
      return <p>{block.text}</p>
    case 'list':
      return block.ordered ? (
        <ol>{block.items.map((it, i) => <li key={i}>{it}</li>)}</ol>
      ) : (
        <ul>{block.items.map((it, i) => <li key={i}>{it}</li>)}</ul>
      )
    case 'definition':
      return (
        <p className="definition">
          <b>{block.term} :</b> {block.text}
        </p>
      )
    case 'callout':
      return (
        <aside className={`callout ${block.variant}`}>
          {block.title && <b>{block.title}</b>}
          <p>{block.text}</p>
        </aside>
      )
    case 'table':
      return (
        <table>
          {block.header.length > 0 && (
            <thead>
              <tr>{block.header.map((h, i) => <th key={i}>{h}</th>)}</tr>
            </thead>
          )}
          <tbody>
            {block.rows.map((row, i) => (
              <tr key={i}>{row.map((cell, j) => <td key={j}>{cell}</td>)}</tr>
            ))}
          </tbody>
          {block.caption && <caption>{block.caption}</caption>}
        </table>
      )
    case 'code':
      return (
        <pre>
          <code>{block.text}</code>
        </pre>
      )
    case 'quote':
      return (
        <blockquote>
          <p>{block.text}</p>
          {block.cite && <footer>— {block.cite}</footer>}
        </blockquote>
      )
    case 'image':
      return (
        <figure>
          <img src={block.src} alt={block.alt ?? ''} />
          {block.caption && <figcaption>{block.caption}</figcaption>}
        </figure>
      )
    default: {
      // Garde d'exhaustivité : tout nouveau type de bloc doit être géré ici.
      const _never: never = block
      return <p className="error">Bloc non géré : {JSON.stringify(_never)}</p>
    }
  }
}

export function DocPreview({ doc }: { doc: Doc | null }) {
  if (!doc) {
    return (
      <section className="preview">
        <p className="muted placeholder">
          L'aperçu du document structuré apparaîtra ici après clic sur « Structurer ».
        </p>
      </section>
    )
  }

  const { metadata, toc, blocks } = doc
  return (
    <section className="preview">
      <article className="page">
        <header className="cover-mini">
          <h1 className="doc-title">{metadata.title ?? 'Document sans titre'}</h1>
          {metadata.subtitle && <p className="subtitle">{metadata.subtitle}</p>}
          {metadata.author && <p className="byline">{metadata.author}</p>}
        </header>

        {toc.length > 0 && (
          <nav className="toc" aria-label="Table des matières">
            <h2>Sommaire</h2>
            <ul>
              {toc.map((entry) => (
                <li key={entry.id} data-level={entry.level}>
                  <a href={`#${entry.id}`}>
                    <span className="num">{entry.number}</span> {entry.text}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        )}

        {blocks.map((block, i) => (
          <BlockView key={i} block={block} />
        ))}
      </article>
    </section>
  )
}
