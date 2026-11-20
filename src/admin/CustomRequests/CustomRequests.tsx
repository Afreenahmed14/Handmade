import { useEffect, useMemo, useState, type FormEvent } from "react";
import { ArrowLeft, ArrowRight, ClipboardList, ExternalLink, Image, MessageSquare, RefreshCw, Search, StickyNote, X } from "lucide-react";
import { formatINR } from "../../utils/currency";
import { getCustomRequestDetail, getCustomRequests, getCustomRequestStats, updateCustomRequest, type CustomRequestDetail, type CustomRequestDirectoryRow, type CustomRequestStats } from "../../services/customRequests";
import type { CustomRequestStatus } from "../../types/database";
import PhotoPreparationPanel from "./PhotoPreparationPanel";
import QuotationPanel from "./QuotationPanel";
import { getLatestQuotationStatuses } from "../../services/quotations";
import type { QuotationStatus } from "../../types/database";
import { adminQuotationStatusStyle, effectiveQuotationStatus, quotationStatusLabel } from "../../utils/quotationStatus";

const pageSize = 20;
const statusLabels: Record<CustomRequestStatus, string> = {
  new: "New", pending: "Pending", in_progress: "In progress", completed: "Completed", rejected: "Rejected",
};
const transitions: Record<CustomRequestStatus, CustomRequestStatus[]> = {
  new: ["pending", "in_progress", "rejected"],
  pending: ["in_progress", "completed", "rejected"],
  in_progress: ["pending", "completed", "rejected"],
  completed: [], rejected: [],
};

type Toast = { text: string; tone: "success" | "error" | "warning" };

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function statusStyle(status: CustomRequestStatus) {
  if (status === "completed") return "border-emerald-800 bg-emerald-950/40 text-emerald-200";
  if (status === "rejected") return "border-red-800 bg-red-950/40 text-red-200";
  if (status === "new") return "border-brass/50 bg-[#f7edf2] text-walnut";
  if (status === "pending") return "border-amber-700 bg-amber-950/40 text-amber-200";
  return "border-indigo-800 bg-indigo-950/40 text-indigo-200";
}

function errorText(reason: unknown) {
  return reason instanceof Error ? reason.message : "Unable to load custom requests.";
}

function budgetText(request: CustomRequestDirectoryRow) {
  if (request.budget_min_inr === null && request.budget_max_inr === null) return "Not provided";
  if (request.budget_min_inr !== null && request.budget_max_inr !== null) return `${formatINR(Number(request.budget_min_inr))} – ${formatINR(Number(request.budget_max_inr))}`;
  return request.budget_min_inr !== null ? `From ${formatINR(Number(request.budget_min_inr))}` : `Up to ${formatINR(Number(request.budget_max_inr))}`;
}

function prettyObject(value: unknown): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, item]) => {
    if (item === null || item === undefined || item === "") return [];
    const formatted = Array.isArray(item) ? item.join(", ") : typeof item === "object" ? JSON.stringify(item) : String(item);
    return [[key.replace(/_/g, " "), formatted] as unknown as string[]];
  }).map(([key, item]) => `${key}: ${item}`);
}

