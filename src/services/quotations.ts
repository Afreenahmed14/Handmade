import type { DbQuotationItemRow, DbQuotationRow, Json, QuotationItemKind, QuotationStatus } from "../types/database";
import { supabase } from "../lib/supabase";

// Personalised product quotations (Phase 3).
// Admin: super-admin RLS on the tables + super-admin-only RPCs. Customers: RPCs only (no table access), which return
// customer-safe fields. No function here sends or trusts a total: the database computes every amount.

export type AdminQuotation = DbQuotationRow & { items: DbQuotationItemRow[] };
export type QuotationOverview = { request_id: string; quotation_id: string; version: number; status: QuotationStatus; final_total_inr: number; valid_until: string | null };

/** The exact shape returned by get_my_quotations: no internal notes, no admin ids. */
export interface CustomerQuotationItem { kind: QuotationItemKind; description: string; quantity: number; unit_price_inr: number; line_total_inr: number }
export interface CustomerQuotation {
  id: string; quote_number: string; request_id: string; version: number; status: QuotationStatus; currency: string;
  subtotal_inr: number; printing_charges_inr: number; discount_inr: number; shipping_charge_inr: number; final_total_inr: number;
  customer_notes: string | null; valid_until: string | null; sent_at: string | null; accepted_at: string | null; declined_at: string | null;
  decline_reason: string | null; expired_at: string | null; superseded_at: string | null; payment_eligible: boolean;
  items: CustomerQuotationItem[];
}

/** Thrown when the quotation tables / functions do not exist yet (the Phase 3 migration has not been applied). */
export class QuotationUnavailableError extends Error {
  constructor() { super("Quotations are not enabled yet: the database migration has not been applied."); }
}
export class QuotationValidationError extends Error {}

function errorCode(error: unknown): string {
  const code = typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined;
  return typeof code === "string" ? code : "";
}
function errorMessage(error: unknown): string {
  return typeof error === "object" && error !== null && typeof (error as { message?: unknown }).message === "string" ? (error as { message: string }).message : "";
}
function isMissingObject(error: unknown): boolean {
  // 42P01 undefined table, 42883 undefined function, PGRST205/PGRST202/PGRST200: not in the API schema cache.
  return ["42P01", "42883", "PGRST205", "PGRST202", "PGRST200"].includes(errorCode(error)) || /does not exist|schema cache|Could not find the function/i.test(errorMessage(error));
}
function rethrow(error: unknown): never {
  if (isMissingObject(error)) throw new QuotationUnavailableError();
  throw error;
}

// ---- Admin ---------------------------------------------------------------------------------------------------

export async function getRequestQuotations(requestId: string): Promise<AdminQuotation[]> {
  const { data, error } = await supabase.from("custom_request_quotations").select("*, custom_request_quotation_items(*)")
    .eq("request_id", requestId).order("version", { ascending: false });
  if (error) rethrow(error);
  return (data as unknown as (DbQuotationRow & { custom_request_quotation_items: DbQuotationItemRow[] })[]).map(({ custom_request_quotation_items, ...quotation }) => ({
    ...quotation, items: [...custom_request_quotation_items].sort((a, b) => a.position - b.position),
  }));
}

/** Latest quotation per request, for the request list. Missing migration => empty (the list keeps working). */
export async function getLatestQuotationStatuses(requestIds: string[]): Promise<Record<string, { version: number; status: QuotationStatus; valid_until: string | null }>> {
  if (!requestIds.length) return {};
  const { data, error } = await supabase.from("custom_request_quotations").select("request_id,version,status,valid_until")
    .in("request_id", requestIds).order("version", { ascending: false });
  if (error) { if (isMissingObject(error)) return {}; throw error; }
  const latest: Record<string, { version: number; status: QuotationStatus; valid_until: string | null }> = {};
  for (const row of data as { request_id: string; version: number; status: QuotationStatus; valid_until: string | null }[]) {
    if (!latest[row.request_id]) latest[row.request_id] = { version: row.version, status: row.status, valid_until: row.valid_until };
  }
  return latest;
}

export interface QuotationDraftInput {
  requestId: string;
  /** Existing draft to replace; omit to start a new version. */
  quotationId?: string | null;
  items: { kind: QuotationItemKind; description: string; quantity: number; unitPrice: number }[];
  discount: number;
  shipping: number;
  validityDays: number;
  customerNotes: string;
  internalNotes: string;
}

/** Sends quantities and unit prices only. The server derives line totals, subtotal, printing charges and the final total. */
export async function saveQuotationDraft(input: QuotationDraftInput): Promise<string> {
  const { data, error } = await supabase.rpc("admin_save_quotation_draft", {
    p_request_id: input.requestId,
    p_items: input.items.map((item) => ({ kind: item.kind, description: item.description.trim(), quantity: item.quantity, unit_price_inr: item.unitPrice })) as Json,
    p_discount_inr: input.discount, p_shipping_charge_inr: input.shipping,
    p_customer_notes: input.customerNotes.trim() || null, p_internal_notes: input.internalNotes.trim() || null,
    p_validity_days: input.validityDays, p_quotation_id: input.quotationId ?? null,
  });
  if (error) rethrow(error);
  return data;
}

export async function sendQuotation(quotationId: string): Promise<void> {
  const { error } = await supabase.rpc("admin_send_quotation", { p_quotation_id: quotationId });
  if (error) rethrow(error);
}

