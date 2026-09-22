import { formatRut, isValidRut, normalizeRut, rutCheckDigit } from './rut';

describe('rut', () => {
  it('normaliza puntos, guiones y minúsculas', () => {
    expect(normalizeRut('12.345.678-k')).toBe('12345678K');
    expect(normalizeRut(' 5.126.663-3 ')).toBe('51266633');
  });

  it('calcula el dígito verificador por módulo 11', () => {
    expect(rutCheckDigit('12345678')).toBe('5');
    expect(rutCheckDigit('5126663')).toBe('3');
  });

  it('acepta RUT válidos con y sin formato', () => {
    expect(isValidRut('12.345.678-5')).toBe(true);
    expect(isValidRut('123456785')).toBe(true);
    expect(isValidRut('5.126.663-3')).toBe(true);
  });

  it('rechaza el dígito verificador incorrecto', () => {
    expect(isValidRut('12.345.678-9')).toBe(false);
  });

  it('rechaza cuerpos fuera de rango o con basura', () => {
    expect(isValidRut('1-9')).toBe(false);
    expect(isValidRut('123456789012')).toBe(false);
    expect(isValidRut('ABCDEFGH1')).toBe(false);
    expect(isValidRut('')).toBe(false);
  });

  it('formatea en la forma canónica', () => {
    expect(formatRut('123456785')).toBe('12.345.678-5');
    expect(formatRut('51266633')).toBe('5.126.663-3');
  });
});
