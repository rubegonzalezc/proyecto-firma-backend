import { BadRequestException } from '@nestjs/common';
import { formatRut, isValidRut, normalizeRut } from '../../common/utils/rut';
import type { SignatureMethod, SignerAuthMethod } from '../legal/signature-levels';
import type { TypedFontStyle } from './pdf/pdf-stamp.service';

/** Lo que el firmante envía al firmar, antes de validarse. */
export interface SignatureSubmission {
  method: SignatureMethod;
  consentAccepted: boolean;
  authMethod: SignerAuthMethod;
  signatureImageBase64?: string;
  typedName?: string;
  typedStyle?: TypedFontStyle;
  rut?: string;
}

/** Lo mismo ya validado y normalizado: lo único que llega al estampado. */
export interface ValidatedSubmission {
  method: SignatureMethod;
  authMethod: SignerAuthMethod;
  /** PNG decodificado, presente solo en `draw` y `upload`. */
  signatureImage: Buffer | null;
  /** Nombre a componer, presente solo en `type`. */
  typedName: string | null;
  typedStyle: TypedFontStyle;
  /** RUT en forma canónica `12.345.678-5`, o null si no se exigía. */
  rut: string | null;
}

const MAX_SIGNATURE_BYTES = 1_500_000;
/** Cabecera PNG: 89 50 4E 47 0D 0A 1A 0A. */
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * Valida y normaliza lo que envía el firmante.
 *
 * Se hace antes de tocar el PDF y en un módulo aparte porque es la frontera de
 * confianza: todo lo de aquí viene del navegador de alguien que, por diseño, no
 * tiene cuenta en la aplicación. Un PDF ya estampado con datos que no cuadran
 * hay que invalidarlo a mano, así que la validación no puede ocurrir después.
 */
export function validateSubmission(params: {
  submission: SignatureSubmission;
  displayName: string;
  requireRut: boolean;
}): ValidatedSubmission {
  const { submission, displayName, requireRut } = params;

  return {
    method: submission.method,
    authMethod: submission.authMethod,
    signatureImage: decodeSignatureImage(submission),
    typedName: submission.method === 'type' ? resolveTypedName(submission, displayName) : null,
    typedStyle: submission.typedStyle ?? 'clasico',
    rut: resolveRut(submission.rut, requireRut),
  };
}

function decodeSignatureImage(submission: SignatureSubmission): Buffer | null {
  if (submission.method !== 'draw' && submission.method !== 'upload') return null;

  const raw = submission.signatureImageBase64?.trim();
  if (!raw) {
    throw new BadRequestException(
      submission.method === 'draw'
        ? 'Dibuja tu firma antes de continuar.'
        : 'Adjunta la imagen de tu firma antes de continuar.',
    );
  }

  // El canvas del navegador entrega `data:image/png;base64,...`; se acepta con
  // o sin el prefijo para no obligar al cliente a recortarlo.
  const base64 = raw.startsWith('data:') ? raw.slice(raw.indexOf(',') + 1) : raw;
  const bytes = Buffer.from(base64, 'base64');

  if (bytes.length === 0) {
    throw new BadRequestException('La imagen de la firma está vacía.');
  }

  if (bytes.length > MAX_SIGNATURE_BYTES) {
    throw new BadRequestException(
      'La imagen de la firma supera 1,5 MB. Usa una imagen más pequeña.',
    );
  }

  // pdf-lib solo incrusta PNG por esta vía; un JPEG aquí reventaría dentro del
  // estampado, con el sobre ya a medio camino.
  if (!bytes.subarray(0, 8).equals(PNG_MAGIC)) {
    throw new BadRequestException('La imagen de la firma debe estar en formato PNG.');
  }

  return bytes;
}

function resolveTypedName(submission: SignatureSubmission, displayName: string): string {
  const typed = submission.typedName?.trim();
  if (!typed) {
    throw new BadRequestException('Escribe tu nombre para componer la firma.');
  }

  // Firmar con el nombre de otra persona rompe la correspondencia entre la
  // marca estampada y el firmante identificado por el enlace.
  if (normalizeName(typed) !== normalizeName(displayName)) {
    throw new BadRequestException(
      `La firma escrita debe corresponder a tu nombre: "${displayName}".`,
    );
  }

  return typed;
}

/** Ignora tildes, mayúsculas y espacios repetidos al comparar nombres. */
function normalizeName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function resolveRut(raw: string | undefined, requireRut: boolean): string | null {
  const value = raw?.trim();

  if (!value) {
    if (requireRut) {
      throw new BadRequestException('Este documento exige que declares tu RUT para firmarlo.');
    }
    return null;
  }

  if (!isValidRut(value)) {
    throw new BadRequestException(
      'El RUT no es válido: revisa el número y el dígito verificador.',
    );
  }

  return formatRut(normalizeRut(value));
}
