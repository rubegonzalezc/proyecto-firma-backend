/**
 * Plantillas de correo.
 *
 * HTML y texto plano en la misma función a propósito: un correo con sólo HTML
 * acaba en spam con más frecuencia, y el firmante que lo reciba en un cliente
 * de texto tiene que poder leer el código igual.
 *
 * Sin imágenes remotas ni CSS externo: muchos clientes los bloquean, y un
 * correo con el código de firma no puede depender de que el lector pulse
 * «mostrar contenido».
 */

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

const INK = '#14172A';
const MUTED = '#6E7387';
const RULE = '#D3D7E2';
const STAMP = '#6B3FA0';

function layout(body: string): string {
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;padding:24px;background:#F2F3F6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:${INK};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#FFFFFF;border:1px solid ${RULE};border-radius:4px;">
    <tr><td style="padding:28px 32px;">
      <p style="margin:0 0 20px;font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:${STAMP};font-weight:600;">SynchroSign</p>
      ${body}
    </td></tr>
  </table>
  <p style="max-width:560px;margin:16px auto 0;font-size:12px;line-height:1.5;color:${MUTED};">
    Firma electrónica conforme a la Ley 19.799. Si no esperabas este correo, puedes ignorarlo.
  </p>
</body></html>`;
}

const h1 = (text: string) =>
  `<h1 style="margin:0 0 12px;font-size:21px;line-height:1.3;font-weight:650;">${text}</h1>`;

const p = (text: string) =>
  `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:${INK};">${text}</p>`;

const muted = (text: string) =>
  `<p style="margin:0 0 8px;font-size:13px;line-height:1.55;color:${MUTED};">${text}</p>`;

const button = (href: string, label: string) =>
  `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 20px;"><tr>
     <td style="background:${STAMP};border-radius:4px;">
       <a href="${href}" style="display:inline-block;padding:12px 22px;font-size:15px;font-weight:600;color:#FFFFFF;text-decoration:none;">${label}</a>
     </td></tr></table>`;

/** Escapa lo que venga de datos del usuario antes de meterlo en el HTML. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function otpEmail(params: {
  code: string;
  documentName: string;
  expiresInMinutes: number;
}): RenderedEmail {
  const name = escapeHtml(params.documentName);

  return {
    subject: `Tu código para firmar: ${params.code}`,
    html: layout(
      h1('Tu código de firma') +
        p(`Para firmar <strong>${name}</strong>, introduce este código en la página de firma:`) +
        `<p style="margin:0 0 16px;font-size:34px;letter-spacing:.22em;font-weight:700;font-family:ui-monospace,'SF Mono',Menlo,Consolas,monospace;">${params.code}</p>` +
        muted(`Caduca en ${params.expiresInMinutes} minutos y sirve una sola vez.`) +
        muted('Nadie de SynchroSign te pedirá este código. Si no lo solicitaste, ignora este correo y no firmes.'),
    ),
    text: [
      'Tu código de firma',
      '',
      `Para firmar "${params.documentName}", introduce este código en la página de firma:`,
      '',
      `    ${params.code}`,
      '',
      `Caduca en ${params.expiresInMinutes} minutos y sirve una sola vez.`,
      'Nadie de SynchroSign te pedirá este código. Si no lo solicitaste, ignora este correo.',
    ].join('\n'),
  };
}

export function signatureRequestEmail(params: {
  signerName: string;
  /** Dirección a la que va este enlace concreto. */
  signerEmail?: string | null;
  documentName: string;
  senderName: string;
  message?: string | null;
  signUrl: string;
  documentTypeLabel?: string | null;
  requiresRut?: boolean;
  expiresAt?: string | null;
}): RenderedEmail {
  const name = escapeHtml(params.documentName);
  const sender = escapeHtml(params.senderName);
  const greeting = params.signerName.trim() ? `Hola ${escapeHtml(params.signerName)}:` : 'Hola:';

  const expiry = params.expiresAt
    ? `El enlace caduca el ${new Intl.DateTimeFormat('es-CL', {
        timeZone: 'America/Santiago',
        day: '2-digit',
        month: 'long',
        year: 'numeric',
      }).format(new Date(params.expiresAt))}.`
    : null;

  const requirements = [
    // Un sobre con varias partes manda un correo casi idéntico a cada una.
    // Decir a qué dirección va este enlace es lo que permite distinguirlos, y
    // además avisa de con qué cuenta hay que firmar.
    params.signerEmail ? `Este enlace es personal y corresponde a ${escapeHtml(params.signerEmail)}.` : null,
    params.documentTypeLabel ? `Tipo de documento: ${escapeHtml(params.documentTypeLabel)}.` : null,
    params.requiresRut ? 'Tendrás que declarar tu RUT al firmar.' : null,
    expiry,
  ].filter(Boolean) as string[];

  // La versión de texto plano se compone sin escapar: escapar ahí deja
  // "&amp;" a la vista del lector.
  const plainRequirements = [
    params.signerEmail ? `Este enlace es personal y corresponde a ${params.signerEmail}.` : null,
    params.documentTypeLabel ? `Tipo de documento: ${params.documentTypeLabel}.` : null,
    params.requiresRut ? 'Tendrás que declarar tu RUT al firmar.' : null,
    expiry,
  ].filter(Boolean) as string[];

  return {
    subject: `${sender} te pide firmar: ${params.documentName}`,
    html: layout(
      h1('Tienes un documento para firmar') +
        p(greeting) +
        p(`<strong>${sender}</strong> te envió <strong>${name}</strong> para que lo firmes electrónicamente.`) +
        (params.message
          ? `<blockquote style="margin:0 0 16px;padding:12px 16px;border-left:3px solid ${RULE};color:${MUTED};font-size:14px;line-height:1.6;">${escapeHtml(params.message)}</blockquote>`
          : '') +
        button(params.signUrl, 'Revisar y firmar') +
        requirements.map(muted).join('') +
        muted('No reenvíes este enlace: es personal.'),
    ),
    text: [
      'Tienes un documento para firmar',
      '',
      params.signerName.trim() ? `Hola ${params.signerName}:` : 'Hola:',
      '',
      `${params.senderName} te envió "${params.documentName}" para que lo firmes electrónicamente.`,
      params.message ? `\n"${params.message}"\n` : '',
      'Revisar y firmar:',
      params.signUrl,
      '',
      ...plainRequirements,
      'No reenvíes este enlace: es personal.',
    ]
      .filter((line) => line !== '')
      .join('\n'),
  };
}

