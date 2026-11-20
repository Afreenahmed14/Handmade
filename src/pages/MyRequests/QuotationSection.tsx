import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { createQuotationPaymentOrder, friendlyQuotationError, getMyQuotations, QuotationUnavailableError, respondToQuotation, type CustomerQuotation } from "../../services/quotations";
import { formatDate, formatDateTime } from "../../utils/orderStatus";
import { customerQuotationStatusLabel, customerQuotationStatusStyle, effectiveQuotationStatus, formatMoney, quotationItemKindLabel } from "../../utils/quotationStatus";

function StatusPill({ quote }: { quote: CustomerQuotation }) {
  const status = effectiveQuotationStatus(quote.status, quote.valid_until);
  return <span className={`border px-2.5 py-1 text-xs ${customerQuotationStatusStyle[status]}`}>{customerQuotationStatusLabel[status]}</span>;
}

function Breakdown({ quote }: { quote: CustomerQuotation }) {
  return (
    <>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[28rem] text-left text-sm">
          <thead className="text-xs text-walnut/60"><tr><th className="py-1 pr-3 font-normal">Item</th><th className="py-1 pr-3 text-right font-normal">Qty</th><th className="py-1 pr-3 text-right font-normal">Unit price</th><th className="py-1 text-right font-normal">Amount</th></tr></thead>
          <tbody>{quote.items.map((item, index) => (
            <tr key={index} className="border-t border-brass/30 text-espresso">
              <td className="py-2 pr-3">{item.description}<span className="block text-xs text-walnut/60">{quotationItemKindLabel[item.kind]}</span></td>
              <td className="py-2 pr-3 text-right">{item.quantity}</td><td className="py-2 pr-3 text-right">{formatMoney(item.unit_price_inr)}</td><td className="py-2 text-right">{formatMoney(item.line_total_inr)}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      <dl className="ml-auto mt-3 grid max-w-xs gap-1 text-sm text-espresso">
        <div className="flex justify-between gap-6"><dt className="text-walnut/70">Subtotal</dt><dd>{formatMoney(quote.subtotal_inr)}</dd></div>
        {quote.printing_charges_inr > 0 && <div className="flex justify-between gap-6 text-xs text-walnut/60"><dt>includes printing / customisation</dt><dd>{formatMoney(quote.printing_charges_inr)}</dd></div>}
        {quote.discount_inr > 0 && <div className="flex justify-between gap-6"><dt className="text-walnut/70">Discount</dt><dd>− {formatMoney(quote.discount_inr)}</dd></div>}
        <div className="flex justify-between gap-6"><dt className="text-walnut/70">Shipping</dt><dd>{quote.shipping_charge_inr > 0 ? formatMoney(quote.shipping_charge_inr) : "Free"}</dd></div>
        <div className="flex justify-between gap-6 border-t border-brass/40 pt-2 text-base font-semibold text-walnut"><dt>Total</dt><dd>{formatMoney(quote.final_total_inr)}</dd></div>
      </dl>
      {quote.customer_notes && <p className="mt-4 whitespace-pre-wrap break-words border-l-2 border-brass pl-4 text-sm text-espresso">{quote.customer_notes}</p>}
    </>
  );
}

function Timeline({ quote }: { quote: CustomerQuotation }) {
  const parts = [
    quote.sent_at && `Sent ${formatDateTime(quote.sent_at)}`,
    quote.accepted_at && `Accepted ${formatDateTime(quote.accepted_at)}`,
    quote.declined_at && `Declined ${formatDateTime(quote.declined_at)}`,
    quote.superseded_at && `Replaced ${formatDateTime(quote.superseded_at)}`,
    quote.status === "sent" && quote.valid_until && `Valid until ${formatDateTime(quote.valid_until)}`,
  ].filter(Boolean);
  return <p className="mt-1 text-xs text-walnut/60">{parts.join(" · ")}</p>;
}

/** The customer's quotations for one of their own requests. Read and respond only: totals always come from the server. */
export default function QuotationSection({ requestId }: { requestId: string }) {
  const navigate = useNavigate();
  const [quotes, setQuotes] = useState<CustomerQuotation[] | null>(null);
  const [error, setError] = useState("");
  const [hidden, setHidden] = useState(false);
  const [step, setStep] = useState<"" | "accept" | "decline">("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [paymentBusy, setPaymentBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; tone: "ok" | "warn" } | null>(null);

  const load = useCallback(async () => {
    try { setQuotes(await getMyQuotations(requestId)); setError(""); }
    catch (reasonValue) {
      if (reasonValue instanceof QuotationUnavailableError) setHidden(true); // migration not applied yet: show nothing
      else setError(friendlyQuotationError(reasonValue));
      setQuotes([]);
    }
  }, [requestId]);
  useEffect(() => { void load(); }, [load]);

  async function respond(decision: "accept" | "decline", quote: CustomerQuotation) {
    setBusy(true); setMessage(null);
    try {
      const result = await respondToQuotation(quote.id, decision, decision === "decline" ? reason : undefined);
      if (result === "expired") setMessage({ text: "This quotation expired before your answer reached us. Please ask our team for a new one.", tone: "warn" });
      else setMessage({ text: result === "accepted" ? "Quotation accepted. Thank you!" : "You've declined this quotation. Our team may send a revised one.", tone: "ok" });
      setStep(""); setReason("");
      await load();
    } catch (reasonValue) { setMessage({ text: friendlyQuotationError(reasonValue), tone: "warn" }); await load(); }
    finally { setBusy(false); }
  }

  if (hidden) return null;
  const latest = quotes?.[0] ?? null;
  const older = (quotes ?? []).slice(1);
  const latestStatus = latest ? effectiveQuotationStatus(latest.status, latest.valid_until) : null;

  return (
    <section className="border border-brass/40 p-5" aria-labelledby="quotation-title">
      <h2 id="quotation-title" className="text-lg text-walnut">Quotation</h2>
      {quotes === null && <p role="status" className="mt-3 text-sm text-walnut/60">Loading your quotation...</p>}
      {error && <p role="alert" className="mt-3 text-sm text-red-800">{error} <button type="button" onClick={() => void load()} className="underline underline-offset-4">Try again</button></p>}
      {message && <p role="status" className={`mt-3 border-l-2 pl-3 text-sm ${message.tone === "ok" ? "border-olive text-olive" : "border-amber-700 text-amber-900"}`}>{message.text}</p>}
      {quotes !== null && !error && !latest && <p className="mt-3 text-sm text-walnut/60">Our team will post your itemised quotation here once it is ready. You can then accept or decline it.</p>}

      {latest && latestStatus && (
        <article className="mt-3">
          <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-espresso">{latest.quote_number} <span className="text-sm text-walnut/60">· Version {latest.version}</span></p><Timeline quote={latest} /></div><StatusPill quote={latest} /></div>
          <Breakdown quote={latest} />

          {latestStatus === "sent" && (
            <div className="mt-5 border-t border-brass/30 pt-4">
              {step === "" && <div className="flex flex-wrap justify-end gap-3"><button type="button" className="btn-outline px-4 py-2 text-sm" onClick={() => { setStep("decline"); setMessage(null); }}>Decline</button><button type="button" className="btn-primary px-4 py-2 text-sm" onClick={() => { setStep("accept"); setMessage(null); }}>Accept quotation</button></div>}
              {step === "accept" && <div className="grid gap-3"><p className="text-sm text-espresso">Accept {latest.quote_number} for <strong>{formatMoney(latest.final_total_inr)}</strong>? Accepting confirms the amounts above. Nothing is charged by accepting, and production starts only after your payment has been verified.</p><div className="flex flex-wrap justify-end gap-3"><button type="button" disabled={busy} className="btn-outline px-4 py-2 text-sm" onClick={() => setStep("")}>Go back</button><button type="button" disabled={busy} className="btn-primary px-4 py-2 text-sm" onClick={() => void respond("accept", latest)}>{busy ? "Accepting..." : "Yes, accept"}</button></div></div>}
              {step === "decline" && <div className="grid gap-3"><label className="grid gap-1 text-sm text-espresso">Reason (optional — it helps us prepare a better quotation)<textarea rows={3} maxLength={1000} value={reason} onChange={(event) => setReason(event.target.value)} className="resize-y border border-brass/50 bg-transparent px-3 py-2 text-sm" /></label><div className="flex flex-wrap justify-end gap-3"><button type="button" disabled={busy} className="btn-outline px-4 py-2 text-sm" onClick={() => { setStep(""); setReason(""); }}>Go back</button><button type="button" disabled={busy} className="btn-primary px-4 py-2 text-sm" onClick={() => void respond("decline", latest)}>{busy ? "Declining..." : "Decline quotation"}</button></div></div>}
            </div>
          )}
          {latestStatus === "accepted" && <div className="mt-5 border-l-2 border-olive pl-4 text-sm text-espresso"><p>You accepted this quotation on {formatDate(latest.accepted_at)}. Pay the exact quoted amount by UPI. Your order will remain pending until our team verifies the payment; production does not start before verification.</p><button type="button" disabled={paymentBusy} onClick={async () => { setPaymentBusy(true); setMessage(null); try { const orderId = await createQuotationPaymentOrder(latest.id); navigate(`/payment/${orderId}`); } catch (reasonValue) { setMessage({ text: friendlyQuotationError(reasonValue), tone: "warn" }); } finally { setPaymentBusy(false); } }} className="btn-primary mt-4 px-5 py-2.5 text-sm">{paymentBusy ? "Preparing payment..." : `Pay ${formatMoney(latest.final_total_inr)}`}</button></div>}
          {latestStatus === "declined" && <p className="mt-5 text-sm text-espresso/80">You declined this quotation{latest.decline_reason ? <> — “{latest.decline_reason}”</> : ""}. Our team may send a revised quotation.</p>}
          {latestStatus === "expired" && <p className="mt-5 text-sm text-amber-900">This quotation expired{latest.valid_until ? ` on ${formatDate(latest.valid_until)}` : ""} and can no longer be accepted. Please contact our team if you'd like a new one.</p>}
        </article>
      )}

      {older.length > 0 && (
        <details className="mt-6 border-t border-brass/30 pt-4">
          <summary className="cursor-pointer text-sm text-walnut">Earlier quotations ({older.length})</summary>
          <ul className="mt-3 grid gap-4">{older.map((quote) => (
            <li key={quote.id} className="border border-brass/30 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-sm text-espresso">{quote.quote_number} <span className="text-walnut/60">· Version {quote.version}</span></p><Timeline quote={quote} /></div><StatusPill quote={quote} /></div>
              <Breakdown quote={quote} />
            </li>
          ))}</ul>
        </details>
      )}
    </section>
  );
}