export default function CustomRequests() {
  const [requests, setRequests] = useState<CustomRequestDirectoryRow[]>([]);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState<CustomRequestStats | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<CustomRequestStatus | "all">("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [statsError, setStatsError] = useState("");
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [toast, setToast] = useState<Toast | null>(null);
  const [detail, setDetail] = useState<CustomRequestDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [nextStatus, setNextStatus] = useState<CustomRequestStatus | "">("");
  const [statusReason, setStatusReason] = useState("");
  const [internalNote, setInternalNote] = useState("");
  const [customerResponse, setCustomerResponse] = useState("");
  const [saving, setSaving] = useState(false);
  const [quoteStatuses, setQuoteStatuses] = useState<Record<string, { version: number; status: QuotationStatus; valid_until: string | null }>>({});

  useEffect(() => {
    let active = true;
    if (fromDate && toDate && fromDate > toDate) {
      setError("Start date must be on or before end date.");
      setRequests([]);
      setTotal(0);
      setLoading(false);
      setRefreshing(false);
      return () => { active = false; };
    }
    setLoading(true);
    setError("");
    void getCustomRequests({ page, pageSize, search, status: statusFilter, fromDate: fromDate || undefined, toDate: toDate || undefined })
      .then((result) => { if (active) { setRequests(result.requests); setTotal(result.total); } })
      .catch((reason: unknown) => { if (active) { setError(errorText(reason)); setRequests([]); setTotal(0); } })
      .finally(() => { if (active) { setLoading(false); setRefreshing(false); } });
    return () => { active = false; };
  }, [page, search, statusFilter, fromDate, toDate, refreshVersion]);

  // Latest quotation status for the requests on this page (empty until the Phase 3 migration is applied).
  useEffect(() => {
    let active = true;
    void getLatestQuotationStatuses(requests.map((request) => request.id))
      .then((result) => { if (active) setQuoteStatuses(result); })
      .catch(() => { if (active) setQuoteStatuses({}); });
    return () => { active = false; };
  }, [requests, refreshVersion]);

  useEffect(() => {
    let active = true;
    setSummaryLoading(true);
    void getCustomRequestStats().then((result) => { if (active) { setStats(result); setStatsError(""); } })
      .catch((reason: unknown) => { if (active) setStatsError(errorText(reason)); })
      .finally(() => { if (active) setSummaryLoading(false); });
    return () => { active = false; };
  }, [refreshVersion]);

  useEffect(() => { setPage(1); }, [search, statusFilter, fromDate, toDate]);
  useEffect(() => { if (!toast) return; const timer = window.setTimeout(() => setToast(null), 6000); return () => window.clearTimeout(timer); }, [toast]);
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  useEffect(() => { if (page > pageCount) setPage(pageCount); }, [page, pageCount]);

  const statCards = useMemo(() => stats ? [
    { label: "Total requests", value: stats.total },
    { label: "New", value: stats.byStatus.new },
    { label: "Pending", value: stats.byStatus.pending },
    { label: "In progress", value: stats.byStatus.in_progress },
    { label: "Completed", value: stats.byStatus.completed },
    { label: "Rejected", value: stats.byStatus.rejected },
  ] : [], [stats]);

  function refresh() {
    setRefreshing(true);
    setRefreshVersion((version) => version + 1);
  }

  async function openRequest(requestId: string) {
    setDetail(null);
    setDetailLoading(true);
    setNextStatus("");
    setStatusReason("");
    setInternalNote("");
    setCustomerResponse("");
    try {
      setDetail(await getCustomRequestDetail(requestId));
    } catch (reason) {
      setToast({ text: errorText(reason), tone: "error" });
    } finally {
      setDetailLoading(false);
    }
  }

  async function saveRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail) return;
    const hasAction = Boolean(nextStatus || internalNote.trim() || customerResponse.trim());
    if (!hasAction) { setToast({ text: "Choose a status change or enter a note/response.", tone: "warning" }); return; }
    if (nextStatus === "completed" || nextStatus === "rejected") {
      if (!window.confirm(`Mark this request ${statusLabels[nextStatus].toLowerCase()}?`)) return;
    }
    setSaving(true);
    try {
      await updateCustomRequest({
        requestId: detail.request.id,
        newStatus: nextStatus || undefined,
        statusReason: nextStatus ? statusReason : undefined,
        internalNote: internalNote.trim() || undefined,
        customerResponse: customerResponse.trim() || undefined,
      });
      setDetail(await getCustomRequestDetail(detail.request.id));
      setRefreshVersion((version) => version + 1);
      setNextStatus("");
      setStatusReason("");
      setInternalNote("");
      setCustomerResponse("");
      setToast({ text: "Custom request updated.", tone: "success" });
    } catch (reason) {
      setToast({ text: errorText(reason), tone: "error" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="relative -m-4 min-h-[calc(100vh-8rem)] bg-cream p-4 text-espresso sm:-m-8 sm:p-8">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-brass/40 pb-5"><div><p className="text-sm text-espresso/65">Customer services</p><h1 className="mt-1 text-3xl text-white">Custom requests</h1></div><button type="button" onClick={refresh} disabled={refreshing} className="inline-flex items-center gap-2 border border-brass/50 px-4 py-2 text-sm text-espresso hover:bg-[#eadbd2] disabled:opacity-50"><RefreshCw size={15} />{refreshing ? "Refreshing..." : "Refresh"}</button></div>
      {(error || statsError) && <p role="alert" className="mt-4 border-l-2 border-red-400 pl-3 text-sm text-red-200">{error || statsError}</p>}

      <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-6">{summaryLoading ? Array.from({ length: 6 }, (_, index) => <div key={index} className="animate-pulse border border-brass/40 bg-white p-4"><div className="h-3 w-20 bg-[#ddc9bd]" /><div className="mt-4 h-7 w-12 bg-[#ddc9bd]" /></div>) : statCards.map((stat) => <article key={stat.label} className="border border-brass/40 bg-white p-4"><p className="text-sm text-espresso/65">{stat.label}</p><p className="mt-3 text-2xl font-semibold text-white">{stat.value}</p></article>)}</div>

      <section className="mt-8"><div className="flex flex-wrap items-end justify-between gap-3"><div><h2 className="text-xl font-medium text-white">Request directory</h2><p className="mt-1 text-sm text-espresso/65">{total} request{total === 1 ? "" : "s"}</p></div><p className="text-xs text-espresso/55">Email notifications are not configured; customer responses are recorded for later delivery.</p></div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(12rem,1fr)_12rem_12rem_12rem]">
          <label className="relative"><span className="sr-only">Search requests</span><Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-espresso/65" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search request, customer, product" className="w-full border border-brass/40 bg-white py-2 pl-9 pr-3 text-sm text-white placeholder:text-espresso/55" /></label>
          <label className="grid gap-1 text-xs text-espresso/65">Status<select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as CustomRequestStatus | "all")} className="border border-brass/40 bg-white px-3 py-2 text-sm text-white"><option value="all">All statuses</option>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label className="grid gap-1 text-xs text-espresso/65">From date<input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} className="border border-brass/40 bg-white px-3 py-2 text-sm text-white" /></label>
          <label className="grid gap-1 text-xs text-espresso/65">To date<input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} className="border border-brass/40 bg-white px-3 py-2 text-sm text-white" /></label>
        </div>

        {loading && <p role="status" className="py-12 text-center text-sm text-espresso/80">Loading custom requests...</p>}
        {!loading && !error && !requests.length && <div className="py-14 text-center"><div className="mx-auto grid h-12 w-12 place-items-center border border-brass/40 bg-white text-espresso/65"><ClipboardList size={20} /></div><p className="mt-4 text-espresso">No requests match these filters.</p></div>}
        {!loading && requests.length > 0 && <div className="mt-4 overflow-x-auto border-y border-brass/40"><table className="w-full min-w-[85rem] text-left text-sm"><thead className="border-b border-brass/40 text-xs uppercase text-espresso/65"><tr><th className="py-3 pr-4">Request</th><th className="py-3 pr-4">Customer</th><th className="py-3 pr-4">Requested product</th><th className="py-3 pr-4">Description</th><th className="py-3 pr-4">Budget</th><th className="py-3 pr-4">Date</th><th className="py-3 pr-4">Status</th><th className="py-3">Quotation</th></tr></thead><tbody>{requests.map((request) => <tr key={request.id} className="border-b border-brass/30 last:border-0"><td className="py-3 pr-4"><button type="button" onClick={() => void openRequest(request.id)} className="font-medium text-walnut hover:underline">{request.request_number}</button></td><td className="py-3 pr-4"><p className="text-espresso">{request.customer_name || "Customer"}</p><p className="text-xs text-espresso/55">{request.customer_email || "Email unavailable"}</p></td><td className="py-3 pr-4 text-espresso">{request.requested_product}</td><td className="max-w-xs py-3 pr-4 text-espresso/65"><p className="truncate">{request.title}</p><p className="truncate text-xs">{request.description}</p></td><td className="py-3 pr-4 whitespace-nowrap text-espresso/80">{budgetText(request)}</td><td className="py-3 pr-4 whitespace-nowrap text-xs text-espresso/80">{formatDate(request.created_at)}</td><td className="py-3 pr-4"><span className={`inline-flex border px-2 py-1 text-xs ${statusStyle(request.status)}`}>{statusLabels[request.status]}</span></td><td className="py-3 whitespace-nowrap">{quoteStatuses[request.id] ? (() => { const quote = quoteStatuses[request.id]; const status = effectiveQuotationStatus(quote.status, quote.valid_until); return <span className={`inline-flex border px-2 py-1 text-xs ${adminQuotationStatusStyle[status]}`}>v{quote.version} · {quotationStatusLabel[status]}</span>; })() : <span className="text-xs text-slate-600">—</span>}</td></tr>)}</tbody></table></div>}
        {pageCount > 1 && <nav aria-label="Custom request pages" className="mt-5 flex items-center justify-center gap-4 text-sm"><button type="button" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={page === 1} aria-label="Previous page" className="border border-brass/50 p-2 text-espresso disabled:opacity-40"><ArrowLeft size={16} /></button><span className="text-espresso/80">Page {page} of {pageCount}</span><button type="button" onClick={() => setPage((current) => Math.min(pageCount, current + 1))} disabled={page === pageCount} aria-label="Next page" className="border border-brass/50 p-2 text-espresso disabled:opacity-40"><ArrowRight size={16} /></button></nav>}
      </section>

      {(detailLoading || detail) && <div className="fixed inset-0 z-50 overflow-y-auto bg-black/70 p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) setDetail(null); }}><section role="dialog" aria-modal="true" aria-labelledby="custom-request-title" className="mx-auto my-6 max-w-4xl border border-brass/40 bg-white text-espresso shadow-2xl"><div className="flex items-start justify-between gap-4 border-b border-brass/40 p-5 sm:p-7"><div><p className="text-sm text-espresso/65">Custom request</p><h2 id="custom-request-title" className="mt-1 text-2xl text-white">{detail?.request.request_number ?? "Loading request..."}</h2></div><button type="button" onClick={() => setDetail(null)} aria-label="Close request detail" className="p-2 text-espresso/80 hover:bg-[#eadbd2]"><X size={19} /></button></div>
        {detailLoading && <p role="status" className="p-8 text-center text-sm text-espresso/65">Loading request details...</p>}
        {detail && <div className="grid gap-6 p-5 sm:p-7"><div className="flex flex-wrap items-start justify-between gap-4"><div><h3 className="text-lg font-medium text-white">{detail.request.title}</h3><p className="mt-1 text-sm text-espresso/65">Submitted {formatDate(detail.request.created_at)}</p></div><span className={`border px-2.5 py-1 text-xs ${statusStyle(detail.request.status)}`}>{statusLabels[detail.request.status]}</span></div>
          <div className="grid gap-5 lg:grid-cols-2"><section className="border border-brass/40 p-4"><h3 className="font-medium text-white">Customer</h3><p className="mt-3 text-sm text-espresso">{detail.request.customer_name || "Customer"}</p><a href={`mailto:${detail.request.customer_email}`} className="text-sm text-walnut hover:underline">{detail.request.customer_email || "Email unavailable"}</a>{detail.request.customer_phone && <p className="mt-1 text-sm text-espresso/80">{detail.request.customer_phone}</p>}<p className="mt-3 text-xs text-espresso/55">Assigned administrator: not supported by the current request schema.</p></section><section className="border border-brass/40 p-4"><h3 className="font-medium text-white">Request details</h3><p className="mt-2 text-sm text-espresso/80">Requested product: {detail.request.requested_product}</p><p className="mt-3 whitespace-pre-wrap text-sm text-espresso">{detail.request.description}</p><p className="mt-3 text-sm text-espresso/80">Budget: {budgetText(detail.request)}</p></section></div>
          <div className="grid gap-5 lg:grid-cols-2"><section className="border border-brass/40 p-4"><h3 className="font-medium text-white">Requirements</h3><div className="mt-3 space-y-2">{prettyObject(detail.request.requirements).map((line) => <p key={line} className="text-sm text-espresso/80">{line}</p>)}{!prettyObject(detail.request.requirements).length && <p className="text-sm text-espresso/55">No additional requirements.</p>}</div><h4 className="mt-4 font-medium text-espresso">Preferences</h4><div className="mt-2 space-y-2">{prettyObject(detail.request.preferences).map((line) => <p key={line} className="text-sm text-espresso/80">{line}</p>)}{!prettyObject(detail.request.preferences).length && <p className="text-sm text-espresso/55">No preferences provided.</p>}</div></section><section className="border border-brass/40 p-4"><h3 className="flex items-center gap-2 font-medium text-white"><Image size={16} />Private attachments</h3>{detail.attachmentUrls.length ? <div className="mt-3 space-y-2">{detail.attachmentUrls.map((url, index) => <a key={url} href={url} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-sm text-walnut hover:underline"><Image size={14} />Attachment {index + 1}<ExternalLink size={13} /></a>)}</div> : <p className="mt-3 text-sm text-espresso/55">No attachments.</p>}</section></div>
          <PhotoPreparationPanel key={detail.request.id} requestId={detail.request.id} requestNumber={detail.request.request_number} status={detail.request.status} preferences={detail.request.preferences} attachmentPaths={detail.request.attachment_paths} notify={(text, tone) => setToast({ text, tone })} />
          <QuotationPanel key={`quotation-${detail.request.id}`} requestId={detail.request.id} requestNumber={detail.request.request_number} requestStatus={detail.request.status} requestedProduct={detail.request.requested_product} requirements={detail.request.requirements} preferences={detail.request.preferences} attachmentPaths={detail.request.attachment_paths} notify={(text, tone) => setToast({ text, tone })} onChanged={() => setRefreshVersion((version) => version + 1)} />
          <div className="grid gap-5 lg:grid-cols-3"><section className="border border-brass/40 p-4"><h3 className="flex items-center gap-2 font-medium text-white"><ClipboardList size={16} />Status history</h3>{detail.statusHistory.length ? <ol className="mt-3 space-y-3 border-l border-brass/50 pl-4">{detail.statusHistory.map((entry) => <li key={entry.id} className="relative"><span className="absolute -left-[1.32rem] top-1 h-2 w-2 rounded-full bg-walnut" /><p className="text-sm text-espresso">{statusLabels[entry.new_status]}</p><p className="text-xs text-espresso/65">{entry.reason}</p><p className="text-[11px] text-espresso/55">{formatDate(entry.created_at)}</p></li>)}</ol> : <p className="mt-3 text-sm text-espresso/55">No status history.</p>}</section><section className="border border-brass/40 p-4"><h3 className="flex items-center gap-2 font-medium text-white"><StickyNote size={16} />Internal notes</h3>{detail.internalNotes.length ? <div className="mt-3 space-y-3">{detail.internalNotes.map((note) => <article key={note.id} className="border-b border-brass/30 pb-2"><p className="whitespace-pre-wrap text-sm text-espresso">{note.note}</p><p className="mt-1 text-[11px] text-espresso/55">{formatDate(note.created_at)}</p></article>)}</div> : <p className="mt-3 text-sm text-espresso/55">No internal notes.</p>}</section><section className="border border-brass/40 p-4"><h3 className="flex items-center gap-2 font-medium text-white"><MessageSquare size={16} />Customer responses</h3>{detail.responses.length ? <div className="mt-3 space-y-3">{detail.responses.map((response) => <article key={response.id} className="border-b border-brass/30 pb-2"><p className="whitespace-pre-wrap text-sm text-espresso">{response.response}</p><p className="mt-1 text-[11px] text-espresso/55">{formatDate(response.created_at)}</p></article>)}</div> : <p className="mt-3 text-sm text-espresso/55">No response recorded.</p>}<p className="mt-3 text-xs text-amber-200">No email service is configured; responses are saved only.</p></section></div>
          <form onSubmit={saveRequest} className="grid gap-3 border border-brass/40 bg-cream p-4"><h3 className="font-medium text-white">Update request</h3><label className="grid gap-1 text-xs text-espresso/65">New status<select value={nextStatus} onChange={(event) => setNextStatus(event.target.value as CustomRequestStatus | "")} className="border border-brass/50 bg-white px-3 py-2 text-sm text-white"><option value="">Keep current status</option>{transitions[detail.request.status].map((status) => <option key={status} value={status}>{statusLabels[status]}</option>)}</select></label>{nextStatus && <label className="grid gap-1 text-xs text-espresso/65">Status reason<input required maxLength={1000} value={statusReason} onChange={(event) => setStatusReason(event.target.value)} className="border border-brass/50 bg-white px-3 py-2 text-sm text-white" /></label>}<label className="grid gap-1 text-xs text-espresso/65">Internal note (admin-only)<textarea maxLength={5000} rows={3} value={internalNote} onChange={(event) => setInternalNote(event.target.value)} className="resize-y border border-brass/50 bg-white px-3 py-2 text-sm text-white" /></label><label className="grid gap-1 text-xs text-espresso/65">Administrative response (visible in request record)<textarea maxLength={5000} rows={3} value={customerResponse} onChange={(event) => setCustomerResponse(event.target.value)} className="resize-y border border-brass/50 bg-white px-3 py-2 text-sm text-white" /></label><div className="flex justify-end"><button type="submit" disabled={saving} className="bg-walnut px-4 py-2 text-sm text-white hover:bg-[#4c173b] disabled:opacity-50">{saving ? "Saving..." : "Save update"}</button></div></form>
        </div>}
      </section></div>}

      {toast && <div role="status" aria-live="polite" className={`fixed bottom-5 right-5 z-[60] max-w-sm border px-4 py-3 text-sm shadow-xl ${toast.tone === "success" ? "border-emerald-700 bg-[#0d2b2a] text-emerald-100" : toast.tone === "warning" ? "border-amber-700 bg-[#382a10] text-amber-100" : "border-red-800 bg-[#3a1720] text-red-100"}`}>{toast.text}</div>}
    </section>
  );
}
