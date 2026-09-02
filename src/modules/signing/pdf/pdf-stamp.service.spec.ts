import {
  PDFArray,
  PDFDocument,
  PDFName,
  PDFRawStream,
  PDFRef,
  StandardFonts,
  decodePDFRawStream,
  degrees,
} from 'pdf-lib';
import { PdfStampService, encodeSafe } from './pdf-stamp.service';
import type { PageRotation } from './pdfCoords';

/** PNG opaco de 1×1: basta para localizar dónde se colocó la imagen. */
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
).toString('base64');

async function blankPage(rotation: PageRotation = 0): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  if (rotation) page.setRotation(degrees(rotation));
  return Buffer.from(await doc.save());
}

/** Descomprime el content stream de la primera página para inspeccionarlo. */
async function contentStreamOf(bytes: Buffer): Promise<string> {
  const doc = await PDFDocument.load(bytes);
  const page = doc.getPage(0);
  const contents = page.node.get(PDFName.of('Contents'));
  const refs: PDFRef[] = contents instanceof PDFArray
    ? (contents.asArray() as PDFRef[])
    : [contents as PDFRef];

  return refs
    .map((ref) => {
      const stream = doc.context.lookup(ref);
      if (!(stream instanceof PDFRawStream)) return '';
      return Buffer.from(decodePDFRawStream(stream).decode()).toString('latin1');
    })
    .join('\n');
}

function multiply(a: number[], b: number[]): number[] {
  return [
    b[0] * a[0] + b[1] * a[2],
    b[0] * a[1] + b[1] * a[3],
    b[2] * a[0] + b[3] * a[2],
    b[2] * a[1] + b[3] * a[3],
    b[4] * a[0] + b[5] * a[2] + a[4],
    b[4] * a[1] + b[5] * a[3] + a[5],
  ];
}

/**
 * CTM efectiva de cada imagen pintada.
 *
 * pdf-lib no emite una sola matriz: descompone la colocación en traslación,
 * rotación y escala, así que hay que componerlas siguiendo la pila de q/Q,
 * igual que haría un visor. Quedarse con una sola `cm` daría la escala del
 * cuadrado unidad y no la posición real.
 */
function imageMatrices(stream: string): number[][] {
  const tokens = stream.split(/\s+/);
  const found: number[][] = [];
  const stack: number[][] = [];
  let ctm = [1, 0, 0, 1, 0, 0];

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token === 'q') stack.push([...ctm]);
    else if (token === 'Q') ctm = stack.pop() ?? ctm;
    else if (token === 'cm') {
      const values = tokens.slice(i - 6, i).map(Number);
      if (values.every((n) => Number.isFinite(n))) ctm = multiply(ctm, values);
    } else if (token === 'Do') {
      found.push([...ctm]);
    }
  }

  return found;
}

