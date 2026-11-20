import type { Database, DbCustomRequestRow, Json, CustomRequestStatus } from "../types/database";
import { supabase } from "../lib/supabase";
import { createPrivateUploadUrl, deletePrivateFile, uploadPrivateFile } from "./storage";

export type CustomRequestDirectoryRow = Database["public"]["Views"]["admin_custom_request_directory"]["Row"];
export type CustomRequestStatusHistory = Database["public"]["Tables"]["custom_request_status_history"]["Row"];
export type CustomRequestInternalNote = Database["public"]["Tables"]["custom_request_internal_notes"]["Row"];
export type CustomRequestResponse = Database["public"]["Tables"]["custom_request_responses"]["Row"];

export interface CustomRequestFilters {
  page: number;
  pageSize: number;
  search?: string;
  status?: CustomRequestStatus | "all";
  fromDate?: string;
  toDate?: string;
}

export interface CustomRequestListResult {
  requests: CustomRequestDirectoryRow[];
  total: number;
}

export interface CustomRequestStats {
  total: number;
  byStatus: Record<CustomRequestStatus, number>;
}

export interface CustomRequestDetail {
  request: CustomRequestDirectoryRow;
  statusHistory: CustomRequestStatusHistory[];
  internalNotes: CustomRequestInternalNote[];
  responses: CustomRequestResponse[];
  attachmentUrls: string[];
}

