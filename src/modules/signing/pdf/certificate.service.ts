import { Injectable } from '@nestjs/common';
import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from 'pdf-lib';
import * as QRCode from 'qrcode';
import { formatHash } from '../../../common/utils/hash';
import {
  AUTH_METHOD_LABEL,
  SIGNATURE_LEVEL_INFO,
  SIGNATURE_METHOD_INFO,
  type SignatureLevel,
  type SignatureMethod,
  type SignerAuthMethod,
} from '../../legal/signature-levels';
import { encodeSafe } from './pdf-stamp.service';

export interface CertificateSigner {
  fullName: string;
  email: string;
  roleLabel?: string | null;
  signedAt: string | null;
  ip?: string | null;
  method?: SignatureMethod | null;
  level?: SignatureLevel | null;
  authMethod?: SignerAuthMethod | null;
  rut?: string | null;
  consentAcceptedAt?: string | null;
}

export interface CertificateData {
  documentName: string;
  verificationCode: string;
  verifyUrl: string;
  signers: CertificateSigner[];
  originalSha256: string;
  finalSha256?: string;
  /** Tipo de documento del catálogo legal, ya resuelto a su etiqueta. */
  documentTypeLabel?: string;
  requiredLevel?: SignatureLevel;
  legalBasis?: string[];
  /** Declaración exacta que aceptó cada firmante. */
  consentText?: string | null;
}

const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN = 56;
const QR_SIZE = 96;
const FOOTER_RESERVE = 150;

const INK = rgb(0.08, 0.09, 0.16);
const MUTED = rgb(0.42, 0.43, 0.51);
const HAIRLINE = rgb(0.87, 0.85, 0.96);

