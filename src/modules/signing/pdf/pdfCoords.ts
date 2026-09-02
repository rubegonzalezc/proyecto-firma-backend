import { PDFPage } from 'pdf-lib';

/**
 * ESPEJO de frontend/src/features/signatures/utils/pdfCoords.ts
 *
 * No editar sin actualizar el otro lado y los casos dorados de ambos: el
 * frontend define dónde va cada campo y el servidor lo estampa, así que
 * cualquier divergencia coloca las firmas en el sitio equivocado. La prueba
 * compartida (`pdfCoords.spec.ts`) usa los mismos valores que el test de
 * Vitest del frontend.
 *
 * Los campos se guardan como fracciones 0..1 del espacio **visual** —el que ve
 * el usuario, con `/Rotate` ya aplicado— con origen **top-left**.
 */

export type PageRotation = 0 | 90 | 180 | 270;

/** Rectángulo normalizado. `page` es 1-based, como en pdf.js. */
export interface FieldRect {
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Caja efectiva de la página en puntos, más su rotación de visualización. */
export interface PageBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  rotation: PageRotation;
}

export interface DrawArgs {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Grados antihorarios, como los espera pdf-lib */
  rotate: PageRotation;
}

export function normalizeRotation(raw: number): PageRotation {
  const value = (((Math.round(raw / 90) * 90) % 360) + 360) % 360;
  return value === 90 || value === 180 || value === 270 ? value : 0;
}

/**
 * CropBox ∩ MediaBox: la misma caja que pdf.js expone en `page.view`.
 *
 * No usar `getSize()`, que devuelve solo el MediaBox. En PDFs de imprenta,
 * donde ambos difieren, mezclarlos desplaza todos los campos.
 */
export function getPageBox(page: PDFPage): PageBox {
  const crop = page.getCropBox();
  const media = page.getMediaBox();

  return {
    x0: Math.max(crop.x, media.x),
    y0: Math.max(crop.y, media.y),
    x1: Math.min(crop.x + crop.width, media.x + media.width),
    y1: Math.min(crop.y + crop.height, media.y + media.height),
    rotation: normalizeRotation(page.getRotation().angle),
  };
}

/** Dimensiones tal como se muestran: la rotación 90/270 intercambia los ejes. */
export function visualPageSize(box: PageBox): { Vw: number; Vh: number } {
  const cw = box.x1 - box.x0;
  const ch = box.y1 - box.y0;
  return box.rotation === 90 || box.rotation === 270
    ? { Vw: ch, Vh: cw }
    : { Vw: cw, Vh: ch };
}

/**
 * `FieldRect` → argumentos de `drawImage`/`drawText` de pdf-lib.
 *
 * `/Rotate R` gira la página R grados horarios al mostrarla, así que el
 * contenido se pre-gira R grados antihorarios para cancelarlo. pdf-lib rota
 * alrededor de `(x, y)` tomando `width`/`height` previos al giro, por lo que
 * el ancla cae en una esquina distinta en cada cuadrante.
 */
export function rectToPdfLibDraw(rect: FieldRect, box: PageBox): DrawArgs {
  const { Vw, Vh } = visualPageSize(box);
  const vx = rect.x * Vw;
  const vy = rect.y * Vh;
  const vw = rect.w * Vw;
  const vh = rect.h * Vh;

  switch (box.rotation) {
    case 90:
      return { x: box.x0 + vy + vh, y: box.y0 + vx, width: vw, height: vh, rotate: 90 };
    case 180:
      return { x: box.x1 - vx, y: box.y0 + vy + vh, width: vw, height: vh, rotate: 180 };
    case 270:
      return { x: box.x1 - vy - vh, y: box.y1 - vx, width: vw, height: vh, rotate: 270 };
    default:
      return { x: box.x0 + vx, y: box.y1 - vy - vh, width: vw, height: vh, rotate: 0 };
  }
}

/**
 * Punto en espacio visual (puntos, origen top-left) → espacio de usuario PDF.
 * Es el caso degenerado de `rectToPdfLibDraw` con tamaño cero, y lo necesita
 * `drawText`, que ancla en el inicio de la baseline y no en una esquina.
 */
export function visualPointToPdf(vx: number, vy: number, box: PageBox): { x: number; y: number } {
  switch (box.rotation) {
    case 90:
      return { x: box.x0 + vy, y: box.y0 + vx };
    case 180:
      return { x: box.x1 - vx, y: box.y0 + vy };
    case 270:
      return { x: box.x1 - vy, y: box.y1 - vx };
    default:
      return { x: box.x0 + vx, y: box.y1 - vy };
  }
}