function cleanSearch(value: string) {
  return value.replace(/[%,_()"\\]/g, " ").replace(/\s+/g, " ").trim();
}

export async function getCustomRequests(filters: CustomRequestFilters): Promise<CustomRequestListResult> {
  const from = Math.max(0, filters.page - 1) * filters.pageSize;
  let query = supabase.from("admin_custom_request_directory").select("*", { count: "exact" }).order("created_at", { ascending: false }).range(from, from + filters.pageSize - 1);
  if (filters.status && filters.status !== "all") query = query.eq("status", filters.status);
  if (filters.fromDate) query = query.gte("created_at", new Date(`${filters.fromDate}T00:00:00`).toISOString());
  if (filters.toDate) query = query.lte("created_at", new Date(`${filters.toDate}T23:59:59.999`).toISOString());
  const search = filters.search ? cleanSearch(filters.search) : "";
  if (search) query = query.or(`request_number.ilike.%${search}%,title.ilike.%${search}%,requested_product.ilike.%${search}%,customer_name.ilike.%${search}%,customer_email.ilike.%${search}%`);
  const { data, error, count } = await query;
  if (error) throw error;
  return { requests: data, total: count ?? data.length };
}

export async function getCustomRequestStats(): Promise<CustomRequestStats> {
  const statuses: CustomRequestStatus[] = ["new", "pending", "in_progress", "completed", "rejected"];
  const counts = await Promise.all(statuses.map(async (status) => {
    const { count, error } = await supabase.from("admin_custom_request_directory").select("id", { count: "exact", head: true }).eq("status", status);
    if (error) throw error;
    return [status, count ?? 0] as const;
  }));
  const byStatus = Object.fromEntries(counts) as Record<CustomRequestStatus, number>;
  return { total: Object.values(byStatus).reduce((sum, value) => sum + value, 0), byStatus };
}

export async function getCustomRequestDetail(requestId: string): Promise<CustomRequestDetail> {
  const [requestResult, historyResult, notesResult, responsesResult] = await Promise.all([
    supabase.from("admin_custom_request_directory").select("*").eq("id", requestId).single(),
    supabase.from("custom_request_status_history").select("*").eq("request_id", requestId).order("created_at"),
    supabase.from("custom_request_internal_notes").select("*").eq("request_id", requestId).order("created_at", { ascending: false }),
    supabase.from("custom_request_responses").select("*").eq("request_id", requestId).order("created_at", { ascending: false }),
  ]);
  if (requestResult.error) throw requestResult.error;
  if (historyResult.error) throw historyResult.error;
  if (notesResult.error) throw notesResult.error;
  if (responsesResult.error) throw responsesResult.error;

  const paths = requestResult.data.attachment_paths;
  const attachmentUrls = await Promise.all(paths.map((path) => createPrivateUploadUrl("customization-uploads", path)));
  return {
    request: requestResult.data,
    statusHistory: historyResult.data,
    internalNotes: notesResult.data,
    responses: responsesResult.data,
    attachmentUrls,
  };
}

export async function updateCustomRequest(input: {
  requestId: string;
  newStatus?: CustomRequestStatus;
  statusReason?: string;
  internalNote?: string;
  customerResponse?: string;
}): Promise<void> {
  const { error } = await supabase.rpc("admin_update_custom_request", {
    p_request_id: input.requestId,
    p_new_status: input.newStatus ?? null,
    p_status_reason: input.statusReason?.trim() || null,
    p_internal_note: input.internalNote?.trim() || null,
    p_customer_response: input.customerResponse?.trim() || null,
  });
  if (error) throw error;
}

export interface CreateCustomerRequestInput {
  productId?: string;
  requestedProduct: string;
  title: string;
  description: string;
  requirements?: Json;
  preferences?: Json;
  budgetMin?: number;
  budgetMax?: number;
  attachmentPaths?: string[];
}

export async function createCustomerCustomRequest(input: CreateCustomerRequestInput): Promise<string> {
  const { data, error } = await supabase.rpc("create_customer_custom_request", {
    p_product_id: input.productId ?? null,
    p_requested_product: input.requestedProduct,
    p_title: input.title,
    p_description: input.description,
    p_requirements: input.requirements ?? {},
    p_preferences: input.preferences ?? {},
    p_budget_min_inr: input.budgetMin ?? null,
    p_budget_max_inr: input.budgetMax ?? null,
    p_attachment_paths: input.attachmentPaths ?? [],
  });
  if (error) throw error;
  return data;
}

export type CustomRequestDbRow = DbCustomRequestRow;

// ---- Customer submission (Phase 5A) ---------------------------------------------------------------------------
// Reuses the existing private `customization-uploads` bucket (owner-folder policy) and the existing
// `create_customer_custom_request` RPC. No new tables, RPCs or policies.

export const CUSTOM_REQUEST_MAX_FILES = 10; // the RPC / table constraint allows at most 10 attachments
/** With the photo editor each photo stores two files (original + edited) and the request allows 10 attachments in total. */
export const EDITOR_MAX_PHOTOS = Math.floor(CUSTOM_REQUEST_MAX_FILES / 2);
export const CUSTOM_REQUEST_MAX_FILE_BYTES = 10 * 1024 * 1024;
export const CUSTOM_REQUEST_IMAGE_ACCEPT = "image/jpeg,image/png,image/webp";
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];

/** Thrown for problems the customer can fix; the message is safe to show as written. */
export class CustomRequestValidationError extends Error {}

export interface CustomRequestForm {
  title: string;
  description: string;
  dimensions: string;
  material: string;
  colour: string;
  finish: string;
  quantity: string;
  engravingText: string;
  styleNotes: string;
  neededBy: string;
  budgetMin: string;
  budgetMax: string;
}

export const emptyCustomRequestForm = (productName = ""): CustomRequestForm => ({
  title: productName ? `Customization for ${productName}`.slice(0, 200) : "",
  description: "", dimensions: "", material: "", colour: "", finish: "", quantity: "1",
  engravingText: "", styleNotes: "", neededBy: "", budgetMin: "", budgetMax: "",
});

export type CustomRequestFormErrors = Partial<Record<keyof CustomRequestForm, string>>;

function parseBudget(raw: string): number | null | "invalid" {
  const value = raw.trim().replace(/,/g, "");
  if (!value) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(value)) return "invalid";
  const amount = Number(value);
  return Number.isFinite(amount) && amount <= 99999999 ? amount : "invalid";
}

