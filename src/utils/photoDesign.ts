// Pure helpers for the admin photo workspace (no React, no network).
//
// SECURITY NOTE: `custom_requests.preferences.photo_design` is written by the customer, so it is untrusted input.
// A path from it is only ever used when it is ALSO listed in the request's `attachment_paths`, which the
// create_customer_custom_request RPC has already verified belong to that customer's own folder.

import type { DbPhotoPreparationRow, Json } from "../types/database";
import {
  EDITOR_MAX_TEXTS, EDITOR_MAX_ZOOM, EDITOR_MIN_ZOOM, clamp, type EditorState, type PrintArea, type TextLayer,
} from "../components/photoEditor/editorModel";

export const MAX_PHOTO_SETS = 10;
const IMAGE_PATH = /\.(jpe?g|png|webp)$/i;
export const isImagePath = (path: string) => IMAGE_PATH.test(path);

export type PhotoStage = "original_uploaded" | "customer_edited" | "admin_prepared" | "ready_for_quotation";
export const PHOTO_STAGES: ReadonlyArray<{ stage: PhotoStage; label: string }> = [
  { stage: "original_uploaded", label: "Original uploaded" },
  { stage: "customer_edited", label: "Customer edited" },
  { stage: "admin_prepared", label: "Admin prepared" },
  { stage: "ready_for_quotation", label: "Ready for quotation" },
];

export interface PhotoSet {
  /** Stable key: the original attachment path. */
  key: string;
  /** 1-based position in the request, for display. */
  position: number;
  originalPath: string;
  customerEditedPath: string | null;
  originalAttachmentNumber: number | null;
  editedAttachmentNumber: number | null;
  /** Editor metadata the customer's editor recorded, or null for attachments uploaded without the editor. */
  customerMeta: Record<string, unknown> | null;
  printArea: PrintArea;
  productType: string | null;
  /** Images can be prepared in the editor; anything else cannot. */
  editable: boolean;
}

export interface ParsedPhotoSets { sets: PhotoSet[]; ignoredEntries: number }

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
/** Narrows arbitrary JSON to a plain object, or null. */
export const asRecord = (value: unknown): Record<string, unknown> | null => (isRecord(value) ? value : null);
const num = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);
const positiveInt = (value: unknown): number | null => { const n = num(value); return n !== null && Number.isInteger(n) && n > 0 ? n : null; };

export function readPrintArea(meta: Record<string, unknown> | null): PrintArea {
  const area = meta && isRecord(meta.print_area) ? meta.print_area : null;
  const width = area ? num(area.width_mm) : null;
  const height = area ? num(area.height_mm) : null;
  return width !== null && height !== null && width > 0 && height > 0 ? { widthMm: width, heightMm: height } : { widthMm: null, heightMm: null };
}

/**
 * Groups a request's attachments into per-photo sets.
 *  - Entries come from preferences.photo_design (original + customer-edited pair).
 *  - Image attachments not covered by any entry become original-only sets (requests made without the editor).
 *  - Malformed entries, or entries naming a path that is not an attachment of this request, are ignored and counted.
 */
export function parsePhotoSets(preferences: Json | null | undefined, attachmentPaths: readonly string[]): ParsedPhotoSets {
  const attachments = new Set(attachmentPaths);
  const raw = isRecord(preferences) && Array.isArray(preferences.photo_design) ? preferences.photo_design : [];
  const sets: PhotoSet[] = [];
  const claimed = new Set<string>();
  let ignoredEntries = 0;

  for (const entry of raw.slice(0, MAX_PHOTO_SETS * 2)) {
    if (!isRecord(entry)) { ignoredEntries += 1; continue; }
    const original = typeof entry.original_path === "string" ? entry.original_path : "";
    const edited = typeof entry.edited_path === "string" ? entry.edited_path : "";
    if (!original || !attachments.has(original) || claimed.has(original) || !isImagePath(original)) { ignoredEntries += 1; continue; }
    const editedValid = edited && edited !== original && attachments.has(edited) && !claimed.has(edited) && isImagePath(edited);
    claimed.add(original);
    if (editedValid) claimed.add(edited);
    const meta = { ...entry } as Record<string, unknown>;
    delete meta.original_path; delete meta.edited_path; // keep only descriptive editor metadata
    sets.push({
      key: original, position: sets.length + 1, originalPath: original, customerEditedPath: editedValid ? edited : null,
      originalAttachmentNumber: positiveInt(entry.original_attachment_number), editedAttachmentNumber: editedValid ? positiveInt(entry.edited_attachment_number) : null,
      customerMeta: meta, printArea: readPrintArea(meta),
      productType: typeof entry.product_type === "string" ? entry.product_type.slice(0, 100) : null, editable: true,
    });
    if (sets.length >= MAX_PHOTO_SETS) break;
  }

  attachmentPaths.forEach((path, index) => {
    if (sets.length >= MAX_PHOTO_SETS || claimed.has(path) || !isImagePath(path)) return;
    claimed.add(path);
    sets.push({
      key: path, position: sets.length + 1, originalPath: path, customerEditedPath: null, originalAttachmentNumber: index + 1,
      editedAttachmentNumber: null, customerMeta: null, printArea: { widthMm: null, heightMm: null }, productType: null, editable: true,
    });
  });
  return { sets, ignoredEntries };
}

