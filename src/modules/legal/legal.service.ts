import { BadRequestException, Injectable } from '@nestjs/common';
import {
  DEFAULT_DOCUMENT_TYPE,
  DOCUMENT_TYPES,
  LEGAL_DISCLAIMER,
  findDocumentType,
  type DocumentTypeRule,
} from './document-types.catalog';
import {
  AUTH_METHOD_LABEL,
  DEFAULT_ALLOWED_METHODS,
  SIGNATURE_LEVEL_INFO,
  SIGNATURE_METHOD_INFO,
  SUPPORTED_LEVELS,
  achievedLevel,
  levelSatisfies,
  type SignatureLevel,
  type SignatureMethod,
  type SignerAuthMethod,
} from './signature-levels';

export interface LegalRecommendation {
  documentType: DocumentTypeRule;
  /** Nivel que la plataforma va a exigir en este sobre. */
  requiredLevel: SignatureLevel;
  /** Si la plataforma puede cerrar el documento por sí sola. */
  signableHere: boolean;
  /** Métodos que quedan habilitados para los firmantes. */
  allowedMethods: SignatureMethod[];
  requireRut: boolean;
  /** Texto que el firmante debe aceptar antes de firmar. */
  consentText: string;
  blockingReason: string | null;
  disclaimer: string;
}

@Injectable()
export class LegalService {
  /** Catálogo completo, con las fichas de niveles y métodos que lo acompañan. */
  catalog() {
    return {
      framework: {
        country: 'CL',
        label: 'Chile — Ley 19.799 sobre documentos electrónicos y firma electrónica',
      },
      documentTypes: DOCUMENT_TYPES,
      levels: Object.values(SIGNATURE_LEVEL_INFO),
      methods: Object.values(SIGNATURE_METHOD_INFO),
      supportedLevels: SUPPORTED_LEVELS,
      disclaimer: LEGAL_DISCLAIMER,
    };
  }

  rule(documentType: string | null | undefined): DocumentTypeRule {
    return findDocumentType(documentType) ?? findDocumentType(DEFAULT_DOCUMENT_TYPE)!;
  }

  /**
   * Qué firma pide este documento y con qué puede cumplirla el firmante.
   *
   * `requiredLevel` puede subirlo el emisor pero nunca bajarlo del mínimo legal:
   * quien envía el documento es libre de exigir más prueba de la necesaria, no
   * de exigir menos.
   */
  recommend(documentType: string | null | undefined, requestedLevel?: SignatureLevel): LegalRecommendation {
    const rule = this.rule(documentType);

    const requiredLevel =
      requestedLevel && levelSatisfies(requestedLevel, rule.minLevel)
        ? requestedLevel
        : rule.minLevel;

    const blockingReason = this.blockingReason(rule);

    const suggested = rule.suggestedMethods.length > 0 ? rule.suggestedMethods : DEFAULT_ALLOWED_METHODS;
    const allowedMethods = suggested.filter((m) => SIGNATURE_METHOD_INFO[m].available);

    // Un nivel verificado necesita un grafismo del propio firmante: aceptar por
    // clic no lo sostiene, así que ni se ofrece.
    const methods =
      requiredLevel === 'fes_verificada'
        ? allowedMethods.filter((m) => m === 'draw' || m === 'upload')
        : [...allowedMethods, 'click' as SignatureMethod];

    return {
      documentType: rule,
      requiredLevel,
      signableHere: rule.signableHere && blockingReason === null,
      allowedMethods: methods.length > 0 ? methods : DEFAULT_ALLOWED_METHODS,
      requireRut: rule.requireRut || requiredLevel === 'fes_verificada',
      consentText: this.consentText(rule),
      blockingReason,
      disclaimer: LEGAL_DISCLAIMER,
    };
  }

  /** Por qué este documento no puede cerrarse aquí, si es el caso. */
  private blockingReason(rule: DocumentTypeRule): string | null {
    if (rule.signableHere) return null;

    switch (rule.minLevel) {
      case 'no_electronica':
        return `La Ley 19.799 excluye este acto de la firma electrónica. ${rule.warnings[0] ?? ''}`.trim();
      case 'notarial':
        return `Este documento requiere ministro de fe. ${rule.obligations[0] ?? ''}`.trim();
      case 'fea':
        return `Este documento requiere firma electrónica avanzada, que aún no está disponible en la plataforma. ${rule.obligations[0] ?? ''}`.trim();
      default:
        return 'Este documento no puede firmarse en la plataforma.';
    }
  }

