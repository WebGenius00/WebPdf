import html2canvas from 'html2canvas'
import { jsPDF } from 'jspdf'

interface PaperSize { width: number; height: number }
const PAPER: Record<'a4' | 'letter', PaperSize> = { a4: { width: 210, height: 297 }, letter: { width: 215.9, height: 279.4 } }
function paperSize(paper: 'a4' | 'letter', orientation: 'portrait' | 'landscape'): PaperSize {
  const size = PAPER[paper] ?? PAPER.a4
  return orientation === 'landscape' ? { width: size.height, height: size.width } : size
}
function safeFilename(title: string): string {
  return `${title.toLowerCase().replace(/[^\wà-ÿ-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'document'}.pdf`
}

/** Capture chaque feuille .page-sheet telle qu’elle est affichée dans l’aperçu. */
export async function downloadPreviewPdf(
  previewRoot: HTMLElement,
  paper: 'a4' | 'letter' = 'a4',
  title = 'document',
  orientation: 'portrait' | 'landscape' = 'portrait',
  onProgress?: (progress: number) => void,
): Promise<void> {
  const size = paperSize(paper, orientation)
  const sheets = Array.from(previewRoot.querySelectorAll<HTMLElement>('.page-sheet'))
  if (!sheets.length) throw new Error('Aucune feuille disponible dans l’aperçu')
  const pdf = new jsPDF({ unit: 'mm', format: paper === 'letter' ? 'letter' : 'a4', orientation })

  for (let index = 0; index < sheets.length; index += 1) {
    const sheet = sheets[index]
    const previousTransform = sheet.style.transform
    // Capture à la taille papier de référence, même si la feuille est réduite
    // pour tenir dans un écran mobile ou dans la colonne de droite.
    sheet.style.transform = 'none'
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    try {
      const canvas = await html2canvas(sheet, {
        backgroundColor: '#ffffff',
        scale: 2,
        useCORS: true,
        logging: false,
        scrollX: 0,
        scrollY: 0,
        width: sheet.offsetWidth,
        height: sheet.offsetHeight,
        windowWidth: sheet.offsetWidth,
        windowHeight: sheet.offsetHeight,
      })
      if (index > 0) pdf.addPage()
      pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, size.width, size.height, undefined, 'FAST')
    } finally {
      sheet.style.transform = previousTransform
    }
    onProgress?.(48 + Math.round(((index + 1) / sheets.length) * 48))
  }

  onProgress?.(100)
  pdf.save(safeFilename(title))
}
