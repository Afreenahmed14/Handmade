// Pure editor model: no React. The same render routine draws the on-screen preview and the exported print file,
// so what the customer sees is what is saved. Originals are only ever read, never modified or re-encoded.

export const EDITOR_PREVIEW_LONG_SIDE = 800; // logical frame size; all coordinates below are in these units
export const EDITOR_EXPORT_MAX_SIDE = 3000;
export const EDITOR_EXPORT_DPI = 300;
export const EDITOR_MAX_TEXTS = 5;
export const EDITOR_MIN_ZOOM = 0.2;
export const EDITOR_MAX_ZOOM = 8;
const EXPORT_MAX_BYTES = 9 * 1024 * 1024; // keeps the edited file well inside the 10 MB image rule and 20 MB bucket limit

export interface TextLayer { id: string; text: string; x: number; y: number; size: number; color: string } // x,y: 0..1 of frame; size: fraction of frame height
export interface EditorState { quarter: 0 | 1 | 2 | 3; fine: number; zoom: number; cx: number; cy: number; texts: TextLayer[] } // cx,cy: source px at frame centre
export interface PrintArea { widthMm: number | null; heightMm: number | null }
export interface Frame { width: number; height: number }
export interface SourceImage { source: CanvasImageSource; width: number; height: number; dispose: () => void }

export const isPrintAreaDefined = (area: PrintArea) => !!area.widthMm && !!area.heightMm && area.widthMm > 0 && area.heightMm > 0;
export const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export async function loadSourceImage(file: File): Promise<SourceImage> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file); // applies EXIF orientation in current browsers
      return { source: bitmap, width: bitmap.width, height: bitmap.height, dispose: () => bitmap.close() };
    } catch { /* fall back to an <img> element */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return { source: image, width: image.naturalWidth, height: image.naturalHeight, dispose: () => URL.revokeObjectURL(url) };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

/** Frame = the printable area. With real dimensions it takes their aspect ratio; without them it follows the photo's own shape (nothing is invented). */
export function frameFor(area: PrintArea, image: { width: number; height: number }, quarter: number): Frame {
  let aspect: number;
  if (isPrintAreaDefined(area)) aspect = (area.widthMm as number) / (area.heightMm as number);
  else { const odd = quarter % 2 === 1; aspect = (odd ? image.height : image.width) / (odd ? image.width : image.height); }
  const long = EDITOR_PREVIEW_LONG_SIDE;
  return aspect >= 1 ? { width: long, height: long / aspect } : { width: long * aspect, height: long };
}

export function baseScale(frame: Frame, image: { width: number; height: number }, quarter: number): number {
  const odd = quarter % 2 === 1;
  const rw = odd ? image.height : image.width, rh = odd ? image.width : image.height;
  return Math.max(frame.width / rw, frame.height / rh); // "fill the area" scale
}

export const currentScale = (frame: Frame, image: { width: number; height: number }, state: EditorState) => baseScale(frame, image, state.quarter) * state.zoom;
export const rotationDeg = (state: EditorState) => state.quarter * 90 + state.fine;

export function defaultState(image: { width: number; height: number }): EditorState {
  return { quarter: 0, fine: 0, zoom: 1, cx: image.width / 2, cy: image.height / 2, texts: [] };
}

/** Zoom that shows the whole photo inside the area (edges may be blank). */
export function fitZoom(frame: Frame, image: { width: number; height: number }, quarter: number): number {
  const odd = quarter % 2 === 1;
  const rw = odd ? image.height : image.width, rh = odd ? image.width : image.height;
  return clamp(Math.min(frame.width / rw, frame.height / rh) / baseScale(frame, image, quarter), EDITOR_MIN_ZOOM, 1);
}

export function textFont(layer: TextLayer, frame: Frame, k: number) {
  return `600 ${Math.max(4, layer.size * frame.height * k)}px "Helvetica Neue", Arial, sans-serif`;
}

export function drawDesign(ctx: CanvasRenderingContext2D, src: SourceImage, state: EditorState, frame: Frame, k: number, selectedTextId?: string | null) {
  ctx.save();
  ctx.scale(k, k);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, frame.width, frame.height);
  const scale = currentScale(frame, src, state);
  ctx.save();
  ctx.translate(frame.width / 2, frame.height / 2);
  ctx.rotate((rotationDeg(state) * Math.PI) / 180);
  ctx.scale(scale, scale);
  ctx.translate(-state.cx, -state.cy);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src.source, 0, 0, src.width, src.height);
  ctx.restore();
  ctx.restore();

  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const layer of state.texts) {
    if (!layer.text) continue;
    ctx.font = textFont(layer, frame, k);
    ctx.fillStyle = layer.color;
    ctx.fillText(layer.text, layer.x * frame.width * k, layer.y * frame.height * k);
    if (selectedTextId === layer.id) { // on-screen selection box only (selectedTextId is never passed when exporting)
      const width = ctx.measureText(layer.text).width, height = layer.size * frame.height * k;
      ctx.save();
      ctx.setLineDash([6, 4]);
      ctx.lineWidth = 2;
      ctx.strokeStyle = "#581A45";
      ctx.strokeRect(layer.x * frame.width * k - width / 2 - 6, layer.y * frame.height * k - height / 2 - 4, width + 12, height + 8);
      ctx.restore();
    }
  }
  ctx.restore();
}

