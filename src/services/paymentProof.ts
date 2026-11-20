import type { Json, OrderPaymentStatus, OrderStatus } from "../types/database";
import { supabase } from "../lib/supabase";
import { createPrivateUploadUrl, deletePrivateFile, uploadPrivateFile } from "./storage";

/** Thrown for problems the customer can fix themselves; its message is safe to show as written. */
export class ProofValidationError extends Error {}

export const PROOF_MAX_BYTES = 10 * 1024 * 1024;
export const PROOF_ACCEPT = "image/jpeg,image/png,image/webp,application/pdf";
const PROOF_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"];

/** Everything the storefront needs to show the UPI payment step of one order. All values come from the database. */
export interface UpiPaymentDetails {
  orderId: string;
  orderNumber: string;
  orderStatus: OrderStatus;
  /** The amount the customer must pay, read from the payment record (the database checks it equals the order total). */
  amountInr: number;
  paymentId: string;
  paymentStatus: OrderPaymentStatus;
  transactionReference: string | null;
  proofPath: string | null;
  submittedAt: string | null;
  verifiedAt: string | null;
  canSubmit: boolean;
  blockReason: string | null;
  upiEnabled: boolean;
  upiId: string;
  payeeName: string;
  qrUrl: string | null;
  paymentInstructions: string;
}

type JsonRecord = Record<string, Json | undefined>;
const isRecord = (value: Json | null | undefined): value is JsonRecord => value !== null && value !== undefined && typeof value === "object" && !Array.isArray(value);
const str = (value: Json | undefined, fallback = "") => (typeof value === "string" ? value : fallback);
const nullableStr = (value: Json | undefined) => (typeof value === "string" && value ? value : null);
const num = (value: Json | undefined) => (typeof value === "number" ? value : Number(value ?? NaN));
const bool = (value: Json | undefined, fallback: boolean) => (typeof value === "boolean" ? value : fallback);

function parseDetails(data: Json | null): UpiPaymentDetails {
  if (!isRecord(data)) throw new Error("Payment details were not returned by the database.");
  const amount = num(data.amount_inr);
  if (!Number.isFinite(amount)) throw new Error("Payment details were incomplete.");
  return {
    orderId: str(data.order_id), orderNumber: str(data.order_number), orderStatus: str(data.order_status) as OrderStatus,
    amountInr: amount, paymentId: str(data.payment_id), paymentStatus: str(data.payment_status) as OrderPaymentStatus,
    transactionReference: nullableStr(data.transaction_reference), proofPath: nullableStr(data.payment_proof_path),
    submittedAt: nullableStr(data.submitted_at), verifiedAt: nullableStr(data.verified_at),
    canSubmit: bool(data.can_submit, false), blockReason: nullableStr(data.block_reason),
    upiEnabled: bool(data.upi_enabled, true), upiId: str(data.upi_id), payeeName: str(data.upi_payee_name),
    qrUrl: nullableStr(data.upi_qr_url), paymentInstructions: str(data.payment_instructions),
  };
}

export async function getUpiPaymentDetails(orderId: string): Promise<UpiPaymentDetails> {
  const { data, error } = await supabase.rpc("get_customer_upi_payment_details", { p_order_id: orderId });
  if (error) throw error;
  return parseDetails(data);
}

/** `upi://pay` link that opens the customer's UPI app with the payee, exact amount and order number filled in. */
export function buildUpiUri(details: Pick<UpiPaymentDetails, "upiId" | "payeeName" | "amountInr" | "orderNumber">): string | null {
  if (!details.upiId) return null;
  const encode = (value: string) => encodeURIComponent(value).replace(/%40/g, "@");
  const params = [`pa=${encode(details.upiId)}`];
  if (details.payeeName) params.push(`pn=${encode(details.payeeName)}`);
  params.push(`am=${details.amountInr.toFixed(2)}`, "cu=INR", `tn=${encode(`Order ${details.orderNumber}`.slice(0, 80))}`);
  return `upi://pay?${params.join("&")}`;
}

// ---- Validation (mirrors the database function, which remains the authority) ----------------------------------

