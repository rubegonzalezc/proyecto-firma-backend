import { UnauthorizedException } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import { fakeConfig } from '../../testing/supabase-fake';
import { SignerSessionService } from './signer-session.service';

const SECRET = 'un-secreto-de-pruebas-suficientemente-largo';
const CLAIMS = { signerId: 'signer-1', envelopeId: 'env-1', tokenId: 'tok-1' };

const service = new SignerSessionService(fakeConfig({ 'app.signerJwtSecret': SECRET }));

describe('SignerSessionService', () => {
  it('emite y verifica una sesión con sus claims', () => {
    const { token } = service.issue(CLAIMS);
    expect(service.verify(token)).toMatchObject(CLAIMS);
  });

  it('rechaza un token firmado con otro secreto', () => {
    const foreign = jwt.sign(CLAIMS, 'otro-secreto', { audience: 'signer-portal' });
    expect(() => service.verify(foreign)).toThrow(UnauthorizedException);
  });

  it('rechaza un token con otra audiencia', () => {
    const wrongAudience = jwt.sign(CLAIMS, SECRET, { audience: 'otra-cosa' });
    expect(() => service.verify(wrongAudience)).toThrow(UnauthorizedException);
  });

  it('rechaza un token expirado', () => {
    const expired = jwt.sign(CLAIMS, SECRET, { audience: 'signer-portal', expiresIn: '-1s' });
    expect(() => service.verify(expired)).toThrow(UnauthorizedException);
  });

  it('rechaza un token sin los claims necesarios', () => {
    const incomplete = jwt.sign({ signerId: 'x' }, SECRET, { audience: 'signer-portal' });
    expect(() => service.verify(incomplete)).toThrow(UnauthorizedException);
  });

  it('rechaza basura en vez de propagar el error de la librería', () => {
    expect(() => service.verify('no-es-un-jwt')).toThrow(UnauthorizedException);
    expect(() => service.verify('')).toThrow(UnauthorizedException);
  });

  it('la sesión es de vida corta', () => {
    const { token } = service.issue(CLAIMS);
    const payload = jwt.decode(token) as jwt.JwtPayload;
    const minutes = (payload.exp! - payload.iat!) / 60;
    expect(minutes).toBeLessThanOrEqual(30);
  });
});
