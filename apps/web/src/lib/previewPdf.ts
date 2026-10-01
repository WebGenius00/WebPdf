import html2canvas from 'html2canvas'
import { jsPDF } from 'jspdf'
import type { RenderOptions } from './api'

const PAPER: Record<NonNullable<RenderOptions['paper']>, { width: number; height: number }> = {
  a4: { width: 210, height: 297 },
  letter: { width: 215.9, height: 279.4 },
}

/**
 * Exporte exactement le contenu visuel de l'aperçu.
 *
 * Le DOM de l'article `.page` est capturé tel qu'il est affiché, puis découpé
 * en feuilles au ratio A4/Letter sans recalculer la typographie ni la largeur
 * des blocs. Ainsi, le bouton Télécharger ne repasse plus par un second moteur
 * de mise en page différent de celui que l'utilisateur vient de valider.
 */
export async function exportPreviewPdf(
  element: HTMLElement,
  options: RenderOptions = {},
  filename = 'document.pdf',
): Promise<void> {
  const paper = PAPER[options.paper ?? 'a4'] ?? PAPER.a4
  const canvas = await html2canvas(element, {
    backgroundColor: '#ffffff',
    scale: Math.min(2, window.devicePixelRatio || 1),
    useCORS: true,
    logging: false,
    width: element.scrollWidth,
    height: element.scrollHeight,
    windowWidth: Math.max(document.documentElement.clientWidth, element.scrollWidth),
    windowHeight: Math.max(document.documentElement.clientHeight, element.scrollHeight),
  })

  const sliceHeight = Math.max(1, Math.floor(canvas.width * paper.height / paper.width))
  const pageCount = Math.max(1, Math.ceil(canvas.height / sliceHeight))
  const pdf = new jsPDF({ unit: 'mm', format: options.paper === 'letter' ? 'letter' : 'a4' })

  for (let page = 0; page < pageCount; page += 1) {
    if (page > 0) pdf.addPage()
    const sourceY = page * sliceHeight
    const currentHeight = Math.min(sliceHeight, canvas.height - sourceY)
    const slice = document.createElement('canvas')
    slice.width = canvas.width
    slice.height = sliceHeight
    const context = slice.getContext('2d')
    if (!context) throw new Error('Impossible de préparer la page PDF')
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, slice.width, slice.height)
    context.drawImage(canvas, 0, sourceY, canvas.width, currentHeight, 0, 0, canvas.width, currentHeight)
    pdf.addImage(slice.toDataURL('image/png'), 'PNG', 0, 0, paper.width, paper.height)
  }

  pdf.save(filename)
}
