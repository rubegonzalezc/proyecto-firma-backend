import { Injectable } from '@nestjs/common';
import { PDFDocument, PDFFont, StandardFonts, rgb } from 'pdf-lib';
import * as QRCode from 'qrcode';
import { formatHash } from '../../../common/utils/hash';
import { encodeSafe } from './pdf-stamp.service';

export interface CertificateSigner {
  fullName: string;
  email: string;
  roleLabel?: string | null;
  signedAt: string | null;
  ip?: string | null;
}

export interface CertificateData {
  documentName: string;
  verificationCode: string;
  verifyUrl: string;
  signers: CertificateSigner[];
  originalSha256: string;
  finalSha256?: string;
}

const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN = 56;
const QR_SIZE = 96;

const INK = rgb(0.08, 0.09, 0.16);
const MUTED = rgb(0.42, 0.43, 0.51);
const HAIRLINE = rgb(0.87, 0.85, 0.96);

function formatTimestamp(iso: string | null): string {
  if (!iso) return 'sin fecha';
  const date = new Date(iso);
  return `${date.toISOString().replace('T', ' ').slice(0, 19)} UTC`;
}

@Injectable()
export class CertificateService {
  /**
   * Añade la hoja de certificación al final del documento.
   *
   * Va en página propia y no sobre el pie de la última página: así nunca tapa
   * contenido del contrato y deja sitio a la tabla de firmantes, que crece con
   * el número de partes.
   */
  async append(pdf: Buffer | Uint8Array, data: CertificateData): Promise<Buffer> {
    const doc = await PDFDocument.load(pdf);
    const page = doc.addPage([PAGE_W, PAGE_H]);

    const regular = await doc.embedFont(StandardFonts.Helvetica);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);

    const text = (value: string, x: number, y: number, size: number, font: PDFFont = regular, color = INK) => {
      page.drawText(encodeSafe(font, value).text, { x, y, size, font, color });
    };

    let y = PAGE_H - MARGIN;

    text('Hoja de certificación de firma electrónica', MARGIN, y, 16, bold);
    y -= 20;
    text(data.documentName, MARGIN, y, 10, regular, MUTED);

    const qrDataUrl = await QRCode.toDataURL(data.verifyUrl, {
      width: 256,
      margin: 0,
      color: { dark: '#141628', light: '#FFFFFF' },
    });
    const qr = await doc.embedPng(Buffer.from(qrDataUrl.split(',')[1], 'base64'));
    page.drawImage(qr, {
      x: PAGE_W - MARGIN - QR_SIZE,
      y: PAGE_H - MARGIN - QR_SIZE + 6,
      width: QR_SIZE,
      height: QR_SIZE,
    });

    y -= 34;
    text('CÓDIGO DE VERIFICACIÓN', MARGIN, y, 8, bold, MUTED);
    y -= 18;
    text(data.verificationCode, MARGIN, y, 18, bold);
    y -= 16;
    text(data.verifyUrl, MARGIN, y, 8, regular, MUTED);

    y -= 28;
    page.drawLine({
      start: { x: MARGIN, y },
      end: { x: PAGE_W - MARGIN, y },
      thickness: 1,
      color: HAIRLINE,
    });

    y -= 24;
    text(`FIRMANTES (${data.signers.length})`, MARGIN, y, 8, bold, MUTED);
    y -= 18;

    for (const [index, signer] of data.signers.entries()) {
      if (y < MARGIN + 120) break;

      const heading = `${index + 1}. ${signer.fullName}`;
      text(heading, MARGIN, y, 11, bold);
      if (signer.roleLabel) {
        text(signer.roleLabel, MARGIN + bold.widthOfTextAtSize(heading, 11) + 8, y, 9, regular, MUTED);
      }
      y -= 13;
      text(signer.email, MARGIN + 14, y, 9, regular, MUTED);
      y -= 12;

      const when = `Firmado el ${formatTimestamp(signer.signedAt)}`;
      text(when, MARGIN + 14, y, 9, regular, MUTED);
      if (signer.ip) {
        text(`· IP ${signer.ip}`, MARGIN + 14 + regular.widthOfTextAtSize(when, 9) + 6, y, 9, regular, MUTED);
      }
      y -= 12;
      text('Método: enlace único + código de un solo uso al correo', MARGIN + 14, y, 8, regular, MUTED);
      y -= 22;
    }

    y = Math.max(y, MARGIN + 78);
    page.drawLine({
      start: { x: MARGIN, y },
      end: { x: PAGE_W - MARGIN, y },
      thickness: 1,
      color: HAIRLINE,
    });

    y -= 20;
    text('INTEGRIDAD (SHA-256)', MARGIN, y, 8, bold, MUTED);
    y -= 14;
    text(`Original  ${formatHash(data.originalSha256)}`, MARGIN, y, 7, regular, MUTED);

    if (data.finalSha256) {
      y -= 11;
      text(`Firmado   ${formatHash(data.finalSha256)}`, MARGIN, y, 7, regular, MUTED);
    }

    y -= 20;
    text(
      'Documento firmado electrónicamente. Verifica su validez e integridad en el enlace o el código QR.',
      MARGIN,
      y,
      7,
      regular,
      MUTED,
    );

    return Buffer.from(await doc.save());
  }
}
