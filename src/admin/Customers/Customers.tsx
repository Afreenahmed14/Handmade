import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, CalendarDays, Mail, MapPin, Phone, RefreshCw, Search, UserRound, X } from "lucide-react";
import { formatINR } from "../../utils/currency";
import { getCustomerById, getCustomerDirectory, getCustomerSummary, type CustomerDirectoryItem, type CustomerRecord, type CustomerSummary } from "../../services/customers";

const pageSize = 20;
type Toast = { text: string; tone: "success" | "warning" | "error" };

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-IN", { dateStyle: "medium" }).format(new Date(value));
}

function initials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("") || "?";
}

function errorText(reason: unknown) {
  return reason instanceof Error ? reason.message : "Unable to load customer data.";
}

function addressText(customer: CustomerRecord) {
  return [customer.address_line1, customer.address_line2, customer.city, customer.state, customer.postal_code, customer.country].filter(Boolean).join(", ");
}

export default function Customers() {
  const [customers, setCustomers] = useState<CustomerDirectoryItem[]>([]);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState<CustomerSummary | null>(null);
  const [search, setSearch] = useState("");
  const [registeredFrom, setRegisteredFrom] = useState("");
  const [registeredTo, setRegisteredTo] = useState("");
  const [activityFilter, setActivityFilter] = useState("all");
  const [orderFilter, setOrderFilter] = useState("unavailable");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [listError, setListError] = useState("");
  const [summaryError, setSummaryError] = useState("");
  const [toast, setToast] = useState<Toast | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedId, setSelectedId] = useState("");
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerRecord | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  useEffect(() => {
    let active = true;
    if (registeredFrom && registeredTo && registeredFrom > registeredTo) {
      setListError("Registration start date must be on or before the end date.");
      setLoading(false);
      setCustomers([]);
      setTotal(0);
      return () => { active = false; };
    }

    setLoading(true);
    setListError("");
    void getCustomerDirectory({
      page,
      pageSize,
      search,
      registeredFrom: registeredFrom || undefined,
      registeredTo: registeredTo || undefined,
      recentlyUpdated: activityFilter === "updated",
    }).then((result) => {
      if (!active) return;
      setCustomers(result.customers);
      setTotal(result.total);
    }).catch((reason: unknown) => {
      if (!active) return;
      setListError(errorText(reason));
      setCustomers([]);
      setTotal(0);
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [page, search, registeredFrom, registeredTo, activityFilter]);

  useEffect(() => {
    let active = true;
    setSummaryLoading(true);
    void getCustomerSummary(6).then((result) => {
      if (active) setSummary(result);
    }).catch((reason: unknown) => {
      if (active) setSummaryError(errorText(reason));
    }).finally(() => { if (active) setSummaryLoading(false); });
    return () => { active = false; };
  }, []);

  useEffect(() => { setPage(1); }, [search, registeredFrom, registeredTo, activityFilter, orderFilter]);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 5000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  useEffect(() => { if (page > pageCount) setPage(pageCount); }, [page, pageCount]);

  const maxRegistrations = useMemo(() => Math.max(1, ...(summary?.registrations.map((item) => item.registrations) ?? [])), [summary]);

  async function openCustomer(customer: CustomerDirectoryItem) {
    setSelectedId(customer.id);
    setSelectedCustomer(null);
    setDetailLoading(true);
    try {
      setSelectedCustomer(await getCustomerById(customer.id));
    } catch (reason) {
      setToast({ text: errorText(reason), tone: "error" });
      setSelectedId("");
    } finally {
      setDetailLoading(false);
    }
  }

  async function refresh() {
    setRefreshing(true);
    try {
      const [directory, nextSummary] = await Promise.all([
        getCustomerDirectory({
          page,
          pageSize,
          search,
          registeredFrom: registeredFrom || undefined,
          registeredTo: registeredTo || undefined,
          recentlyUpdated: activityFilter === "updated",
        }),
        getCustomerSummary(6),
      ]);
      setCustomers(directory.customers);
      setTotal(directory.total);
      setSummary(nextSummary);
      setListError("");
      setSummaryError("");
      setToast({ text: "Customer data refreshed.", tone: "success" });
    } catch (reason) {
      setToast({ text: errorText(reason), tone: "error" });
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <section className="relative -m-4 min-h-[calc(100vh-8rem)] bg-cream p-4 text-espresso sm:-m-8 sm:p-8">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-brass/40 pb-5">
        <div><p className="text-sm text-espresso/65">People</p><h1 className="mt-1 text-3xl text-white">Customers</h1></div>
        <button type="button" onClick={() => void refresh()} disabled={refreshing} className="inline-flex items-center gap-2 border border-brass/50 px-4 py-2 text-sm text-espresso hover:bg-[#eadbd2] disabled:opacity-50"><RefreshCw size={15} />{refreshing ? "Refreshing..." : "Refresh"}</button>
      </div>

      {(summaryError || listError) && <p role="alert" className="mt-4 border-l-2 border-red-400 pl-3 text-sm text-red-200">{summaryError || listError}</p>}

      <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: "Registered customers", value: summary?.totalCustomers ?? "—", note: "Accounts with the customer role" },
          { label: "New in 30 days", value: summary?.newCustomers30Days ?? "—", note: "Based on profile registration date" },
          { label: "Active account status", value: "Not tracked", note: "No account status or sign-in activity field" },
          { label: "Customers with orders", value: "Unavailable", note: "Order tables are not present in the current schema" },
        ].map((stat, index) => <article key={stat.label} className="border border-brass/40 bg-white p-4"><p className="text-sm text-espresso/65">{stat.label}</p><p className={`mt-3 text-2xl font-semibold ${index < 2 ? "text-white" : "text-espresso/80"}`}>{summaryLoading && index < 2 ? "..." : stat.value}</p><p className="mt-2 text-xs text-espresso/55">{stat.note}</p></article>)}
      </div>

      <section className="mt-8 border border-brass/40 bg-white p-4 sm:p-5">
        <div className="flex items-center justify-between gap-4"><div><h2 className="text-lg font-medium text-white">Registration analytics</h2><p className="mt-1 text-xs text-espresso/65">Customer account registrations by month</p></div><CalendarDays size={18} className="text-walnut" /></div>
        {summaryLoading && <p role="status" className="py-8 text-sm text-espresso/65">Loading registration analytics...</p>}
        {!summaryLoading && summary?.registrations.length === 0 && <p className="py-8 text-sm text-espresso/65">No registration data available.</p>}
        {!summaryLoading && !!summary?.registrations.length && <div className="mt-5 grid grid-cols-3 gap-3 sm:grid-cols-6">{summary.registrations.map((item) => {
          const height = Math.max(4, Math.round((item.registrations / maxRegistrations) * 96));
          const monthLabel = new Intl.DateTimeFormat("en-IN", { month: "short", year: "2-digit" }).format(new Date(`${item.monthStart}T00:00:00`));
          return <div key={item.monthStart} className="flex min-w-0 flex-col items-center gap-2"><div className="flex h-24 w-full items-end justify-center border-b border-brass/40"><div title={`${item.registrations} registrations`} className="w-8 max-w-full bg-walnut" style={{ height: `${height}px` }} /></div><span className="text-xs text-espresso/80">{item.registrations}</span><span className="text-[11px] text-espresso/55">{monthLabel}</span></div>;
        })}</div>}
      </section>

      <section className="mt-9">
        <div className="flex flex-wrap items-end justify-between gap-4"><div><h2 className="text-xl font-medium text-white">Customer directory</h2><p className="mt-1 text-sm text-espresso/65">{total} customer{total === 1 ? "" : "s"}</p></div><p className="max-w-lg text-xs text-espresso/55">Order count and spend will appear when order data is available. Auth account activity is not exposed by the current profile schema.</p></div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(12rem,1fr)_12rem_12rem_12rem_12rem]">
          <label className="relative"><span className="sr-only">Search customer name or email</span><Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-espresso/65" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name or email" className="w-full border border-brass/40 bg-white py-2 pl-9 pr-3 text-sm text-white placeholder:text-espresso/55" /></label>
          <label className="grid gap-1 text-xs text-espresso/65">Registered from<input type="date" value={registeredFrom} onChange={(event) => setRegisteredFrom(event.target.value)} className="border border-brass/40 bg-white px-3 py-2 text-sm text-white" /></label>
          <label className="grid gap-1 text-xs text-espresso/65">Registered to<input type="date" value={registeredTo} onChange={(event) => setRegisteredTo(event.target.value)} className="border border-brass/40 bg-white px-3 py-2 text-sm text-white" /></label>
          <label className="grid gap-1 text-xs text-espresso/65">Profile activity<select value={activityFilter} onChange={(event) => setActivityFilter(event.target.value)} className="border border-brass/40 bg-white px-3 py-2 text-sm text-white"><option value="all">All profile updates</option><option value="updated">Updated in last 30 days</option></select></label>
          <label className="grid gap-1 text-xs text-espresso/65">Order history<select disabled value={orderFilter} onChange={(event) => setOrderFilter(event.target.value)} title="Order filtering will be available when order data exists" className="border border-brass/40 bg-white px-3 py-2 text-sm text-espresso/55"><option value="unavailable">Unavailable until orders module</option></select></label>
        </div>

        {loading && <p role="status" className="py-12 text-center text-sm text-espresso/80">Loading customers...</p>}
        {!loading && !listError && !customers.length && <div className="py-14 text-center"><div className="mx-auto grid h-12 w-12 place-items-center border border-brass/40 bg-white text-espresso/65"><UserRound size={20} /></div><p className="mt-4 text-espresso">No customers match these filters.</p></div>}
        {!loading && customers.length > 0 && <div className="mt-4 overflow-x-auto border-y border-brass/40"><table className="w-full min-w-[72rem] text-left text-sm"><thead className="border-b border-brass/40 text-xs uppercase text-espresso/65"><tr><th className="py-3 pr-4 font-medium">Customer</th><th className="py-3 pr-4 font-medium">Phone</th><th className="py-3 pr-4 font-medium">Registered</th><th className="py-3 pr-4 font-medium">Account status</th><th className="py-3 pr-4 font-medium">Orders</th><th className="py-3 pr-4 font-medium">Total spend</th><th className="py-3 font-medium">Last profile update</th></tr></thead><tbody>{customers.map((customer) => <tr key={customer.id} className="border-b border-brass/30 last:border-0"><td className="py-3 pr-4"><button type="button" onClick={() => void openCustomer(customer)} className="text-left"><span className="block font-medium text-white hover:text-walnut">{customer.full_name || "Unnamed customer"}</span><span className="mt-0.5 block text-xs text-espresso/65">{customer.email}</span></button></td><td className="py-3 pr-4 text-espresso/80">{customer.mobile_number || "—"}</td><td className="py-3 pr-4 whitespace-nowrap text-espresso/80">{formatDate(customer.created_at)}</td><td className="py-3 pr-4 text-espresso/65">Not tracked</td><td className="py-3 pr-4 text-espresso/55">Unavailable</td><td className="py-3 pr-4 text-espresso/55">Unavailable</td><td className="py-3 whitespace-nowrap text-espresso/80">{formatDate(customer.updated_at)}</td></tr>)}</tbody></table></div>}

        {pageCount > 1 && <nav aria-label="Customer pages" className="mt-5 flex items-center justify-center gap-4 text-sm"><button type="button" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={page === 1} aria-label="Previous page" className="border border-brass/50 p-2 text-espresso disabled:opacity-40"><ArrowLeft size={16} /></button><span className="text-espresso/80">Page {page} of {pageCount}</span><button type="button" onClick={() => setPage((current) => Math.min(pageCount, current + 1))} disabled={page === pageCount} aria-label="Next page" className="border border-brass/50 p-2 text-espresso disabled:opacity-40"><ArrowRight size={16} /></button></nav>}
      </section>

      {selectedId && <div className="fixed inset-0 z-50 overflow-y-auto bg-black/70 p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) { setSelectedId(""); setSelectedCustomer(null); } }}>
        <section role="dialog" aria-modal="true" aria-labelledby="customer-detail-title" className="mx-auto my-6 max-w-3xl border border-brass/40 bg-white text-espresso shadow-2xl">
          <div className="flex items-start justify-between gap-4 border-b border-brass/40 p-5 sm:p-7"><div><p className="text-sm text-espresso/65">Customer profile</p><h2 id="customer-detail-title" className="mt-1 text-2xl text-white">{selectedCustomer?.full_name || "Customer details"}</h2></div><button type="button" onClick={() => { setSelectedId(""); setSelectedCustomer(null); }} aria-label="Close customer details" className="p-2 text-espresso/80 hover:bg-[#eadbd2]"><X size={19} /></button></div>
          {detailLoading && <p role="status" className="p-8 text-center text-sm text-espresso/65">Loading customer details...</p>}
          {selectedCustomer && <div className="grid gap-6 p-5 sm:p-7">
            <div className="flex flex-wrap items-center gap-4"><div className="grid h-16 w-16 place-items-center border border-brass/50 bg-cream text-xl text-walnut">{initials(selectedCustomer.full_name)}</div><div><h3 className="text-lg font-medium text-white">{selectedCustomer.full_name || "Unnamed customer"}</h3><p className="mt-1 text-sm text-espresso/65">No profile photo stored</p></div><span className="ml-auto border border-brass/50 px-2.5 py-1 text-xs text-espresso/80">Account status not tracked</span></div>
            <div className="grid gap-4 border-y border-brass/40 py-5 sm:grid-cols-2"><div className="flex items-start gap-3 text-sm"><Mail size={16} className="mt-0.5 shrink-0 text-walnut" /><div><p className="text-xs text-espresso/55">Email</p><a href={`mailto:${selectedCustomer.email}`} className="break-all text-espresso hover:text-walnut">{selectedCustomer.email || "Not provided"}</a></div></div><div className="flex items-start gap-3 text-sm"><Phone size={16} className="mt-0.5 shrink-0 text-walnut" /><div><p className="text-xs text-espresso/55">Phone</p><p className="text-espresso">{selectedCustomer.mobile_number || "Not provided"}</p></div></div><div className="flex items-start gap-3 text-sm sm:col-span-2"><MapPin size={16} className="mt-0.5 shrink-0 text-walnut" /><div><p className="text-xs text-espresso/55">Saved profile address</p><p className="text-espresso">{addressText(selectedCustomer) || "No address saved"}</p></div></div><div className="text-sm"><p className="text-xs text-espresso/55">Registered</p><p className="mt-1 text-espresso">{formatDate(selectedCustomer.created_at)}</p></div><div className="text-sm"><p className="text-xs text-espresso/55">Profile last updated</p><p className="mt-1 text-espresso">{formatDate(selectedCustomer.updated_at)}</p></div></div>
            <div><h3 className="font-medium text-white">Recent profile activity</h3><ul className="mt-3 space-y-2 border-l border-brass/50 pl-4 text-sm text-espresso/80"><li>Customer profile created · {formatDate(selectedCustomer.created_at)}</li>{selectedCustomer.updated_at !== selectedCustomer.created_at && <li>Profile information last updated · {formatDate(selectedCustomer.updated_at)}</li>}</ul></div>
            <div className="border border-brass/40 bg-cream p-4"><h3 className="font-medium text-white">Order history</h3><p className="mt-2 text-sm text-espresso/65">Order tables are not present in the current database schema. Order IDs, statuses, totals, and purchase history are not available yet.</p></div>
            <div className="grid gap-3 sm:grid-cols-2"><div className="border border-brass/40 p-4"><p className="text-xs text-espresso/55">Total orders</p><p className="mt-2 text-lg text-espresso/80">Unavailable</p></div><div className="border border-brass/40 p-4"><p className="text-xs text-espresso/55">Total purchase value</p><p className="mt-2 text-lg text-espresso/80">Unavailable</p></div></div>
          </div>}
        </section>
      </div>}

      {toast && <div role="status" aria-live="polite" className={`fixed bottom-5 right-5 z-[60] max-w-sm border px-4 py-3 text-sm shadow-xl ${toast.tone === "success" ? "border-emerald-700 bg-[#0d2b2a] text-emerald-100" : toast.tone === "warning" ? "border-amber-700 bg-[#382a10] text-amber-100" : "border-red-800 bg-[#3a1720] text-red-100"}`}>{toast.text}</div>}
    </section>
  );
}