export function validateCustomRequestForm(form: CustomRequestForm): CustomRequestFormErrors {
  const errors: CustomRequestFormErrors = {};
  const title = form.title.trim();
  if (!title) errors.title = "Give your request a short title.";
  else if (title.length > 200) errors.title = "The title must be 200 characters or fewer.";
  const description = form.description.trim();
  if (!description) errors.description = "Describe what you would like us to customize.";
  else if (description.length < 10) errors.description = "Please add a little more detail (at least 10 characters).";
  else if (description.length > 5000) errors.description = "The description must be 5000 characters or fewer.";
  for (const key of ["dimensions", "material", "colour", "finish", "engravingText"] as const) {
    if (form[key].trim().length > 300) errors[key] = "Keep this to 300 characters or fewer.";
  }
  if (form.styleNotes.trim().length > 1000) errors.styleNotes = "Keep this to 1000 characters or fewer.";
  const quantity = form.quantity.trim();
  if (quantity && (!/^\d+$/.test(quantity) || Number(quantity) < 1 || Number(quantity) > 1000)) errors.quantity = "Enter a whole number from 1 to 1000.";
  if (form.neededBy) {
    const date = new Date(`${form.neededBy}T00:00:00`);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    if (Number.isNaN(date.getTime())) errors.neededBy = "Choose a valid date.";
    else if (date < today) errors.neededBy = "Choose a date that is today or later.";
  }
  const min = parseBudget(form.budgetMin);
  const max = parseBudget(form.budgetMax);
  if (min === "invalid") errors.budgetMin = "Enter an amount in rupees, for example 5000.";
  if (max === "invalid") errors.budgetMax = "Enter an amount in rupees, for example 8000.";
  if (typeof min === "number" && typeof max === "number" && max < min) errors.budgetMax = "Maximum budget must be at least the minimum.";
  return errors;
}

async function matchesImageSignature(file: File): Promise<boolean> {
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const at = (offset: number, text: string) => [...text].every((char, index) => bytes[offset + index] === char.charCodeAt(0));
  switch (file.type) {
    case "image/jpeg": return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    case "image/png": return bytes[0] === 0x89 && at(1, "PNG");
    case "image/webp": return at(0, "RIFF") && at(8, "WEBP");
    default: return false;
  }
}

/** Optional per-product limits (personalised products). Each can only tighten the global rules, never relax them. */
export interface ReferenceImageRules {
  allowedMimes?: string[];
  maxBytes?: number;
  maxFiles?: number;
  minWidth?: number | null;
  minHeight?: number | null;
}

async function readImageSize(file: File): Promise<{ width: number; height: number } | null> {
  try {
    if (typeof createImageBitmap !== "function") return null;
    const bitmap = await createImageBitmap(file);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return size;
  } catch {
    return null;
  }
}

/** Returns an error message, or "" when the reference image may be attached. Checks type, size and file signature. */
export async function validateReferenceImage(file: File, rules?: ReferenceImageRules): Promise<string> {
  if (!IMAGE_TYPES.includes(file.type)) return `${file.name}: choose a JPEG, PNG or WebP image.`;
  if (rules?.allowedMimes && !rules.allowedMimes.includes(file.type)) return `${file.name}: this product accepts ${rules.allowedMimes.map((mime) => mime.replace("image/", "").toUpperCase()).join(", ")} images only.`;
  if (file.size === 0) return `${file.name}: the file is empty.`;
  const maxBytes = Math.min(CUSTOM_REQUEST_MAX_FILE_BYTES, rules?.maxBytes ?? CUSTOM_REQUEST_MAX_FILE_BYTES);
  if (file.size > maxBytes) return `${file.name}: images must be ${Math.round(maxBytes / 1024 / 1024)} MB or smaller.`;
  try {
    if (!(await matchesImageSignature(file))) return `${file.name}: this doesn't look like a valid image.`;
  } catch {
    return `${file.name}: we couldn't read this file. Please choose it again.`;
  }
  if (rules?.minWidth || rules?.minHeight) {
    const size = await readImageSize(file); // if the browser can't decode it, the team still reviews it
    if (size && (size.width < (rules.minWidth ?? 0) || size.height < (rules.minHeight ?? 0))) {
      return `${file.name}: the image is ${size.width} × ${size.height} px; this product needs at least ${rules.minWidth ?? 0} × ${rules.minHeight ?? 0} px for a sharp print.`;
    }
  }
  return "";
}

function compact(entries: Record<string, string | number | undefined>): Record<string, string | number> {
  return Object.fromEntries(Object.entries(entries).filter(([, v]) => v !== undefined && v !== "")) as Record<string, string | number>;
}

