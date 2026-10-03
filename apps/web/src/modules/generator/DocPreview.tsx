import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Block, Doc } from '../../lib/doc'
import type { LayoutOptions, PageFurniture } from '../../lib/api'

const PAPER_PIXELS = {
  a4: { width: 794, height: 1123 },
  letter: { width: 816, height: 1056 },
} as const

function paperPixels(paper: 'a4' | 'letter', orientation: 'portrait' | 'landscape') {
  const size = PAPER_PIXELS[paper]
  return orientation === 'landscape' ? { width: size.height, height: size.width } : size
}

/**
 * Remplace les variables d'en-tête/pied : {title}, {section}, {page}, {pages}.
 * Les variables inconnues sont retirées pour ne jamais afficher d'accolates.
 */
function fillFurnitureVars(template: string, vars: Record<string, string>): string {
  return template
    .replace(/\{title\}/g, vars.title)
    .replace(/\{section\}/g, vars.section)
    .replace(/\{page\}/g, vars.page)
    .replace(/\{pages\}/g, vars.pages)
    .replace(/\{[^{}]*\}/g, '')
}

/** Section courante (dernier titre h1/h2 rencontré) pour chaque bloc du document. */
function sectionByBlock(blocks: Block[]): string[] {
  let current = ''
  return blocks.map((block) => {
    if (block.type === 'heading' && (block.level === 1 || block.level === 2)) current = block.text
    return current
  })
}

function InlineText({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\+\+[^+]+\+\+)/g)
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={i}>{part.slice(2, -2)}</strong>
    if (part.startsWith('*') && part.endsWith('*')) return <em key={i}>{part.slice(1, -1)}</em>
    if (part.startsWith('`') && part.endsWith('`')) return <code key={i}>{part.slice(1, -1)}</code>
    if (part.startsWith('++') && part.endsWith('++')) return <u key={i}>{part.slice(2, -2)}</u>
    return <span key={i}>{part}</span>
  })
}

