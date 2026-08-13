import { Injectable, NotFoundException } from '@nestjs/common';
import type { DocumentVerificationRow } from '../../common/types/database.types';
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
      signerName: row.signer_name,
      signerEmail: row.signer_email,
      signedAt: row.signed_at,
      signedPdfUrl,
    };
  }
}