export async function discardQuotationDraft(quotationId: string): Promise<void> {
  const { error } = await supabase.rpc("admin_discard_quotation_draft", { p_quotation_id: quotationId });
  if (error) rethrow(error);
}

export interface QuotationFormItem { key: string; kind: QuotationItemKind; description: string; quantity: string; unitPrice: string }
export interface QuotationForm { items: QuotationFormItem[]; discount: string; shipping: string; validityDays: string; customerNotes: string; internalNotes: string }

const MONEY = /^\d+(\.\d{1,2})?$/;
export const parseMoney = (raw: string): number | null => {
  const value = raw.trim().replace(/,/g, "");
  if (value === "") return 0;
  return MONEY.test(value) ? Number(value) : null;
};

/** Early, friendly checks only. The database repeats every one of them and is the authority. */
export function validateQuotationForm(form: QuotationForm): { error: string | null; input: Omit<QuotationDraftInput, "requestId" | "quotationId"> | null } {
  const fail = (error: string) => ({ error, input: null });
  if (form.items.length < 1 || form.items.length > 30) return fail("Add between 1 and 30 line items.");
  const items: QuotationDraftInput["items"] = [];
  for (const [index, item] of form.items.entries()) {
    const label = `Line ${index + 1}`;
    if (!item.description.trim() || item.description.trim().length > 200) return fail(`${label}: enter a description of up to 200 characters.`);
    if (!/^\d+$/.test(item.quantity.trim()) || Number(item.quantity) < 1 || Number(item.quantity) > 1000) return fail(`${label}: quantity must be a whole number from 1 to 1000.`);
    const price = item.unitPrice.trim() === "" ? null : parseMoney(item.unitPrice);
    if (price === null || price > 1000000) return fail(`${label}: enter a unit price from 0 to 10,00,000 with at most 2 decimals.`);
    items.push({ kind: item.kind, description: item.description.trim(), quantity: Number(item.quantity), unitPrice: price });
  }
  if (!items.some((item) => item.kind === "product")) return fail("Add at least one product line.");
  const discount = parseMoney(form.discount);
  const shipping = parseMoney(form.shipping);
  if (discount === null) return fail("Discount must be an amount with at most 2 decimals.");
  if (shipping === null) return fail("Shipping must be an amount with at most 2 decimals.");
  const validityDays = Number(form.validityDays);
  if (!/^\d+$/.test(form.validityDays.trim()) || validityDays < 1 || validityDays > 90) return fail("Validity must be a whole number of days from 1 to 90.");
  if (form.customerNotes.trim().length > 2000) return fail("Customer notes must be 2000 characters or fewer.");
  if (form.internalNotes.trim().length > 5000) return fail("Internal notes must be 5000 characters or fewer.");
  return { error: null, input: { items, discount, shipping, validityDays, customerNotes: form.customerNotes, internalNotes: form.internalNotes } };
}

// ---- Customer ------------------------------------------------------------------------------------------------

export async function getMyQuotations(requestId: string): Promise<CustomerQuotation[]> {
  const { data, error } = await supabase.rpc("get_my_quotations", { p_request_id: requestId });
  if (error) rethrow(error);
  return Array.isArray(data) ? (data as unknown as CustomerQuotation[]) : [];
}

/** For list badges. Any failure (including a missing migration) simply means "no badges". */
export async function getMyQuotationOverview(requestIds: string[]): Promise<Record<string, QuotationOverview>> {
  if (!requestIds.length) return {};
  const { data, error } = await supabase.rpc("get_my_quotation_overview", { p_request_ids: requestIds });
  if (error) return {};
  return Object.fromEntries((data as QuotationOverview[]).map((row) => [row.request_id, row]));
}

/** Returns the resulting status. "expired" means the quotation lapsed before the answer reached the server. */
/** Creates (or returns) the single UPI order for an accepted quotation. The database owns amount and eligibility checks. */
export async function createQuotationPaymentOrder(quotationId: string): Promise<string> {
  const { data, error } = await supabase.rpc("customer_create_quotation_payment_order", { p_quotation_id: quotationId });
  if (error) rethrow(error);
  if (typeof data !== "string" || !data) throw new Error("The payment order was not returned by the database.");
  return data;
}

export async function respondToQuotation(quotationId: string, decision: "accept" | "decline", reason?: string): Promise<QuotationStatus> {
  const { data, error } = await supabase.rpc("customer_respond_to_quotation", { p_quotation_id: quotationId, p_decision: decision, p_reason: reason?.trim() || null });
  if (error) rethrow(error);
  return data as QuotationStatus;
}

export function friendlyQuotationError(error: unknown): string {
  if (error instanceof QuotationUnavailableError || error instanceof QuotationValidationError) return error.message;
  const code = errorCode(error);
  const message = errorMessage(error);
  if (code === "42501") return /super admin/i.test(message) ? "Only a super admin can manage quotations." : "Please sign in again and retry.";
  if (code === "22023" || code === "P0002") return message || "This quotation can't be changed right now.";
  if (code === "23505") return "A quotation was just changed by someone else. Refresh and try again.";
  if (code === "23514") return "These amounts don't pass the quotation checks. Please review them.";
  return "Something went wrong with the quotation. Please check your connection and try again.";
}
