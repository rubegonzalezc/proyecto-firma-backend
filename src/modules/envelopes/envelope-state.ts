import type { EnvelopeSignerRow, EnvelopeStatus, SigningMode } from '../../common/types/database.types';

/**
 * ESPEJO de frontend/src/features/envelopes/envelopeState.ts
 *
 * Reglas de quién puede firmar y cuándo, como funciones puras: son la única
 * autoridad sobre el turno, y se prueban sin base de datos ni PDFs de por medio.
 */

type SignerLike = Pick<EnvelopeSignerRow, 'id' | 'order_index' | 'status'>;

export function orderedSigners<T extends SignerLike>(signers: T[]): T[] {
  return [...signers].sort((a, b) => a.order_index - b.order_index);
}

/** Un firmante sigue en juego mientras no haya firmado ni rechazado. */
const OPEN_STATUSES = new Set(['waiting', 'pending', 'notified', 'viewed']);

/**
 * En modo secuencial solo está activo el pendiente de menor orden.
 * En paralelo lo están todos los que aún no han firmado.
 */
export function activeSigners<T extends SignerLike>(signers: T[], mode: SigningMode): T[] {
  const open = orderedSigners(signers).filter((s) => OPEN_STATUSES.has(s.status));
  if (open.length === 0) return [];
  return mode === 'sequential' ? [open[0]] : open;
}

export function canSign(
  signer: SignerLike,
  signers: SignerLike[],
  mode: SigningMode,
  envelopeStatus: EnvelopeStatus,
): boolean {
  if (!['draft', 'sent', 'in_progress'].includes(envelopeStatus)) return false;
  if (!OPEN_STATUSES.has(signer.status)) return false;
  return activeSigners(signers, mode).some((s) => s.id === signer.id);
}

export function allSigned(signers: SignerLike[]): boolean {
  return signers.length > 0 && signers.every((s) => s.status === 'signed');
}

/** Estado del sobre derivado del de sus firmantes. */
export function deriveEnvelopeStatus(
  signers: SignerLike[],
  current: EnvelopeStatus,
): EnvelopeStatus {
  if (current === 'voided' || current === 'completed' || current === 'expired') return current;
  if (signers.some((s) => s.status === 'declined')) return 'declined';
  if (allSigned(signers)) return 'completed';
  if (signers.some((s) => s.status === 'signed')) return 'in_progress';
  return current;
}

/** Al firmar el activo, en secuencial se habilita el siguiente de la fila. */
export function nextSignerToActivate<T extends SignerLike>(
  signers: T[],
  mode: SigningMode,
): T | null {
  if (mode === 'parallel') return null;
  return orderedSigners(signers).find((s) => s.status === 'waiting') ?? null;
}

/** Estado inicial: en secuencial solo el primero arranca habilitado. */
export function initialSignerStatus(orderIndex: number, mode: SigningMode) {
  if (mode === 'parallel') return 'pending' as const;
  return orderIndex === 0 ? ('pending' as const) : ('waiting' as const);
}

export function validateBeforeSend(
  signers: Array<{ id: string; full_name: string; email: string }>,
  fieldsBySigner: Map<string | null, number>,
): string[] {
  const problems: string[] = [];

  if (signers.length === 0) problems.push('Añade al menos un firmante.');
  if ((fieldsBySigner.get(null) ?? 0) > 0) {
    problems.push('Hay campos sin asignar a ningún firmante.');
  }

  for (const signer of signers) {
    if (!signer.email?.trim()) {
      problems.push(`Falta el correo de ${signer.full_name || 'un firmante'}.`);
    }
    if ((fieldsBySigner.get(signer.id) ?? 0) === 0) {
      problems.push(`${signer.full_name || signer.email} no tiene ningún campo de firma.`);
    }
  }

  const emails = signers.map((s) => s.email?.trim().toLowerCase()).filter(Boolean);
  if (new Set(emails).size !== emails.length) {
    problems.push('Hay correos repetidos entre los firmantes.');
  }

  return problems;
}
