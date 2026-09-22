export type DocumentStatus = 'draft' | 'signed';

export interface Profile {
  id: string;
  email: string;
  full_name: string | null;
  created_at: string;
  updated_at: string;
}

export interface FolderRow {
  id: string;
  user_id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

export interface DocumentRow {
  id: string;
  user_id: string;
  folder_id: string | null;
  name: string;
  original_pdf_path: string;
  signed_pdf_path: string | null;
  status: DocumentStatus;
  signer_name: string | null;
  signer_email: string | null;
  verification_code: string | null;
  signed_sha256: string | null;
  created_at: string;
  signed_at: string | null;
}

export interface DocumentVerificationRow {
  verification_code: string;
  name: string;
  signer_name: string | null;
  signer_email: string | null;
  signed_at: string | null;
  signed_pdf_path: string | null;
  signed_sha256: string | null;
  status: DocumentStatus;
}

export interface AuthUser {
  id: string;
  email: string;
  role: string;
}

export type SigningMode = 'sequential' | 'parallel';

export type EnvelopeStatus =
  | 'draft'
  | 'sent'
  | 'in_progress'
  | 'completed'
  | 'declined'
  | 'voided'
  | 'expired';

export type SignerStatus =
  | 'waiting'
  | 'pending'
  | 'notified'
  | 'viewed'
  | 'signed'
  | 'declined'
  | 'expired';

export type FieldType = 'signature' | 'initials' | 'name' | 'rut' | 'date' | 'text';

export type SignatureLevelValue = 'fes' | 'fes_verificada' | 'fea' | 'notarial' | 'no_electronica';

export type SignatureMethodValue = 'draw' | 'type' | 'upload' | 'click' | 'certificate';

export type SignerAuthMethodValue = 'link_only' | 'email_otp' | 'account_password';

export interface EnvelopeRow {
  id: string;
  user_id: string;
  document_id: string;
  name: string;
  message: string | null;
  mode: SigningMode;
  status: EnvelopeStatus;
  verification_code: string | null;
  page_count: number;
  current_version: number;
  original_pdf_path: string;
  current_pdf_path: string;
  final_pdf_path: string | null;
  original_sha256: string;
  final_sha256: string | null;
  expires_at: string | null;
  sent_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  document_type: string;
  required_level: SignatureLevelValue;
  legal_framework: string;
  consent_text: string | null;
}

export interface EnvelopeSignerRow {
  id: string;
  envelope_id: string;
  order_index: number;
  full_name: string;
  email: string;
  role_label: string | null;
  status: SignerStatus;
  signed_at: string | null;
  declined_at: string | null;
  decline_reason: string | null;
  signed_ip: string | null;
  signed_user_agent: string | null;
  created_at: string;
  allowed_methods: SignatureMethodValue[];
  signature_method: SignatureMethodValue | null;
  signature_level: SignatureLevelValue | null;
  auth_method: SignerAuthMethodValue | null;
  signature_image_path: string | null;
  require_rut: boolean;
  identity_rut: string | null;
  consent_accepted_at: string | null;
  consent_sha256: string | null;
}

export interface SignatureFieldRow {
  id: string;
  envelope_id: string;
  signer_id: string | null;
  page_number: number;
  x: number;
  y: number;
  w: number;
  h: number;
  type: FieldType;
  required: boolean;
  label: string | null;
  value_text: string | null;
  filled_at: string | null;
  page_rotation: number;
  page_width_pt: number;
  page_height_pt: number;
  detection_source: 'heuristic' | 'manual' | 'fallback';
  detection_confidence: number | null;
  created_at: string;
}

export interface EnvelopeVersionRow {
  id: string;
  envelope_id: string;
  version: number;
  pdf_path: string;
  sha256: string;
  created_by_signer_id: string | null;
  created_at: string;
}

export interface SignerTokenRow {
  id: string;
  signer_id: string;
  token_hash: string;
  expires_at: string;
  consumed_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

export interface SignerOtpChallengeRow {
  id: string;
  signer_id: string;
  code_hash: string;
  expires_at: string;
  attempts: number;
  verified_at: string | null;
  created_at: string;
}

export interface EnvelopeVerificationRow {
  verification_code: string;
  document_name: string;
  mode: SigningMode;
  document_type: string;
  required_level: SignatureLevelValue;
  legal_framework: string;
  completed_at: string | null;
  final_pdf_path: string | null;
  final_sha256: string | null;
  signers: Array<{
    name: string;
    email: string;
    role: string | null;
    order: number;
    signedAt: string | null;
    method: SignatureMethodValue | null;
    level: SignatureLevelValue | null;
    authMethod: SignerAuthMethodValue | null;
    rut: string | null;
    consentAcceptedAt: string | null;
  }> | null;
}
