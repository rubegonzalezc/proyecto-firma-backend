import type { SignatureLevel, SignatureMethod } from './signature-levels';

/**
 * Catálogo de tipos de documento con la firma que cada uno necesita en Chile.
 *
 * Esto es orientación, no asesoría legal, y así se declara en la API y en la
 * interfaz. Su utilidad no es decidir por el usuario: es evitar los dos errores
 * caros. Uno, firmar electrónicamente algo que la ley excluye —un pagaré, una
 * compraventa de inmueble, un acto de familia— y creer que quedó firmado. Dos,
 * usar la firma más débil disponible en un contrato que después habrá que
 * defender.
 *
 * Cada entrada declara el nivel mínimo con el que el documento es válido y el
 * nivel recomendado, que suele ser más alto. La diferencia entre ambos es
 * exactamente la carga de la prueba del art. 5 de la Ley 19.799.
 */

export type DocumentTypeCategory =
  | 'laboral'
  | 'comercial'
  | 'civil'
  | 'societario'
  | 'tributario'
  | 'publico'
  | 'salud'
  | 'familia'
  | 'otro';

export interface DocumentTypeRule {
  id: string;
  label: string;
  category: DocumentTypeCategory;
  /** Nivel por debajo del cual el documento no es válido o no es oponible. */
  minLevel: SignatureLevel;
  /** Nivel que conviene usar aunque el mínimo sea menor. */
  recommendedLevel: SignatureLevel;
  /** Si la plataforma puede cerrar este documento por sí sola. */
  signableHere: boolean;
  /** Métodos que tienen sentido para este documento, en orden de preferencia. */
  suggestedMethods: SignatureMethod[];
  /** Si conviene exigir el RUT del firmante. */
  requireRut: boolean;
  legalBasis: string[];
  /** Qué hay que hacer además de firmar. */
  obligations: string[];
  /** Lo que puede salir mal si se firma sin más. */
  warnings: string[];
}

const ALL_MARKS: SignatureMethod[] = ['draw', 'type', 'upload'];

