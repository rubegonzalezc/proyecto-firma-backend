import { ArgumentsHost, BadRequestException, NotFoundException } from '@nestjs/common';
import { GlobalExceptionFilter } from './global-exception.filter';

function hostWith(): { host: ArgumentsHost; body: () => Record<string, unknown>; status: () => number } {
  let captured: Record<string, unknown> = {};
  let code = 0;

  const response = {
    status(value: number) {
      code = value;
      return this;
    },
    json(value: Record<string, unknown>) {
      captured = value;
      return this;
    },
  };

  const host = {
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => ({ method: 'POST', url: '/api/v1/documents/x/send-for-signature' }),
    }),
  } as unknown as ArgumentsHost;

  return { host, body: () => captured, status: () => code };
}

describe('GlobalExceptionFilter', () => {
  const filter = new GlobalExceptionFilter();
  const logged = () => jest.spyOn(filter['logger'], 'error').mockImplementation(() => {});

  afterEach(() => jest.restoreAllMocks());

  it('conserva el estado y el mensaje de las excepciones HTTP', () => {
    const { host, body, status } = hostWith();
    filter.catch(new NotFoundException('Documento no encontrado'), host);

    expect(status()).toBe(404);
    expect(body().message).toBe('Documento no encontrado');
  });

  it('pasa los detalles estructurados de una excepción HTTP', () => {
    const { host, body } = hostWith();
    filter.catch(new BadRequestException({ message: 'No cumple', code: 'X' }), host);

    expect(body().details).toMatchObject({ code: 'X' });
  });

  describe('errores de Supabase', () => {
    it('los registra, aunque no sean instancias de Error', () => {
      // Antes no entraban por ninguna rama: el cliente veía un 500 mudo y el
      // log del servidor no decía nada.
      const spy = logged();
      const { host } = hostWith();

      filter.catch({ code: '23505', message: 'duplicate key value', details: 'Key (id)' }, host);

      expect(spy).toHaveBeenCalled();
      expect(spy.mock.calls.flat().join(' ')).toContain('duplicate key value');
    });

    it('incluye la ruta en el registro', () => {
      const spy = logged();
      const { host } = hostWith();

      filter.catch({ code: '23505', message: 'duplicate key' }, host);

      expect(spy.mock.calls.flat().join(' ')).toContain('/send-for-signature');
    });

    it('dice que falta aplicar una migración cuando falta una columna', () => {
      logged();
      const { host, body } = hostWith();

      filter.catch({ code: '42703', message: 'column envelopes.document_type does not exist' }, host);

      expect(body().message).toContain('migraciones');
      expect(body().message).toContain('document_type');
    });

    it('lo mismo si falta una tabla o una función', () => {
      logged();

      for (const code of ['42P01', '42883']) {
        const { host, body } = hostWith();
        filter.catch({ code, message: 'relation does not exist' }, host);
        expect(body().message).toContain('migraciones');
      }
    });

    it('no filtra el detalle interno de otros errores de base de datos', () => {
      logged();
      const { host, body } = hostWith();

      filter.catch({ code: '23505', message: 'duplicate key value violates unique constraint' }, host);

      expect(body().message).toBe('Error interno del servidor');
    });
  });

  it('registra cualquier otra cosa que alguien haya lanzado', () => {
    const spy = logged();
    const { host, status } = hostWith();

    filter.catch('algo raro', host);

    expect(status()).toBe(500);
    expect(spy.mock.calls.flat().join(' ')).toContain('algo raro');
  });
});
