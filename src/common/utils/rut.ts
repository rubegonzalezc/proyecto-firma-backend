/**
 * Normalización y validación de RUT chileno.
 *
 * El RUT es el ancla de identidad en Chile: sin él, "Juan Pérez" no identifica a
 * nadie en particular. Validar el dígito verificador no prueba que el RUT sea de
 * quien firma —para eso haría falta consultar al Registro Civil—, pero descarta
 * los tecleados al azar y los errores de digitación, que es la mayor parte de lo
 * que se recoge mal en un formulario.
 */

/** Deja solo dígitos y el verificador en mayúscula: `12.345.678-k` → `123456789K`. */
export function normalizeRut(raw: string): string {
  return raw.replace(/[.\s-]/g, '').toUpperCase();
}

/** Formato canónico para mostrar y almacenar: `12.345.678-5`. */
export function formatRut(raw: string): string {
  const clean = normalizeRut(raw);
  if (clean.length < 2) return clean;

  const body = clean.slice(0, -1);
  const dv = clean.slice(-1);
  const grouped = body.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${grouped}-${dv}`;
}

/** Dígito verificador por módulo 11. */
export function rutCheckDigit(body: string): string {
  let sum = 0;
  let multiplier = 2;

  for (let i = body.length - 1; i >= 0; i--) {
    sum += Number(body[i]) * multiplier;
    multiplier = multiplier === 7 ? 2 : multiplier + 1;
  }

  const remainder = 11 - (sum % 11);
  if (remainder === 11) return '0';
  if (remainder === 10) return 'K';
  return String(remainder);
}

export function isValidRut(raw: string): boolean {
  const clean = normalizeRut(raw);
  if (!/^\d{7,8}[\dK]$/.test(clean)) return false;

  const body = clean.slice(0, -1);
  const dv = clean.slice(-1);
  return rutCheckDigit(body) === dv;
}