  /**
   * Declaración que el firmante acepta antes de firmar.
   *
   * El consentimiento expreso es lo que convierte un clic en una firma: sin
   * constancia de que el firmante quiso obligarse, la traza de auditoría prueba
   * que alguien apretó un botón, no que consintió.
   */
  consentText(rule: DocumentTypeRule): string {
    // Se nombra el documento como «el documento "X"» y no como "este X": las
    // etiquetas del catálogo tienen géneros distintos ("el contrato", "el acta")
    // y los paréntesis de algunas —"Acuerdo de confidencialidad (NDA)"— hacían
    // que la declaración quedara mal escrita. Con el tipo genérico se dice
    // simplemente "este documento", porque «suscribir "otro documento"» no es
    // una frase que nadie deba aceptar en un texto legal.
    const subject =
      rule.id === DEFAULT_DOCUMENT_TYPE ? 'este documento' : `el documento «${rule.label}»`;

    return [
      `Declaro que soy la persona identificada en este documento y que acepto suscribir ${subject} mediante firma electrónica.`,
      'Acepto que mi firma electrónica tenga el mismo valor que mi firma manuscrita, conforme a la Ley 19.799.',
      'Declaro haber leído el documento en su totalidad antes de firmarlo.',
    ].join(' ');
  }

  /**
   * Comprueba que lo que el firmante envió alcanza el nivel exigido, y devuelve
   * el nivel realmente alcanzado.
   *
   * Se rechaza antes de estampar, no después: un PDF ya firmado con un nivel
   * insuficiente es un documento que hay que invalidar a mano.
   */
  assertSignatureSatisfies(params: {
    requiredLevel: SignatureLevel;
    method: SignatureMethod;
    allowedMethods: SignatureMethod[];
    authMethod: SignerAuthMethod;
    consentAccepted: boolean;
    rutVerified: boolean;
  }): SignatureLevel {
    const methodInfo = SIGNATURE_METHOD_INFO[params.method];

    if (!methodInfo.available) {
      throw new BadRequestException(
        `El método "${methodInfo.label}" todavía no está disponible en la plataforma.`,
      );
    }

    if (!params.allowedMethods.includes(params.method)) {
      throw new BadRequestException(
        `Este documento no admite firmar con "${methodInfo.label}". Métodos permitidos: ${params.allowedMethods
          .map((m) => SIGNATURE_METHOD_INFO[m].label)
          .join(', ')}.`,
      );
    }

    if (!params.consentAccepted) {
      throw new BadRequestException(
        'Debes aceptar expresamente firmar este documento electrónicamente.',
      );
    }

    const achieved = achievedLevel({
      method: params.method,
      authMethod: params.authMethod,
      consentAccepted: params.consentAccepted,
      rutVerified: params.rutVerified,
    });

    if (!levelSatisfies(achieved, params.requiredLevel)) {
      throw new BadRequestException({
        message: `Este documento exige ${SIGNATURE_LEVEL_INFO[params.requiredLevel].label.toLowerCase()} y la firma enviada solo alcanza ${SIGNATURE_LEVEL_INFO[achieved].label.toLowerCase()}.`,
        code: 'SIGNATURE_LEVEL_INSUFFICIENT',
        requiredLevel: params.requiredLevel,
        achievedLevel: achieved,
        missing: SIGNATURE_LEVEL_INFO[params.requiredLevel].requirements,
      });
    }

    return achieved;
  }

  /** Etiquetas legibles para la hoja de certificación y la verificación pública. */
  describeSignature(params: {
    method: SignatureMethod | null;
    authMethod: SignerAuthMethod | null;
    level: SignatureLevel | null;
  }) {
    return {
      methodLabel: params.method ? SIGNATURE_METHOD_INFO[params.method].label : null,
      authLabel: params.authMethod ? AUTH_METHOD_LABEL[params.authMethod] : null,
      levelLabel: params.level ? SIGNATURE_LEVEL_INFO[params.level].label : null,
      levelShort: params.level ? SIGNATURE_LEVEL_INFO[params.level].short : null,
    };
  }
}
