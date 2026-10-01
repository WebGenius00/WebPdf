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

function safeFilename(title: string): string {
  return `${title.toLowerCase().replace(/[^\wà-ÿ-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'document'}.pdf`
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
  onProgress?: (progress: number) => void,
): Promise<void> {
  const size = PAPER[paper] ?? PAPER.a4
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

  const pdf = new jsPDF({ unit: 'mm', format: paper === 'letter' ? 'letter' : 'a4', orientation: 'portrait' })
  const pageHeightPx = Math.max(1, Math.floor(canvas.width * size.height / size.width))
  const pageCount = Math.max(1, Math.ceil(canvas.height / pageHeightPx))
  const pageCanvas = document.createElement('canvas')
  pageCanvas.width = canvas.width
  pageCanvas.height = pageHeightPx
  const pageContext = pageCanvas.getContext('2d')
  if (!pageContext) throw new Error('Impossible de préparer le PDF depuis l’aperçu')

  for (let index = 0; index < pageCount; index += 1) {
    if (index > 0) pdf.addPage()
    pageContext.fillStyle = '#ffffff'
    pageContext.fillRect(0, 0, pageCanvas.width, pageCanvas.height)
    pageContext.drawImage(canvas, 0, index * pageHeightPx, canvas.width, pageHeightPx, 0, 0, canvas.width, pageHeightPx)
    pdf.addImage(pageCanvas.toDataURL('image/jpeg', 0.94), 'JPEG', 0, 0, size.width, size.height, undefined, 'FAST')
    onProgress?.(48 + Math.round(((index + 1) / pageCount) * 48))
  }

  onProgress?.(100)
  pdf.save(safeFilename(title))
}
