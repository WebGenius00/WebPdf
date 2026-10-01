import html2canvas from 'html2canvas'
import { jsPDF } from 'jspdf'

interface PaperSize {
  width: number
  height: number
}

const PAPER: Record<'a4' | 'letter', PaperSize> = {
  a4: { width: 210, height: 297 },
  letter: { width: 215.9, height: 279.4 },
}

function paperSize(paper: 'a4' | 'letter', orientation: 'portrait' | 'landscape'): PaperSize {
  const size = PAPER[paper] ?? PAPER.a4
  return orientation === 'landscape' ? { width: size.height, height: size.width } : size
}

function safeFilename(title: string): string {
  return `${title.toLowerCase().replace(/[^\wà-ÿ-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'document'}.pdf`
}

function visibleBlockBoundaries(previewPage: HTMLElement, canvas: HTMLCanvasElement): number[] {
  const pageRect = previewPage.getBoundingClientRect()
  const scale = canvas.width / Math.max(1, pageRect.width)
  return Array.from(previewPage.children)
    .map((child) => {
      const rect = (child as HTMLElement).getBoundingClientRect()
      return Math.round((rect.bottom - pageRect.top) * scale)
    })
    .filter((bottom) => bottom > 0 && bottom < canvas.height)
    .sort((a, b) => a - b)
}

/**
 * Capture la page blanche affichée dans l’aperçu et la découpe sans la
 * re-structurer. Chaque page PDF est donc un extrait exact de ce que voit
 * l’utilisateur, dans le même ordre et avec les mêmes proportions.
 */
export async function downloadPreviewPdf(
  previewPage: HTMLElement,
  paper: 'a4' | 'letter' = 'a4',
  title = 'document',
  orientation: 'portrait' | 'landscape' = 'portrait',
  onProgress?: (progress: number) => void,
): Promise<void> {
  const size = paperSize(paper, orientation)
  onProgress?.(4)
  const canvas = await html2canvas(previewPage, {
    backgroundColor: '#ffffff',
    scale: Math.min(2, Math.max(1, window.devicePixelRatio || 1)),
    useCORS: true,
    logging: false,
    scrollX: 0,
    scrollY: -window.scrollY,
    windowWidth: previewPage.scrollWidth,
    windowHeight: previewPage.scrollHeight,
  })
  onProgress?.(48)

  const pdf = new jsPDF({ unit: 'mm', format: paper === 'letter' ? 'letter' : 'a4', orientation })
  const pageHeightPx = Math.max(1, Math.floor(canvas.width * size.height / size.width))
  const boundaries = visibleBlockBoundaries(previewPage, canvas)
  let sourceTop = 0
  let pageIndex = 0

  while (sourceTop < canvas.height) {
    const targetBottom = Math.min(canvas.height, sourceTop + pageHeightPx)
    const safeBottom = boundaries
      .filter((boundary) => boundary > sourceTop + 120 && boundary <= targetBottom)
      .pop() ?? targetBottom
    const sliceHeight = Math.max(1, safeBottom - sourceTop)
    const pageCanvas = document.createElement('canvas')
    pageCanvas.width = canvas.width
    pageCanvas.height = sliceHeight
    const pageContext = pageCanvas.getContext('2d')
    if (!pageContext) throw new Error('Impossible de préparer le PDF depuis l’aperçu')
    pageContext.fillStyle = '#ffffff'
    pageContext.fillRect(0, 0, pageCanvas.width, pageCanvas.height)
    pageContext.drawImage(canvas, 0, sourceTop, canvas.width, sliceHeight, 0, 0, canvas.width, sliceHeight)
    if (pageIndex > 0) pdf.addPage()
    const renderedHeight = sliceHeight / canvas.width * size.width
    pdf.addImage(pageCanvas.toDataURL('image/jpeg', 0.96), 'JPEG', 0, 0, size.width, renderedHeight, undefined, 'FAST')
    sourceTop = safeBottom
    pageIndex += 1
    onProgress?.(48 + Math.round(Math.min(1, sourceTop / canvas.height) * 48))
  }

  onProgress?.(100)
  pdf.save(safeFilename(title))
}
