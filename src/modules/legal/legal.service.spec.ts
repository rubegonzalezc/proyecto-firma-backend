import { BadRequestException } from '@nestjs/common';
import { LegalService } from './legal.service';
import { achievedLevel, levelSatisfies } from './signature-levels';

describe('LegalService', () => {
  const legal = new LegalService();

  describe('recommend', () => {
    it('cae al tipo genérico si el id no existe', () => {
      expect(legal.recommend('no-existe').documentType.id).toBe('otro');
    });

    it('marca como no firmable lo que la ley excluye', () => {
      const testamento = legal.recommend('testamento');
      expect(testamento.signableHere).toBe(false);
      expect(testamento.blockingReason).toContain('excluye');
    });

    it('marca como no firmable lo que exige ministro de fe', () => {
      const pagare = legal.recommend('pagare');
      expect(pagare.signableHere).toBe(false);
      expect(pagare.blockingReason).toContain('ministro de fe');
    });

    it('explica que la FEA aún no está disponible', () => {
      const dte = legal.recommend('documento_tributario_electronico');
      expect(dte.signableHere).toBe(false);
      expect(dte.blockingReason).toContain('avanzada');
    });

    it('deja al emisor subir el nivel exigido, nunca bajarlo', () => {
      const subido = legal.recommend('nda', 'fes_verificada');
      expect(subido.requiredLevel).toBe('fes_verificada');

      // El contrato de trabajo exige RUT; pedir "fes" no relaja ese mínimo.
      const bajado = legal.recommend('contrato_trabajo', 'fes');
      expect(bajado.requiredLevel).toBe('fes');
      expect(bajado.requireRut).toBe(true);
    });

    it('retira el clic cuando se exige identidad verificada', () => {
      const verificada = legal.recommend('nda', 'fes_verificada');
      expect(verificada.allowedMethods).not.toContain('click');
      expect(verificada.requireRut).toBe(true);
    });

    it('ofrece el clic en los documentos de firma simple', () => {
      expect(legal.recommend('nda').allowedMethods).toContain('click');
    });

    it('nunca ofrece métodos que la plataforma no puede ejecutar', () => {
      for (const type of ['contrato_trabajo', 'nda', 'otro', 'constitucion_sociedad']) {
        expect(legal.recommend(type).allowedMethods).not.toContain('certificate');
      }
    });

    it('nombra el documento en el texto de consentimiento', () => {
      expect(legal.recommend('contrato_arrendamiento').consentText).toContain(
        'el documento «Contrato de arrendamiento»',
      );
    });

    it('con el tipo genérico dice «este documento», no «otro documento»', () => {
      // «acepto suscribir "otro documento"» no es una frase que nadie deba
      // aceptar en una declaración legal.
      const generic = legal.recommend('otro').consentText;
      expect(generic).toContain('suscribir este documento');
      expect(generic).not.toContain('otro documento');
    });

    it('no arrastra los paréntesis de la etiqueta a la declaración', () => {
      expect(legal.recommend('nda').consentText).toContain(
        'el documento «Acuerdo de confidencialidad (NDA)»',
      );
    });
  });

  describe('assertSignatureSatisfies', () => {
    type Params = Parameters<LegalService['assertSignatureSatisfies']>[0];

    const base: Params = {
      requiredLevel: 'fes',
      method: 'draw',
      allowedMethods: ['draw', 'upload'],
      authMethod: 'email_otp',
      consentAccepted: true,
      rutVerified: true,
    };

    const call = (patch: Partial<Params> = {}) =>
      legal.assertSignatureSatisfies({ ...base, ...patch });

    it('devuelve el nivel alcanzado cuando todo encaja', () => {
      expect(call()).toBe('fes_verificada');
    });

    it('rechaza un método que el sobre no permite', () => {
      expect(() => call({ method: 'click' })).toThrow(BadRequestException);
    });

    it('rechaza métodos no implementados', () => {
      expect(() => call({ method: 'certificate', allowedMethods: ['certificate'] })).toThrow(
        /no está disponible/,
      );
    });

    it('rechaza la firma sin consentimiento expreso', () => {
      expect(() => call({ consentAccepted: false })).toThrow(/aceptar expresamente/);
    });

    it('rechaza la firma que no alcanza el nivel exigido', () => {
      expect(() => call({ requiredLevel: 'fes_verificada', rutVerified: false })).toThrow(
        BadRequestException,
      );
    });
  });

  describe('achievedLevel', () => {
    it('solo declara verificada con identidad, RUT y grafismo propio', () => {
      expect(
        achievedLevel({ method: 'draw', authMethod: 'email_otp', consentAccepted: true, rutVerified: true }),
      ).toBe('fes_verificada');

      expect(
        achievedLevel({ method: 'type', authMethod: 'email_otp', consentAccepted: true, rutVerified: true }),
      ).toBe('fes');

      expect(
        achievedLevel({ method: 'draw', authMethod: 'link_only', consentAccepted: true, rutVerified: true }),
      ).toBe('fes');

      expect(
        achievedLevel({ method: 'draw', authMethod: 'email_otp', consentAccepted: true, rutVerified: false }),
      ).toBe('fes');
    });

    it('no acredita nada sin consentimiento', () => {
      expect(
        achievedLevel({ method: 'draw', authMethod: 'account_password', consentAccepted: false, rutVerified: true }),
      ).toBe('fes');
    });
  });

  describe('levelSatisfies', () => {
    it('ordena los niveles por fuerza probatoria', () => {
      expect(levelSatisfies('fes_verificada', 'fes')).toBe(true);
      expect(levelSatisfies('fes', 'fes_verificada')).toBe(false);
      expect(levelSatisfies('fes_verificada', 'notarial')).toBe(false);
    });
  });
});