function buildPayload(form: CustomRequestForm, extraRequirements?: Record<string, string | number>) {
  const min = parseBudget(form.budgetMin);
  const max = parseBudget(form.budgetMax);
  const quantity = form.quantity.trim();
  return {
    title: form.title.trim(),
    description: form.description.trim(),
    requirements: compact({
      dimensions: form.dimensions.trim(), material: form.material.trim(), colour: form.colour.trim(),
      finish: form.finish.trim(), quantity: quantity ? Number(quantity) : undefined, engraving_text: form.engravingText.trim(),
      ...extraRequirements,
    }) as Json,
    preferences: compact({ style_notes: form.styleNotes.trim(), needed_by: form.neededBy }) as Json,
    budgetMin: typeof min === "number" ? min : undefined,
    budgetMax: typeof max === "number" ? max : undefined,
  };
}

/** The customer's own request (RLS limits custom_requests to the owner); used for the reference number. */
export async function getOwnRequestReference(requestId: string): Promise<string | null> {
  const { data, error } = await supabase.from("custom_requests").select("request_number").eq("id", requestId).maybeSingle();
  if (error) throw error;
  return data?.request_number ?? null;
}

/** Finds a request the customer created since `since` for the same product and title (guards against double submits). */
async function findRecentOwnRequest(productId: string, title: string, since: string): Promise<{ id: string; request_number: string } | null> {
  const { data, error } = await supabase.from("custom_requests").select("id,request_number")
    .eq("product_id", productId).eq("title", title).gte("created_at", since).order("created_at", { ascending: false }).limit(1);
  if (error) return null;
  return data[0] ?? null;
}

/** A Postgres/PostgREST error code means the server answered and rejected the call; no code means the outcome is unknown. */
function serverRejected(error: unknown): boolean {
  const code = typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined;
  return typeof code === "string" && code.length > 0;
}

/** One edited print file per original photo (same order as `files`) plus the editor metadata describing it. */
export interface DesignSubmission { editedFile: File; meta: Record<string, unknown> }

export interface SubmitCustomizationInput {
  productId: string;
  productName: string;
  form: CustomRequestForm;
  files: File[];
  /** Personalised products: per-product image limits, re-checked at submit time. */
  imageRules?: ReferenceImageRules;
  /** Photo editor output, one entry per file in `files`. Originals upload unchanged; edited files upload as separate attachments. */
  designs?: DesignSubmission[];
  /** Personalised products: extra keys stored with the request's requirements (e.g. product_type, size). */
  extraRequirements?: Record<string, string | number>;
  /** Paths already uploaded by an earlier, unresolved attempt; reused instead of uploading again. */
  resume?: { paths: string[]; startedAt: string } | null;
  onProgress?: (message: string) => void;
}

export interface SubmitCustomizationResult { requestId: string; requestNumber: string | null }

/** Carries state out of a failed attempt so a retry doesn't re-upload files or create a second request. */
export class CustomRequestSubmitError extends Error {
  constructor(public cause: unknown, public resume: { paths: string[]; startedAt: string } | null) {
    super(cause instanceof Error ? cause.message : "Submission failed");
  }
}

