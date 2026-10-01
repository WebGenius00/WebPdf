export interface PreviewQualityIssue {
  type: 'empty-page' | 'orphan-heading'
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
      issues.push({ type: 'empty-page', page: pageNumber, message: `La page ${pageNumber} est vide.` })
      return
    }

    const blocks = Array.from(article.querySelectorAll<HTMLElement>(':scope > .preview-block'))
    const pageBottom = article.getBoundingClientRect().bottom
    blocks.forEach((block, blockIndex) => {
      const heading = block.querySelector<HTMLElement>('h1, h2, h3')
      if (!heading) return
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
