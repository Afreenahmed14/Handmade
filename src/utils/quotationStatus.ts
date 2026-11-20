import type { QuotationItemKind, QuotationStatus } from "../types/database";

/** Quotation wording and maths helpers shared by the admin panel and the customer screens. */

export const quotationStatusLabel: Record<QuotationStatus, string> = {
  draft: "Draft", sent: "Sent", accepted: "Accepted", declined: "Declined", expired: "Expired", superseded: "Superseded",
};

/** Customer-facing wording: a sent quotation is "Awaiting your response". */
export const customerQuotationStatusLabel: Record<QuotationStatus, string> = {
  draft: "Draft", sent: "Awaiting your response", accepted: "Accepted", declined: "Declined", expired: "Expired", superseded: "Replaced by a newer quotation",
};

export const adminQuotationStatusStyle: Record<QuotationStatus, string> = {
  draft: "border-slate-600 bg-slate-800/60 text-slate-200",
  sent: "border-sky-800 bg-sky-950/40 text-sky-200",
  accepted: "border-emerald-800 bg-emerald-950/40 text-emerald-200",
  declined: "border-red-800 bg-red-950/40 text-red-200",
  expired: "border-amber-700 bg-amber-950/40 text-amber-200",
  superseded: "border-slate-700 bg-slate-900/60 text-slate-400",
};

export const customerQuotationStatusStyle: Record<QuotationStatus, string> = {
  draft: "border-brass/60 bg-brass/10 text-walnut",
  sent: "border-sky-700/40 bg-sky-50 text-sky-900",
  accepted: "border-olive/60 bg-olive/10 text-olive",
  declined: "border-red-800/40 bg-red-50 text-red-900",
  expired: "border-amber-700/50 bg-amber-50 text-amber-900",
  superseded: "border-brass/40 bg-transparent text-walnut/70",
};

export const quotationItemKindLabel: Record<QuotationItemKind, string> = {
  product: "Product", printing: "Printing / customisation", additional: "Additional charge",
};
export const quotationItemKinds = Object.keys(quotationItemKindLabel) as QuotationItemKind[];

/** A sent quotation whose validity has passed is shown as expired even before the database persists that. */
export function effectiveQuotationStatus(status: QuotationStatus, validUntil: string | null, now: number = Date.now()): QuotationStatus {
  if (status === "sent" && validUntil && new Date(validUntil).getTime() <= now) return "expired";
  return status;
}

export const formatMoney = (value: number): string =>
  "₹" + Number(value).toLocaleString("en-IN", { minimumFractionDigits: Number.isInteger(Number(value)) ? 0 : 2, maximumFractionDigits: 2 });

/** Whole paise, so that preview arithmetic never shows floating point noise. */
const paise = (value: number) => Math.round(value * 100);

export interface PreviewItem { kind: QuotationItemKind; quantity: number; unitPrice: number }
export interface PreviewTotals { subtotal: number; printing: number; discount: number; shipping: number; total: number }

/**
 * DISPLAY ONLY. This mirrors what the database computes so the admin sees a running figure while typing.
 * It is never sent to the server: the RPC receives quantities and unit prices only and recomputes every total.
 */
export function previewTotals(items: PreviewItem[], discount: number, shipping: number): PreviewTotals {
  const lineTotal = (item: PreviewItem) => paise(item.unitPrice) * Math.trunc(item.quantity);
  const subtotal = items.reduce((sum, item) => sum + lineTotal(item), 0);
  const printing = items.filter((item) => item.kind === "printing").reduce((sum, item) => sum + lineTotal(item), 0);
  const total = subtotal - paise(discount) + paise(shipping);
  return { subtotal: subtotal / 100, printing: printing / 100, discount, shipping, total: total / 100 };
}