export async function submitCustomization(input: SubmitCustomizationInput): Promise<SubmitCustomizationResult> {
  const formErrors = validateCustomRequestForm(input.form);
  if (Object.keys(formErrors).length) throw new CustomRequestValidationError("Please fix the highlighted fields.");
  const designs = input.designs ?? [];
  if (designs.length && designs.length !== input.files.length) throw new CustomRequestValidationError("Every photo needs a saved design. Please re-open the editor for your photos.");
  const maxFiles = Math.min(designs.length ? EDITOR_MAX_PHOTOS : CUSTOM_REQUEST_MAX_FILES, input.imageRules?.maxFiles ?? CUSTOM_REQUEST_MAX_FILES);
  if (input.files.length > maxFiles) throw new CustomRequestValidationError(`Attach at most ${maxFiles} images.`);
  for (const file of input.files) {
    const message = await validateReferenceImage(file, input.imageRules);
    if (message) throw new CustomRequestValidationError(message);
  }
  for (const design of designs) {
    const message = await validateReferenceImage(design.editedFile); // generated by us, but checked like any other upload
    if (message) throw new CustomRequestValidationError(message);
  }

  const startedAt = input.resume?.startedAt ?? new Date(Date.now() - 5000).toISOString();
  const payload = buildPayload(input.form, input.extraRequirements);

  // If an earlier attempt's outcome is unknown, check whether it actually created the request before sending another.
  if (input.resume) {
    const existing = await findRecentOwnRequest(input.productId, payload.title, startedAt);
    if (existing) return { requestId: existing.id, requestNumber: existing.request_number };
  }

  const uploaded: string[] = [...(input.resume?.paths ?? [])];
  try {
    if (!input.resume) {
      // Order matters: originals first, then edited files, so retries can map paths back to photos by position.
      const toUpload = [...input.files, ...designs.map((design) => design.editedFile)];
      for (let index = 0; index < toUpload.length; index += 1) {
        input.onProgress?.(`Uploading image ${index + 1} of ${toUpload.length}...`);
        uploaded.push(await uploadPrivateFile("customization-uploads", toUpload[index]));
      }
    }
  } catch (error) {
    await Promise.all(uploaded.map((path) => deletePrivateFile("customization-uploads", path)));
    throw new CustomRequestSubmitError(error, null);
  }

  const count = input.files.length;
  const requirements = designs.length
    ? { ...(payload.requirements as Record<string, Json>), design_summary: `${count} photo${count === 1 ? "" : "s"} edited in the photo editor. Attachments 1-${count} are the untouched originals; attachments ${count + 1}-${count * 2} are the edited print files, in the same order.` }
    : payload.requirements;
  const preferences = designs.length
    ? {
      ...(payload.preferences as Record<string, Json>),
      photo_design: designs.map((design, index) => ({
        ...design.meta,
        original_attachment_number: index + 1, original_path: uploaded[index],
        edited_attachment_number: count + index + 1, edited_path: uploaded[count + index],
      })) as Json,
    }
    : payload.preferences;

  input.onProgress?.("Sending your request...");
  let requestId: string;
  try {
    requestId = await createCustomerCustomRequest({
      productId: input.productId, requestedProduct: input.productName, title: payload.title, description: payload.description,
      requirements: requirements as Json, preferences: preferences as Json, budgetMin: payload.budgetMin, budgetMax: payload.budgetMax,
      attachmentPaths: uploaded,
    });
  } catch (error) {
    if (serverRejected(error)) {
      await Promise.all(uploaded.map((path) => deletePrivateFile("customization-uploads", path)));
      throw new CustomRequestSubmitError(error, null);
    }
    // Outcome unknown: keep the files (the request may reference them) and let the retry reconcile.
    throw new CustomRequestSubmitError(error, { paths: uploaded, startedAt });
  }

  let requestNumber: string | null = null;
  try { requestNumber = await getOwnRequestReference(requestId); } catch { requestNumber = null; }
  return { requestId, requestNumber };
}

export function friendlyCustomRequestError(error: unknown): string {
  const original = error instanceof CustomRequestSubmitError ? error.cause : error;
  if (original instanceof CustomRequestValidationError) return original.message;
  const e = (typeof original === "object" && original !== null ? original : {}) as { code?: string; message?: string; statusCode?: string };
  const message = typeof e.message === "string" ? e.message : "";
  if (e.code === "42501") return /customer account/i.test(message)
    ? "Only signed-in customer accounts can send customization requests."
    : "We couldn't attach your images. Please sign in again and retry.";
  if (e.code === "P0002") return "This product is no longer available for customization.";
  if (e.code === "22023" || e.code === "23514") return message || "Please review your details and try again.";
  if (/payload too large|exceeded the maximum|too large/i.test(message)) return "One of your images is too large for upload. Please use smaller images.";
  if (/mime type|not supported/i.test(message)) return "One of your files is not a supported image type.";
  return "We couldn't send your request. Please check your connection and try again — retrying will not create a duplicate.";
}

