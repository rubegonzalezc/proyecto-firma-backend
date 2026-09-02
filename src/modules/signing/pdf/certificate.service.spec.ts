import { PDFDocument, StandardFonts } from 'pdf-lib';
import { formatHash } from '../../../common/utils/hash';
import { CertificateService } from './certificate.service';

async function contract(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  doc.addPage([612, 792]).drawText('CONTRATO', { x: 60, y: 700, size: 14, font });
  return Buffer.from(await doc.save());
}

const baseData = {
  documentName: 'Contrato de arrendamiento.pdf',
  verificationCode: 'A1B2-C3D4-E5F6',
  verifyUrl: 'https://app.example.cl/verify/A1B2-C3D4-E5F6',
  originalSha256: 'a'.repeat(64),
  finalSha256: 'b'.repeat(64),
  signers: [
    {
      fullName: 'Ana Rojas',
      email: 'ana@example.cl',
      roleLabel: 'Arrendador',
      signedAt: '2026-09-02T12:00:00.000Z',
      ip: '190.1.2.3',
    },
    {
      fullName: 'Luis Soto',
      email: 'luis@example.cl',
      roleLabel: 'Arrendatario',
      signedAt: '2026-09-02T13:00:00.000Z',
      ip: null,
    },
  ],
};

describe('CertificateService', () => {
  const service = new CertificateService();

  it('añade la hoja al final sin tocar el contrato', async () => {
    const original = await contract();
    const result = await service.append(original, baseData);

    const doc = await PDFDocument.load(result);
    expect(doc.getPageCount()).toBe(2);
    // La página del contrato conserva su tamaño original
    expect(doc.getPage(0).getSize()).toEqual({ width: 612, height: 792 });
  });

  it('produce un PDF válido con muchos firmantes sin desbordar', async () => {
    const many = {
      ...baseData,
      signers: Array.from({ length: 12 }, (_, i) => ({
        fullName: `Firmante ${i + 1}`,
        email: `f${i + 1}@example.cl`,
        roleLabel: null,
        signedAt: '2026-09-02T12:00:00.000Z',
        ip: null,
      })),
    };

    const doc = await PDFDocument.load(await service.append(await contract(), many));
    expect(doc.getPageCount()).toBe(2);
  });

  it('funciona sin hash final, cuando el sobre aún no se ha cerrado', async () => {
    const result = await service.append(await contract(), {
      ...baseData,
      finalSha256: undefined,
    });
    expect((await PDFDocument.load(result)).getPageCount()).toBe(2);
  });

  it('no falla con nombres fuera de WinAnsi', async () => {
    const result = await service.append(await contract(), {
      ...baseData,
      signers: [
        { fullName: 'Łukasz 张伟', email: 'l@example.cl', roleLabel: null, signedAt: null, ip: null },
      ],
    });
    expect((await PDFDocument.load(result)).getPageCount()).toBe(2);
  });

  it('tolera un firmante sin fecha de firma', async () => {
    const result = await service.append(await contract(), {
      ...baseData,
      signers: [{ fullName: 'Ana', email: 'a@x.cl', roleLabel: null, signedAt: null, ip: null }],
    });
    expect((await PDFDocument.load(result)).getPageCount()).toBe(2);
  });

  it('agrupa el hash para que sea legible', () => {
    expect(formatHash('a'.repeat(64))).toContain('aaaaaaaa aaaaaaaa');
  });
});
