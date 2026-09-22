/**
 * Niveles de firma y métodos disponibles, según la Ley 19.799 de Chile.
 *
 * La ley solo reconoce dos categorías: firma electrónica **simple** (art. 2
 * letra f) y firma electrónica **avanzada** (art. 2 letra g, certificada por un
 * prestador acreditado). Todo lo demás son grados de evidencia, no categorías
 * legales.
 *
 * Aun así la distinción práctica importa. El art. 5 deja la carga de la prueba
 * en quien invoca un documento firmado con firma simple: si la contraparte la
 * desconoce, hay que acreditar que fue esa persona quien firmó. Por eso aquí se
 * distingue un nivel intermedio, `fes_verificada`, que no es una categoría de la
 * ley sino una firma simple con la identidad comprobada en el acto (código al
 * correo, RUT declarado, consentimiento expreso, IP y hora). Sigue siendo firma
 * simple; lo que cambia es cuánto cuesta defenderla.
 */

export const SIGNATURE_LEVELS = [
  'fes',
  'fes_verificada',
  'fea',
  'notarial',
  'no_electronica',
] as const;

export type SignatureLevel = (typeof SIGNATURE_LEVELS)[number];

/** Niveles que esta plataforma puede producir hoy. */
export const SUPPORTED_LEVELS: SignatureLevel[] = ['fes', 'fes_verificada'];

/**
 * Orden de fuerza probatoria. `notarial` y `no_electronica` no son "más firma":
 * son salidas del flujo electrónico, y por eso se ordenan por encima de todo lo
 * que la plataforma puede emitir.
 */
const LEVEL_RANK: Record<SignatureLevel, number> = {
  fes: 1,
  fes_verificada: 2,
  fea: 3,
  notarial: 4,
  no_electronica: 5,
};

export function levelRank(level: SignatureLevel): number {
  return LEVEL_RANK[level];
}

export function levelSatisfies(achieved: SignatureLevel, required: SignatureLevel): boolean {
  return LEVEL_RANK[achieved] >= LEVEL_RANK[required];
}

export interface SignatureLevelInfo {
  id: SignatureLevel;
  label: string;
  short: string;
  description: string;
  legalBasis: string[];
  /** Si la plataforma puede emitir este nivel por sí sola. */
  available: boolean;
  /** Qué hace falta para alcanzarlo. */
  requirements: string[];
}

export const SIGNATURE_LEVEL_INFO: Record<SignatureLevel, SignatureLevelInfo> = {
  fes: {
    id: 'fes',
    label: 'Firma electrónica simple',
    short: 'FES',
    description:
      'Válida para la generalidad de los actos y contratos entre privados. Si la contraparte la desconoce, quien la invoca debe probar su autenticidad.',
    legalBasis: ['Ley 19.799, art. 2 letra f', 'Ley 19.799, art. 3', 'Ley 19.799, art. 5'],
    available: true,
    requirements: [
      'Identificación del firmante por su enlace único',
      'Consentimiento expreso de firmar electrónicamente',
      'Registro de fecha, hora, IP y agente del navegador',
      'Hash SHA-256 del documento antes y después de cada firma',
    ],
  },
  fes_verificada: {
    id: 'fes_verificada',
    label: 'Firma electrónica simple con identidad verificada',
    short: 'FES+',
    description:
      'Sigue siendo firma simple ante la ley, pero con la identidad comprobada en el momento de firmar. Reduce mucho el costo de defenderla si se impugna.',
    legalBasis: ['Ley 19.799, art. 2 letra f', 'Ley 19.799, art. 5'],
    available: true,
    requirements: [
      'Todo lo de la firma simple',
      'Código de un solo uso enviado al correo del firmante, o sesión autenticada con contraseña',
      'RUT declarado por el firmante y validado en su dígito verificador',
      'Imagen de la firma capturada por el propio firmante',
    ],
  },
  fea: {
    id: 'fea',
    label: 'Firma electrónica avanzada',
    short: 'FEA',
    description:
      'Certificada por un prestador acreditado ante la Entidad Acreditadora. Hace plena prueba y permite firmar instrumentos públicos electrónicos.',
    legalBasis: [
      'Ley 19.799, art. 2 letra g',
      'Ley 19.799, art. 4',
      'Ley 19.799, art. 5 inciso 2',
      'Código Civil, art. 1702',
    ],
    available: false,
    requirements: [
      'Certificado digital vigente emitido por un prestador acreditado',
      'Firma criptográfica embebida en el documento (PAdES)',
      'Sello de tiempo de una autoridad de tiempo',
    ],
  },
  notarial: {
    id: 'notarial',
    label: 'Requiere ministro de fe',
    short: 'Notarial',
    description:
      'La ley exige escritura pública, autorización notarial o ratificación ante un ministro de fe. No se resuelve dentro de esta plataforma.',
    legalBasis: ['Ley 19.799, art. 3 inciso 2 letra a'],
    available: false,
    requirements: ['Comparecencia ante notario, conservador u otro ministro de fe'],
  },
  no_electronica: {
    id: 'no_electronica',
    label: 'Excluido de la firma electrónica',
    short: 'Excluido',
    description:
      'La ley excluye expresamente estos actos: los que exigen una solemnidad no reproducible en soporte electrónico, los que requieren comparecencia personal y los relativos al derecho de familia.',
    legalBasis: ['Ley 19.799, art. 3 inciso 2 letras a, b y c'],
    available: false,
    requirements: ['Debe otorgarse en soporte papel conforme a su regulación especial'],
  },
};

