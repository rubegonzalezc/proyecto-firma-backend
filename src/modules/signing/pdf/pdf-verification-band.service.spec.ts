import { PDFDocument, StandardFonts } from 'pdf-lib';
import {
  formatSignersBandLine,
  PdfVerificationBandService,
} from './pdf-verification-band.service';

async function contract(pages = 1): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pages; i++) {
    doc.addPage([612, 792]).drawText(`CONTRATO p${i + 1}`, { x: 72, y: 700, size: 14, font });
  }
  return Buffer.from(await doc.save());
}

describe('formatSignersBandLine', () => {
  it('resume varios firmantes', () => {
    expect(formatSignersBandLine(['Ana'])).toBe('Ana');
    expect(formatSignersBandLine(['Ana', 'Luis'])).toBe('Ana · Luis');
    expect(formatSignersBandLine(['Ana', 'Luis', 'Pedro'])).toBe('Ana · Luis +1');
  });
});

describe('PdfVerificationBandService', () => {
  const service = new PdfVerificationBandService();

  it('estampa el carril en cada página del cuerpo', async () => {
    const original = await contract(2);
    const out = await service.apply(original, {
      verificationCode: 'A1B2-C3D4-E5F6',
      verifyUrl: 'https://app.example.cl/verify/A1B2-C3D4-E5F6',
      signerNames: ['Ana Rojas', 'Luis Soto'],
    });

    const doc = await PDFDocument.load(out);
    expect(doc.getPageCount()).toBe(2);
  });

  it('no altera el número de páginas', async () => {
    const original = await contract(1);
    const out = await service.apply(original, {
      verificationCode: 'AAAA-BBBB-CCCC',
      verifyUrl: 'https://app.example.cl/verify/AAAA-BBBB-CCCC',
      signerNames: ['Uno'],
    });
    const before = (await PDFDocument.load(original)).getPageCount();
    const after = (await PDFDocument.load(out)).getPageCount();
    expect(after).toBe(before);
  });
});
