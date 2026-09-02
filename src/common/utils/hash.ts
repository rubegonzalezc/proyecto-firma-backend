import { createHash, randomBytes, timingSafeEqual } from 'crypto';

/** SHA-256 en hexadecimal de un binario. */
export function sha256Hex(data: Buffer | Uint8Array): string {
  return createHash('sha256').update(Buffer.from(data)).digest('hex');
}

/**
 * Hash de un secreto (enlace de firma, código OTP) para guardarlo en base de
 * datos. El `pepper` va en variable de entorno, de modo que una filtración de
 * la base sin acceso al servidor no permite reconstruir los códigos: el
 * espacio de un OTP de 6 dígitos es de solo un millón y se agotaría al instante
 * por fuerza bruta.
 */
export function hashSecret(value: string, pepper: string): string {
  return createHash('sha256').update(`${value}${pepper}`).digest('hex');
}

/** Token opaco para el enlace de firma, seguro en una URL. */
export function generateToken(bytes = 48): string {
  return randomBytes(bytes).toString('base64url');
}

/** Código numérico de 6 dígitos, con ceros a la izquierda incluidos. */
export function generateOtpCode(): string {
  return String(randomBytes(4).readUInt32BE(0) % 1_000_000).padStart(6, '0');
}

/**
 * Compara dos hexadecimales en tiempo constante. Una comparación con `===`
 * se cortocircuita en el primer byte distinto, lo que filtra información
 * aprovechable por un atacante que mida los tiempos de respuesta.
 */
export function timingSafeEqualHex(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, 'hex');
  const bufferB = Buffer.from(b, 'hex');
  if (bufferA.length !== bufferB.length || bufferA.length === 0) return false;
  return timingSafeEqual(bufferA, bufferB);
}

/** Agrupa el hash para mostrarlo de forma legible. */
export function formatHash(hex: string, groupSize = 8): string {
  return (hex.match(new RegExp(`.{1,${groupSize}}`, 'g')) ?? []).join(' ');
}
