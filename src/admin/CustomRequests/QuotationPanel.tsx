import { useCallback, useEffect, useMemo, useState } from "react";
import { FileText, Loader2, Plus, Send, Trash2 } from "lucide-react";
import { getPhotoPreparations, PhotoPreparationUnavailableError } from "../../services/photoPreparation";
import {
  QuotationUnavailableError, discardQuotationDraft, friendlyQuotationError, getRequestQuotations, parseMoney, saveQuotationDraft,
  sendQuotation, validateQuotationForm, type AdminQuotation, type QuotationForm, type QuotationFormItem,
} from "../../services/quotations";
import type { CustomRequestStatus, Json, QuotationItemKind } from "../../types/database";
import { formatDateTime } from "../../utils/orderStatus";
import { groupPreparations, parsePhotoSets } from "../../utils/photoDesign";
import {
  adminQuotationStatusStyle, effectiveQuotationStatus, formatMoney, previewTotals, quotationItemKindLabel, quotationItemKinds, quotationStatusLabel,
} from "../../utils/quotationStatus";
import { readableEntries } from "../../utils/customRequestStatus";

type NotifyTone = "success" | "error" | "warning";
interface Props {
  requestId: string;
  requestNumber: string;
  requestStatus: CustomRequestStatus;
  requestedProduct: string;
  requirements: Json;
  preferences: Json;
  attachmentPaths: string[];
  notify: (text: string, tone: NotifyTone) => void;
  /** Called after a quotation changes so the request list can refresh its quotation column. */
  onChanged: () => void;
}

const field = "border border-brass/50 bg-white px-3 py-2 text-sm text-white disabled:opacity-60";
const smallButton = "inline-flex items-center gap-1.5 border border-brass/50 px-3 py-1.5 text-xs text-espresso hover:bg-[#eadbd2] disabled:opacity-50";
const newKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Math.random()));
const blankItem = (kind: QuotationItemKind, description = "", quantity = "1"): QuotationFormItem => ({ key: newKey(), kind, description, quantity, unitPrice: "" });

function requestedQuantity(requirements: Json): string {
  if (requirements && typeof requirements === "object" && !Array.isArray(requirements)) {
    const value = Number(requirements.quantity);
    if (Number.isInteger(value) && value >= 1 && value <= 1000) return String(value);
  }
  return "1";
}

/** Starts from the request itself (product + quantity). Unit prices are left empty: the admin must enter them. */
function blankForm(product: string, requirements: Json): QuotationForm {
  return { items: [blankItem("product", product.slice(0, 200), requestedQuantity(requirements))], discount: "", shipping: "", validityDays: "14", customerNotes: "", internalNotes: "" };
}

function formFromQuotation(quote: AdminQuotation, keepInternalNotes: boolean): QuotationForm {
  return {
    items: quote.items.map((item) => ({ key: newKey(), kind: item.kind, description: item.description, quantity: String(item.quantity), unitPrice: String(item.unit_price_inr) })),
    discount: quote.discount_inr ? String(quote.discount_inr) : "", shipping: quote.shipping_charge_inr ? String(quote.shipping_charge_inr) : "",
    validityDays: String(quote.validity_days), customerNotes: quote.customer_notes ?? "", internalNotes: keepInternalNotes ? quote.internal_notes ?? "" : "",
  };
}

function ItemsTable({ quote }: { quote: AdminQuotation }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[32rem] text-left text-xs">
        <thead className="text-espresso/55"><tr><th className="py-1 pr-3">Type</th><th className="py-1 pr-3">Description</th><th className="py-1 pr-3 text-right">Qty</th><th className="py-1 pr-3 text-right">Unit price</th><th className="py-1 text-right">Line total</th></tr></thead>
        <tbody>{quote.items.map((item) => <tr key={item.id} className="border-t border-brass/30 text-espresso"><td className="py-1 pr-3 text-espresso/65">{quotationItemKindLabel[item.kind]}</td><td className="py-1 pr-3">{item.description}</td><td className="py-1 pr-3 text-right">{item.quantity}</td><td className="py-1 pr-3 text-right">{formatMoney(item.unit_price_inr)}</td><td className="py-1 text-right">{formatMoney(item.line_total_inr)}</td></tr>)}</tbody>
      </table>
    </div>
  );
}

