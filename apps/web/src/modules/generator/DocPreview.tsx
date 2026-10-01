/**
 * Aperçu web du Doc JSON (schéma doc/0.1).
 * L’article est une feuille papier calibrée : elle est seulement réduite
 * visuellement pour tenir dans le panneau, jamais étirée ni reflowée.
 */

import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import type { Block, Doc } from '../../lib/doc'
import type { LayoutOptions } from '../../lib/api'

const PAPER_PIXELS = {
  a4: { width: 794, height: 1123 },
  letter: { width: 816, height: 1056 },
} as const

function InlineText({ text }: { text: string }): ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g)
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={i}>{part.slice(2, -2)}</strong>
    if (part.startsWith('*') && part.endsWith('*')) return <em key={i}>{part.slice(1, -1)}</em>
    if (part.startsWith('`') && part.endsWith('`')) return <code key={i}>{part.slice(1, -1)}</code>
    return <span key={i}>{part}</span>
  })
}

function BlockView({ block }: { block: Block }): ReactNode {
  switch (block.type) {
    case 'heading': {
      const Tag = (`h${Math.min(block.level, 3)}`) as 'h1' | 'h2' | 'h3'
      return <Tag id={block.id}>{block.number && <span className="num">{block.number} </span>}<InlineText text={block.text} /></Tag>
    }
    case 'paragraph': return <p><InlineText text={block.text} /></p>
    case 'list': return block.ordered ? <ol>{block.items.map((it, i) => <li key={i}><InlineText text={it} /></li>)}</ol> : <ul>{block.items.map((it, i) => <li key={i}><InlineText text={it} /></li>)}</ul>
    case 'definition': return <p className="definition"><b><InlineText text={block.term} /> :</b> <InlineText text={block.text} /></p>
    case 'callout': return <aside className={`callout ${block.variant}`}>{block.title && <b><InlineText text={block.title} /></b>}<p><InlineText text={block.text} /></p></aside>
    case 'table': return <table>{block.header.length > 0 && <thead><tr>{block.header.map((h, i) => <th key={i}><InlineText text={h} /></th>)}</tr></thead>}<tbody>{block.rows.map((row, i) => <tr key={i}>{row.map((cell, j) => <td key={j}><InlineText text={cell} /></td>)}</tr>)}</tbody>{block.caption && <caption>{block.caption}</caption>}</table>
    case 'code': return <pre><code>{block.text}</code></pre>
    case 'quote': return <blockquote><p><InlineText text={block.text} /></p>{block.cite && <footer>— <InlineText text={block.cite} /></footer>}</blockquote>
    case 'image': return <figure><img src={block.src} alt={block.alt ?? ''} />{block.caption && <figcaption>{block.caption}</figcaption>}</figure>
    default: { const _never: never = block; return <p className="error">Bloc non géré : {JSON.stringify(_never)}</p> }
  }
}

interface DocPreviewProps {
  doc: Doc | null
  layout?: LayoutOptions
  paper?: 'a4' | 'letter'
  font?: 'serif' | 'sans' | 'modern' | 'mono'
  pageRef?: (node: HTMLElement | null) => void
}

export function DocPreview({ doc, layout, paper = 'a4', font = 'serif', pageRef }: DocPreviewProps) {
  const previewRef = useRef<HTMLElement>(null)
  const articleRef = useRef<HTMLElement>(null)
  const [scale, setScale] = useState(1)
  const [contentHeight, setContentHeight] = useState<number>(PAPER_PIXELS[paper].height)
  const paperSize = PAPER_PIXELS[paper]

  useLayoutEffect(() => {
    const preview = previewRef.current
    const article = articleRef.current
    if (!preview || !article) return
    const update = () => {
      const available = Math.max(260, preview.clientWidth - 44)
      const nextScale = Math.min(1, available / paperSize.width)
      setScale(nextScale)
      setContentHeight(Math.max(paperSize.height, article.scrollHeight))
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(preview)
    observer.observe(article)
    return () => observer.disconnect()
  }, [doc, paper, paperSize.height, paperSize.width])

  if (!doc) return <section className="preview"><p className="muted placeholder">L’aperçu du document structuré apparaîtra ici après structuration.</p></section>

  const { metadata, toc, blocks } = doc
  const setPageRef = (node: HTMLElement | null) => {
    articleRef.current = node
    pageRef?.(node)
  }
  const stageHeight = Math.max(paperSize.height, contentHeight) * scale + 44

  return (
    <section ref={previewRef} className="preview" aria-live="polite">
      <div className="preview-stage" style={{ height: stageHeight }}>
        <article ref={setPageRef} className={`page paper-${paper} font-${font} density-${layout?.density ?? 'standard'} title-spacing-${layout?.titleSpacing ?? 'standard'} align-${layout?.paragraphAlign ?? 'justify'}`} style={{ width: paperSize.width, minHeight: paperSize.height, transform: `scale(${scale})` }}>
          <header className="cover-mini"><h1 className="doc-title">{metadata.title ?? 'Document sans titre'}</h1>{metadata.subtitle && <p className="subtitle">{metadata.subtitle}</p>}{metadata.author && <p className="byline">{metadata.author}</p>}</header>
          {toc.length > 0 && <nav className="toc" aria-label="Table des matières"><h2>Sommaire</h2><ul>{toc.map((entry) => <li key={entry.id} data-level={entry.level}><a href={`#${entry.id}`}><span className="num">{entry.number}</span> {entry.text}</a></li>)}</ul></nav>}
          {blocks.map((block, i) => <BlockView key={i} block={block} />)}
        </article>
      </div>
    </section>
  )
}
