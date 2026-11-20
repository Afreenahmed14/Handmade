import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, CreditCard, ExternalLink, RefreshCw, Search, ShieldCheck, X } from "lucide-react";
import PaymentProofPreview from "../../components/payment/PaymentProofPreview";
import { formatINR } from "../../utils/currency";
import { getPaymentDetail, getPaymentRecords, getPaymentSummary, verifyPaymentAgainstExistingRpc, rejectPayment, recordFullRefund, getPaymentOperationHistory, type PaymentOperationHistoryRow, type AdminPaymentDetail, type AdminPaymentRecord, type PaymentSummary } from "../../services/payments";
import type { OrderPaymentStatus, PaymentMethod } from "../../types/database";

const pageSize = 20;
type PaymentFilter = "all" | "paid" | "pending_group" | "verification_pending" | "failed" | "refunded";

const paymentLabels: Record<OrderPaymentStatus, string> = {
  pending: "Pending", verification_pending: "Verification pending", paid: "Paid",
  failed: "Failed", cod_due: "COD due", refunded: "Refunded",
};

type Toast = { text: string; tone: "success" | "error" };

function formatDate(value: string | null) {
  return value ? new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "—";
}

function safePaymentLabel(payment: AdminPaymentRecord) {
  if (payment.payment_status === "paid" && !payment.verified_at) return "Paid (verification missing)";
  return paymentLabels[payment.payment_status];
}

function paymentTone(status: OrderPaymentStatus) {
  if (status === "paid") return "border-emerald-800 bg-emerald-950/40 text-emerald-200";
  if (status === "failed" || status === "refunded") return "border-red-800 bg-red-950/40 text-red-200";
  return "border-amber-700 bg-amber-950/40 text-amber-200";
}

function errorText(reason: unknown) {
  return reason instanceof Error ? reason.message : "Unable to load payment information.";
}

function MethodBars({ data }: { data: PaymentSummary["methods"] }) {
  const max = Math.max(1, ...data.map((item) => item.count));
  if (!data.length || data.every((item) => item.count === 0)) return <p className="py-4 text-sm text-espresso/65">No payment records for this period.</p>;
  return <div className="mt-4 space-y-3">{data.map((item) => <div key={item.label}><div className="mb-1 flex justify-between text-sm"><span className="uppercase text-espresso">{item.label}</span><span className="text-espresso/65">{item.count}</span></div><div className="h-2 bg-[#eadbd2]"><div className="h-full bg-walnut" style={{ width: `${Math.max(2, item.count / max * 100)}%` }} /></div></div>)}</div>;
}

