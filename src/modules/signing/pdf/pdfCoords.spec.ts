import { PDFDocument, degrees } from 'pdf-lib';
import {
  DrawArgs,
  FieldRect,
  PageBox,
  PageRotation,
  getPageBox,
  normalizeRotation,
  rectToPdfLibDraw,
  visualPageSize,
  visualPointToPdf,
} from './pdfCoords';

/**
 * Los casos de esta prueba son los mismos que los de
 * frontend/src/features/signatures/utils/pdfCoords.test.ts. Si los dos espejos
 * divergen, uno de los dos falla.
 */

/** Inverso escrito aparte de la tabla: un error de signo no se cancelaría. */
function occupiedUserAabb(d: DrawArgs) {
  switch (d.rotate) {
    case 90:
      return { ux0: d.x - d.height, ux1: d.x, uy0: d.y, uy1: d.y + d.width };
    case 180:
      return { ux0: d.x - d.width, ux1: d.x, uy0: d.y - d.height, uy1: d.y };
    case 270:
      return { ux0: d.x, ux1: d.x + d.height, uy0: d.y - d.width, uy1: d.y };
    default:
      return { ux0: d.x, ux1: d.x + d.width, uy0: d.y, uy1: d.y + d.height };
  }
}

function userAabbToVisual(aabb: ReturnType<typeof occupiedUserAabb>, box: PageBox) {
  const { ux0, ux1, uy0, uy1 } = aabb;

  switch (box.rotation) {
    case 90:
      return { vx: uy0 - box.y0, vy: ux0 - box.x0, vw: uy1 - uy0, vh: ux1 - ux0 };
    case 180:
      return { vx: box.x1 - ux1, vy: uy0 - box.y0, vw: ux1 - ux0, vh: uy1 - uy0 };
    case 270:
      return { vx: box.y1 - uy1, vy: box.x1 - ux1, vw: uy1 - uy0, vh: ux1 - ux0 };
    default:
      return { vx: ux0 - box.x0, vy: box.y1 - uy1, vw: ux1 - ux0, vh: uy1 - uy0 };
  }
}

const ROTATIONS: PageRotation[] = [0, 90, 180, 270];

const BOXES: Array<{ label: string; base: Omit<PageBox, 'rotation'> }> = [
  { label: 'carta origen 0', base: { x0: 0, y0: 0, x1: 612, y1: 792 } },
  { label: 'A4 origen 0', base: { x0: 0, y0: 0, x1: 595.28, y1: 841.89 } },
  { label: 'cropbox con origen no nulo', base: { x0: 12.5, y0: 24, x1: 600.5, y1: 780 } },
];

const RECTS: FieldRect[] = [
  { page: 1, x: 0, y: 0, w: 1, h: 1 },
  { page: 1, x: 0.1, y: 0.1, w: 0.3, h: 0.08 },
  { page: 1, x: 0.55, y: 0.72, w: 0.3, h: 0.08 },
  { page: 1, x: 0, y: 0, w: 0.2, h: 0.05 },
  { page: 1, x: 0.8, y: 0.9, w: 0.2, h: 0.1 },
  { page: 1, x: 0.42, y: 0.33, w: 0.15, h: 0.2 },
];