export const DOCUMENT_TYPES: DocumentTypeRule[] = [
  // ─── Laboral ──────────────────────────────────────────────────────────────
  {
    id: 'contrato_trabajo',
    label: 'Contrato de trabajo',
    category: 'laboral',
    minLevel: 'fes',
    recommendedLevel: 'fes_verificada',
    signableHere: true,
    suggestedMethods: ['draw', 'upload'],
    requireRut: true,
    legalBasis: [
      'Código del Trabajo, art. 9 (escrituración y dos ejemplares)',
      'Ley 19.799, art. 3',
    ],
    obligations: [
      'Debe firmarse dentro de los plazos del art. 9 del Código del Trabajo.',
      'Entrega un ejemplar firmado al trabajador y conserva el tuyo.',
      'Registra el contrato en el sitio de la Dirección del Trabajo cuando corresponda.',
    ],
    warnings: [
      'Sin RUT ni verificación de identidad, un contrato laboral impugnado es difícil de sostener ante la Inspección del Trabajo.',
    ],
  },
  {
    id: 'anexo_contrato_trabajo',
    label: 'Anexo de contrato de trabajo',
    category: 'laboral',
    minLevel: 'fes',
    recommendedLevel: 'fes_verificada',
    signableHere: true,
    suggestedMethods: ['draw', 'upload'],
    requireRut: true,
    legalBasis: ['Código del Trabajo, art. 11', 'Ley 19.799, art. 3'],
    obligations: ['Entrega un ejemplar al trabajador.'],
    warnings: [],
  },
  {
    id: 'carta_aviso_termino',
    label: 'Carta de aviso de término de contrato',
    category: 'laboral',
    minLevel: 'fes',
    recommendedLevel: 'fes',
    signableHere: true,
    suggestedMethods: ALL_MARKS,
    requireRut: false,
    legalBasis: ['Código del Trabajo, art. 162'],
    obligations: [
      'Envía copia a la Inspección del Trabajo dentro del plazo legal.',
      'La carta debe notificarse personalmente o por carta certificada al domicilio del trabajador.',
    ],
    warnings: [
      'Firmarla aquí no reemplaza la notificación formal al trabajador ni el aviso a la Inspección.',
    ],
  },
  {
    id: 'finiquito',
    label: 'Finiquito laboral',
    category: 'laboral',
    minLevel: 'notarial',
    recommendedLevel: 'notarial',
    signableHere: false,
    suggestedMethods: [],
    requireRut: true,
    legalBasis: [
      'Código del Trabajo, art. 177 (ratificación ante ministro de fe)',
      'Ley 21.361 (finiquito electrónico en la plataforma de la Dirección del Trabajo)',
    ],
    obligations: [
      'Debe ratificarse ante notario, inspector del trabajo u otro ministro de fe.',
      'Alternativamente, tramítalo en la plataforma electrónica de la Dirección del Trabajo.',
    ],
    warnings: [
      'Un finiquito firmado solo aquí no tiene poder liberatorio: el trabajador puede reclamar después lo que el documento dice haber pagado.',
    ],
  },

  // ─── Comercial y civil ────────────────────────────────────────────────────
  {
    id: 'nda',
    label: 'Acuerdo de confidencialidad (NDA)',
    category: 'comercial',
    minLevel: 'fes',
    recommendedLevel: 'fes',
    signableHere: true,
    suggestedMethods: ALL_MARKS,
    requireRut: false,
    legalBasis: ['Ley 19.799, art. 3'],
    obligations: [],
    warnings: [],
  },
  {
    id: 'contrato_prestacion_servicios',
    label: 'Contrato de prestación de servicios',
    category: 'comercial',
    minLevel: 'fes',
    recommendedLevel: 'fes_verificada',
    signableHere: true,
    suggestedMethods: ['draw', 'upload', 'type'],
    requireRut: true,
    legalBasis: ['Ley 19.799, art. 3', 'Código Civil, art. 1545'],
    obligations: [],
    warnings: [
      'Si el contrato incluye cláusulas de cobro ejecutivo, necesitas además un título ejecutivo válido: el contrato firmado electrónicamente no lo es por sí solo.',
    ],
  },
  {
    id: 'contrato_arrendamiento',
    label: 'Contrato de arrendamiento',
    category: 'civil',
    minLevel: 'fes',
    recommendedLevel: 'fes_verificada',
    signableHere: true,
    suggestedMethods: ['draw', 'upload'],
    requireRut: true,
    legalBasis: ['Ley 18.101', 'Ley 19.799, art. 3'],
    obligations: [],
    warnings: [
      'Para el procedimiento monitorio de restitución conviene la firma autorizada ante notario. Sin ella el contrato es válido, pero el desalojo se tramita por la vía ordinaria.',
    ],
  },
  {
    id: 'compraventa_bien_mueble',
    label: 'Compraventa de bien mueble',
    category: 'civil',
    minLevel: 'fes',
    recommendedLevel: 'fes_verificada',
    signableHere: true,
    suggestedMethods: ALL_MARKS,
    requireRut: true,
    legalBasis: ['Código Civil, art. 1801 inciso 1', 'Ley 19.799, art. 3'],
    obligations: [],
    warnings: [
      'Los vehículos motorizados requieren además inscripción en el Registro de Vehículos Motorizados del Registro Civil.',
    ],
  },
  {
    id: 'compraventa_inmueble',
    label: 'Compraventa de inmueble',
    category: 'civil',
    minLevel: 'notarial',
    recommendedLevel: 'notarial',
    signableHere: false,
    suggestedMethods: [],
    requireRut: true,
    legalBasis: [
      'Código Civil, art. 1801 inciso 2 (escritura pública)',
      'Ley 19.799, art. 3 inciso 2 letra a',
    ],
    obligations: [
      'Otorga escritura pública ante notario.',
      'Inscribe el título en el Conservador de Bienes Raíces competente.',
    ],
    warnings: [
      'Sin escritura pública la compraventa es nula: no hay firma electrónica que la sanee.',
    ],
  },
  {
    id: 'pagare',
    label: 'Pagaré o letra de cambio',
    category: 'comercial',
    minLevel: 'notarial',
    recommendedLevel: 'notarial',
    signableHere: false,
    suggestedMethods: [],
    requireRut: true,
    legalBasis: [
      'Ley 18.092 sobre letra de cambio y pagaré',
      'Código de Procedimiento Civil, art. 434',
    ],
    obligations: [
      'Para que tenga mérito ejecutivo, la firma debe autorizarse ante notario o protestarse conforme a la ley.',
    ],
    warnings: [
      'Un pagaré firmado solo electrónicamente no sirve para cobrar ejecutivamente: pierdes justo la ventaja por la que se usa un pagaré.',
    ],
  },
  {
    id: 'mandato_simple',
    label: 'Mandato o poder simple',
    category: 'civil',
    minLevel: 'fes',
    recommendedLevel: 'fes_verificada',
    signableHere: true,
    suggestedMethods: ['draw', 'upload'],
    requireRut: true,
    legalBasis: ['Código Civil, art. 2116 y siguientes'],
    obligations: [],
    warnings: [
      'Bancos, notarías y organismos públicos suelen exigir poder notarial. Confirma con el destinatario antes de firmar aquí.',
    ],
  },
  {
    id: 'poder_notarial',
    label: 'Poder notarial',
    category: 'civil',
    minLevel: 'notarial',
    recommendedLevel: 'notarial',
    signableHere: false,
    suggestedMethods: [],
    requireRut: true,
    legalBasis: ['Ley 19.799, art. 3 inciso 2 letra b'],
    obligations: ['Otórgalo ante notario.'],
    warnings: [],
  },

  // ─── Societario ───────────────────────────────────────────────────────────
  {
    id: 'acta_directorio',
    label: 'Acta de directorio o de junta',
    category: 'societario',
    minLevel: 'fes',
    recommendedLevel: 'fea',
    signableHere: true,
    suggestedMethods: ['draw', 'upload'],
    requireRut: true,
    legalBasis: ['Ley 18.046, art. 48', 'Ley 19.799, art. 3'],
    obligations: [
      'Cuando el acuerdo deba reducirse a escritura pública o inscribirse, la firma electrónica simple no basta.',
    ],
    warnings: [
      'Los acuerdos que se inscriben en el Registro de Comercio suelen requerir firma electrónica avanzada o escritura pública.',
    ],
  },
  {
    id: 'constitucion_sociedad',
    label: 'Constitución o modificación de sociedad',
    category: 'societario',
    minLevel: 'fea',
    recommendedLevel: 'fea',
    signableHere: false,
    suggestedMethods: ['certificate'],
    requireRut: true,
    legalBasis: [
      'Ley 20.659 (Registro de Empresas y Sociedades)',
      'Ley 19.799, art. 4',
    ],
    obligations: [
      'Tramítala en el Registro de Empresas y Sociedades con firma electrónica avanzada, o por escritura pública ante notario.',
    ],
    warnings: [],
  },

  // ─── Tributario y público ─────────────────────────────────────────────────
  {
    id: 'documento_tributario_electronico',
    label: 'Documento tributario electrónico (factura, boleta, nota)',
    category: 'tributario',
    minLevel: 'fea',
    recommendedLevel: 'fea',
    signableHere: false,
    suggestedMethods: ['certificate'],
    requireRut: true,
    legalBasis: [
      'Ley 19.983',
      'Resoluciones del Servicio de Impuestos Internos sobre documentos tributarios electrónicos',
    ],
    obligations: [
      'Emítelo desde el sistema del SII o desde un software autorizado, firmado con certificado digital.',
    ],
    warnings: [
      'Un PDF de factura firmado aquí no es un documento tributario electrónico y no tiene valor ante el SII.',
    ],
  },
  {
    id: 'documento_organismo_publico',
    label: 'Documento dirigido a un organismo público',
    category: 'publico',
    minLevel: 'fea',
    recommendedLevel: 'fea',
    signableHere: false,
    suggestedMethods: ['certificate'],
    requireRut: true,
    legalBasis: [
      'Ley 19.799, art. 4 y art. 5 inciso 1',
      'Ley 21.180 sobre transformación digital del Estado',
    ],
    obligations: [
      'Los instrumentos públicos electrónicos deben suscribirse con firma electrónica avanzada.',
    ],
    warnings: [
      'Confirma con el organismo destinatario: muchos aceptan firma simple para trámites que no son instrumento público.',
    ],
  },

  // ─── Salud y datos ────────────────────────────────────────────────────────
  {
    id: 'consentimiento_informado',
    label: 'Consentimiento informado',
    category: 'salud',
    minLevel: 'fes',
    recommendedLevel: 'fes_verificada',
    signableHere: true,
    suggestedMethods: ['draw'],
    requireRut: true,
    legalBasis: ['Ley 20.584, art. 14 y 15'],
    obligations: [
      'Deja constancia de que la información fue entregada y comprendida antes de firmar.',
      'Incorpora el documento firmado a la ficha clínica.',
    ],
    warnings: [],
  },
  {
    id: 'autorizacion_datos_personales',
    label: 'Autorización de tratamiento de datos personales',
    category: 'salud',
    minLevel: 'fes',
    recommendedLevel: 'fes',
    signableHere: true,
    suggestedMethods: ALL_MARKS,
    requireRut: false,
    legalBasis: ['Ley 19.628', 'Ley 21.719 (en vigencia desde diciembre de 2026)'],
    obligations: [
      'La autorización debe ser específica: indica la finalidad concreta del tratamiento.',
      'Guarda constancia de cómo y cuándo se otorgó.',
    ],
    warnings: [],
  },

  // ─── Familia: excluidos ───────────────────────────────────────────────────
  {
    id: 'acto_derecho_familia',
    label: 'Acto de derecho de familia',
    category: 'familia',
    minLevel: 'no_electronica',
    recommendedLevel: 'no_electronica',
    signableHere: false,
    suggestedMethods: [],
    requireRut: true,
    legalBasis: ['Ley 19.799, art. 3 inciso 2 letra c'],
    obligations: ['Otórgalo en la forma que exija su regulación especial.'],
    warnings: [
      'La ley excluye expresamente los actos de derecho de familia de la firma electrónica.',
    ],
  },
  {
    id: 'testamento',
    label: 'Testamento',
    category: 'familia',
    minLevel: 'no_electronica',
    recommendedLevel: 'no_electronica',
    signableHere: false,
    suggestedMethods: [],
    requireRut: true,
    legalBasis: [
      'Código Civil, art. 1011 y siguientes',
      'Ley 19.799, art. 3 inciso 2 letras a y b',
    ],
    obligations: ['Otórgalo ante notario y testigos, o en la forma del testamento solemne.'],
    warnings: ['Un testamento firmado electrónicamente es nulo.'],
  },

  // ─── Genérico ─────────────────────────────────────────────────────────────
  {
    id: 'otro',
    label: 'Otro documento',
    category: 'otro',
    minLevel: 'fes',
    recommendedLevel: 'fes',
    signableHere: true,
    suggestedMethods: ALL_MARKS,
    requireRut: false,
    legalBasis: ['Ley 19.799, art. 3'],
    obligations: [],
    warnings: [
      'Si el documento es un título de crédito, un acto de familia o algo que la ley manda otorgar ante notario, la firma electrónica no lo sustituye.',
    ],
  },
];

export const DEFAULT_DOCUMENT_TYPE = 'otro';

const BY_ID = new Map(DOCUMENT_TYPES.map((rule) => [rule.id, rule]));

export function findDocumentType(id: string | null | undefined): DocumentTypeRule | null {
  if (!id) return null;
  return BY_ID.get(id) ?? null;
}

export const LEGAL_DISCLAIMER =
  'Esta orientación se basa en la Ley 19.799 y en la normativa chilena vigente. Es material informativo, no asesoría legal: ante un documento de alto valor o riesgo, consulta a un abogado.';
