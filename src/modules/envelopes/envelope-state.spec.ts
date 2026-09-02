import type { EnvelopeSignerRow } from '../../common/types/database.types';
import {
  activeSigners,
  allSigned,
  canSign,
  deriveEnvelopeStatus,
  initialSignerStatus,
  nextSignerToActivate,
  validateBeforeSend,
} from './envelope-state';

/**
 * Mismos casos que frontend/src/features/envelopes/envelopeState.test.ts.
 * Las dos implementaciones deben coincidir: el frontend decide qué mostrar y
 * el servidor decide qué permitir, y una discrepancia se ve como un botón que
 * el backend rechaza.
 */

type Signer = Pick<EnvelopeSignerRow, 'id' | 'order_index' | 'status'>;

const s = (id: string, order_index: number, status: Signer['status'] = 'pending'): Signer => ({
  id,
  order_index,
  status,
});

const three = (): Signer[] => [s('a', 0, 'pending'), s('b', 1, 'waiting'), s('c', 2, 'waiting')];

describe('modo secuencial', () => {
  it('solo habilita al primero', () => {
    const signers = three();
    expect(activeSigners(signers, 'sequential').map((x) => x.id)).toEqual(['a']);
    expect(canSign(signers[0], signers, 'sequential', 'sent')).toBe(true);
    expect(canSign(signers[1], signers, 'sequential', 'sent')).toBe(false);
    expect(canSign(signers[2], signers, 'sequential', 'sent')).toBe(false);
  });

  it('habilita al siguiente cuando el anterior firma', () => {
    const signed = three().map((x) => (x.id === 'a' ? { ...x, status: 'signed' as const } : x));
    expect(nextSignerToActivate(signed, 'sequential')?.id).toBe('b');
    expect(activeSigners(signed, 'sequential').map((x) => x.id)).toEqual(['b']);
  });

  it('respeta el orden aunque lleguen desordenados', () => {
    const signers = [s('c', 2, 'waiting'), s('a', 0, 'pending'), s('b', 1, 'waiting')];
    expect(activeSigners(signers, 'sequential').map((x) => x.id)).toEqual(['a']);
  });

  it('completa el sobre cuando todos firman', () => {
    const signers = three().map((x) => ({ ...x, status: 'signed' as const }));
    expect(allSigned(signers)).toBe(true);
    expect(activeSigners(signers, 'sequential')).toEqual([]);
    expect(deriveEnvelopeStatus(signers, 'in_progress')).toBe('completed');
  });

  it('considera activos los estados intermedios de notificado y visto', () => {
    const signers = [s('a', 0, 'notified'), s('b', 1, 'waiting')];
    expect(activeSigners(signers, 'sequential').map((x) => x.id)).toEqual(['a']);

    const viewed = [s('a', 0, 'viewed'), s('b', 1, 'waiting')];
    expect(canSign(viewed[0], viewed, 'sequential', 'sent')).toBe(true);
  });
});

describe('modo paralelo', () => {
  it('habilita a todos a la vez', () => {
    const signers = three().map((x) => ({ ...x, status: 'pending' as const }));
    expect(activeSigners(signers, 'parallel').map((x) => x.id)).toEqual(['a', 'b', 'c']);
  });

  it('no reordena la fila al firmar uno', () => {
    const signers = three().map((x) => ({ ...x, status: 'pending' as const }));
    expect(nextSignerToActivate(signers, 'parallel')).toBeNull();
  });

  it('pasa a en curso con la primera firma', () => {
    const signers = [s('a', 0, 'signed'), s('b', 1, 'pending')];
    expect(deriveEnvelopeStatus(signers, 'sent')).toBe('in_progress');
  });
});

describe('estado inicial', () => {
  it('en secuencial solo arranca el primero', () => {
    expect(initialSignerStatus(0, 'sequential')).toBe('pending');
    expect(initialSignerStatus(1, 'sequential')).toBe('waiting');
  });

  it('en paralelo arrancan todos', () => {
    expect(initialSignerStatus(0, 'parallel')).toBe('pending');
    expect(initialSignerStatus(3, 'parallel')).toBe('pending');
  });
});

describe('estados terminales', () => {
  it('un rechazo bloquea el sobre', () => {
    const signers = three().map((x) => (x.id === 'b' ? { ...x, status: 'declined' as const } : x));
    expect(deriveEnvelopeStatus(signers, 'in_progress')).toBe('declined');
  });

  it('anulado, completado y expirado no vuelven atrás', () => {
    const signers = three();
    expect(deriveEnvelopeStatus(signers, 'voided')).toBe('voided');
    expect(deriveEnvelopeStatus(signers, 'completed')).toBe('completed');
    expect(deriveEnvelopeStatus(signers, 'expired')).toBe('expired');
  });

  it('no se puede firmar en un sobre anulado ni completado', () => {
    const signers = three();
    expect(canSign(signers[0], signers, 'sequential', 'voided')).toBe(false);
    expect(canSign(signers[0], signers, 'sequential', 'completed')).toBe(false);
    expect(canSign(signers[0], signers, 'sequential', 'expired')).toBe(false);
  });

  it('quien ya firmó no puede volver a firmar', () => {
    const signers = three().map((x) => (x.id === 'a' ? { ...x, status: 'signed' as const } : x));
    expect(canSign(signers[0], signers, 'sequential', 'in_progress')).toBe(false);
  });

  it('un sobre sin firmantes no cuenta como completado', () => {
    expect(allSigned([])).toBe(false);
  });
});

describe('validateBeforeSend', () => {
  const counts = (entries: Array<[string | null, number]>) => new Map(entries);
  const signer = (id: string, email: string) => ({ id, full_name: `Nombre ${id}`, email });

  it('acepta un sobre bien formado', () => {
    const signers = [signer('a', 'a@x.cl'), signer('b', 'b@x.cl')];
    expect(validateBeforeSend(signers, counts([['a', 1], ['b', 2]]))).toEqual([]);
  });

  it('rechaza un firmante sin campos', () => {
    const signers = [signer('a', 'a@x.cl'), signer('b', 'b@x.cl')];
    const problems = validateBeforeSend(signers, counts([['a', 1], ['b', 0]]));
    expect(problems.join(' ')).toContain('Nombre b');
  });

  it('detecta campos huérfanos y correos repetidos', () => {
    const signers = [signer('a', 'a@x.cl'), signer('b', 'A@X.cl')];
    const problems = validateBeforeSend(signers, counts([[null, 1], ['a', 1], ['b', 1]]));
    expect(problems).toContain('Hay campos sin asignar a ningún firmante.');
    expect(problems).toContain('Hay correos repetidos entre los firmantes.');
  });

  it('exige al menos un firmante', () => {
    expect(validateBeforeSend([], counts([]))).toContain('Añade al menos un firmante.');
  });

  it('detecta un firmante sin correo', () => {
    const problems = validateBeforeSend([signer('a', '   ')], counts([['a', 1]]));
    expect(problems.join(' ')).toContain('Falta el correo');
  });
});