function formatTimestamp(iso: string | null | undefined): string {
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
   *
   * Lo que declara tiene que ser cierto. La versión anterior imprimía siempre
   * «enlace único + código de un solo uso al correo» aunque el firmante hubiera
   * entrado con su contraseña, lo que convertía la hoja en prueba de algo que
   * no había pasado. Ahora cada firmante declara su método real, su nivel y
   * cuándo aceptó el consentimiento.
   */
  async append(pdf: Buffer | Uint8Array, data: CertificateData): Promise<Buffer> {
    const doc = await PDFDocument.load(pdf);

    const regular = await doc.embedFont(StandardFonts.Helvetica);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);

    let page = doc.addPage([PAGE_W, PAGE_H]);
    let y = PAGE_H - MARGIN;

    const text = (
      value: string,
      x: number,
      yPos: number,
      size: number,
      font: PDFFont = regular,
      color = INK,
    ) => {
      page.drawText(encodeSafe(font, value).text, { x, y: yPos, size, font, color });
    };

    /**
     * Abre una página nueva si no queda sitio. La versión anterior hacía
     * `break` y simplemente dejaba fuera a los firmantes que no cupieran: un
     * sobre con seis partes certificaba a cuatro.
     */
    const ensureSpace = (needed: number) => {
      if (y - needed >= MARGIN) return;
      page = doc.addPage([PAGE_W, PAGE_H]);
      y = PAGE_H - MARGIN;
      text('Hoja de certificación (continuación)', MARGIN, y, 10, bold, MUTED);
      y -= 24;
    };

    // ── Cabecera ────────────────────────────────────────────────────────────
    text('Hoja de certificación de firma electrónica', MARGIN, y, 16, bold);
    y -= 18;
    text(data.documentName, MARGIN, y, 10, regular, MUTED);

    if (data.documentTypeLabel) {
      y -= 13;
      text(`Tipo de documento: ${data.documentTypeLabel}`, MARGIN, y, 9, regular, MUTED);
    }

    if (data.requiredLevel) {
      const info = SIGNATURE_LEVEL_INFO[data.requiredLevel];
      y -= 13;
      text(`Nivel exigido: ${info.label} (${info.short})`, MARGIN, y, 9, bold, MUTED);
    }

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

    y -= 30;
    text('CÓDIGO DE VERIFICACIÓN', MARGIN, y, 8, bold, MUTED);
    y -= 18;
    text(data.verificationCode, MARGIN, y, 18, bold);
    y -= 16;
    text(data.verifyUrl, MARGIN, y, 8, regular, MUTED);

    y -= 26;
    this.rule(page, y);

    // ── Firmantes ───────────────────────────────────────────────────────────
    y -= 24;
    text(`FIRMANTES (${data.signers.length})`, MARGIN, y, 8, bold, MUTED);
    y -= 18;

    for (const [index, signer] of data.signers.entries()) {
      ensureSpace(88);

      const heading = `${index + 1}. ${signer.fullName}`;
      text(heading, MARGIN, y, 11, bold);
      if (signer.roleLabel) {
        text(
          signer.roleLabel,
          MARGIN + bold.widthOfTextAtSize(heading, 11) + 8,
          y,
          9,
          regular,
          MUTED,
        );
      }

      if (signer.level) {
        const badge = SIGNATURE_LEVEL_INFO[signer.level].short;
        text(badge, PAGE_W - MARGIN - bold.widthOfTextAtSize(badge, 9), y, 9, bold, INK);
      }

      y -= 13;
      const identity = signer.rut ? `${signer.email} · RUT ${signer.rut}` : signer.email;
      text(identity, MARGIN + 14, y, 9, regular, MUTED);
      y -= 12;

      const when = `Firmado el ${formatTimestamp(signer.signedAt)}`;
      text(when, MARGIN + 14, y, 9, regular, MUTED);
      if (signer.ip) {
        text(
          `· IP ${signer.ip}`,
          MARGIN + 14 + regular.widthOfTextAtSize(when, 9) + 6,
          y,
          9,
          regular,
          MUTED,
        );
      }
      y -= 12;

      if (signer.method) {
        text(
          `Forma de firma: ${SIGNATURE_METHOD_INFO[signer.method].label}`,
          MARGIN + 14,
          y,
          8,
          regular,
          MUTED,
        );
        y -= 11;
      }

      if (signer.authMethod) {
        text(
          `Identificación: ${AUTH_METHOD_LABEL[signer.authMethod]}`,
          MARGIN + 14,
          y,
          8,
          regular,
          MUTED,
        );
        y -= 11;
      }

      if (signer.consentAcceptedAt) {
        text(
          `Consentimiento aceptado el ${formatTimestamp(signer.consentAcceptedAt)}`,
          MARGIN + 14,
          y,
          8,
          regular,
          MUTED,
        );
        y -= 11;
      }

      y -= 10;
    }

    // ── Integridad y marco legal ────────────────────────────────────────────
    ensureSpace(FOOTER_RESERVE);
    y = Math.max(y, MARGIN + FOOTER_RESERVE - 72);
    this.rule(page, y);

    y -= 20;
    text('INTEGRIDAD (SHA-256)', MARGIN, y, 8, bold, MUTED);
    y -= 14;
    text(`Original  ${formatHash(data.originalSha256)}`, MARGIN, y, 7, regular, MUTED);

    if (data.finalSha256) {
      y -= 11;
      text(`Firmado   ${formatHash(data.finalSha256)}`, MARGIN, y, 7, regular, MUTED);
    }

    if (data.legalBasis && data.legalBasis.length > 0) {
      y -= 20;
      text('MARCO LEGAL', MARGIN, y, 8, bold, MUTED);
      for (const basis of data.legalBasis) {
        y -= 11;
        text(basis, MARGIN, y, 7, regular, MUTED);
      }
    }

    if (data.consentText) {
      y -= 20;
      text('DECLARACIÓN ACEPTADA POR CADA FIRMANTE', MARGIN, y, 8, bold, MUTED);
      for (const line of wrap(regular, data.consentText, 7, PAGE_W - MARGIN * 2)) {
        y -= 10;
        text(line, MARGIN, y, 7, regular, MUTED);
      }
    }

    y -= 18;
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

  private rule(page: PDFPage, y: number): void {
    page.drawLine({
      start: { x: MARGIN, y },
      end: { x: PAGE_W - MARGIN, y },
      thickness: 1,
      color: HAIRLINE,
    });
  }
}

/** Parte un párrafo en líneas que quepan en el ancho dado. */
export function wrap(font: PDFFont, textValue: string, size: number, maxWidth: number): string[] {
  const words = encodeSafe(font, textValue).text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';

  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      line = candidate;
    } else {
      if (line) lines.push(line);
      line = word;
    }
  }

  if (line) lines.push(line);
  return lines;
}
