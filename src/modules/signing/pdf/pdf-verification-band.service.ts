import { Injectable } from '@nestjs/common';
import { PDFDocument, PDFFont, PDFPage, StandardFonts, degrees, rgb } from 'pdf-lib';
import * as QRCode from 'qrcode';
import { wrap } from './certificate.service';
import { encodeSafe } from './pdf-stamp.service';
import {
  getPageBox,
  rectToPdfLibDraw,
  visualPageSize,
  visualPointToPdf,
  type FieldRect,
} from './pdfCoords';

export interface VerificationBandData {
  verificationCode: string;
  verifyUrl: string;
  signerNames: string[];
}

/** Ancho del carril en el espacio visual (pt). */
const BAND_WIDTH = 40;
const BAND_PADDING = 4;
const QR_SIZE = 34;
const QR_RENDER_PX = 180;
const FONT_BODY = 5;
const FONT_CODE = 5.5;
const LINE_LEADING = 1.45;

const MUTED = rgb(0.42, 0.43, 0.51);
const INK = rgb(0.08, 0.09, 0.16);
const HAIRLINE = rgb(0.87, 0.85, 0.96);

const LABEL = 'Firmado electrónicamente';

/** Resume firmantes para el margen estrecho. */
export function formatSignersBandLine(names: string[]): string {
  const trimmed = names.map((n) => n.trim()).filter(Boolean);
  if (trimmed.length === 0) return '';
  if (trimmed.length === 1) return trimmed[0];
  if (trimmed.length === 2) return `${trimmed[0]} · ${trimmed[1]}`;
  return `${trimmed[0]} · ${trimmed[1]} +${trimmed.length - 2}`;
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
}

function lineHeight(size: number): number {
  return size * LINE_LEADING;
}

@Injectable()
export class PdfVerificationBandService {
  /**
   * Carril izquierdo con textos horizontales apilados (sin rotación) para evitar
   * superposición de glifos, más QR pequeño al pie de la franja.
   */
  async apply(pdf: Buffer | Uint8Array, data: VerificationBandData): Promise<Buffer> {
    const doc = await PDFDocument.load(pdf);
    const regular = await doc.embedFont(StandardFonts.Helvetica);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);

    const qrDataUrl = await QRCode.toDataURL(data.verifyUrl, {
      width: QR_RENDER_PX,
      margin: 0,
      color: { dark: '#141628', light: '#FFFFFF' },
    });
    const qrPng = await doc.embedPng(Buffer.from(qrDataUrl.split(',')[1], 'base64'));

    const signersLine = truncate(formatSignersBandLine(data.signerNames), 40);
    const pages = doc.getPages();

    for (let index = 0; index < pages.length; index++) {
      this.drawBand(
        pages[index],
        regular,
        bold,
        qrPng,
        data.verificationCode,
        signersLine,
        index + 1,
      );
    }

    return Buffer.from(await doc.save());
  }

  private drawBand(
    page: PDFPage,
    regular: PDFFont,
    bold: PDFFont,
    qr: Awaited<ReturnType<PDFDocument['embedPng']>>,
    verificationCode: string,
    signersLine: string,
    pageNumber: number,
  ): void {
    const box = getPageBox(page);
    const { Vw, Vh } = visualPageSize(box);
    const maxTextWidth = BAND_WIDTH - BAND_PADDING * 2;

    const lineTop = visualPointToPdf(BAND_WIDTH, 0, box);
    const lineBottom = visualPointToPdf(BAND_WIDTH, Vh, box);
    page.drawLine({
      start: lineTop,
      end: lineBottom,
      thickness: 0.75,
      color: HAIRLINE,
    });

    const qrRect: FieldRect = {
      page: pageNumber,
      x: BAND_PADDING / Vw,
      y: 1 - (BAND_PADDING + QR_SIZE) / Vh,
      w: QR_SIZE / Vw,
      h: QR_SIZE / Vh,
    };
    const qrDraw = rectToPdfLibDraw(qrRect, box);
    page.drawImage(qr, {
      x: qrDraw.x,
      y: qrDraw.y,
      width: qrDraw.width,
      height: qrDraw.height,
      rotate: degrees(qrDraw.rotate),
    });

    const textBlocks: Array<{ lines: string[]; size: number; font: PDFFont; color: ReturnType<typeof rgb> }> =
      [
        {
          lines: wrap(bold, LABEL, FONT_BODY, maxTextWidth),
          size: FONT_BODY,
          font: bold,
          color: INK,
        },
        {
          lines: wrap(bold, verificationCode, FONT_CODE, maxTextWidth),
          size: FONT_CODE,
          font: bold,
          color: MUTED,
        },
      ];

    if (signersLine) {
      textBlocks.push({
        lines: wrap(regular, signersLine, FONT_BODY, maxTextWidth),
        size: FONT_BODY,
        font: regular,
        color: MUTED,
      });
    }

    const qrZoneTopVy = Vh - BAND_PADDING - QR_SIZE - 6;
    let vy = BAND_PADDING + 2;

    for (const block of textBlocks) {
      if (vy + block.lines.length * lineHeight(block.size) > qrZoneTopVy) break;

      for (const line of block.lines) {
        if (vy + lineHeight(block.size) > qrZoneTopVy) break;
        this.drawBandLine(page, box, BAND_PADDING, vy, line, block.size, block.font, block.color);
        vy += lineHeight(block.size);
      }

      vy += 3;
    }
  }

  private drawBandLine(
    page: PDFPage,
    box: ReturnType<typeof getPageBox>,
    vx: number,
    vy: number,
    text: string,
    size: number,
    font: PDFFont,
    color: ReturnType<typeof rgb>,
  ): void {
    const { x, y } = visualPointToPdf(vx, vy, box);
    page.drawText(encodeSafe(font, text).text, { x, y, size, font, color });
  }
}