// ---- Customer "My requests" (Phase 5B) -------------------------------------------------------------------------
// Read-only. Ownership is enforced by RLS on custom_requests / custom_request_responses (owner or super admin);
// every query also filters by the signed-in customer's id. Columns are listed explicitly. Internal notes
// (custom_request_internal_notes) and status history with its reasons (custom_request_status_history) are
// admin-only tables and are never queried here.

const CUSTOMER_REQUEST_COLUMNS = "id,request_number,product_id,requested_product,title,description,requirements,preferences,budget_min_inr,budget_max_inr,attachment_paths,status,customer_response,response_updated_at,created_at,updated_at";

export type CustomerRequest = Pick<DbCustomRequestRow,
  "id" | "request_number" | "product_id" | "requested_product" | "title" | "description" | "requirements" | "preferences" |
  "budget_min_inr" | "budget_max_inr" | "attachment_paths" | "status" | "customer_response" | "response_updated_at" | "created_at" | "updated_at">;

/** The only fields of a team reply that a customer receives (no author, no internal data). */
export interface CustomerRequestReply { id: string; response: string; created_at: string }

export interface MyRequestFilters { page: number; pageSize: number; status?: CustomRequestStatus | "all"; search?: string }
export interface MyRequestsResult { requests: CustomerRequest[]; total: number }

export async function getMyCustomRequests(customerId: string, filters: MyRequestFilters): Promise<MyRequestsResult> {
  const from = Math.max(0, filters.page - 1) * filters.pageSize;
  let query = supabase.from("custom_requests").select(CUSTOMER_REQUEST_COLUMNS, { count: "exact" })
    .eq("customer_id", customerId).order("created_at", { ascending: false }).range(from, from + filters.pageSize - 1);
  if (filters.status && filters.status !== "all") query = query.eq("status", filters.status);
  const search = (filters.search ?? "").replace(/[%,_()"\\*]/g, " ").replace(/\s+/g, " ").trim().slice(0, 100);
  if (search) query = query.or(`request_number.ilike.%${search}%,title.ilike.%${search}%,requested_product.ilike.%${search}%`);
  const { data, error, count } = await query;
  if (error) throw error;
  const requests = data as unknown as CustomerRequest[];
  return { requests, total: count ?? requests.length };
}

export interface MyRequestDetail {
  request: CustomerRequest;
  replies: CustomerRequestReply[];
  productSlug: string | null;
}

/** Returns null when the request doesn't exist or belongs to someone else (RLS and the customer filter both hide it). */
export async function getMyCustomRequestDetail(customerId: string, requestId: string): Promise<MyRequestDetail | null> {
  const { data, error } = await supabase.from("custom_requests").select(CUSTOMER_REQUEST_COLUMNS)
    .eq("id", requestId).eq("customer_id", customerId).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const request = data as unknown as CustomerRequest;
  const [replies, product] = await Promise.all([
    supabase.from("custom_request_responses").select("id,response,created_at").eq("request_id", request.id).order("created_at", { ascending: false }),
    request.product_id ? supabase.from("products").select("slug").eq("id", request.product_id).eq("is_published", true).maybeSingle() : Promise.resolve({ data: null, error: null }),
  ]);
  if (replies.error) throw replies.error;
  return { request, replies: replies.data as CustomerRequestReply[], productSlug: product.data?.slug ?? null };
}

export interface AttachmentLink { path: string; url: string | null }

/** Short-lived signed URLs for the customer's own private attachments. A failure for one file doesn't hide the others. */
export async function getMyAttachmentLinks(customerId: string, paths: string[]): Promise<AttachmentLink[]> {
  return Promise.all(paths.map(async (path) => {
    // Defence in depth: the storage policy already restricts this to the customer's own folder.
    if (!path.startsWith(`${customerId}/`)) return { path, url: null };
    try { return { path, url: await createPrivateUploadUrl("customization-uploads", path, 300) }; } catch { return { path, url: null }; }
  }));
}

export function friendlyMyRequestsError(error: unknown): string {
  const message = typeof error === "object" && error !== null && typeof (error as { message?: unknown }).message === "string" ? (error as { message: string }).message : "";
  if (/JWT|not authenticated|permission denied/i.test(message)) return "Please sign in again to see your requests.";
  return "We couldn't load your requests. Please check your connection and try again.";
}