function BlockView({ block }: { block: Block }) {
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

function Cover({ metadata }: { metadata: Doc['metadata'] }) {
  return <header className="cover-mini"><h1 className="doc-title">{metadata.title ?? 'Document sans titre'}</h1>{metadata.subtitle && <p className="subtitle">{metadata.subtitle}</p>}{metadata.author && <p className="byline">{metadata.author}</p>}</header>
}

function TableOfContents({ toc }: { toc: Doc['toc'] }) {
  if (!toc.length) return null
  return <nav className="toc" aria-label="Table des matières"><h2>Sommaire</h2><ul>{toc.map((entry) => <li key={entry.id} data-level={entry.level}><a href={`#${entry.id}`}>{entry.number && <span className="num">{entry.number}</span>} {entry.text}</a></li>)}</ul></nav>
}

/** Une ligne d'en-tête ou de pied de page : trois zones alignées gauche/centre/droite. */
function FurnitureLine({ furniture, vars }: { furniture: PageFurniture; vars: Record<string, string> }) {
  return (
    <div className="sheet-furniture" aria-hidden="true">
      <span className="zone-left">{fillFurnitureVars(furniture.left, vars)}</span>
      <span className="zone-center">{fillFurnitureVars(furniture.center, vars)}</span>
      <span className="zone-right">{fillFurnitureVars(furniture.right, vars)}</span>
    </div>
  )
}

interface DocPreviewProps {
  doc: Doc | null
  layout?: LayoutOptions
  paper?: 'a4' | 'letter'
  orientation?: 'portrait' | 'landscape'
  font?: 'serif' | 'sans' | 'modern' | 'mono'
  header?: PageFurniture
  footer?: PageFurniture
  focusText?: string
  pageRef?: (node: HTMLElement | null) => void
}

export function DocPreview({ doc, layout, paper = 'a4', orientation = 'portrait', font = 'serif', header, footer, focusText = '', pageRef }: DocPreviewProps) {
  const previewRef = useRef<HTMLElement>(null)
  const measureRef = useRef<HTMLElement>(null)
  const [scale, setScale] = useState(1)
  const [pageGroups, setPageGroups] = useState<number[][] | null>(null)
  const paperSize = paperPixels(paper, orientation)
  const tocLength = doc?.toc.length ?? 0

  useEffect(() => {
    if (!focusText.trim()) return
    document.querySelector<HTMLElement>('.preview-block.preview-focus')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [focusText])

  useLayoutEffect(() => {
    const preview = previewRef.current
    const measure = measureRef.current
    if (!preview || !measure || !doc) return
    const update = () => {
      const available = Math.max(260, preview.clientWidth - 44)
      setScale(Math.min(1, available / paperSize.width))
      // Marges réelles lues dans le CSS (le jour où .page change de padding,
      // la pagination s'adapte automatiquement — aucune constante à maintenir).
      const measureStyles = window.getComputedStyle(measure)
      const padTop = Number.parseFloat(measureStyles.paddingTop) || 0
      const padBottom = Number.parseFloat(measureStyles.paddingBottom) || 0
      const contentStart = tocLength > 0 ? 2 : 1
      const children = Array.from(measure.children).slice(contentStart) as HTMLElement[]
      const top = measure.getBoundingClientRect().top
      const groups: number[][] = [[]]
      let page = 0
      for (let index = 0; index < children.length; index += 1) {
        const bottom = children[index].getBoundingClientRect().bottom - top
        // Limite de contenu de la page courante : hauteur papier moins les deux marges.
        const pageContentLimit = (page + 1) * paperSize.height - padTop - padBottom
        const containsHeading = Boolean(children[index].querySelector('h1, h2, h3'))
        const nextBottom = children[index + 1] ? children[index + 1].getBoundingClientRect().bottom - top : bottom
        // Un titre ne doit jamais rester seul en bas de page : s'il n'y a plus
        // la place pour le bloc qui le suit, le titre part sur la page suivante.
        const headingNeedsFollowingContent = containsHeading && nextBottom > pageContentLimit
        if (groups[page].length > 0 && (bottom > pageContentLimit || headingNeedsFollowingContent)) {
          page += 1
          groups[page] = []
        }
        groups[page].push(index)
      }
      setPageGroups(groups.filter((group) => group.length > 0))
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(preview)
    observer.observe(measure)
    return () => observer.disconnect()
  }, [doc, paper, orientation, font, layout, tocLength, paperSize.height, paperSize.width])

  if (!doc) return <section className="preview"><p className="muted placeholder">L’aperçu du document structuré apparaîtra ici après structuration.</p></section>

  const { metadata, toc, blocks } = doc
  const groups = pageGroups ?? [blocks.map((_, index) => index)]
  const sections = sectionByBlock(blocks)
  const pageClass = `page paper-${paper} orientation-${orientation} font-${font} density-${layout?.density ?? 'standard'} title-spacing-${layout?.titleSpacing ?? 'standard'} align-${layout?.paragraphAlign ?? 'justify'}`
  const stageHeight = groups.length * (paperSize.height * scale + 28) + 8
  const setPageRef = (node: HTMLElement | null) => pageRef?.(node)
  const hasHeader = Boolean(header?.enabled && (header.left || header.center || header.right))
  const hasFooter = Boolean(footer?.enabled && (footer.left || footer.center || footer.right))

  return (
    <section ref={previewRef} className="preview" aria-live="polite">
      <div className="preview-meta"><span>Format {paper.toUpperCase()} · {orientation === 'portrait' ? 'Portrait' : 'Paysage'}</span><strong>{groups.length} {groups.length > 1 ? 'pages' : 'page'}</strong></div>
      <div className="preview-stage paginated-preview" ref={setPageRef} style={{ height: stageHeight }}>
        {groups.map((group, pageIndex) => {
          const isCover = pageIndex === 0
          const showHeader = hasHeader && (!isCover || Boolean(header?.onCover))
          const showFooter = hasFooter && (!isCover || Boolean(footer?.onCover))
          const vars = {
            title: metadata.title ?? 'document',
            section: group.length > 0 ? sections[group[0]] ?? '' : '',
            page: String(pageIndex + 1),
            pages: String(groups.length),
          }
          return <div className="page-sheet" key={pageIndex} style={{ width: paperSize.width, height: paperSize.height, top: pageIndex * (paperSize.height + 28) * scale, transform: `translateX(-50%) scale(${scale})` }}>
            {showHeader && header && <div className="sheet-header"><FurnitureLine furniture={header} vars={vars} /></div>}
            {showFooter && footer && <div className="sheet-footer"><FurnitureLine furniture={footer} vars={vars} /></div>}
            <article className={pageClass} style={{ width: paperSize.width, minHeight: paperSize.height }}>
              {isCover && <><Cover metadata={metadata}/><TableOfContents toc={toc}/></>}
              {group.map((blockIndex) => {
                const blockText = JSON.stringify(blocks[blockIndex]).toLowerCase()
                const focused = focusText.trim().length > 8 && blockText.includes(focusText.trim().toLowerCase())
                return <div className={`preview-block${focused ? ' preview-focus' : ''}`} key={blockIndex}><BlockView block={blocks[blockIndex]} /></div>
              })}
            </article>
          </div>})}
        <article ref={measureRef} className={`${pageClass} preview-measure`} style={{ width: paperSize.width, minHeight: paperSize.height }} aria-hidden="true"><Cover metadata={metadata}/><TableOfContents toc={toc}/>{blocks.map((block, index) => <div className="preview-block" key={index}><BlockView block={block} /></div>)}</article>
      </div>
    </section>
  )
}