/** Returns an error message, or "" when the reference is acceptable. */
export function validateReference(raw: string): string {
  const value = raw.trim();
  if (!value) return "Enter the transaction reference (UTR) shown in your UPI app.";
  if (value.length < 6) return "That reference looks too short. UPI transaction references are usually 12 characters or more.";
  if (value.length > 100) return "The reference must be 100 characters or fewer.";
  if (!/^[A-Za-z0-9][A-Za-z0-9 _./:#-]*$/.test(value)) return "Use only letters, numbers and the characters - _ . / : #";
  return "";
}

async function matchesSignature(file: File): Promise<boolean> {
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const at = (offset: number, text: string) => [...text].every((char, index) => bytes[offset + index] === char.charCodeAt(0));
  switch (file.type) {
    case "image/jpeg": return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    case "image/png": return bytes[0] === 0x89 && at(1, "PNG");
    case "image/webp": return at(0, "RIFF") && at(8, "WEBP");
    case "application/pdf": return at(0, "%PDF");
    default: return false;
  }
}

/** Returns an error message, or "" when the file may be uploaded as payment proof. Checks type, size and file signature. */
export async function validateProofFile(file: File): Promise<string> {
  if (!PROOF_TYPES.includes(file.type)) return "Choose a JPEG, PNG or WebP screenshot, or a PDF.";
  if (file.size === 0) return "That file is empty.";
  if (file.size > PROOF_MAX_BYTES) return "The file must be 10 MB or smaller.";
  try {
    if (!(await matchesSignature(file))) return "That file doesn't look like a valid image or PDF. Please choose the original screenshot.";
  } catch {
    return "We couldn't read that file. Please choose it again.";
  }
  return "";
}

// ---- Submission ----------------------------------------------------------------------------------------------

export interface SubmitProofInput {
  orderId: string;
  reference: string;
  /** Optional screenshot or PDF. When omitted, any proof already on file is kept. */
  file: File | null;
  /** The proof currently on file; removed from Storage after a replacement succeeds. */
  previousProofPath: string | null;
}

/** A Postgres/PostgREST error code means the server answered and rejected the call; no code means the outcome is unknown. */
function serverRejected(error: unknown): boolean {
  const code = typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined;
  return typeof code === "string" && code.length > 0;
}

/**
 * Uploads the proof (if any) to the customer's own folder of the private bucket, then records it with the database
 * function. If the server rejects the submission the freshly uploaded file is removed so nothing is left orphaned.
 * If the outcome is unknown (for example the connection dropped after the request was sent) the file is deliberately
 * kept, because the database may already reference it. After a successful replacement the previous proof is removed.
 * Resolves with a warning when only the cleanup step failed.
 */
export async function submitPaymentProof(input: SubmitProofInput): Promise<{ cleanupWarning: string | null }> {
  const reference = input.reference.trim();
  const referenceError = validateReference(reference);
  if (referenceError) throw new ProofValidationError(referenceError);
  if (input.file) {
    const fileError = await validateProofFile(input.file);
    if (fileError) throw new ProofValidationError(fileError);
  }

  let uploadedPath: string | null = null;
  if (input.file) uploadedPath = await uploadPrivateFile("payment-proofs", input.file);

  const { error } = await supabase.rpc("customer_submit_payment_proof", {
    p_order_id: input.orderId, p_reference: reference, p_proof_path: uploadedPath,
  });
  if (error) {
    if (uploadedPath && serverRejected(error)) await deletePrivateFile("payment-proofs", uploadedPath);
    throw error;
  }

  if (uploadedPath && input.previousProofPath && input.previousProofPath !== uploadedPath) {
    const removed = await deletePrivateFile("payment-proofs", input.previousProofPath);
    if (!removed) return { cleanupWarning: "Your details were submitted, but your earlier proof file could not be removed. It remains private." };
  }
  return { cleanupWarning: null };
}

/** Short-lived link for viewing a private proof. Works for the customer who owns it and for super admins only. */
export async function createProofViewUrl(path: string): Promise<string> {
  return createPrivateUploadUrl("payment-proofs", path, 120);
}

export function friendlyPaymentError(error: unknown): string {
  if (error instanceof ProofValidationError) return error.message;
  const e = (typeof error === "object" && error !== null ? error : {}) as { code?: string; message?: string };
  const message = typeof e.message === "string" ? e.message : "";
  switch (e.code) {
    case "42501": return /own payment-proofs folder/i.test(message)
      ? "That file couldn't be attached. Please choose it again."
      : "Please sign in with the customer account that placed this order.";
    case "P0002": return /proof file was not found/i.test(message)
      ? "Your file didn't finish uploading. Please try again."
      : "We couldn't find this order's payment record.";
    case "22023": case "23514": case "23505":
      return message || "This payment couldn't be submitted. Please review the details and try again.";
    default:
      return "We couldn't submit your payment details. Please check your connection and try again. Submitting again is safe.";
  }
}
