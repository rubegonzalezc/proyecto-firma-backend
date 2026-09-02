import {
  formatHash,
  generateOtpCode,
  generateToken,
  hashSecret,
  sha256Hex,
  timingSafeEqualHex,
} from './hash';

describe('sha256Hex', () => {
  it('coincide con el vector conocido de la cadena vacía', () => {
    expect(sha256Hex(Buffer.alloc(0))).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  it('cambia si el documento cambia en un solo byte', () => {
    expect(sha256Hex(Buffer.from([1, 2, 3]))).not.toBe(sha256Hex(Buffer.from([1, 2, 4])));
  });
});

describe('hashSecret', () => {
  it('produce hashes distintos con peppers distintos', () => {
    expect(hashSecret('123456', 'pepper-a')).not.toBe(hashSecret('123456', 'pepper-b'));
  });

  it('es determinista con el mismo pepper', () => {
    expect(hashSecret('123456', 'p')).toBe(hashSecret('123456', 'p'));
  });

  it('no deja rastro del secreto en el resultado', () => {
    expect(hashSecret('482913', 'p')).not.toContain('482913');
  });
});

describe('generateToken', () => {
  it('genera tokens seguros para URL y sin colisiones observables', () => {
    const tokens = new Set(Array.from({ length: 500 }, () => generateToken()));
    expect(tokens.size).toBe(500);
    for (const token of tokens) {
      expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(token.length).toBeGreaterThanOrEqual(60);
    }
  });
});

describe('generateOtpCode', () => {
  it('siempre devuelve 6 dígitos, con ceros a la izquierda incluidos', () => {
    for (let i = 0; i < 2000; i++) {
      expect(generateOtpCode()).toMatch(/^\d{6}$/);
    }
  });

  it('cubre un rango amplio y no se queda en un valor fijo', () => {
    const codes = new Set(Array.from({ length: 500 }, () => generateOtpCode()));
    expect(codes.size).toBeGreaterThan(400);
  });
});

describe('timingSafeEqualHex', () => {
  it('acepta hexadecimales idénticos', () => {
    const hash = sha256Hex(Buffer.from('x'));
    expect(timingSafeEqualHex(hash, hash)).toBe(true);
  });

  it('rechaza hexadecimales distintos', () => {
    expect(timingSafeEqualHex(sha256Hex(Buffer.from('a')), sha256Hex(Buffer.from('b')))).toBe(false);
  });

  it('rechaza longitudes distintas sin lanzar excepción', () => {
    expect(timingSafeEqualHex('aabb', 'aabbcc')).toBe(false);
  });

  it('rechaza la cadena vacía en vez de aceptarla por descuido', () => {
    expect(timingSafeEqualHex('', '')).toBe(false);
  });
});

describe('formatHash', () => {
  it('agrupa en bloques legibles', () => {
    expect(formatHash('aabbccdd11223344', 8)).toBe('aabbccdd 11223344');
  });
});
