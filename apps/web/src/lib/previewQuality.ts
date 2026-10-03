export interface PreviewQualityIssue {
  type: 'empty-page' | 'orphan-heading' | 'overflow' | 'empty-heading'
  page: number
  message: string
}

/** Vérifie uniquement les feuilles réellement affichées, jamais la feuille de mesure cachée. */
export function inspectPreviewQuality(root: HTMLElement): PreviewQualityIssue[] {
  const sheets = Array.from(root.querySelectorAll<HTMLElement>('.page-sheet'))
  const issues: PreviewQualityIssue[] = []

  sheets.forEach((sheet, index) => {
    const article = sheet.querySelector<HTMLElement>('.page')
    if (!article) return
    const pageNumber = index + 1
    const text = article.textContent?.replace(/\s+/g, ' ').trim() ?? ''
    if (!text) {
      // Une page peut n'être composée que d'éléments non textuels
      // (image, tableau, code) : ce n'est pas une page vide.
      const hasVisualContent = article.querySelector('img, table, pre, svg') !== null
      if (!hasVisualContent) {
        issues.push({ type: 'empty-page', page: pageNumber, message: `La page ${pageNumber} est vide.` })
        return
      }
    }

    const blocks = Array.from(article.querySelectorAll<HTMLElement>(':scope > .preview-block'))
    if (article.scrollHeight > article.clientHeight + 2) {
      issues.push({ type: 'overflow', page: pageNumber, message: `Le contenu dépasse la limite visible de la page ${pageNumber}.` })
    }
    const pageBottom = article.getBoundingClientRect().bottom
    blocks.forEach((block, blockIndex) => {
      const heading = block.querySelector<HTMLElement>('h1, h2, h3')
      if (!heading) return
      if (!heading.textContent?.trim()) {
        issues.push({ type: 'empty-heading', page: pageNumber, message: `Un titre vide est présent sur la page ${pageNumber}.` })
        return
      }
      const headingBottom = heading.getBoundingClientRect().bottom
      const hasFollowingContent = blocks.slice(blockIndex + 1).some((next) => Boolean(next.textContent?.replace(/\s+/g, '').trim()))
      const remainingSpace = pageBottom - headingBottom
      if (!hasFollowingContent && remainingSpace < 150) {
        issues.push({ type: 'orphan-heading', page: pageNumber, message: `Le titre « ${heading.textContent?.trim() ?? 'sans titre'} » est isolé en bas de la page ${pageNumber}.` })
      }
    })
  })

  return issues
}
