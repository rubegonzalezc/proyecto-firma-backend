import { Injectable } from '@nestjs/common';
import { PDFDocument, PDFFont, PDFPage, StandardFonts, degrees, rgb } from 'pdf-lib';
import * as QRCode from 'qrcode';
import { encodeSafe } from './pdf-stamp.service';

export interface VerificationBandData {
  verificationCode: string;
  verifyUrl: string;
  signerNames: string[];
}

/**
 * Franja gris a la izquierda, donde va el QR. 48 pt deja el código legible
 * sin comerse tanto margen del contrato.
 */
export const VERIFICATION_BAND_WIDTH = 48;

const QR_SIZE = 36;
const EDGE = 8;
const TEXT_X = 10;
const GAP = 10;
const QR_RENDER_PX = 180;

const STRIP = rgb(0.96, 0.96, 0.98);
const INK = rgb(0.08, 0.09, 0.16);
const MUTED = rgb(0.42, 0.43, 0.51);
const HAIRLINE = rgb(0.82, 0.83, 0.88);

const LABEL = 'Firmado electrónicamente';

/** Resume firmantes para el margen. */
export function formatSignersBandLine(names: string[]): string {
  const trimmed = names.map((n) => n.trim()).filter(Boolean);
  if (trimmed.length === 0) return '';
  if (trimmed.length === 1) return trimmed[0];
  if (trimmed.length === 2) return `${trimmed[0]} · ${trimmed[1]}`;
  return `${trimmed[0]} · ${trimmed[1]} +${trimmed.length - 2}`;
}

interface BandRun {
  text: string;
  font: PDFFont;
  size: number;
  color: ReturnType<typeof rgb>;
}

/**
 * Coloca cada texto en su propio tramo vertical, medido con el ancho real
 * de la fuente. `rotate: 270` hace que el texto baje desde `y` sin cruzarse
 * con el siguiente tramo ni con el QR.
 */
export function placeBandRuns(
  runs: Array<{ text: string; font: PDFFont; size: number }>,
  top: number,
  bottom: number,
  gap: number,
): Array<{ text: string; y: number; size: number }> {
  const placed: Array<{ text: string; y: number; size: number }> = [];
  let y = top;

  for (const run of runs) {
    const width = run.font.widthOfTextAtSize(run.text, run.size);
    if (width <= 0) continue;
    if (y - width < bottom) break;
    placed.push({ text: run.text, y, size: run.size });
    y -= width + gap;
  }

  return placed;
}

function shortenToWidth(font: PDFFont, text: string, size: number, maxWidth: number): string {
  if (font.widthOfTextAtSize(text, size) <= maxWidth) return text;
  let end = text.length;
  while (end > 1 && font.widthOfTextAtSize(`${text.slice(0, end)}…`, size) > maxWidth) {
    end -= 1;
  }
  return `${text.slice(0, end)}…`;
}

@Injectable()
export class PdfVerificationBandService {
  /**
   * Añade una franja de identificación a la izquierda de cada página y
   * desplaza el contenido original. Así el código, los firmantes y el QR
   * no tapan cláusulas ni se pisan entre sí.
   */
  async apply(pdf: Buffer | Uint8Array, data: VerificationBandData): Promise<Buffer> {
    const source = await PDFDocument.load(pdf);
    const doc = await PDFDocument.create();
    const embedded = await doc.embedPages(source.getPages());

    const regular = await doc.embedFont(StandardFonts.Helvetica);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);

    const qrDataUrl = await QRCode.toDataURL(data.verifyUrl, {
      width: QR_RENDER_PX,
      margin: 0,
      color: { dark: '#141628', light: '#FFFFFF' },
    });
    const qrPng = await doc.embedPng(Buffer.from(qrDataUrl.split(',')[1], 'base64'));
    const signers = formatSignersBandLine(data.signerNames);

    for (const page of embedded) {
      const sheet = doc.addPage([page.width + VERIFICATION_BAND_WIDTH, page.height]);
      sheet.drawPage(page, {
        x: VERIFICATION_BAND_WIDTH,
        y: 0,
        width: page.width,
        height: page.height,
      });
      this.drawGutter(sheet, page.height, regular, bold, qrPng, data.verificationCode, signers);
    }

    return Buffer.from(await doc.save());
  }

  private drawGutter(
    page: PDFPage,
    pageHeight: number,
    regular: PDFFont,
    bold: PDFFont,
    qr: Awaited<ReturnType<PDFDocument['embedPng']>>,
    verificationCode: string,
    signersLine: string,
  ): void {
    page.drawRectangle({
      x: 0,
      y: 0,
      width: VERIFICATION_BAND_WIDTH,
      height: pageHeight,
      color: STRIP,
    });
    page.drawLine({
      start: { x: VERIFICATION_BAND_WIDTH, y: 0 },
      end: { x: VERIFICATION_BAND_WIDTH, y: pageHeight },
      thickness: 0.6,
      color: HAIRLINE,
    });

    const qrX = (VERIFICATION_BAND_WIDTH - QR_SIZE) / 2;
    const qrY = EDGE;
    page.drawImage(qr, { x: qrX, y: qrY, width: QR_SIZE, height: QR_SIZE });

    const top = pageHeight - EDGE;
    const bottom = qrY + QR_SIZE + 12;
    const available = Math.max(0, top - bottom);

    const runs: BandRun[] = [
      { text: LABEL, font: bold, size: 8, color: INK },
      { text: verificationCode, font: bold, size: 7.5, color: MUTED },
    ];
    if (signersLine) {
      runs.push({
        text: shortenToWidth(regular, encodeSafe(regular, signersLine).text, 7, available),
        font: regular,
        size: 7,
        color: MUTED,
      });
    }

    const encoded = runs.map((run) => ({
      ...run,
      text: encodeSafe(run.font, run.text).text,
    }));

    let sizeScale = 1;
    const fits = (scale: number) => {
      const width =
        encoded.reduce(
          (sum, run) => sum + run.font.widthOfTextAtSize(run.text, run.size * scale),
          0,
        ) +
        GAP * Math.max(0, encoded.length - 1);
      return width <= available;
    };
    while (sizeScale > 0.72 && !fits(sizeScale)) sizeScale -= 0.08;

    const placed = placeBandRuns(
      encoded.map((run) => ({ ...run, size: run.size * sizeScale })),
      top,
      bottom,
      GAP,
    );

    for (const item of placed) {
      const source = encoded.find((run) => run.text === item.text);
      page.drawText(item.text, {
        x: TEXT_X,
        y: item.y,
        size: item.size,
        font: source?.font ?? regular,
        color: source?.color ?? MUTED,
        rotate: degrees(270),
      });
    }
  }
}
