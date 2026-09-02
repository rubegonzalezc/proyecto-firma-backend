import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvelopeSignerRow, SignerTokenRow } from '../../common/types/database.types';
import { generateToken, hashSecret } from '../../common/utils/hash';
import { SupabaseService } from '../../infrastructure/supabase/supabase.service';

export interface ResolvedToken {
  token: SignerTokenRow;
  signer: EnvelopeSignerRow;
}

@Injectable()
export class SignerTokenService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly config: ConfigService,
  ) {}

  private get pepper(): string {
    return this.config.getOrThrow<string>('app.tokenPepper');
  }

  /**
   * Emite el enlace de firma. Devuelve el token en claro una sola vez —solo
   * viaja en el correo—; en base de datos queda únicamente su hash, de modo
   * que una filtración de la base no permite suplantar a ningún firmante.
   */
  async issue(signerId: string, expiresAt: string): Promise<string> {
    const token = generateToken();

    const { error } = await this.supabase.admin.from('signer_tokens').insert({
      signer_id: signerId,
      token_hash: hashSecret(token, this.pepper),
      expires_at: expiresAt,
    });

    if (error) throw error;
    return token;
  }

  /**
   * Resuelve un token a su firmante. Devuelve null en cualquier caso inválido
   * —inexistente, caducado o revocado— sin distinguirlos, para no revelar si
   * un sobre existe.
   */
  async resolve(token: string): Promise<ResolvedToken | null> {
    if (!token || token.length < 20) return null;

    const { data, error } = await this.supabase.admin
      .from('signer_tokens')
      .select('*, envelope_signers(*)')
      .eq('token_hash', hashSecret(token, this.pepper))
      .maybeSingle();

    if (error || !data) return null;

    const row = data as SignerTokenRow & { envelope_signers: EnvelopeSignerRow | null };
    if (row.revoked_at) return null;
    if (new Date(row.expires_at).getTime() < Date.now()) return null;
    if (!row.envelope_signers) return null;

    return { token: row, signer: row.envelope_signers };
  }

  async markConsumed(tokenId: string): Promise<void> {
    await this.supabase.admin
      .from('signer_tokens')
      .update({ consumed_at: new Date().toISOString() })
      .eq('id', tokenId)
      .is('consumed_at', null);
  }

  /** Al anular un sobre, sus enlaces dejan de servir de inmediato. */
  async revokeForEnvelope(envelopeId: string): Promise<void> {
    const { data } = await this.supabase.admin
      .from('envelope_signers')
      .select('id')
      .eq('envelope_id', envelopeId);

    const ids = (data ?? []).map((row: { id: string }) => row.id);
    if (ids.length === 0) return;

    await this.supabase.admin
      .from('signer_tokens')
      .update({ revoked_at: new Date().toISOString() })
      .in('signer_id', ids)
      .is('revoked_at', null);
  }

  async revokeForSigner(signerId: string): Promise<void> {
    await this.supabase.admin
      .from('signer_tokens')
      .update({ revoked_at: new Date().toISOString() })
      .eq('signer_id', signerId)
      .is('revoked_at', null);
  }

  async reissue(signerId: string, expiresAt: string): Promise<string> {
    const { data } = await this.supabase.admin
      .from('envelope_signers')
      .select('id')
      .eq('id', signerId)
      .maybeSingle();

    if (!data) throw new NotFoundException('Firmante no encontrado');

    await this.revokeForSigner(signerId);
    return this.issue(signerId, expiresAt);
  }
}
