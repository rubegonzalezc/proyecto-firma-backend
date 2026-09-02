import { Injectable, Logger } from '@nestjs/common';
import { PDFDocument, PDFFont, StandardFonts, degrees, rgb } from 'pdf-lib';
import { FieldRect, getPageBox, rectToPdfLibDraw, visualPageSize, visualPointToPdf } from './pdfCoords';

export type StampValue =
  | { kind: 'signature'; pngBase64: string }
  | { kind: 'text'; text: string; align?: 'left' | 'center'; bold?: boolean };

export interface StampInstruction {
  rect: FieldRect;
  value: StampValue;
}

export interface StampResult {
  bytes: Buffer;
  /** Caracteres que la fuente no pudo representar y se sustituyeron. */
  droppedCharacters: string[];
}

const TEXT_PADDING_PT = 2;
const MIN_FONT_PT = 6;
const MAX_FONT_PT = 14;

@Injectable()
export class PdfStampService {
  private readonly logger = new Logger(PdfStampService.name);

  /**
   * Estampa los campos indicados sobre el PDF.
   *
   * Esto vive en el servidor a propósito: el endpoint anterior aceptaba un PDF
   * ya firmado en base64 y lo guardaba sin comprobar nada, así que un cliente
   * podía subir cualquier documento y quedaba "verificado". Ahora el cliente
   * solo envía la imagen de la firma y los valores; las coordenadas y el
   * documento resultante los produce el servidor.
   */
  async stampFields(pdf: Buffer | Uint8Array, instructions: StampInstruction[]): Promise<StampResult> {
    const doc = await PDFDocument.load(pdf);

    // Un AcroForm sin aplanar puede repintarse encima de lo estampado.
    try {
      const form = doc.getForm();
      if (form.getFields().length > 0) form.flatten();
    } catch {
      this.logger.debug('El PDF no tiene formulario aplanable; se continúa igual');
    }

    const pages = doc.getPages();
    const dropped: string[] = [];
    let regular: PDFFont | undefined;
    let bold: PDFFont | undefined;

    for (const { rect, value } of instructions) {
      const page = pages[rect.page - 1];
      if (!page) {
        this.logger.warn(`Campo en página ${rect.page} inexistente; se omite`);
        continue;
      }

      const box = getPageBox(page);
      const draw = rectToPdfLibDraw(rect, box);

      if (value.kind === 'signature') {
        const image = await doc.embedPng(Buffer.from(value.pngBase64, 'base64'));
        // Conserva la proporción de la firma dentro de la caja.
        const scale = Math.min(draw.width / image.width, draw.height / image.height);
        const w = image.width * scale;
        const h = image.height * scale;
        const { Vw, Vh } = visualPageSize(box);

        const centered = rectToPdfLibDraw(
          {
            page: rect.page,
            x: rect.x + (draw.width - w) / 2 / Vw,
            y: rect.y + (draw.height - h) / 2 / Vh,
            w: w / Vw,
            h: h / Vh,
          },
          box,
        );

        page.drawImage(image, {
          x: centered.x,
          y: centered.y,
          width: centered.width,
          height: centered.height,
          rotate: degrees(centered.rotate),
        });
        continue;
      }

      const font = value.bold
        ? (bold ??= await doc.embedFont(StandardFonts.HelveticaBold))
        : (regular ??= await doc.embedFont(StandardFonts.Helvetica));

      const safe = encodeSafe(font, value.text);
      dropped.push(...safe.dropped);

      const { Vw, Vh } = visualPageSize(box);
      const boxWidthPt = rect.w * Vw - TEXT_PADDING_PT * 2;
      const boxHeightPt = rect.h * Vh;
      const size = fitFontSize(font, safe.text, boxWidthPt, boxHeightPt);
      const textWidth = font.widthOfTextAtSize(safe.text, size);
      const offsetX =
        value.align === 'center' ? (rect.w * Vw - textWidth) / 2 : TEXT_PADDING_PT;
      const baselineVy = rect.y * Vh + boxHeightPt / 2 + size * 0.35;
      const anchor = visualPointToPdf(rect.x * Vw + offsetX, baselineVy, box);

      page.drawText(safe.text, {
        x: anchor.x,
        y: anchor.y,
        size,
        font,
        color: rgb(0.12, 0.13, 0.16),
        rotate: degrees(box.rotation),
      });
    }

    return { bytes: Buffer.from(await doc.save()), droppedCharacters: [...new Set(dropped)] };
  }
}

/**
 * Helvetica solo codifica WinAnsi: los acentos del español pasan, pero un
 * nombre con "Ł" o caracteres CJK lanza excepción y abortaría la firma entera.
 * Se sustituyen esos caracteres y se informan, en vez de romper.
 *
 * La solución de fondo es incrustar un TTF con `@pdf-lib/fontkit`; hasta
 * entonces esto garantiza que la firma nunca falle por el nombre del firmante.
 */
export function encodeSafe(font: PDFFont, text: string): { text: string; dropped: string[] } {
  const dropped: string[] = [];
  let out = '';

  for (const char of text) {
    try {
      font.widthOfTextAtSize(char, 12);
      out += char;
    } catch {
      const fallback = char.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      try {
        font.widthOfTextAtSize(fallback, 12);
        out += fallback;
      } catch {
        out += '?';
      }
      dropped.push(char);
    }
  }

  return { text: out, dropped };
}

function fitFontSize(font: PDFFont, text: string, maxWidthPt: number, maxHeightPt: number): number {
  let size = Math.min(MAX_FONT_PT, Math.max(MIN_FONT_PT, maxHeightPt * 0.8));
  while (size > MIN_FONT_PT && font.widthOfTextAtSize(text, size) > maxWidthPt) {
    size -= 0.5;
  }
  return size;
}
