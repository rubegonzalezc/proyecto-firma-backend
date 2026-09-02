import { hashSecret } from '../../common/utils/hash';
import { SupabaseFake, fakeConfig } from '../../testing/supabase-fake';
import { SignerTokenService } from './signer-token.service';

const PEPPER = 'token-pepper-de-pruebas';
const SIGNER = 'signer-1';
const ENVELOPE = 'env-1';

const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();

function setup() {
  const db = new SupabaseFake();
  db.seed('envelope_signers', [
    { id: SIGNER, envelope_id: ENVELOPE, email: 'ana@x.cl', full_name: 'Ana', status: 'pending', order_index: 0 },
    { id: 'signer-2', envelope_id: ENVELOPE, email: 'luis@x.cl', full_name: 'Luis', status: 'waiting', order_index: 1 },
  ]);
  const service = new SignerTokenService(db.asService(), fakeConfig({ 'app.tokenPepper': PEPPER }));
  return { db, service };
}

describe('SignerTokenService', () => {
  it('emite un enlace y guarda solo su hash', async () => {
    const { db, service } = setup();
    const token = await service.issue(SIGNER, inDays(14));

    const [row] = db.rows('signer_tokens');
    expect(row.token_hash).not.toBe(token);
    expect(row.token_hash).toBe(hashSecret(token, PEPPER));
    // El token en claro no queda por ninguna parte
    expect(JSON.stringify(db.rows('signer_tokens'))).not.toContain(token);
  });

  it('resuelve un enlace válido a su firmante', async () => {
    const { service } = setup();
    const token = await service.issue(SIGNER, inDays(14));

    const resolved = await service.resolve(token);
    expect(resolved?.signer.id).toBe(SIGNER);
    expect(resolved?.signer.email).toBe('ana@x.cl');
  });

  it('rechaza un enlace inexistente sin distinguirlo de uno inválido', async () => {
    const { service } = setup();
    await service.issue(SIGNER, inDays(14));

    expect(await service.resolve('token-que-no-existe-pero-suficientemente-largo')).toBeNull();
  });

  it('rechaza tokens demasiado cortos sin consultar la base', async () => {
    const { service } = setup();
    expect(await service.resolve('corto')).toBeNull();
    expect(await service.resolve('')).toBeNull();
  });

  it('rechaza un enlace caducado', async () => {
    const { db, service } = setup();
    const token = await service.issue(SIGNER, inDays(14));
    db.rows('signer_tokens')[0].expires_at = new Date(Date.now() - 1000).toISOString();

    expect(await service.resolve(token)).toBeNull();
  });

  it('rechaza un enlace revocado', async () => {
    const { service } = setup();
    const token = await service.issue(SIGNER, inDays(14));

    await service.revokeForSigner(SIGNER);
    expect(await service.resolve(token)).toBeNull();
  });

  it('anular el sobre revoca los enlaces de todos sus firmantes', async () => {
    const { service } = setup();
    const first = await service.issue(SIGNER, inDays(14));
    const second = await service.issue('signer-2', inDays(14));

    await service.revokeForEnvelope(ENVELOPE);

    expect(await service.resolve(first)).toBeNull();
    expect(await service.resolve(second)).toBeNull();
  });

  it('el enlace sigue sirviendo tras marcarse como canjeado', async () => {
    const { db, service } = setup();
    const token = await service.issue(SIGNER, inDays(14));
    const resolved = await service.resolve(token);

    await service.markConsumed(resolved!.token.id);

    // El firmante puede volver al correo y reabrir: la barrera de un solo uso
    // está en el código OTP, no en el enlace.
    expect(await service.resolve(token)).not.toBeNull();
    expect(db.rows('signer_tokens')[0].consumed_at).not.toBeNull();
  });

  it('reemitir revoca el enlace anterior', async () => {
    const { service } = setup();
    const old = await service.issue(SIGNER, inDays(14));
    const fresh = await service.reissue(SIGNER, inDays(14));

    expect(await service.resolve(old)).toBeNull();
    expect((await service.resolve(fresh))?.signer.id).toBe(SIGNER);
  });

  it('no reemite para un firmante inexistente', async () => {
    const { service } = setup();
    await expect(service.reissue('no-existe', inDays(14))).rejects.toThrow();
  });

  it('genera enlaces distintos en cada emisión', async () => {
    const { service } = setup();
    const tokens = new Set<string>();
    for (let i = 0; i < 20; i++) tokens.add(await service.issue(SIGNER, inDays(14)));
    expect(tokens.size).toBe(20);
  });
});