export function signerSignedEmail(params: {
  signerName: string;
  documentName: string;
  remaining: number;
  reviewUrl: string;
}): RenderedEmail {
  const name = escapeHtml(params.documentName);
  const signer = escapeHtml(params.signerName);
  const pending =
    params.remaining === 0
      ? 'No quedan firmas pendientes.'
      : params.remaining === 1
        ? 'Queda 1 firma pendiente.'
        : `Quedan ${params.remaining} firmas pendientes.`;

  return {
    subject: `${signer} firmó ${params.documentName}`,
    html: layout(
      h1('Una parte firmó el documento') +
        p(`<strong>${signer}</strong> acaba de firmar <strong>${name}</strong>.`) +
        muted(pending) +
        button(params.reviewUrl, 'Ver el documento'),
    ),
    text: [
      'Una parte firmó el documento',
      '',
      `${params.signerName} acaba de firmar "${params.documentName}".`,
      pending,
      '',
      params.reviewUrl,
    ].join('\n'),
  };
}

export function envelopeCompletedEmail(params: {
  documentName: string;
  verificationCode: string;
  verifyUrl: string;
  signerCount: number;
}): RenderedEmail {
  const name = escapeHtml(params.documentName);

  return {
    subject: `Documento firmado: ${params.documentName}`,
    html: layout(
      h1('El documento quedó firmado') +
        p(`<strong>${name}</strong> fue firmado por ${params.signerCount} ${params.signerCount === 1 ? 'parte' : 'partes'}.`) +
        p('Código de verificación:') +
        `<p style="margin:0 0 16px;font-size:22px;letter-spacing:.12em;font-weight:700;font-family:ui-monospace,'SF Mono',Menlo,Consolas,monospace;">${escapeHtml(params.verificationCode)}</p>` +
        button(params.verifyUrl, 'Verificar y descargar') +
        muted('Cualquiera con el código puede comprobar la validez y la integridad del documento.'),
    ),
    text: [
      'El documento quedó firmado',
      '',
      `"${params.documentName}" fue firmado por ${params.signerCount} ${params.signerCount === 1 ? 'parte' : 'partes'}.`,
      '',
      `Código de verificación: ${params.verificationCode}`,
      params.verifyUrl,
    ].join('\n'),
  };
}
