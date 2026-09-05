import { Injectable, NotFoundException } from '@nestjs/common';
import type { Request } from 'express';
import type {
  DocumentVerificationRow,
  EnvelopeVerificationRow,
} from '../../common/types/database.types';
import { SupabaseService } from '../../infrastructure/supabase/supabase.service';
import { DocumentAuditService } from '../audit/document-audit.service';

const CODE_REGEX = /^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/;

@Injectable()
export class VerificationService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly documentAudit: DocumentAuditService,
  ) {}

  normalizeCode(raw: string): string {
    return raw.trim().toUpperCase();
  }

  async verify(code: string, request?: Request) {
    const normalized = this.normalizeCode(code);

    if (!CODE_REGEX.test(normalized)) {
      throw new NotFoundException('Código de verificación inválido');
    }

    const envelope = await this.verifyEnvelope(normalized, request);
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

    const documentId = await this.resolveDocumentId(normalized);
    if (documentId) {
      await this.documentAudit.record({
        documentId,
        eventType: 'document.verified',
        request,
        metadata: { verificationCode: normalized },
      });
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
      sha256: row.signed_sha256,
      integrityCheckAvailable: row.signed_sha256 !== null,
    };
  }

  private async resolveDocumentId(code: string): Promise<string | null> {
    const { data } = await this.supabase.admin
      .from('documents')
      .select('id')
      .eq('verification_code', code)
      .maybeSingle();
    return data?.id ?? null;
  }

  private async verifyEnvelope(code: string, request?: Request) {
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
      integrityCheckAvailable: row.final_sha256 !== null,
    };
  }
}
