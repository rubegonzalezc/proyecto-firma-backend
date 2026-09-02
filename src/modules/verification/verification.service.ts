import { Injectable, NotFoundException } from '@nestjs/common';
import type {
  DocumentVerificationRow,
  EnvelopeVerificationRow,
} from '../../common/types/database.types';
import { SupabaseService } from '../../infrastructure/supabase/supabase.service';

const CODE_REGEX = /^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/;

@Injectable()
export class VerificationService {
  constructor(private readonly supabase: SupabaseService) {}

  normalizeCode(raw: string): string {
    return raw.trim().toUpperCase();
  }

  async verify(code: string) {
    const normalized = this.normalizeCode(code);

    if (!CODE_REGEX.test(normalized)) {
      throw new NotFoundException('Código de verificación inválido');
    }

    // Los sobres multi-parte tienen prioridad; si no hay ninguno se consulta la
    // vista antigua, de modo que los códigos ya emitidos siguen funcionando.
    const envelope = await this.verifyEnvelope(normalized);
    if (envelope) return envelope;

    const { data, error } = await this.supabase.admin
      .from('document_verifications')
      .select('*')
      .eq('verification_code', normalized)
      .maybeSingle();

    if (error) throw error;
    if (!data) throw new NotFoundException('Documento no encontrado');

    const row = data as DocumentVerificationRow;
    let signedPdfUrl: string | null = null;

    if (row.signed_pdf_path) {
      const { data: urlData } = await this.supabase.admin.storage
        .from(this.supabase.documentsBucket)
        .createSignedUrl(row.signed_pdf_path, 600);

      signedPdfUrl = urlData?.signedUrl ?? null;
    }

    return {
      valid: true,
      verificationCode: row.verification_code,
      documentName: row.name,
      signers: [
        {
          name: row.signer_name,
          email: row.signer_email,
          role: null,
          signedAt: row.signed_at,
        },
      ],
      signedAt: row.signed_at,
      signedPdfUrl,
      // El flujo antiguo no calculaba hash: se declara explícitamente en vez
      // de omitirlo, para que el cliente no crea que la integridad es
      // comprobable cuando no lo es.
      sha256: null,
      integrityCheckAvailable: false,
    };
  }

  /** Verificación de un sobre multi-parte, con todos sus firmantes. */
  private async verifyEnvelope(code: string) {
    const { data, error } = await this.supabase.admin
      .from('envelope_verifications')
      .select('*')
      .eq('verification_code', code)
      .maybeSingle();

    if (error || !data) return null;

    const row = data as EnvelopeVerificationRow;
    let signedPdfUrl: string | null = null;

    if (row.final_pdf_path) {
      const { data: urlData } = await this.supabase.admin.storage
        .from(this.supabase.documentsBucket)
        .createSignedUrl(row.final_pdf_path, 600);

      signedPdfUrl = urlData?.signedUrl ?? null;
    }

    return {
      valid: true,
      verificationCode: row.verification_code,
      documentName: row.document_name,
      mode: row.mode,
      signers: (row.signers ?? []).map((s) => ({
        name: s.name,
        email: s.email,
        role: s.role,
        signedAt: s.signedAt,
      })),
      signedAt: row.completed_at,
      signedPdfUrl,
      sha256: row.final_sha256,
      // Con el hash publicado, quien tenga el PDF puede comprobar por su cuenta
      // que no ha sido alterado, sin depender de que confíe en esta respuesta.
      integrityCheckAvailable: row.final_sha256 !== null,
    };
  }
}
