export type DocumentStatus = 'draft' | 'signed';

export interface Profile {
  id: string;
  email: string;
  full_name: string | null;
  created_at: string;
  updated_at: string;
}

export interface DocumentRow {
  id: string;
  user_id: string;
  name: string;
  original_pdf_path: string;
  signed_pdf_path: string | null;
  status: DocumentStatus;
  signer_name: string | null;
  signer_email: string | null;
  verification_code: string | null;
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
  status: DocumentStatus;
}

export interface AuthUser {
  id: string;
  email: string;
  role: string;
}
