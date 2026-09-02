import { SupabaseFake, fakeConfig } from '../../testing/supabase-fake';
import { OtpService } from './otp.service';

const PEPPER = 'pepper-de-pruebas';
const SIGNER = 'signer-1';

function setup() {
  const db = new SupabaseFake();
  const service = new OtpService(db.asService(), fakeConfig({ 'app.otpPepper': PEPPER }));
  return { db, service };
}

describe('OtpService', () => {
  it('emite un código de 6 dígitos y solo guarda su hash', async () => {
    const { db, service } = setup();
    const code = await service.issue(SIGNER);

    expect(code).toMatch(/^\d{6}$/);

    const [row] = db.rows('signer_otp_challenges');
    expect(row.code_hash).not.toContain(code);
    expect(row.code_hash).toHaveLength(64);
    expect(row.attempts).toBe(0);
  });

  it('acepta el código correcto y marca el desafío como usado', async () => {
    const { db, service } = setup();
    const code = await service.issue(SIGNER);

    expect(await service.verify(SIGNER, code)).toEqual({ ok: true });
    expect(db.rows('signer_otp_challenges')[0].verified_at).not.toBeNull();
  });

  it('rechaza un código incorrecto', async () => {
    const { service } = setup();
    const code = await service.issue(SIGNER);
    const wrong = code === '000000' ? '111111' : '000000';

    expect(await service.verify(SIGNER, wrong)).toEqual({ ok: false, reason: 'mismatch' });
  });

  it('cuenta los intentos fallidos y cierra tras agotarlos', async () => {
    const { db, service } = setup();
    const code = await service.issue(SIGNER);
    const wrong = code === '000000' ? '111111' : '000000';

    for (let i = 0; i < service.maxAttempts; i++) {
      expect(await service.verify(SIGNER, wrong)).toEqual({ ok: false, reason: 'mismatch' });
    }

    expect(db.rows('signer_otp_challenges')[0].attempts).toBe(service.maxAttempts);

    // Agotados los intentos, ni siquiera el código correcto sirve
    expect(await service.verify(SIGNER, code)).toEqual({ ok: false, reason: 'exhausted' });
  });

  it('rechaza un código caducado', async () => {
    const { db, service } = setup();
    const code = await service.issue(SIGNER);
    db.rows('signer_otp_challenges')[0].expires_at = new Date(Date.now() - 1000).toISOString();

    expect(await service.verify(SIGNER, code)).toEqual({ ok: false, reason: 'expired' });
  });

  it('informa cuando no hay ningún desafío pendiente', async () => {
    const { service } = setup();
    expect(await service.verify(SIGNER, '123456')).toEqual({ ok: false, reason: 'missing' });
  });

  it('un código ya usado no vale una segunda vez', async () => {
    const { service } = setup();
    const code = await service.issue(SIGNER);

    expect(await service.verify(SIGNER, code)).toEqual({ ok: true });
    expect(await service.verify(SIGNER, code)).toEqual({ ok: false, reason: 'missing' });
  });

  it('el código de un firmante no sirve para otro', async () => {
    const { service } = setup();
    const code = await service.issue(SIGNER);

    expect(await service.verify('otro-firmante', code)).toEqual({ ok: false, reason: 'missing' });
  });

  it('pedir un código nuevo anula el anterior', async () => {
    const { service } = setup();
    const first = await service.issue(SIGNER);
    const second = await service.issue(SIGNER);

    expect(await service.verify(SIGNER, second)).toEqual({ ok: true });

    // El primero ya no vale, aunque no haya caducado
    const fresh = setup();
    const onlyCode = await fresh.service.issue(SIGNER);
    await fresh.service.issue(SIGNER);
    expect(await fresh.service.verify(SIGNER, onlyCode)).not.toEqual({ ok: true });
    expect(first).toMatch(/^\d{6}$/);
  });

  it('invalida todos los desafíos pendientes al firmar', async () => {
    const { db, service } = setup();
    const code = await service.issue(SIGNER);

    await service.invalidateAll(SIGNER);

    expect(db.rows('signer_otp_challenges').every((r) => r.verified_at !== null)).toBe(true);
    expect(await service.verify(SIGNER, code)).toEqual({ ok: false, reason: 'missing' });
  });

  it('exige el pepper configurado', async () => {
    const db = new SupabaseFake();
    const service = new OtpService(db.asService(), fakeConfig({}));
    await expect(service.issue(SIGNER)).rejects.toThrow('app.otpPepper');
  });
});