describe('rectToPdfLibDraw', () => {
  for (const { label, base } of BOXES) {
    for (const rotation of ROTATIONS) {
      const box: PageBox = { ...base, rotation };
      const { Vw, Vh } = visualPageSize(box);

      it(`round-trip visual→pdf-lib→visual · ${label} · rot ${rotation}`, () => {
        for (const rect of RECTS) {
          const visual = userAabbToVisual(occupiedUserAabb(rectToPdfLibDraw(rect, box)), box);

          expect(visual.vx).toBeCloseTo(rect.x * Vw, 6);
          expect(visual.vy).toBeCloseTo(rect.y * Vh, 6);
          expect(visual.vw).toBeCloseTo(rect.w * Vw, 6);
          expect(visual.vh).toBeCloseTo(rect.h * Vh, 6);
        }
      });

      it(`el rect (0,0,1,1) cubre exactamente la caja · ${label} · rot ${rotation}`, () => {
        const { ux0, ux1, uy0, uy1 } = occupiedUserAabb(
          rectToPdfLibDraw({ page: 1, x: 0, y: 0, w: 1, h: 1 }, box),
        );

        expect(ux0).toBeCloseTo(box.x0, 6);
        expect(ux1).toBeCloseTo(box.x1, 6);
        expect(uy0).toBeCloseTo(box.y0, 6);
        expect(uy1).toBeCloseTo(box.y1, 6);
      });
    }
  }

  it('intercambia las dimensiones visuales en rotación 90 y 270', () => {
    const base = { x0: 0, y0: 0, x1: 612, y1: 792 };
    expect(visualPageSize({ ...base, rotation: 0 })).toEqual({ Vw: 612, Vh: 792 });
    expect(visualPageSize({ ...base, rotation: 90 })).toEqual({ Vw: 792, Vh: 612 });
    expect(visualPageSize({ ...base, rotation: 180 })).toEqual({ Vw: 612, Vh: 792 });
    expect(visualPageSize({ ...base, rotation: 270 })).toEqual({ Vw: 792, Vh: 612 });
  });
});

describe('visualPointToPdf', () => {
  it('coincide con el caso degenerado de rectToPdfLibDraw', () => {
    const base = { x0: 12.5, y0: 24, x1: 600.5, y1: 780 };

    for (const rotation of ROTATIONS) {
      const box: PageBox = { ...base, rotation };
      const { Vw, Vh } = visualPageSize(box);
      const degenerate = rectToPdfLibDraw({ page: 1, x: 0.3, y: 0.4, w: 0, h: 0 }, box);
      const point = visualPointToPdf(0.3 * Vw, 0.4 * Vh, box);

      expect(point.x).toBeCloseTo(degenerate.x, 6);
      expect(point.y).toBeCloseTo(degenerate.y, 6);
    }
  });

  it('mapea la esquina superior izquierda visual en las 4 rotaciones', () => {
    const base = { x0: 0, y0: 0, x1: 612, y1: 792 };
    expect(visualPointToPdf(0, 0, { ...base, rotation: 0 })).toEqual({ x: 0, y: 792 });
    expect(visualPointToPdf(0, 0, { ...base, rotation: 90 })).toEqual({ x: 0, y: 0 });
    expect(visualPointToPdf(0, 0, { ...base, rotation: 180 })).toEqual({ x: 612, y: 0 });
    expect(visualPointToPdf(0, 0, { ...base, rotation: 270 })).toEqual({ x: 612, y: 792 });
  });
});

describe('getPageBox', () => {
  it('lee la caja y la rotación reales de una página de pdf-lib', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([612, 792]);
    page.setRotation(degrees(90));

    expect(getPageBox(page)).toEqual({ x0: 0, y0: 0, x1: 612, y1: 792, rotation: 90 });
  });

  it('intersecta CropBox con MediaBox en vez de usar getSize()', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([612, 792]);
    page.setCropBox(10, 10, 580, 760);

    const box = getPageBox(page);
    expect(box).toEqual({ x0: 10, y0: 10, x1: 590, y1: 770, rotation: 0 });

    // getSize() daría 612x792 y desplazaría todos los campos
    const size = page.getSize();
    expect(size.width).toBe(612);
    expect(box.x1 - box.x0).toBe(580);
  });
});

describe('normalizeRotation', () => {
  it('normaliza ángulos negativos y mayores de 360', () => {
    expect(normalizeRotation(-90)).toBe(270);
    expect(normalizeRotation(450)).toBe(90);
    expect(normalizeRotation(360)).toBe(0);
    expect(normalizeRotation(45)).toBe(90);
  });
});
