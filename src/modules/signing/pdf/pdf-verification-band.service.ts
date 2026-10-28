import { Injectable } from '@nestjs/common';
import { PDFDocument, PDFFont, PDFPage, StandardFonts, degrees, rgb } from 'pdf-lib';
import * as QRCode from 'qrcode';
import { encodeSafe } from './pdf-stamp.service';
import {
  getPageBox,
  rectToPdfLibDraw,
  visualPageSize,
  visualPointToPdf,
  type FieldRect,
  type PageBox,
} from './pdfCoords';

export interface VerificationBandData {
  verificationCode: string;
  verifyUrl: string;
  signerNames: string[];
}

/** Ancho del carril en el espacio visual (pt), fuera del área habitual de lectura. */
const BAND_WIDTH = 36;
const BAND_PADDING = 5;
const QR_SIZE = 36;
const QR_RENDER_PX = 180;
const FONT_LABEL = 6;
const FONT_CODE = 7;
const LINE_GAP = 8;

const MUTED = rgb(0.42, 0.43, 0.51);
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

function verticalTextAdvance(text: string, size: number): number {
  return Math.max(size + LINE_GAP, text.length * size * 0.42 + LINE_GAP);
}

function bandTextRotation(box: PageBox): number {
  // Texto hacia arriba en el borde visual izquierdo, coherente con /Rotate de la página.
  return box.rotation - 90;
}

@Injectable()
export class PdfVerificationBandService {
  /**
   * Estampa en cada página del PDF un carril izquierdo con verificación.
   * No modifica el MediaBox: el contenido existente queda intacto salvo la franja
   * reservada (~10 mm) que muchos contratos ya dejan libre.
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

    const signersLine = truncate(formatSignersBandLine(data.signerNames), 52);
    const pages = doc.getPages();

    for (let index = 0; index < pages.length; index++) {
      this.drawBand(pages[index], regular, bold, qrPng, data.verificationCode, signersLine, index + 1);
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
    const vxLine = BAND_WIDTH;

    const lineTop = visualPointToPdf(vxLine, 0, box);
    const lineBottom = visualPointToPdf(vxLine, Vh, box);
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

    const vxText = BAND_WIDTH / 2 + 1;
    let vy = Vh - BAND_PADDING - QR_SIZE - 10;

    vy -= verticalTextAdvance(verificationCode, FONT_CODE);
    this.drawVerticalText(page, box, vxText, vy, verificationCode, FONT_CODE, bold, MUTED);

    if (signersLine) {
      vy -= verticalTextAdvance(signersLine, FONT_LABEL);
      this.drawVerticalText(page, box, vxText, vy, signersLine, FONT_LABEL, regular, MUTED);
    }

    vy -= verticalTextAdvance(LABEL, FONT_LABEL);
    this.drawVerticalText(page, box, vxText, vy, LABEL, FONT_LABEL, bold, MUTED);
  }

  private drawVerticalText(
    page: PDFPage,
    box: PageBox,
    vx: number,
    vy: number,
    value: string,
    size: number,
    font: PDFFont,
    color: ReturnType<typeof rgb>,
  ): void {
    const { x, y } = visualPointToPdf(vx, vy, box);
    page.drawText(encodeSafe(font, value).text, {
      x,
      y,
      size,
      font,
      color,
      rotate: degrees(bandTextRotation(box)),
    });
  }
}
