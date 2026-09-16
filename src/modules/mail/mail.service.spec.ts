import { ServiceUnavailableException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { MailService } from './mail.service';
import { escapeHtml, otpEmail, signatureRequestEmail } from './mail.templates';

function configWith(values: Record<string, string>): ConfigService {
  return { get: (key: string) => values[key] } as unknown as ConfigService;
}

const email = otpEmail({ code: '482913', documentName: 'Contrato', expiresInMinutes: 10 });

describe('MailService', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  describe('sin clave configurada', () => {
    const service = () =>
      new MailService(configWith({ 'mail.resendApiKey': '', 'mail.from': 'a@b.cl' }));

    it('no se considera configurado', () => {
      expect(service().isConfigured).toBe(false);
    });

    it('escribe el correo en el log en vez de enviarlo, y lo declara', async () => {
      const mail = service();
      const spy = jest.spyOn(mail['logger'], 'warn').mockImplementation(() => {});

      const result = await mail.send({ to: 'ana@empresa.cl', email });

      expect(result.delivered).toBe(false);
      // El código tiene que quedar recuperable en desarrollo: es la única vía.
      expect(spy.mock.calls.flat().join(' ')).toContain('482913');
    });

    it('no revienta aunque el correo sea crítico', async () => {
      const mail = service();
      jest.spyOn(mail['logger'], 'warn').mockImplementation(() => {});

      await expect(
        mail.send({ to: 'ana@empresa.cl', email, critical: true }),
      ).resolves.toMatchObject({ delivered: false });
    });
  });

  describe('con clave configurada', () => {
    const service = () =>
      new MailService(
        configWith({
          'mail.resendApiKey': 're_test',
          'mail.from': 'SynchroSign <no-reply@synchrodev.cl>',
          'mail.replyTo': 'hola@synchrodev.cl',
        }),
      );

    it('envía a Resend con remitente, asunto, HTML y texto', async () => {
      const fetchMock = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ id: 'msg-1' }),
      });
      global.fetch = fetchMock as unknown as typeof fetch;

      const result = await service().send({ to: 'ana@empresa.cl', email, tag: 'otp' });

      expect(result).toEqual({ id: 'msg-1', delivered: true });

      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://api.resend.com/emails');
      expect((init.headers as Record<string, string>).Authorization).toBe('Bearer re_test');

      const body = JSON.parse(init.body as string);
      expect(body.from).toBe('SynchroSign <no-reply@synchrodev.cl>');
      expect(body.to).toEqual(['ana@empresa.cl']);
      expect(body.reply_to).toBe('hola@synchrodev.cl');
      expect(body.text).toContain('482913');
      expect(body.html).toContain('482913');
      expect(body.tags).toEqual([{ name: 'kind', value: 'otp' }]);
    });

    it('propaga el fallo cuando el usuario está esperando el correo', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 422,
        statusText: 'Unprocessable',
        json: async () => ({ message: 'dominio no verificado' }),
      }) as unknown as typeof fetch;

      const mail = service();
      jest.spyOn(mail['logger'], 'error').mockImplementation(() => {});

      await expect(
        mail.send({ to: 'ana@empresa.cl', email, critical: true }),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
    });

    it('se traga el fallo de un aviso de cortesía', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('ECONNRESET')) as unknown as typeof fetch;

      const mail = service();
      jest.spyOn(mail['logger'], 'error').mockImplementation(() => {});

      await expect(mail.send({ to: 'ana@empresa.cl', email })).resolves.toMatchObject({
        delivered: false,
      });
    });

    it('no vuelca la dirección completa en el log', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ id: 'msg-2' }),
      }) as unknown as typeof fetch;

      const mail = service();
      const spy = jest.spyOn(mail['logger'], 'log').mockImplementation(() => {});

      await mail.send({ to: 'ana@empresa.cl', email });

      const logged = spy.mock.calls.flat().join(' ');
      expect(logged).toContain('a***@empresa.cl');
      expect(logged).not.toContain('ana@empresa.cl');
    });
  });
});

describe('plantillas', () => {
  it('escapa el HTML de los datos del usuario', () => {
    expect(escapeHtml('<script>alert(1)</script>')).toBe(
      '&lt;script&gt;alert(1)&lt;/script&gt;',
    );
  });

  it('no deja pasar marcado en el nombre del documento', () => {
    const rendered = signatureRequestEmail({
      signerName: 'Ana',
      documentName: '<img src=x onerror=alert(1)>',
      senderName: 'Luis',
      signUrl: 'https://sign.synchrodev.cl/sign/abc',
    });

    expect(rendered.html).not.toContain('<img src=x');
    expect(rendered.html).toContain('&lt;img src=x');
  });

  it('cada invitación dice a qué dirección corresponde', () => {
    // Un sobre de dos partes manda correos casi idénticos: sin esto no hay
    // forma de distinguirlos, y parece que solo llegó uno.
    const rendered = signatureRequestEmail({
      signerName: 'Ana Rojas',
      signerEmail: 'ana@empresa.cl',
      documentName: 'Contrato',
      senderName: 'Luis Soto',
      signUrl: 'https://sign.synchrodev.cl/sign/abc',
    });

    expect(rendered.html).toContain('ana@empresa.cl');
    expect(rendered.text).toContain('ana@empresa.cl');
  });

  it('el texto plano no arrastra entidades HTML', () => {
    const rendered = signatureRequestEmail({
      signerName: 'Ana',
      signerEmail: 'ana+contratos@empresa.cl',
      documentName: 'Acuerdo & anexo',
      senderName: 'Luis & Co',
      signUrl: 'https://sign.synchrodev.cl/sign/abc',
      documentTypeLabel: 'Acuerdo de confidencialidad (NDA)',
    });

    expect(rendered.text).not.toContain('&amp;');
    expect(rendered.text).toContain('ana+contratos@empresa.cl');
    expect(rendered.html).toContain('&amp;');
  });

  it('el correo de invitación lleva el enlace en HTML y en texto', () => {
    const rendered = signatureRequestEmail({
      signerName: 'Ana Rojas',
      documentName: 'Contrato de arrendamiento',
      senderName: 'Luis Soto',
      signUrl: 'https://sign.synchrodev.cl/sign/abc',
      documentTypeLabel: 'Contrato de arrendamiento',
      requiresRut: true,
    });

    expect(rendered.subject).toContain('Luis Soto');
    expect(rendered.html).toContain('https://sign.synchrodev.cl/sign/abc');
    expect(rendered.text).toContain('https://sign.synchrodev.cl/sign/abc');
    expect(rendered.text).toContain('RUT');
  });

  it('el correo del código lo muestra en texto plano', () => {
    const rendered = otpEmail({ code: '112233', documentName: 'NDA', expiresInMinutes: 10 });
    expect(rendered.subject).toContain('112233');
    expect(rendered.text).toContain('112233');
    expect(rendered.text).toContain('10 minutos');
  });
});
