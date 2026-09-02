import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { SignerOtpChallengeRow } from '../../common/types/database.types';
import { generateOtpCode, hashSecret, timingSafeEqualHex } from '../../common/utils/hash';
import { SupabaseService } from '../../infrastructure/supabase/supabase.service';

/** Ventana corta: el código llega al correo y se usa en el momento. */
const OTP_TTL_MS = 10 * 60 * 1000;
/** Agotados los intentos, el desafío muere y hay que pedir otro código. */
const MAX_ATTEMPTS = 5;

export type OtpVerifyResult =
  | { ok: true }
  | { ok: false; reason: 'expired' | 'exhausted' | 'mismatch' | 'missing' };

@Injectable()
export class OtpService {
  private readonly logger = new Logger(OtpService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly config: ConfigService,
  ) {}

  private get pepper(): string {
    return this.config.getOrThrow<string>('app.otpPepper');
  }

  /**
   * Crea un desafío y devuelve el código en claro para enviarlo por correo.
   * Solo se almacena su hash con pepper: el espacio de un código de 6 dígitos
   * es de un millón y sin pepper se rompería al instante por fuerza bruta.
   */
  async issue(signerId: string): Promise<string> {
    // Pedir un código nuevo anula el anterior: así solo hay uno vivo por
    // firmante y no queda ninguno reutilizable rondando.
    await this.invalidateAll(signerId);

    const code = generateOtpCode();

    // `attempts` y `created_at` se escriben explícitamente en vez de confiar en
    // los valores por defecto de la tabla: son los que gobiernan el bloqueo por
    // intentos, y no deben depender de dónde se ejecute la consulta.
    const { error } = await this.supabase.admin.from('signer_otp_challenges').insert({
      signer_id: signerId,
      code_hash: hashSecret(code, this.pepper),
      expires_at: new Date(Date.now() + OTP_TTL_MS).toISOString(),
      attempts: 0,
      created_at: new Date().toISOString(),
    });

    if (error) throw error;
    return code;
  }

  private async latestChallenge(signerId: string): Promise<SignerOtpChallengeRow | null> {
    const { data } = await this.supabase.admin
      .from('signer_otp_challenges')
      .select('*')
      .eq('signer_id', signerId)
      .is('verified_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    return (data as SignerOtpChallengeRow) ?? null;
  }

  /**
   * Verifica el código contra el último desafío pendiente. El intento se
   * contabiliza siempre, también cuando falla, para que agotar los reintentos
   * cierre efectivamente la puerta.
   */
  async verify(signerId: string, code: string): Promise<OtpVerifyResult> {
    const challenge = await this.latestChallenge(signerId);
    if (!challenge) return { ok: false, reason: 'missing' };

    if (new Date(challenge.expires_at).getTime() < Date.now()) {
      return { ok: false, reason: 'expired' };
    }

    if (challenge.attempts >= MAX_ATTEMPTS) {
      return { ok: false, reason: 'exhausted' };
    }

    await this.supabase.admin
      .from('signer_otp_challenges')
      .update({ attempts: challenge.attempts + 1 })
      .eq('id', challenge.id);

    const matches = timingSafeEqualHex(challenge.code_hash, hashSecret(code, this.pepper));
    if (!matches) return { ok: false, reason: 'mismatch' };

    await this.supabase.admin
      .from('signer_otp_challenges')
      .update({ verified_at: new Date().toISOString() })
      .eq('id', challenge.id);

    return { ok: true };
  }

  /** Tras firmar o rechazar, ningún desafío pendiente sigue sirviendo. */
  async invalidateAll(signerId: string): Promise<void> {
    await this.supabase.admin
      .from('signer_otp_challenges')
      .update({ verified_at: new Date().toISOString() })
      .eq('signer_id', signerId)
      .is('verified_at', null);
  }

  get maxAttempts(): number {
    return MAX_ATTEMPTS;
  }

  get ttlMinutes(): number {
    return OTP_TTL_MS / 60_000;
  }
}