/** Topmost text layer under a point given in frame units. */
export function hitText(ctx: CanvasRenderingContext2D, state: EditorState, frame: Frame, x: number, y: number): TextLayer | null {
  ctx.save();
  try {
    for (let index = state.texts.length - 1; index >= 0; index -= 1) {
      const layer = state.texts[index];
      if (!layer.text) continue;
      ctx.font = textFont(layer, frame, 1);
      const halfW = ctx.measureText(layer.text).width / 2 + 10, halfH = (layer.size * frame.height) / 2 + 10;
      if (Math.abs(x - layer.x * frame.width) <= halfW && Math.abs(y - layer.y * frame.height) <= halfH) return layer;
    }
  } finally { ctx.restore(); }
  return null;
}

/** Moves the photo by a drag of (dx, dy) frame units, accounting for rotation and zoom. */
export function panState(state: EditorState, frame: Frame, image: { width: number; height: number }, dx: number, dy: number): EditorState {
  const scale = currentScale(frame, image, state), theta = (rotationDeg(state) * Math.PI) / 180;
  const cos = Math.cos(theta), sin = Math.sin(theta);
  return {
    ...state,
    cx: clamp(state.cx - (dx * cos + dy * sin) / scale, 0, image.width),
    cy: clamp(state.cy - (-dx * sin + dy * cos) / scale, 0, image.height),
  };
}

function cropBounds(state: EditorState, frame: Frame, image: { width: number; height: number }) {
  const scale = currentScale(frame, image, state), theta = (rotationDeg(state) * Math.PI) / 180;
  const cos = Math.cos(theta), sin = Math.sin(theta);
  const xs: number[] = [], ys: number[] = [];
  for (const [fx, fy] of [[0, 0], [frame.width, 0], [frame.width, frame.height], [0, frame.height]]) {
    const dx = (fx - frame.width / 2) / scale, dy = (fy - frame.height / 2) / scale;
    xs.push(state.cx + dx * cos + dy * sin);
    ys.push(state.cy - dx * sin + dy * cos);
  }
  const x0 = clamp(Math.min(...xs), 0, image.width), x1 = clamp(Math.max(...xs), 0, image.width);
  const y0 = clamp(Math.min(...ys), 0, image.height), y1 = clamp(Math.max(...ys), 0, image.height);
  const r = (n: number) => Math.round(n * 10) / 10;
  return { x: r(x0), y: r(y0), width: r(x1 - x0), height: r(y1 - y0) };
}

