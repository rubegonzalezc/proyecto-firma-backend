import { Injectable } from '@nestjs/common';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import * as QRCode from 'qrcode';
import { encodeSafe } from './pdf-stamp.service';

export interface SimpleDocumentStampInput {
  displayName: string;
  email: string;
  verificationCode: string;
  signedAt: Date;
  verifyUrl: string;
}

@Injectable()
export class DocumentStampService {
  /** Estampa bloque de firma textual (sin imagen dibujada) en la última página. */
  async stamp(pdf: Buffer | Uint8Array, input: SimpleDocumentStampInput): Promise<Buffer> {
    const doc = await PDFDocument.load(pdf);
    const pages = doc.getPages();
    const page = pages[pages.length - 1];
    const { width } = page.getSize();

    const regular = await doc.embedFont(StandardFonts.Helvetica);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);

    const blockWidth = width * 0.9;
    const blockX = (width - blockWidth) / 2;
    const blockY = 40;
    const blockHeight = 88;
    const blockTop = blockY + blockHeight;

    const qrPng = await QRCode.toBuffer(input.verifyUrl, {
      width: 200,
      margin: 1,
      color: { dark: '#1F2937', light: '#FFFFFF' },
    });
    const qrImage = await doc.embedPng(qrPng);
    const qrSize = 72;

    page.drawRectangle({
      x: blockX,
      y: blockTop - blockHeight,
      width: blockWidth,
      height: blockHeight,
      borderColor: rgb(0.82, 0.84, 0.88),
      borderWidth: 1,
      color: rgb(0.98, 0.99, 1),
    });

    const nameLine = encodeSafe(bold, input.displayName);
    page.drawText(nameLine.text, {
      x: blockX + 14,
      y: blockTop - 22,
      size: 12,
      font: bold,
      color: rgb(0.1, 0.12, 0.18),
    });

    const meta = encodeSafe(
      regular,
      `${input.email} · ${input.signedAt.toISOString().slice(0, 10)} · ${input.verificationCode}`,
    );
    page.drawText(meta.text, {
      x: blockX + 14,
      y: blockTop - 40,
      size: 9,
      font: regular,
      color: rgb(0.35, 0.38, 0.45),
    });

    page.drawText('Firmado electrónicamente con SynchroSign', {
      x: blockX + 14,
      y: blockTop - 56,
      size: 8,
      font: regular,
      color: rgb(0.45, 0.48, 0.55),
    });

    page.drawImage(qrImage, {
      x: blockX + blockWidth - qrSize - 12,
      y: blockTop - qrSize - 8,
      width: qrSize,
      height: qrSize,
    });

    return Buffer.from(await doc.save());
  }
}