function Totals({ quote }: { quote: AdminQuotation }) {
  const rows: [string, string][] = [["Subtotal", formatMoney(quote.subtotal_inr)], ["of which printing / customisation", formatMoney(quote.printing_charges_inr)], ["Discount", `− ${formatMoney(quote.discount_inr)}`], ["Shipping", formatMoney(quote.shipping_charge_inr)]];
  return (
    <dl className="ml-auto mt-2 grid max-w-xs gap-1 text-xs text-espresso/80">
      {rows.map(([label, value]) => <div key={label} className="flex justify-between gap-6"><dt className="text-espresso/55">{label}</dt><dd>{value}</dd></div>)}
      <div className="flex justify-between gap-6 border-t border-brass/40 pt-1 text-sm font-medium text-white"><dt>Final total</dt><dd>{formatMoney(quote.final_total_inr)}</dd></div>
    </dl>
  );
}

export default function QuotationPanel({ requestId, requestNumber, requestStatus, requestedProduct, requirements, preferences, attachmentPaths, notify, onChanged }: Props) {
  const [quotes, setQuotes] = useState<AdminQuotation[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [unavailable, setUnavailable] = useState(false);
  const [photoReadiness, setPhotoReadiness] = useState<{ ready: number; total: number } | null>(null);
  const [form, setForm] = useState<QuotationForm | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formError, setFormError] = useState("");
  const [busy, setBusy] = useState<"" | "save" | "send" | "discard">("");

  const load = useCallback(async () => {
    try {
      setQuotes(await getRequestQuotations(requestId));
      setLoadError(""); setUnavailable(false);
    } catch (error) {
      if (error instanceof QuotationUnavailableError) setUnavailable(true);
      else setLoadError(friendlyQuotationError(error));
      setQuotes([]);
    }
  }, [requestId]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    let active = true;
    void getPhotoPreparations(requestId).then((rows) => {
      if (!active) return;
      const sets = parsePhotoSets(preferences, attachmentPaths).sets.filter((set) => set.editable);
      const grouped = groupPreparations(rows);
      setPhotoReadiness({ total: sets.length, ready: sets.filter((set) => grouped.get(set.originalPath)?.[0]?.is_ready_for_quotation).length });
    }).catch((error: unknown) => { if (active && !(error instanceof PhotoPreparationUnavailableError)) setPhotoReadiness(null); });
    return () => { active = false; };
  }, [requestId, preferences, attachmentPaths]);

  const now = Date.now();
  const draft = quotes?.find((quote) => quote.status === "draft") ?? null;
  const accepted = quotes?.find((quote) => quote.status === "accepted") ?? null;
  const history = (quotes ?? []).filter((quote) => quote.status !== "draft");
  const lastSent = history[0] ?? null;
  const requestClosed = requestStatus === "completed" || requestStatus === "rejected";
  const canCreate = !unavailable && !requestClosed && !accepted && !draft && quotes !== null;
  const options = useMemo(() => readableEntries(requirements).filter(([label]) => label !== "Design summary"), [requirements]);

  const preview = useMemo(() => {
    if (!form) return null;
    const lines = form.items.map((item) => ({ kind: item.kind, quantity: /^\d+$/.test(item.quantity.trim()) ? Number(item.quantity) : 0, unitPrice: parseMoney(item.unitPrice) ?? 0 }));
    return { lines, totals: previewTotals(lines, parseMoney(form.discount) ?? 0, parseMoney(form.shipping) ?? 0) };
  }, [form]);

  function openNew() { setEditingId(null); setForm(blankForm(requestedProduct, requirements)); setFormError(""); }
  function openRevision() { if (lastSent) { setEditingId(null); setForm(formFromQuotation(lastSent, false)); setFormError(""); } }
  function openDraft() { if (draft) { setEditingId(draft.id); setForm(formFromQuotation(draft, true)); setFormError(""); } }
  function updateItem(key: string, patch: Partial<QuotationFormItem>) { setForm((current) => current && { ...current, items: current.items.map((item) => item.key === key ? { ...item, ...patch } : item) }); }

  async function saveDraft() {
    if (!form) return;
    const checked = validateQuotationForm(form);
    if (!checked.input) { setFormError(checked.error ?? "Please review the quotation."); return; }
    setBusy("save"); setFormError("");
    try {
      await saveQuotationDraft({ requestId, quotationId: editingId, ...checked.input });
      setForm(null); setEditingId(null);
      await load(); onChanged();
      notify("Draft saved. Review the server-calculated total, then send it to the customer.", "success");
    } catch (error) { setFormError(friendlyQuotationError(error)); } finally { setBusy(""); }
  }

  async function send(quote: AdminQuotation) {
    if (!window.confirm(`Send quotation ${quote.quote_number} for ${formatMoney(quote.final_total_inr)} to the customer?${lastSent && lastSent.status === "sent" ? " The earlier sent quotation will be marked superseded." : ""} It will be valid for ${quote.validity_days} days from now.`)) return;
    setBusy("send");
    try { await sendQuotation(quote.id); await load(); onChanged(); notify("Quotation sent to the customer.", "success"); }
    catch (error) { notify(friendlyQuotationError(error), "error"); await load(); } finally { setBusy(""); }
  }

  async function discard(quote: AdminQuotation) {
    if (!window.confirm(`Discard draft ${quote.quote_number}? Drafts that were never sent are deleted; sent quotations are always kept.`)) return;
    setBusy("discard");
    try { await discardQuotationDraft(quote.id); setForm(null); await load(); onChanged(); notify("Draft discarded.", "success"); }
    catch (error) { notify(friendlyQuotationError(error), "error"); } finally { setBusy(""); }
  }

  return (
    <section className="grid gap-4 border border-brass/40 p-4" aria-labelledby={`quotation-heading-${requestId}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 id={`quotation-heading-${requestId}`} className="flex items-center gap-2 font-medium text-white"><FileText size={16} aria-hidden="true" />Quotation</h3>
        <div className="flex flex-wrap gap-2">
          {canCreate && !form && !lastSent && <button type="button" className={smallButton} onClick={openNew}><Plus size={13} aria-hidden="true" />Create quotation</button>}
          {canCreate && !form && lastSent && <button type="button" className={smallButton} onClick={openRevision}><Plus size={13} aria-hidden="true" />Create revised quotation</button>}
        </div>
      </div>

      {unavailable && <p role="status" className="border-l-2 border-amber-400 pl-3 text-xs text-amber-200">Quotations are not enabled yet: the Phase 3 database migration has not been applied.</p>}
      {loadError && <p role="alert" className="border-l-2 border-red-400 pl-3 text-xs text-red-200">{loadError}</p>}
      {quotes === null && !unavailable && <p role="status" className="text-sm text-espresso/65">Loading quotations...</p>}

      {!unavailable && (
        <div className="grid gap-1 border border-brass/30 bg-cream p-3 text-xs text-espresso/80">
          <p><span className="text-espresso/55">Product:</span> {requestedProduct} · <span className="text-espresso/55">Quantity:</span> {requestedQuantity(requirements)}</p>
          {options.length > 0 && <p className="text-espresso/65">{options.map(([label, value]) => `${label}: ${value}`).join(" · ")}</p>}
          {photoReadiness && photoReadiness.total > 0 && (
            <p className={photoReadiness.ready === photoReadiness.total ? "text-emerald-300" : "text-amber-200"}>
              {photoReadiness.ready} of {photoReadiness.total} photo{photoReadiness.total === 1 ? "" : "s"} marked ready for quotation{photoReadiness.ready < photoReadiness.total ? " — you can still quote, but check the photo preparation above first." : "."}
            </p>
          )}
        </div>
      )}

      {requestClosed && !accepted && <p className="text-xs text-espresso/65">This request is {requestStatus}; new quotations can't be created.</p>}
      {accepted && <p className="border-l-2 border-emerald-400 pl-3 text-xs text-emerald-200">Accepted on {formatDateTime(accepted.accepted_at)}. {accepted.quote_number} is eligible for payment. Nothing has been paid and production has not started; production waits for verified payment.</p>}

      {draft && !form && (
        <article className="grid gap-2 border border-sky-900 bg-cream p-3">
          <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm text-white">{draft.quote_number} <span className={`ml-2 border px-2 py-0.5 text-xs ${adminQuotationStatusStyle.draft}`}>Draft</span></p><p className="text-xs text-espresso/55">Totals below were calculated by the server.</p></div>
          <ItemsTable quote={draft} /><Totals quote={draft} />
          <p className="text-xs text-espresso/65">Valid for {draft.validity_days} days from the moment it is sent.</p>
          {draft.customer_notes && <p className="whitespace-pre-wrap text-xs text-espresso/80"><span className="text-espresso/55">Customer notes:</span> {draft.customer_notes}</p>}
          {draft.internal_notes && <p className="whitespace-pre-wrap text-xs text-amber-200"><span className="text-espresso/55">Internal (never shown to the customer):</span> {draft.internal_notes}</p>}
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" className={smallButton} onClick={openDraft} disabled={busy !== ""}>Edit draft</button>
            <button type="button" className={smallButton} onClick={() => void discard(draft)} disabled={busy !== ""}><Trash2 size={13} aria-hidden="true" />Discard</button>
            <button type="button" className="inline-flex items-center gap-1.5 bg-walnut px-3 py-1.5 text-xs text-white hover:bg-[#4c173b] disabled:opacity-50" onClick={() => void send(draft)} disabled={busy !== "" || requestClosed}>{busy === "send" ? <Loader2 size={13} className="animate-spin" aria-hidden="true" /> : <Send size={13} aria-hidden="true" />}Send to customer</button>
          </div>
        </article>
      )}

      {form && preview && (
        <form className="grid gap-3 border border-brass/40 bg-cream p-3" onSubmit={(event) => { event.preventDefault(); void saveDraft(); }} noValidate>
          <p className="text-sm font-medium text-white">{editingId ? "Edit draft quotation" : lastSent ? `Revised quotation for ${requestNumber}` : `New quotation for ${requestNumber}`}</p>
          <div className="grid gap-2">
            {form.items.map((item, index) => (
              <div key={item.key} className="grid gap-2 border border-brass/30 p-2 sm:grid-cols-[11rem_1fr_5rem_8rem_auto]">
                <label className="grid gap-1 text-[11px] text-espresso/55">Type<select value={item.kind} onChange={(event) => updateItem(item.key, { kind: event.target.value as QuotationItemKind })} className={field}>{quotationItemKinds.map((kind) => <option key={kind} value={kind}>{quotationItemKindLabel[kind]}</option>)}</select></label>
                <label className="grid gap-1 text-[11px] text-espresso/55">Description<input value={item.description} maxLength={200} onChange={(event) => updateItem(item.key, { description: event.target.value })} className={field} /></label>
                <label className="grid gap-1 text-[11px] text-espresso/55">Qty<input inputMode="numeric" value={item.quantity} onChange={(event) => updateItem(item.key, { quantity: event.target.value })} className={field} /></label>
                <label className="grid gap-1 text-[11px] text-espresso/55">Unit price (₹)<input inputMode="decimal" value={item.unitPrice} onChange={(event) => updateItem(item.key, { unitPrice: event.target.value })} className={field} /></label>
                <div className="flex items-end justify-between gap-2 sm:flex-col sm:items-end"><span className="text-xs text-espresso/65">{formatMoney(preview.lines[index].unitPrice * preview.lines[index].quantity)}</span><button type="button" aria-label={`Remove line ${index + 1}`} disabled={form.items.length === 1} onClick={() => setForm({ ...form, items: form.items.filter((entry) => entry.key !== item.key) })} className="p-1 text-espresso/65 hover:text-red-300 disabled:opacity-30"><Trash2 size={14} aria-hidden="true" /></button></div>
              </div>
            ))}
            <div className="flex flex-wrap gap-2">
              <button type="button" className={smallButton} disabled={form.items.length >= 30} onClick={() => setForm({ ...form, items: [...form.items, blankItem("printing", "Printing / customisation")] })}><Plus size={13} aria-hidden="true" />Printing charge</button>
              <button type="button" className={smallButton} disabled={form.items.length >= 30} onClick={() => setForm({ ...form, items: [...form.items, blankItem("additional")] })}><Plus size={13} aria-hidden="true" />Additional charge</button>
              <button type="button" className={smallButton} disabled={form.items.length >= 30} onClick={() => setForm({ ...form, items: [...form.items, blankItem("product", requestedProduct.slice(0, 200))] })}><Plus size={13} aria-hidden="true" />Product line</button>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="grid gap-1 text-xs text-espresso/65">Discount (₹)<input inputMode="decimal" value={form.discount} onChange={(event) => setForm({ ...form, discount: event.target.value })} className={field} /></label>
            <label className="grid gap-1 text-xs text-espresso/65">Shipping charges (₹)<input inputMode="decimal" value={form.shipping} onChange={(event) => setForm({ ...form, shipping: event.target.value })} className={field} /></label>
            <label className="grid gap-1 text-xs text-espresso/65">Valid for (days after sending)<input inputMode="numeric" value={form.validityDays} onChange={(event) => setForm({ ...form, validityDays: event.target.value })} className={field} /></label>
          </div>
          <label className="grid gap-1 text-xs text-espresso/65">Notes for the customer (visible to them)<textarea rows={3} maxLength={2000} value={form.customerNotes} onChange={(event) => setForm({ ...form, customerNotes: event.target.value })} className={`${field} resize-y`} /></label>
          <label className="grid gap-1 text-xs text-espresso/65">Internal notes (admin-only, never shown to the customer)<textarea rows={2} maxLength={5000} value={form.internalNotes} onChange={(event) => setForm({ ...form, internalNotes: event.target.value })} className={`${field} resize-y`} /></label>
          <div className="grid max-w-xs gap-1 justify-self-end text-xs text-espresso/80" aria-live="polite">
            <p className="text-[11px] text-espresso/55">Preview only — the server recalculates every amount when you save.</p>
            <div className="flex justify-between gap-6"><span className="text-espresso/55">Subtotal</span><span>{formatMoney(preview.totals.subtotal)}</span></div>
            <div className="flex justify-between gap-6"><span className="text-espresso/55">Discount</span><span>− {formatMoney(preview.totals.discount)}</span></div>
            <div className="flex justify-between gap-6"><span className="text-espresso/55">Shipping</span><span>{formatMoney(preview.totals.shipping)}</span></div>
            <div className="flex justify-between gap-6 border-t border-brass/40 pt-1 text-sm text-white"><span>Estimated total</span><span>{formatMoney(preview.totals.total)}</span></div>
          </div>
          {formError && <p role="alert" className="border-l-2 border-red-400 pl-3 text-xs text-red-200">{formError}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" className={smallButton} disabled={busy !== ""} onClick={() => { setForm(null); setEditingId(null); setFormError(""); }}>Cancel</button>
            <button type="submit" disabled={busy !== ""} className="bg-walnut px-4 py-1.5 text-xs text-white hover:bg-[#4c173b] disabled:opacity-50">{busy === "save" ? "Saving..." : "Save draft"}</button>
          </div>
        </form>
      )}

      {history.length > 0 && (
        <div className="grid gap-3">
          <h4 className="text-sm font-medium text-espresso">Quotation history</h4>
          {history.map((quote) => {
            const status = effectiveQuotationStatus(quote.status, quote.valid_until, now);
            return (
              <details key={quote.id} className="border border-brass/30 bg-cream p-3" open={quote.id === history[0].id}>
                <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2 text-sm text-espresso">
                  <span>Version {quote.version} · {quote.quote_number} · {formatMoney(quote.final_total_inr)}</span>
                  <span className={`border px-2 py-0.5 text-xs ${adminQuotationStatusStyle[status]}`}>{quotationStatusLabel[status]}</span>
                </summary>
                <div className="mt-3 grid gap-2">
                  <p className="text-[11px] text-espresso/55">
                    Sent {formatDateTime(quote.sent_at)}{quote.valid_until ? ` · valid until ${formatDateTime(quote.valid_until)}` : ""}
                    {quote.accepted_at ? ` · accepted ${formatDateTime(quote.accepted_at)}` : ""}{quote.declined_at ? ` · declined ${formatDateTime(quote.declined_at)}` : ""}
                    {quote.superseded_at ? ` · superseded ${formatDateTime(quote.superseded_at)}` : ""}
                  </p>
                  {quote.decline_reason && <p className="whitespace-pre-wrap text-xs text-red-200"><span className="text-espresso/55">Customer's reason:</span> {quote.decline_reason}</p>}
                  <ItemsTable quote={quote} /><Totals quote={quote} />
                  {quote.customer_notes && <p className="whitespace-pre-wrap text-xs text-espresso/80"><span className="text-espresso/55">Customer notes:</span> {quote.customer_notes}</p>}
                  {quote.internal_notes && <p className="whitespace-pre-wrap text-xs text-amber-200"><span className="text-espresso/55">Internal:</span> {quote.internal_notes}</p>}
                </div>
              </details>
            );
          })}
        </div>
      )}
      {quotes !== null && !unavailable && !draft && history.length === 0 && !form && <p className="text-sm text-espresso/55">No quotation has been created for this request yet.</p>}
    </section>
  );
}