describe('PdfStampService', () => {
  const service = new PdfStampService();

  it('coloca la firma en el rectángulo pedido', async () => {
    const rect = { page: 1, x: 0.2, y: 0.35, w: 100 / 612, h: 100 / 792 };
    const { bytes } = await service.stampFields(await blankPage(), [
      { rect, value: { kind: 'signature', pngBase64: PNG_1X1 } },
    ]);

    const matrices = imageMatrices(await contentStreamOf(bytes));
    expect(matrices).toHaveLength(1);

    const [a, , , d, e, f] = matrices[0];
    // 100pt de lado, esquina inferior izquierda en (0.2*612, 792 - 0.35*792 - 100)
    expect(a).toBeCloseTo(100, 2);
    expect(d).toBeCloseTo(100, 2);
    expect(e).toBeCloseTo(0.2 * 612, 2);
    expect(f).toBeCloseTo(792 - 0.35 * 792 - 100, 2);
  });

  it('estampa una imagen por cada campo de firma', async () => {
    const { bytes } = await service.stampFields(await blankPage(), [
      { rect: { page: 1, x: 0.1, y: 0.1, w: 0.2, h: 0.05 }, value: { kind: 'signature', pngBase64: PNG_1X1 } },
      { rect: { page: 1, x: 0.6, y: 0.1, w: 0.2, h: 0.05 }, value: { kind: 'signature', pngBase64: PNG_1X1 } },
    ]);

    expect(imageMatrices(await contentStreamOf(bytes))).toHaveLength(2);
  });

  it('conserva la proporción de la firma dentro de una caja alargada', async () => {
    // Imagen cuadrada en una caja 4:1 → debe quedar cuadrada y centrada
    const rect = { page: 1, x: 0.1, y: 0.5, w: 400 / 612, h: 100 / 792 };
    const { bytes } = await service.stampFields(await blankPage(), [
      { rect, value: { kind: 'signature', pngBase64: PNG_1X1 } },
    ]);

    const [a, , , d, e] = imageMatrices(await contentStreamOf(bytes))[0];
    expect(a).toBeCloseTo(100, 1);
    expect(d).toBeCloseTo(100, 1);
    // Centrada horizontalmente: sobran 300pt, 150 a cada lado
    expect(e).toBeCloseTo(0.1 * 612 + 150, 1);
  });

  it('produce un PDF válido en las cuatro rotaciones', async () => {
    for (const rotation of [0, 90, 180, 270] as PageRotation[]) {
      const { bytes } = await service.stampFields(await blankPage(rotation), [
        { rect: { page: 1, x: 0.2, y: 0.3, w: 0.2, h: 0.06 }, value: { kind: 'signature', pngBase64: PNG_1X1 } },
      ]);
      const doc = await PDFDocument.load(bytes);
      expect(doc.getPageCount()).toBe(1);
      expect(imageMatrices(await contentStreamOf(bytes))).toHaveLength(1);
    }
  });

  it('omite campos que apuntan a páginas inexistentes en vez de romper', async () => {
    const { bytes } = await service.stampFields(await blankPage(), [
      { rect: { page: 9, x: 0.1, y: 0.1, w: 0.2, h: 0.05 }, value: { kind: 'text', text: 'x' } },
    ]);
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
  });

  it('no falla con un nombre fuera de WinAnsi y reporta lo sustituido', async () => {
    const result = await service.stampFields(await blankPage(), [
      {
        rect: { page: 1, x: 0.1, y: 0.5, w: 0.4, h: 0.04 },
        value: { kind: 'text', text: 'Łukasz 张伟' },
      },
    ]);

    expect(result.droppedCharacters).toContain('Ł');
    expect(result.droppedCharacters).toContain('张');
    expect((await PDFDocument.load(result.bytes)).getPageCount()).toBe(1);
  });

  it('deja intactos los acentos del español', async () => {
    const result = await service.stampFields(await blankPage(), [
      {
        rect: { page: 1, x: 0.1, y: 0.5, w: 0.4, h: 0.04 },
        value: { kind: 'text', text: 'José Muñoz Ñuñoa' },
      },
    ]);
    expect(result.droppedCharacters).toEqual([]);
  });

  it('aplana un formulario antes de estampar para que no lo tape', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([612, 792]);
    const form = doc.getForm();
    const field = form.createTextField('nombre');
    field.setText('valor previo');
    field.addToPage(page, { x: 50, y: 600, width: 200, height: 20 });

    const { bytes } = await service.stampFields(Buffer.from(await doc.save()), [
      { rect: { page: 1, x: 0.1, y: 0.1, w: 0.2, h: 0.05 }, value: { kind: 'signature', pngBase64: PNG_1X1 } },
    ]);

    const reloaded = await PDFDocument.load(bytes);
    expect(reloaded.getForm().getFields()).toHaveLength(0);
    // El campo aplanado también se pinta como XObject, de ahí que haya más de
    // un `Do`: lo que importa es que el aplanado no reventó el estampado.
    expect(imageMatrices(await contentStreamOf(bytes)).length).toBeGreaterThanOrEqual(1);
  });
});

describe('encodeSafe', () => {
  it('conserva los acentos y sustituye lo que la fuente no admite', async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);

    expect(encodeSafe(font, 'José Muñoz')).toEqual({ text: 'José Muñoz', dropped: [] });

    const polish = encodeSafe(font, 'Łukasz');
    expect(polish.dropped).toEqual(['Ł']);
    expect(polish.text).toHaveLength('Łukasz'.length);
  });
});
