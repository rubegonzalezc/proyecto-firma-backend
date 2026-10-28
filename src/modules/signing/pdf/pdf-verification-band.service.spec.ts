import { PDFDocument, StandardFonts } from 'pdf-lib';
import {
  formatSignersBandLine,
  PdfVerificationBandService,
  placeBandRuns,
  VERIFICATION_BAND_WIDTH,
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

describe('placeBandRuns', () => {
  it('separa los tramos por su ancho real y no los deja cruzarse', async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const placed = placeBandRuns(
      [
        { text: 'Firmado electrónicamente', font, size: 8 },
        { text: 'A1B2-C3D4-E5F6', font, size: 8 },
        { text: 'Ana Rojas · Luis Soto', font, size: 8 },
      ],
      780,
      70,
      10,
    );

    expect(placed).toHaveLength(3);
    for (let i = 0; i < placed.length - 1; i++) {
      const end = placed[i].y - font.widthOfTextAtSize(placed[i].text, placed[i].size);
      expect(end).toBeGreaterThanOrEqual(placed[i + 1].y + 10 - 0.01);
    }
    const last = placed[placed.length - 1];
    expect(last.y - font.widthOfTextAtSize(last.text, last.size)).toBeGreaterThanOrEqual(70);
  });
});

describe('PdfVerificationBandService', () => {
  const service = new PdfVerificationBandService();

  it('desplaza el contrato y reserva la franja izquierda', async () => {
    const original = await contract(2);
    const out = await service.apply(original, {
      verificationCode: 'A1B2-C3D4-E5F6',
      verifyUrl: 'https://app.example.cl/verify/A1B2-C3D4-E5F6',
      signerNames: ['Ana Rojas', 'Luis Soto'],
    });

    const doc = await PDFDocument.load(out);
    expect(doc.getPageCount()).toBe(2);
    const page = doc.getPage(0);
    expect(page.getWidth()).toBeCloseTo(612 + VERIFICATION_BAND_WIDTH, 1);
    expect(page.getHeight()).toBeCloseTo(792, 1);
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
