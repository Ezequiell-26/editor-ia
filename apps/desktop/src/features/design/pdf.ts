import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import type { DesignFormat } from '../../services/project-service';
import { designBackground, mountDesign } from './rasterize';

/**
 * Exporta un deck HTML a PDF: busca las secciones `data-slide`/`.slide`, las
 * dibuja con html2canvas (MIT) y arma una página por diapositiva con jsPDF
 * (MIT). Sin scripts ni Chrome. Si no hay secciones, exporta una sola página.
 */
export interface DesignPdfResult {
  readonly base64: string;
  readonly bytes: number;
  readonly pages: number;
  readonly width: number;
  readonly height: number;
}

function sliceToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return btoa(binary);
}

export async function renderDeckToPdf(
  html: string,
  format: DesignFormat = 'deck',
): Promise<DesignPdfResult> {
  const mounted = await mountDesign(html, format);
  try {
    const candidates = [
      ...mounted.frameDocument.querySelectorAll<HTMLElement>('[data-slide], .slide'),
    ];
    const slides = candidates.length > 0 ? candidates : [mounted.frameDocument.body];
    const pdf = new jsPDF({
      orientation: mounted.width >= mounted.height ? 'landscape' : 'portrait',
      unit: 'px',
      format: [mounted.width, mounted.height],
      compress: true,
      hotfixes: ['px_scaling'],
    });
    for (const [index, slide] of slides.entries()) {
      const canvas = await html2canvas(slide, {
        width: mounted.width,
        height: mounted.height,
        windowWidth: mounted.width,
        windowHeight: mounted.height,
        scrollX: 0,
        scrollY: 0,
        backgroundColor: designBackground(slide),
        scale: 1,
        logging: false,
        useCORS: false,
        allowTaint: false,
      });
      if (index > 0) {
        pdf.addPage([mounted.width, mounted.height], mounted.width >= mounted.height ? 'landscape' : 'portrait');
      }
      pdf.addImage(
        canvas.toDataURL('image/png'),
        'PNG',
        0,
        0,
        mounted.width,
        mounted.height,
        undefined,
        'FAST',
      );
    }
    const buffer = pdf.output('arraybuffer') as ArrayBuffer;
    return {
      base64: sliceToBase64(buffer),
      bytes: buffer.byteLength,
      pages: slides.length,
      width: mounted.width,
      height: mounted.height,
    };
  } finally {
    mounted.dispose();
  }
}
