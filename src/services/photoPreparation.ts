import type { DbPhotoPreparationRow, Json } from "../types/database";
import { supabase } from "../lib/supabase";
import type { DesignResult } from "../components/photoEditor/editorModel";
import { validateReferenceImage } from "./customRequests";
import {
  createPrivateDownloadUrl, createPrivateUploadUrls, deletePrivateFile, downloadPrivateFile, uploadAdminPreparedFile,
} from "./storage";

// Admin photo preparation (Phase 2B). Every function here relies on server-side enforcement: the table is readable by
// super admins only (RLS), writes go through super-admin-only RPCs, and storage is the existing private bucket.
// Nothing in this file produces a permanent URL.

const BUCKET = "customization-uploads" as const;
export type PhotoPreparation = DbPhotoPreparationRow;
export const PRODUCTION_NOTES_MAX = 5000;

/** Thrown when the preparation table does not exist yet (the Phase 2B migration has not been applied). */
export class PhotoPreparationUnavailableError extends Error {
  constructor() { super("Photo preparation is not enabled yet: the database migration has not been applied."); }
}

export class PhotoPreparationValidationError extends Error {}

function errorCode(error: unknown): string {
  const code = typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined;
  return typeof code === "string" ? code : "";
}
function errorMessage(error: unknown): string {
  return typeof error === "object" && error !== null && typeof (error as { message?: unknown }).message === "string" ? (error as { message: string }).message : "";
}

/** A Postgres/PostgREST error code means the server answered and rejected the call; no code means the outcome is unknown. */
const serverRejected = (error: unknown) => errorCode(error).length > 0;

/** All prepared versions of every photo in a request, newest first. */
export async function getPhotoPreparations(requestId: string): Promise<PhotoPreparation[]> {
  const { data, error } = await supabase.from("custom_request_photo_preparations").select("*").eq("request_id", requestId)
    .order("original_path").order("version", { ascending: false });
  if (error) {
    // 42P01: undefined table (direct Postgres). PGRST205/PGRST200: not in the API schema cache.
    if (["42P01", "PGRST205", "PGRST200"].includes(errorCode(error)) || /does not exist|schema cache/i.test(errorMessage(error))) throw new PhotoPreparationUnavailableError();
    throw error;
  }
  return data;
}

/** One batched request for short-lived (2 minute) preview URLs. Unsignable paths map to null. */
export function signPreviewUrls(paths: string[]): Promise<Record<string, string | null>> {
  return createPrivateUploadUrls(BUCKET, paths);
}

const EXTENSION_MIME: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };

/** Reads a private image with the admin's own session and validates it exactly like an upload (type, size, signature). */
export async function loadPrivateImageAsFile(path: string): Promise<File> {
  const name = path.split("/").pop() ?? "photo.jpg";
  const extension = name.split(".").pop()?.toLowerCase() ?? "";
  const mime = EXTENSION_MIME[extension];
  if (!mime) throw new PhotoPreparationValidationError("This attachment is not an image that can be prepared.");
  const blob = await downloadPrivateFile(BUCKET, path);
  const file = new File([blob], name, { type: mime });
  const problem = await validateReferenceImage(file);
  if (problem) throw new PhotoPreparationValidationError(problem);
  return file;
}

/** Signs a one-minute download link and triggers the browser's save dialog. The URL is not kept anywhere. */
export async function downloadPrivateImage(path: string, fileName: string): Promise<void> {
  const safeName = fileName.replace(/[^A-Za-z0-9._-]+/g, "-").slice(0, 120) || "photo";
  const url = await createPrivateDownloadUrl(BUCKET, path, safeName);
  const link = document.createElement("a");
  link.href = url;
  link.rel = "noopener noreferrer";
  link.download = safeName;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

export type PreparationStart = "admin_version" | "customer_design" | "original";

export interface SavePreparationInput {
  requestId: string;
  originalPath: string;
  result: DesignResult;
  startedFrom: PreparationStart;
  productionNotes: string;
  markReady: boolean;
}

/**
 * Uploads the prepared image as a NEW private file, then records it. The original and the customer-edited file are
 * only ever read. If the server rejects the record, the new upload is removed; if the outcome is unknown (network),
 * it is kept so a record that did land never points at a missing file.
 */
export async function savePhotoPreparation(input: SavePreparationInput): Promise<string> {
  const notes = input.productionNotes.trim();
  if (notes.length > PRODUCTION_NOTES_MAX) throw new PhotoPreparationValidationError(`Production notes must be ${PRODUCTION_NOTES_MAX} characters or fewer.`);
  const problem = await validateReferenceImage(input.result.editedFile); // type, size and signature of what we are about to store
  if (problem) throw new PhotoPreparationValidationError(problem);

  const meta = {
    ...input.result.meta,
    admin_preparation: { prepared_from: input.startedFrom, editor: "PhotoEditor", source_original_path: input.originalPath },
  } as unknown as Json;

  const preparedPath = await uploadAdminPreparedFile(input.requestId, input.result.editedFile);
  const { data, error } = await supabase.rpc("admin_save_photo_preparation", {
    p_request_id: input.requestId, p_original_path: input.originalPath, p_prepared_path: preparedPath,
    p_preparation_meta: meta, p_production_notes: notes || null, p_mark_ready: input.markReady,
  });
  if (error) {
    if (serverRejected(error)) await deletePrivateFile(BUCKET, preparedPath);
    throw error;
  }
  return data;
}

/** Notes / ready flag of the current prepared version. */
export async function updatePhotoPreparation(preparationId: string, productionNotes: string, markReady: boolean): Promise<void> {
  const notes = productionNotes.trim();
  if (notes.length > PRODUCTION_NOTES_MAX) throw new PhotoPreparationValidationError(`Production notes must be ${PRODUCTION_NOTES_MAX} characters or fewer.`);
  const { error } = await supabase.rpc("admin_update_photo_preparation", {
    p_preparation_id: preparationId, p_production_notes: notes || null, p_mark_ready: markReady,
  });
  if (error) throw error;
}

export function friendlyPhotoPreparationError(error: unknown): string {
  if (error instanceof PhotoPreparationUnavailableError || error instanceof PhotoPreparationValidationError) return error.message;
  const message = errorMessage(error);
  const code = errorCode(error);
  if (code === "42501") return "Only a super admin can prepare customer photos.";
  if (code === "22023" || code === "P0002") return message || "This photo can't be prepared right now.";
  if (/payload too large|exceeded the maximum|too large/i.test(message)) return "The prepared image is too large to upload.";
  if (/mime type|not supported/i.test(message)) return "That file type is not supported.";
  if (/not found|Object not found/i.test(message)) return "The original photo could not be found in storage.";
  return "Something went wrong while preparing the photo. Please try again.";
}