/** Source pixels per printed inch across the frame width, or null when the print size is unknown. */
export function effectiveDpi(state: EditorState, frame: Frame, image: { width: number; height: number }, area: PrintArea): number | null {
  if (!isPrintAreaDefined(area)) return null;
  const sourcePxAcross = frame.width / currentScale(frame, image, state);
  return Math.round(sourcePxAcross / ((area.widthMm as number) / 25.4));
}

export interface DesignResult { editedFile: File; meta: Record<string, unknown> }

function toBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
}

/** Renders the print file (JPEG) and the metadata describing the design. The original file is not touched. */
export async function buildDesignResult(file: File, src: SourceImage, state: EditorState, area: PrintArea, productType: string | null): Promise<DesignResult> {
  const frame = frameFor(area, src, state.quarter);
  const defined = isPrintAreaDefined(area);
  const longTarget = defined
    ? Math.min(Math.round((Math.max(area.widthMm as number, area.heightMm as number) / 25.4) * EDITOR_EXPORT_DPI), EDITOR_EXPORT_MAX_SIDE)
    : Math.min(Math.max(src.width, src.height), EDITOR_EXPORT_MAX_SIDE);
  const k = Math.max(0.5, longTarget) / Math.max(frame.width, frame.height);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(frame.width * k));
  canvas.height = Math.max(1, Math.round(frame.height * k));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Your browser could not prepare the edited image.");
  drawDesign(ctx, src, state, frame, k);

  let quality = 0.92;
  let blob = await toBlob(canvas, quality);
  while (blob && blob.size > EXPORT_MAX_BYTES && quality > 0.5) { quality -= 0.1; blob = await toBlob(canvas, quality); }
  if (!blob) throw new Error("Your browser could not save the edited image.");
  if (blob.size > EXPORT_MAX_BYTES) throw new Error("The edited image is too large to save. Try a smaller photo.");

  const baseName = file.name.replace(/\.[^.]+$/, "").replace(/[^A-Za-z0-9._-]+/g, "-").slice(0, 60) || "photo";
  const editedFile = new File([blob], `edited-${baseName}.jpg`, { type: "image/jpeg" });
  const scale = currentScale(frame, src, state);
  const meta: Record<string, unknown> = {
    editor_version: 1,
    product_type: productType,
    print_area: { width_mm: defined ? area.widthMm : null, height_mm: defined ? area.heightMm : null, defined, note: defined ? undefined : "Print size not configured for this product; frame follows the photo's shape." },
    original: { file_name: file.name, mime_type: file.type, size_bytes: file.size, width_px: src.width, height_px: src.height },
    transform: {
      rotation_deg: Math.round(rotationDeg(state) * 100) / 100, quarter_turns: state.quarter, fine_rotation_deg: Math.round(state.fine * 100) / 100,
      zoom_vs_fill: Math.round(state.zoom * 1000) / 1000, scale_output_px_per_source_px: Math.round(scale * (canvas.width / frame.width) * 10000) / 10000,
      center_source_px: { x: Math.round(state.cx), y: Math.round(state.cy) },
      crop_bounds_source_px: cropBounds(state, frame, src),
      crop_note: Math.abs(state.fine) < 0.01 ? "Axis-aligned crop of the original, in source pixels (after quarter-turn rotation is applied)." : "Bounding box of the crop in the original; the photo is also tilted.",
    },
    texts: state.texts.filter((layer) => layer.text.trim()).map((layer) => ({
      text: layer.text, color: layer.color, x_fraction: Math.round(layer.x * 1000) / 1000, y_fraction: Math.round(layer.y * 1000) / 1000,
      size_fraction_of_height: Math.round(layer.size * 1000) / 1000, font_px_in_output: Math.round(layer.size * canvas.height),
    })),
    output: { width_px: canvas.width, height_px: canvas.height, mime_type: "image/jpeg", effective_dpi: effectiveDpi(state, frame, src, area) },
  };
  return { editedFile, meta };
}
