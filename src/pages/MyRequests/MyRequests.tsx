import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { ClipboardList } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { friendlyMyRequestsError, getMyCustomRequests, type CustomerRequest } from "../../services/customRequests";
import { getMyQuotationOverview, type QuotationOverview } from "../../services/quotations";
import { customerQuotationStatusLabel, customerQuotationStatusStyle, effectiveQuotationStatus, formatMoney } from "../../utils/quotationStatus";
import type { CustomRequestStatus } from "../../types/database";
import { budgetText, customerRequestStatusLabel, customerRequestStatusStyle, customerRequestStatuses } from "../../utils/customRequestStatus";
import { formatDate } from "../../utils/orderStatus";

const PAGE_SIZE = 10;
type StatusFilter = CustomRequestStatus | "all";

export function RequestStatusBadge({ status }: { status: CustomRequestStatus }) {
  return <span className={`border px-2.5 py-1 text-xs ${customerRequestStatusStyle[status]}`}>{customerRequestStatusLabel[status]}</span>;
}

export default function MyRequests() {
  const { user } = useAuth();
  const userId = user?.id ?? "";
  const [status, setStatus] = useState<StatusFilter>("all");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [requests, setRequests] = useState<CustomerRequest[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [quotes, setQuotes] = useState<Record<string, QuotationOverview>>({});

  useEffect(() => {
    if (!userId) return;
    let active = true;
    setLoading(true); setError("");
    void getMyCustomRequests(userId, { page, pageSize: PAGE_SIZE, status, search })
      .then((result) => { if (active) { setRequests(result.requests); setTotal(result.total); } })
      .catch((reason: unknown) => { if (active) { setError(friendlyMyRequestsError(reason)); setRequests([]); setTotal(0); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [userId, page, status, search, attempt]);

  useEffect(() => {
    let active = true;
    void getMyQuotationOverview(requests.map((request) => request.id)).then((result) => { if (active) setQuotes(result); });
    return () => { active = false; };
  }, [requests]);

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  useEffect(() => { if (!loading && page > pageCount) setPage(pageCount); }, [loading, page, pageCount]);
  const chooseStatus = useCallback((next: StatusFilter) => { setStatus(next); setPage(1); }, []);
  function submitSearch(event: FormEvent) { event.preventDefault(); setSearch(searchInput.trim()); setPage(1); }
  function clearFilters() { setStatus("all"); setSearch(""); setSearchInput(""); setPage(1); }
  const filtered = status !== "all" || search !== "";

  return (
    <section className="container-x max-w-4xl py-14 md:py-20">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div><h1 className="text-4xl text-walnut">My custom requests</h1><p className="mt-2 text-sm text-espresso/70">Follow the customization requests you've sent and read replies from our team.</p></div>
        <Link to="/shop" className="btn-outline px-4 py-2 text-sm">Browse customizable pieces</Link>
      </div>

      <form onSubmit={submitSearch} role="search" className="mt-8 flex flex-wrap gap-3">
        <label className="sr-only" htmlFor="request-search">Search your requests</label>
        <input id="request-search" value={searchInput} onChange={(e) => setSearchInput(e.target.value)} maxLength={100} placeholder="Search by reference, title or product" className="min-w-0 flex-1 border border-brass/50 bg-transparent px-4 py-2 text-sm" />
        <button type="submit" className="btn-outline px-4 py-2 text-sm">Search</button>
      </form>
      <div role="group" aria-label="Filter by status" className="mt-4 flex flex-wrap gap-2">
        {(["all", ...customerRequestStatuses] as StatusFilter[]).map((value) => (
          <button key={value} type="button" aria-pressed={status === value} onClick={() => chooseStatus(value)}
            className={`border px-4 py-2 text-sm transition ${status === value ? "border-walnut bg-walnut text-cream" : "border-brass/50 text-walnut hover:bg-brass/10"}`}>
            {value === "all" ? "All" : customerRequestStatusLabel[value]}
          </button>
        ))}
      </div>

      {loading && <p role="status" className="py-16 text-center text-walnut/70">Loading your requests...</p>}
      {!loading && error && (
        <div className="py-16 text-center"><p role="alert" className="mx-auto max-w-md text-red-800">{error}</p><button type="button" onClick={() => setAttempt((n) => n + 1)} className="btn-outline mt-6">Try again</button></div>
      )}
      {!loading && !error && requests.length === 0 && (
        <div className="py-16 text-center">
          <ClipboardList size={36} aria-hidden="true" className="mx-auto text-brass" />
          <h2 className="mt-4 text-2xl text-walnut">{filtered ? "No requests match" : "You haven't sent a custom request yet"}</h2>
          <p className="mx-auto mt-2 max-w-sm text-sm text-espresso/70">{filtered ? "Try a different status or search." : "Look for pieces marked “Can be personalised” and choose Customize."}</p>
          {filtered ? <button type="button" onClick={clearFilters} className="btn-outline mt-6">Clear filters</button> : <Link to="/shop" className="btn-primary mt-6">Browse the collection</Link>}
        </div>
      )}
      {!loading && !error && requests.length > 0 && (
        <ul className="mt-6 grid gap-5">
          {requests.map((request) => (
            <li key={request.id} className="border border-brass/40 p-5 sm:p-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0"><h2 className="break-words text-xl text-walnut">{request.title}</h2><p className="text-sm text-walnut/70">{request.request_number} · Submitted {formatDate(request.created_at)}</p></div>
                <RequestStatusBadge status={request.status} />
              </div>
              <p className="mt-3 text-sm text-espresso/80">Product: {request.requested_product}</p>
              <p className="mt-1 line-clamp-2 text-sm text-espresso/70">{request.description}</p>
              {quotes[request.id] && (() => { const quote = quotes[request.id]; const quoteStatus = effectiveQuotationStatus(quote.status, quote.valid_until); return <p className="mt-3 flex flex-wrap items-center gap-2 text-sm text-espresso/80">Quotation: <span className={`border px-2 py-0.5 text-xs ${customerQuotationStatusStyle[quoteStatus]}`}>{customerQuotationStatusLabel[quoteStatus]}</span><span>{formatMoney(Number(quote.final_total_inr))}</span></p>; })()}
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-brass/30 pt-4 text-sm">
                <span className="text-walnut/70">Budget: {budgetText(request.budget_min_inr, request.budget_max_inr)}{request.response_updated_at ? " · Reply from our team" : ""}</span>
                <Link to={`/my-requests/${request.id}`} className="btn-primary px-4 py-2 text-sm">View details<span className="sr-only"> for {request.request_number}</span></Link>
              </div>
            </li>
          ))}
        </ul>
      )}
      {!loading && !error && pageCount > 1 && (
        <nav aria-label="Request pages" className="mt-8 flex items-center justify-center gap-4 text-sm">
          <button type="button" onClick={() => setPage((n) => Math.max(1, n - 1))} disabled={page === 1} className="btn-outline px-4 py-2 disabled:opacity-40">Previous</button>
          <span aria-live="polite">Page {page} of {pageCount}</span>
          <button type="button" onClick={() => setPage((n) => Math.min(pageCount, n + 1))} disabled={page === pageCount} className="btn-outline px-4 py-2 disabled:opacity-40">Next</button>
        </nav>
      )}
    </section>
  );
}