export default function Payments() {
  const [payments, setPayments] = useState<AdminPaymentRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState<PaymentSummary | null>(null);
  const [search, setSearch] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [statusFilter, setStatusFilter] = useState<PaymentFilter>("all");
  const [methodFilter, setMethodFilter] = useState<PaymentMethod | "all">("all");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [summaryError, setSummaryError] = useState("");
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [toast, setToast] = useState<Toast | null>(null);
  const [detail, setDetail] = useState<AdminPaymentDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [paymentHistory, setPaymentHistory] = useState<PaymentOperationHistoryRow[]>([]);
  const [reference, setReference] = useState("");
  const [verificationNote, setVerificationNote] = useState("");
  const [verifying, setVerifying] = useState(false);

  useEffect(() => {
    let active = true;
    if (fromDate && toDate && fromDate > toDate) {
      setError("Start date must be on or before end date.");
      setPayments([]);
      setTotal(0);
      setLoading(false);
      setRefreshing(false);
      return () => { active = false; };
    }
    setLoading(true);
    setError("");
    void getPaymentRecords({
      page, pageSize, search, fromDate: fromDate || undefined, toDate: toDate || undefined,
      status: statusFilter, method: methodFilter,
    }).then((result) => {
      if (!active) return;
      setPayments(result.payments);
      setTotal(result.total);
    }).catch((reason: unknown) => {
      if (!active) return;
      setError(errorText(reason));
      setPayments([]);
      setTotal(0);
    }).finally(() => { if (active) { setLoading(false); setRefreshing(false); } });
    return () => { active = false; };
  }, [page, search, fromDate, toDate, statusFilter, methodFilter, refreshVersion]);

  useEffect(() => {
    let active = true;
    setSummaryLoading(true);
    void getPaymentSummary(fromDate || undefined, toDate || undefined).then((result) => {
      if (active) { setSummary(result); setSummaryError(""); }
    }).catch((reason: unknown) => { if (active) setSummaryError(errorText(reason)); })
      .finally(() => { if (active) setSummaryLoading(false); });
    return () => { active = false; };
  }, [fromDate, toDate, refreshVersion]);

  useEffect(() => { setPage(1); }, [search, fromDate, toDate, statusFilter, methodFilter]);
  useEffect(() => { if (!toast) return; const timer = window.setTimeout(() => setToast(null), 6000); return () => window.clearTimeout(timer); }, [toast]);
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  useEffect(() => { if (page > pageCount) setPage(pageCount); }, [page, pageCount]);

  const stats = useMemo(() => [
    { label: "Payment records", value: summary?.totalRecords ?? "—", note: "Records in selected date range" },
    { label: "Verified payment amount", value: summary ? formatINR(summary.verifiedAmount) : "—", note: "Paid and verified records only" },
    { label: "Pending payments", value: summary?.pendingCount ?? "—", note: "Pending, verification pending, or COD due" },
    { label: "Failed payments", value: summary?.failedCount ?? "—", note: "Recorded failed status" },
    { label: "Refunded status", value: summary?.refundedCount ?? "—", note: "Refund status exists; refund records do not" },
  ], [summary]);

  function refresh() {
    setRefreshing(true);
    setRefreshVersion((version) => version + 1);
  }

  async function openPayment(payment: AdminPaymentRecord) {
    setDetail(null);
    setPaymentHistory([]);
    setDetailLoading(true);
    setReference(payment.transaction_reference ?? "");
    setVerificationNote("");
    try {
      const [nextDetail, history] = await Promise.all([getPaymentDetail(payment.id), getPaymentOperationHistory(payment.id)]);
      setDetail(nextDetail);
      setPaymentHistory(history);
    } catch (reason) {
      setToast({ text: errorText(reason), tone: "error" });
    } finally {
      setDetailLoading(false);
    }
  }

  async function verifyPayment() {
    if (!detail) return;
    if (!window.confirm("Only confirm after independently checking the transaction has settled in the bank/UPI source. A customer screenshot or reference alone is not proof.")) return;
    setVerifying(true);
    try {
      await verifyPaymentAgainstExistingRpc(detail.payment.id, reference, verificationNote);
      const [nextDetail, nextSummary] = await Promise.all([
        getPaymentDetail(detail.payment.id), getPaymentSummary(fromDate || undefined, toDate || undefined),
      ]);
      setDetail(nextDetail);
      setPaymentHistory(await getPaymentOperationHistory(detail.payment.id));
      setSummary(nextSummary);
      setRefreshVersion((version) => version + 1);
      setToast({ text: "Manual verification recorded.", tone: "success" });
    } catch (reason) {
      setToast({ text: errorText(reason), tone: "error" });
    } finally {
      setVerifying(false);
    }
  }

  async function rejectCurrentPayment() {
    if (!detail) return;
    const reason = window.prompt("Why is this UPI payment being rejected? The customer will be able to resubmit.");
    if (reason === null) return;
    if (!reason.trim()) { setToast({ text: "A rejection reason is required.", tone: "error" }); return; }
    setVerifying(true);
    try {
      await rejectPayment(detail.payment.id, reason);
      setDetail(await getPaymentDetail(detail.payment.id));
      setPaymentHistory(await getPaymentOperationHistory(detail.payment.id));
      setRefreshVersion((version) => version + 1);
      setToast({ text: "Payment rejected. The customer can submit corrected payment details.", tone: "success" });
    } catch (reasonError) { setToast({ text: errorText(reasonError), tone: "error" }); }
    finally { setVerifying(false); }
  }

  async function refundCurrentPayment() {
    if (!detail) return;
    const amountText = window.prompt(`Confirm the full refund amount (${formatINR(Number(detail.payment.amount_inr))}). Partial refunds are not supported.`);
    if (amountText === null) return;
    const referenceValue = window.prompt("Enter the bank/UPI refund transaction reference:");
    if (referenceValue === null) return;
    const note = window.prompt("Optional refund note:") ?? "";
    setVerifying(true);
    try {
      await recordFullRefund(detail.payment.id, Number(amountText), referenceValue, note);
      setDetail(await getPaymentDetail(detail.payment.id));
      setPaymentHistory(await getPaymentOperationHistory(detail.payment.id));
      setRefreshVersion((version) => version + 1);
      setToast({ text: "Full refund recorded. Ensure the funds were actually returned before using this action.", tone: "success" });
    } catch (reasonError) { setToast({ text: errorText(reasonError), tone: "error" }); }
    finally { setVerifying(false); }
  }

  const eligibleForVerification = detail?.payment.payment_method === "upi"
    && ["pending", "verification_pending"].includes(detail.payment.payment_status);

  return (
    <section className="relative -m-4 min-h-[calc(100vh-8rem)] bg-cream p-4 text-espresso sm:-m-8 sm:p-8">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-brass/40 pb-5"><div><p className="text-sm text-espresso/65">Commerce operations</p><h1 className="mt-1 text-3xl text-walnut">Payments</h1></div><button type="button" onClick={refresh} disabled={refreshing} className="inline-flex items-center gap-2 border border-brass/50 px-4 py-2 text-sm text-espresso hover:bg-[#eadbd2] disabled:opacity-50"><RefreshCw size={15} />{refreshing ? "Refreshing..." : "Refresh"}</button></div>
      {(error || summaryError) && <p role="alert" className="mt-4 border-l-2 border-red-400 pl-3 text-sm text-red-200">{error || summaryError}</p>}

      <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">{stats.map((stat) => <article key={stat.label} className="border border-brass/40 bg-white p-4"><div className="flex items-center justify-between gap-2 text-sm text-espresso/65"><span>{stat.label}</span><CreditCard size={16} className="text-walnut" /></div><p className="mt-3 text-2xl font-semibold text-walnut">{summaryLoading ? "..." : stat.value}</p><p className="mt-2 text-xs text-espresso/55">{stat.note}</p></article>)}</div>

      <section className="mt-6 grid gap-5 border border-brass/40 bg-white p-4 sm:grid-cols-[minmax(0,1fr)_16rem] sm:p-5"><div><h2 className="text-lg font-medium text-walnut">Payment method distribution</h2><p className="mt-1 text-xs text-espresso/65">Payment records created in the selected date range</p></div><div className="space-y-3">{summaryLoading ? <div className="h-14 animate-pulse bg-[#eadbd2]" /> : summary?.methods.length ? summary.methods.map((item) => <div key={item.label} className="flex items-center justify-between border-b border-brass/40 pb-2 text-sm"><span className="uppercase text-espresso/80">{item.label}</span><span className="text-walnut">{item.count}</span></div>) : <p className="text-sm text-espresso/65">No payment methods in this date range.</p>}</div></section>

      <section className="mt-8"><div className="flex flex-wrap items-end justify-between gap-3"><div><h2 className="text-xl font-medium text-walnut">Payment records</h2><p className="mt-1 text-sm text-espresso/65">{total} record{total === 1 ? "" : "s"}</p></div><p className="max-w-lg text-xs text-espresso/55">A verified amount requires `paid` status and a recorded verification timestamp. Refunds are recorded with a transaction reference and payment activity history.</p></div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(12rem,1fr)_12rem_12rem_12rem_12rem]">
          <label className="relative"><span className="sr-only">Search payment ID or transaction reference</span><Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-espresso/65" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search payment ID or reference" className="w-full border border-brass/40 bg-white py-2 pl-9 pr-3 text-sm text-walnut placeholder:text-espresso/55" /></label>
          <label className="grid gap-1 text-xs text-espresso/65">From date<input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} className="border border-brass/40 bg-white px-3 py-2 text-sm text-walnut" /></label>
          <label className="grid gap-1 text-xs text-espresso/65">To date<input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} className="border border-brass/40 bg-white px-3 py-2 text-sm text-walnut" /></label>
          <label className="grid gap-1 text-xs text-espresso/65">Payment status<select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as PaymentFilter)} className="border border-brass/40 bg-white px-3 py-2 text-sm text-walnut"><option value="all">All statuses</option><option value="paid">Paid / verified</option><option value="pending_group">Pending</option><option value="verification_pending">Verification pending (customer submitted)</option><option value="failed">Failed</option><option value="refunded">Refunded status</option></select></label>
          <label className="grid gap-1 text-xs text-espresso/65">Method<select value={methodFilter} onChange={(event) => setMethodFilter(event.target.value as PaymentMethod | "all")} className="border border-brass/40 bg-white px-3 py-2 text-sm text-walnut"><option value="all">All methods</option><option value="upi">UPI</option><option value="cod">Cash on delivery</option></select></label>
        </div>

        {loading && <p role="status" className="py-12 text-center text-sm text-espresso/80">Loading payments...</p>}
        {!loading && !error && !payments.length && <div className="py-14 text-center"><div className="mx-auto grid h-12 w-12 place-items-center border border-brass/40 bg-white text-espresso/65"><CreditCard size={20} /></div><p className="mt-4 text-espresso">No payments match these filters.</p></div>}
        {!loading && payments.length > 0 && <div className="mt-4 overflow-x-auto border-y border-brass/40"><table className="w-full min-w-[78rem] text-left text-sm"><thead className="border-b border-brass/40 text-xs uppercase text-espresso/65"><tr><th className="py-3 pr-4">Payment ID</th><th className="py-3 pr-4">Order</th><th className="py-3 pr-4">Customer</th><th className="py-3 pr-4">Method</th><th className="py-3 pr-4">Transaction reference</th><th className="py-3 pr-4">Amount</th><th className="py-3 pr-4">Status</th><th className="py-3 pr-4">Verified</th><th className="py-3">Created</th></tr></thead><tbody>{payments.map((payment) => <tr key={payment.id} className="border-b border-brass/30 last:border-0"><td className="py-3 pr-4"><button type="button" onClick={() => void openPayment(payment)} className="font-mono text-xs text-walnut hover:underline">{payment.id.slice(0, 8)}…</button></td><td className="py-3 pr-4 text-espresso">{payment.orderNumber}</td><td className="py-3 pr-4"><p className="text-espresso">{payment.customerName}</p><p className="text-xs text-espresso/55">{payment.customerEmail}</p></td><td className="py-3 pr-4 uppercase text-espresso/80">{payment.payment_method}</td><td className="py-3 pr-4 text-espresso/80">{payment.transaction_reference || "—"}{payment.payment_proof_path && <span className="ml-2 border border-brass/50 px-1.5 py-0.5 text-[10px] text-walnut">Proof</span>}</td><td className="py-3 pr-4 text-espresso">{formatINR(Number(payment.amount_inr))}</td><td className="py-3 pr-4"><span className={`inline-flex border px-2 py-1 text-xs ${paymentTone(payment.payment_status)}`}>{safePaymentLabel(payment)}</span></td><td className="py-3 pr-4 whitespace-nowrap text-xs text-espresso/80">{formatDate(payment.verified_at)}</td><td className="py-3 whitespace-nowrap text-xs text-espresso/80">{formatDate(payment.created_at)}</td></tr>)}</tbody></table></div>}
        {pageCount > 1 && <nav aria-label="Payment pages" className="mt-5 flex items-center justify-center gap-4 text-sm"><button type="button" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={page === 1} aria-label="Previous page" className="border border-brass/50 p-2 text-espresso disabled:opacity-40"><ArrowLeft size={16} /></button><span className="text-espresso/80">Page {page} of {pageCount}</span><button type="button" onClick={() => setPage((current) => Math.min(pageCount, current + 1))} disabled={page === pageCount} aria-label="Next page" className="border border-brass/50 p-2 text-espresso disabled:opacity-40"><ArrowRight size={16} /></button></nav>}
      </section>

      {(detailLoading || detail) && <div className="fixed inset-0 z-50 overflow-y-auto bg-black/70 p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !verifying) setDetail(null); }}><section role="dialog" aria-modal="true" aria-labelledby="payment-detail-title" className="mx-auto my-6 max-w-4xl border border-brass/40 bg-white text-espresso shadow-2xl"><div className="flex items-start justify-between gap-4 border-b border-brass/40 p-5 sm:p-7"><div><p className="text-sm text-espresso/65">Payment details</p><h2 id="payment-detail-title" className="mt-1 text-2xl text-walnut">{detail?.payment.id ?? "Loading payment..."}</h2></div><button type="button" onClick={() => setDetail(null)} aria-label="Close payment details" className="p-2 text-espresso/80 hover:bg-[#eadbd2]"><X size={19} /></button></div>
        {detailLoading && <p role="status" className="p-8 text-center text-sm text-espresso/65">Loading payment details...</p>}
        {detail && <div className="grid gap-6 p-5 sm:p-7"><section className="grid gap-5 sm:grid-cols-2"><div className="border border-brass/40 p-4"><h3 className="font-medium text-walnut">Payment record</h3><dl className="mt-3 grid grid-cols-2 gap-2 text-sm"><dt className="text-espresso/55">Payment ID</dt><dd className="break-all font-mono text-xs text-espresso">{detail.payment.id}</dd><dt className="text-espresso/55">Method</dt><dd className="uppercase text-espresso">{detail.payment.payment_method}</dd><dt className="text-espresso/55">Amount</dt><dd className="text-espresso">{formatINR(Number(detail.payment.amount_inr))}</dd><dt className="text-espresso/55">Status</dt><dd className={detail.payment.payment_status === "paid" && !detail.payment.verified_at ? "text-amber-200" : "text-espresso"}>{safePaymentLabel({ ...detail.payment, orderNumber: "", customerName: "", customerEmail: "", orderStatus: "" })}</dd><dt className="text-espresso/55">Reference</dt><dd className="break-all text-espresso">{detail.payment.transaction_reference || "Not provided"}</dd><dt className="text-espresso/55">Created</dt><dd className="text-espresso">{formatDate(detail.payment.created_at)}</dd><dt className="text-espresso/55">Verified</dt><dd className="text-espresso">{formatDate(detail.payment.verified_at)}</dd>{detail.payment.verification_note && <><dt className="text-espresso/55">Verification note</dt><dd className="text-espresso">{detail.payment.verification_note}</dd></>}</dl></div><div className="border border-brass/40 p-4"><h3 className="font-medium text-walnut">Related order & customer</h3><p className="mt-3 font-medium text-walnut">{detail.order.order.order_number}</p><p className="mt-2 text-sm text-espresso">{detail.order.order.customer_name}</p><a href={`mailto:${detail.order.order.customer_email}`} className="text-sm text-walnut hover:underline">{detail.order.order.customer_email}</a>{detail.order.order.customer_phone && <p className="mt-1 text-sm text-espresso/80">{detail.order.order.customer_phone}</p>}<p className="mt-3 text-sm text-espresso/80">Order total: {formatINR(Number(detail.order.order.total_inr))}</p><p className="mt-1 text-xs text-espresso/65">Order status: {detail.order.order.order_status.replace(/_/g, " ")}</p></div></section>
          <section className="border border-brass/40 p-4"><h3 className="font-medium text-walnut">Payment activity history</h3>{paymentHistory.length ? <div className="mt-3 divide-y divide-slate-800">{paymentHistory.map((entry) => <div key={entry.id} className="py-3 text-sm"><div className="flex flex-wrap items-center justify-between gap-2"><span className="font-medium text-espresso">{entry.action.replace(/_/g, " ")}</span><time className="text-xs text-espresso/55">{formatDate(entry.created_at)}</time></div><p className="mt-1 text-xs text-espresso/65">{entry.previous_status ? `${entry.previous_status} → ` : ""}{entry.new_status} · {formatINR(Number(entry.amount_inr))}</p>{entry.external_reference && <p className="mt-1 break-all text-xs text-espresso/65">Reference: {entry.external_reference}</p>}{entry.note && <p className="mt-1 text-xs text-espresso/65">{entry.note}</p>}</div>)}</div> : <p className="mt-2 text-sm text-espresso/65">No payment status changes recorded yet.</p>}{detail.payment.verified_by && <p className="mt-2 text-xs text-espresso/65">Verified by user {detail.payment.verified_by}</p>}</section>
          <section className="border border-brass/40 p-4"><h3 className="font-medium text-walnut">Refund information</h3><p className="mt-2 text-sm text-espresso/65">The schema supports a `refunded` payment status only. It has no refund amount, provider transaction, or refund-history records, so no refund action is available here.</p></section>
          {detail.payment.payment_method === "upi" && (detail.payment.payment_proof_path || detail.payment.payment_status === "verification_pending") && <section className="border border-brass/40 p-4"><h3 className="font-medium text-walnut">Customer payment submission</h3><p className="mt-1 text-xs text-espresso/65">{detail.payment.payment_status === "verification_pending" ? `Submitted by the customer ${formatDate(detail.payment.updated_at)} and awaiting your verification. ` : ""}This is the customer's claim, not proof that money was received.</p>{detail.payment.payment_status === "verification_pending" && <p className="mt-3 text-sm text-espresso">Reference submitted: <span className="break-all font-mono text-xs">{detail.payment.transaction_reference || "—"}</span></p>}<div className="mt-3">{detail.payment.payment_proof_path ? <PaymentProofPreview path={detail.payment.payment_proof_path} variant="admin" /> : <p className="text-xs text-espresso/55">No screenshot was attached.</p>}</div></section>}
          {detail.payment.payment_method === "upi" && ["pending", "verification_pending"].includes(detail.payment.payment_status) && <section className="border border-amber-800/70 bg-amber-950/20 p-4"><h3 className="flex items-center gap-2 font-medium text-amber-100"><ShieldCheck size={17} />Manual UPI verification</h3><p className="mt-1 text-xs text-amber-200/80">Verify settlement independently in the bank/UPI source. A screenshot or customer-submitted reference alone is not proof.</p><div className="mt-3 grid gap-3 sm:grid-cols-2"><label className="grid gap-1 text-xs text-espresso/80">Transaction reference<input value={reference} onChange={(event) => setReference(event.target.value)} maxLength={200} className="border border-brass/50 bg-cream px-3 py-2 text-sm text-walnut" /></label><label className="grid gap-1 text-xs text-espresso/80">Verification note<input value={verificationNote} onChange={(event) => setVerificationNote(event.target.value)} maxLength={1000} className="border border-brass/50 bg-cream px-3 py-2 text-sm text-walnut" /></label></div><button type="button" onClick={verifyPayment} disabled={verifying || !reference.trim()} className="mt-3 inline-flex items-center gap-2 bg-emerald-800 px-4 py-2 text-sm text-walnut hover:bg-emerald-700 disabled:opacity-50"><ShieldCheck size={15} />{verifying ? "Recording..." : "Verify settled payment"}</button><button type="button" onClick={rejectCurrentPayment} disabled={verifying} className="ml-2 mt-3 inline-flex items-center gap-2 border border-red-700 px-4 py-2 text-sm text-red-200 hover:bg-red-950/50 disabled:opacity-50">{verifying ? "Recording..." : "Reject payment"}</button></section>}
          {detail.payment.payment_status === "paid" && detail.payment.verified_at && <section className="border border-red-900/70 bg-red-950/20 p-4"><h3 className="font-medium text-red-100">Record a full refund</h3><p className="mt-1 text-xs text-red-200/80">Use only after you have actually returned the full amount to the customer. Partial refunds are not supported.</p><button type="button" onClick={refundCurrentPayment} disabled={verifying} className="mt-3 border border-red-700 px-4 py-2 text-sm text-red-100 hover:bg-red-950/60 disabled:opacity-50">{verifying ? "Recording..." : "Record full refund"}</button></section>}
          <section><h3 className="font-medium text-walnut">Order items</h3><div className="mt-3 divide-y divide-slate-800">{detail.order.items.map((item) => <div key={item.id} className="flex items-center justify-between gap-3 py-2 text-sm"><span className="text-espresso/80">{item.product_name} · {item.quantity} × {formatINR(Number(item.unit_price_inr))}</span><span className="text-espresso">{formatINR(Number(item.line_subtotal_inr))}</span></div>)}</div></section>
        </div>}
      </section></div>}

      {toast && <div role="status" aria-live="polite" className={`fixed bottom-5 right-5 z-[60] max-w-sm border px-4 py-3 text-sm shadow-xl ${toast.tone === "success" ? "border-emerald-700 bg-[#0d2b2a] text-emerald-100" : "border-red-800 bg-[#3a1720] text-red-100"}`}>{toast.text}</div>}
    </section>
  );
}