/** Formas en que el firmante puede producir la marca de firma. */
export const SIGNATURE_METHODS = ['draw', 'type', 'upload', 'click', 'certificate'] as const;

export type SignatureMethod = (typeof SIGNATURE_METHODS)[number];

/** Métodos que el firmante puede elegir por defecto si el emisor no restringe. */
export const DEFAULT_ALLOWED_METHODS: SignatureMethod[] = ['draw', 'type', 'upload'];

export interface SignatureMethodInfo {
  id: SignatureMethod;
  label: string;
  description: string;
  /** Nivel máximo que este método puede sostener por sí mismo. */
  maxLevel: SignatureLevel;
  available: boolean;
  /** Por qué elegirlo, en términos de la prueba que deja. */
  evidenceNote: string;
}

export const SIGNATURE_METHOD_INFO: Record<SignatureMethod, SignatureMethodInfo> = {
  draw: {
    id: 'draw',
    label: 'Dibujar la firma',
    description: 'El firmante traza su firma con el dedo, el lápiz táctil o el ratón.',
    maxLevel: 'fes_verificada',
    available: true,
    evidenceNote:
      'Deja un trazo propio del firmante, comparable con su firma manuscrita. Es la forma más defendible sin certificado.',
  },
  type: {
    id: 'type',
    label: 'Escribir la firma',
    description: 'El firmante escribe su nombre y elige un estilo tipográfico.',
    maxLevel: 'fes_verificada',
    available: true,
    evidenceNote:
      'No hay trazo comparable: la prueba descansa por completo en la identificación y la traza de auditoría.',
  },
  upload: {
    id: 'upload',
    label: 'Subir una imagen',
    description: 'El firmante adjunta una imagen de su firma manuscrita.',
    maxLevel: 'fes_verificada',
    available: true,
    evidenceNote:
      'Una imagen puede haberla subido cualquiera que la tenga. Vale como apariencia, no como prueba de autoría por sí sola.',
  },
  click: {
    id: 'click',
    label: 'Aceptar y firmar',
    description: 'Se estampa el nombre del firmante sin grafismo, tras aceptar expresamente.',
    maxLevel: 'fes',
    available: true,
    evidenceNote:
      'La firma es el acto de aceptación registrado, no la imagen. Suficiente para actos de bajo riesgo.',
  },
  certificate: {
    id: 'certificate',
    label: 'Firmar con certificado (FEA)',
    description:
      'Firma criptográfica con certificado de un prestador acreditado, embebida en el PDF.',
    maxLevel: 'fea',
    available: false,
    evidenceNote:
      'Plena prueba conforme al art. 1702 del Código Civil. Requiere integrar un prestador acreditado.',
  },
};

/** Cómo se identificó el firmante al momento de firmar. */
export const AUTH_METHODS = ['link_only', 'email_otp', 'account_password'] as const;

export type SignerAuthMethod = (typeof AUTH_METHODS)[number];

export const AUTH_METHOD_LABEL: Record<SignerAuthMethod, string> = {
  link_only: 'Enlace único enviado al correo',
  email_otp: 'Enlace único + código de un solo uso al correo',
  account_password: 'Sesión autenticada con la cuenta invitada',
};

/**
 * Nivel efectivamente alcanzado por una firma concreta.
 *
 * Deliberadamente conservador: `fes_verificada` exige las tres piezas que la
 * hacen defendible —identidad comprobada en el acto, RUT declarado y un
 * grafismo del propio firmante—. Si falta cualquiera, la firma se declara como
 * simple, porque declarar un nivel que la evidencia no sostiene es peor que no
 * declararlo.
 */
export function achievedLevel(params: {
  method: SignatureMethod;
  authMethod: SignerAuthMethod;
  consentAccepted: boolean;
  rutVerified: boolean;
}): SignatureLevel {
  if (params.method === 'certificate') return 'fea';
  if (!params.consentAccepted) return 'fes';

  const identityChecked =
    params.authMethod === 'email_otp' || params.authMethod === 'account_password';
  const hasOwnMark = params.method === 'draw' || params.method === 'upload';

  if (identityChecked && params.rutVerified && hasOwnMark) return 'fes_verificada';
  return 'fes';
}