/** Preparations grouped by original path, newest version first. The first item of each list is the current one. */
export function groupPreparations(rows: readonly DbPhotoPreparationRow[]): Map<string, DbPhotoPreparationRow[]> {
  const grouped = new Map<string, DbPhotoPreparationRow[]>();
  for (const row of rows) grouped.set(row.original_path, [...(grouped.get(row.original_path) ?? []), row]);
  for (const list of grouped.values()) list.sort((a, b) => b.version - a.version);
  return grouped;
}

/** Highest stage reached. Ready-for-quotation counts only when the CURRENT prepared version carries the flag. */
export function photoStage(set: Pick<PhotoSet, "customerEditedPath">, current: Pick<DbPhotoPreparationRow, "is_ready_for_quotation"> | null | undefined): PhotoStage {
  if (current) return current.is_ready_for_quotation ? "ready_for_quotation" : "admin_prepared";
  return set.customerEditedPath ? "customer_edited" : "original_uploaded";
}

export const stageIndex = (stage: PhotoStage) => PHOTO_STAGES.findIndex((item) => item.stage === stage);

/** Which of the four stages a photo has actually been through (same order as PHOTO_STAGES). A skipped stage stays false. */
export function achievedStages(set: Pick<PhotoSet, "customerEditedPath">, current: Pick<DbPhotoPreparationRow, "is_ready_for_quotation"> | null | undefined): boolean[] {
  return [true, set.customerEditedPath !== null, Boolean(current), Boolean(current?.is_ready_for_quotation)];
}

const HEX_COLOUR = /^#[0-9a-f]{6}$/i;

/**
 * Rebuilds editor state from the metadata a previous editing session saved (customer's or admin's), so an admin can
 * continue from there. Returns null when the metadata is missing or unusable; the caller then starts from the original.
 */
export function editorStateFromMeta(meta: Record<string, unknown> | null | undefined, makeId: () => string = () => crypto.randomUUID()): EditorState | null {
  if (!meta || !isRecord(meta.transform) || !isRecord(meta.original)) return null;
  const width = num(meta.original.width_px), height = num(meta.original.height_px);
  if (width === null || height === null || width <= 0 || height <= 0) return null;
  const t = meta.transform;
  const quarter = num(t.quarter_turns), fine = num(t.fine_rotation_deg), zoom = num(t.zoom_vs_fill);
  const center = isRecord(t.center_source_px) ? t.center_source_px : null;
  const cx = center ? num(center.x) : null, cy = center ? num(center.y) : null;
  if (quarter === null || fine === null || zoom === null || cx === null || cy === null) return null;
  if (!Number.isInteger(quarter) || quarter < 0 || quarter > 3) return null;

  const texts: TextLayer[] = [];
  if (Array.isArray(meta.texts)) {
    for (const item of meta.texts.slice(0, EDITOR_MAX_TEXTS)) {
      if (!isRecord(item) || typeof item.text !== "string" || !item.text.trim()) continue;
      const x = num(item.x_fraction), y = num(item.y_fraction), size = num(item.size_fraction_of_height);
      if (x === null || y === null || size === null) continue;
      texts.push({
        id: makeId(), text: item.text.slice(0, 60), x: clamp(x, 0, 1), y: clamp(y, 0, 1), size: clamp(size, 0.03, 0.3),
        color: typeof item.color === "string" && HEX_COLOUR.test(item.color) ? item.color.toUpperCase() : "#FFFFFF",
      });
    }
  }
  return {
    quarter: quarter as 0 | 1 | 2 | 3, fine: clamp(fine, -45, 45), zoom: clamp(zoom, EDITOR_MIN_ZOOM, EDITOR_MAX_ZOOM),
    cx: clamp(cx, 0, width), cy: clamp(cy, 0, height), texts,
  };
}

export interface MetaSummary { widthPx: number | null; heightPx: number | null; dpi: number | null; printMm: string | null; textCount: number }

/** Display-safe summary of editor metadata. Never throws on odd JSON. */
export function summarizeMeta(meta: Json | Record<string, unknown> | null | undefined): MetaSummary {
  const m = isRecord(meta) ? meta : {};
  const output = isRecord(m.output) ? m.output : {};
  const area = readPrintArea(m);
  return {
    widthPx: num(output.width_px), heightPx: num(output.height_px), dpi: num(output.effective_dpi),
    printMm: area.widthMm && area.heightMm ? `${area.widthMm} × ${area.heightMm} mm` : null,
    textCount: Array.isArray(m.texts) ? m.texts.length : 0,
  };
}
