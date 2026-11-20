import { useEffect, useMemo, useState } from "react";
import { BarChart3, Boxes, CircleDollarSign, ClipboardList, Package, RefreshCw, ShoppingCart, Tags, TrendingUp, Users } from "lucide-react";
import { Link } from "react-router-dom";
import { formatINR } from "../../utils/currency";
import { dashboardStatusLabel, getAdminDashboardAnalytics, getAdminDashboardRecentActivity, type AdminDashboardData, type AdminDashboardRecentActivity } from "../../services/dashboard";

function formatMonth(monthStart: string) {
  return new Intl.DateTimeFormat("en-IN", { month: "short", year: "2-digit" }).format(new Date(`${monthStart}T00:00:00`));
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-IN", { dateStyle: "medium" }).format(new Date(value));
}

function errorText(reason: unknown) {
  return reason instanceof Error ? reason.message : "Unable to load dashboard analytics.";
}

function SkeletonCard() {
  return <div className="animate-pulse border border-brass/40 bg-white p-4"><div className="h-3 w-24 bg-[#ddc9bd]" /><div className="mt-4 h-7 w-32 bg-[#ddc9bd]" /><div className="mt-3 h-3 w-40 bg-[#eadbd2]" /></div>;
}

function BarList({ items, valueLabel, formatValue }: { items: { label: string; value: number; detail?: string }[]; valueLabel: string; formatValue: (value: number) => string }) {
  const max = Math.max(1, ...items.map((item) => item.value));
  if (!items.length || items.every((item) => item.value === 0)) return <p className="py-8 text-sm text-espresso/65">No data for this period.</p>;
  return <div className="space-y-4">{items.map((item) => <div key={item.label}><div className="mb-1.5 flex items-center justify-between gap-3 text-sm"><span className="truncate text-espresso">{item.label}</span><span className="shrink-0 text-espresso/65" aria-label={`${valueLabel}: ${formatValue(item.value)}`}>{formatValue(item.value)}</span></div><div className="h-2 overflow-hidden bg-[#eadbd2]"><div className="h-full bg-walnut" style={{ width: `${Math.max(2, (item.value / max) * 100)}%` }} /></div>{item.detail && <p className="mt-1 text-xs text-espresso/55">{item.detail}</p>}</div>)}</div>;
}

function RevenueChart({ data }: { data: AdminDashboardData["revenueTrend"] }) {
  const maxRevenue = Math.max(1, ...data.map((point) => point.value));
  if (!data.length || data.every((point) => point.value === 0)) return <p className="py-8 text-sm text-espresso/65">No verified revenue in the selected period.</p>;
  return <div className="grid grid-cols-3 gap-3 sm:grid-cols-6 lg:grid-cols-12" role="img" aria-label="Verified revenue by month">
    {data.map((point) => <div key={point.monthStart} className="flex min-w-0 flex-col items-center gap-2"><div className="flex h-32 w-full items-end justify-center border-b border-brass/40"><div title={`${formatINR(point.value)} verified revenue`} className="w-7 max-w-full bg-walnut" style={{ height: `${Math.max(3, (point.value / maxRevenue) * 120)}px` }} /></div><span className="max-w-full truncate text-[11px] text-espresso/80">{formatINR(point.value)}</span><span className="text-[11px] text-espresso/55">{formatMonth(point.monthStart)}</span></div>)}
  </div>;
}

function MetricCard({ label, value, note, icon: Icon, tone }: { label: string; value: string | number; note: string; icon: typeof CircleDollarSign; tone: string }) {
  return <article className="border border-brass/40 bg-white p-4"><div className="flex items-center justify-between gap-3"><p className="text-sm text-espresso/65">{label}</p><Icon size={17} className={tone} /></div><p className="mt-3 text-2xl font-semibold text-walnut">{value}</p><p className="mt-2 text-xs text-espresso/55">{note}</p></article>;
}

export default function Dashboard() {
  const [data, setData] = useState<AdminDashboardData | null>(null);
  const [recent, setRecent] = useState<AdminDashboardRecentActivity | null>(null);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [refreshVersion, setRefreshVersion] = useState(0);

  useEffect(() => {
    let active = true;
    if (fromDate && toDate && fromDate > toDate) {
      setError("Start date must be on or before end date.");
      setData(null);
      setRecent(null);
      setLoading(false);
      setRefreshing(false);
      return () => { active = false; };
    }
    setLoading(true);
    setError("");
    void Promise.all([getAdminDashboardAnalytics(fromDate || undefined, toDate || undefined), getAdminDashboardRecentActivity()])
      .then(([analytics, activity]) => {
        if (!active) return;
        setData(analytics);
        setRecent(activity);
      }).catch((reason: unknown) => {
        if (active) {
          setData(null);
          setRecent(null);
          setError(errorText(reason));
        }
      }).finally(() => { if (active) { setLoading(false); setRefreshing(false); } });
    return () => { active = false; };
  }, [fromDate, toDate, refreshVersion]);

  const metricCards = useMemo(() => {
    if (!data) return [];
    const metrics = data.metrics;
    return [
      { label: "Verified revenue", value: formatINR(metrics.verifiedRevenue), note: "Paid, verified transactions; excludes cancelled/refunded", icon: CircleDollarSign, tone: "text-emerald-300" },
      { label: "Total orders", value: metrics.totalOrders, note: `${metrics.paidOrderCount} orders with verified payments`, icon: ClipboardList, tone: "text-walnut" },
      { label: "Average order value", value: formatINR(metrics.averageOrderValue), note: "Average of verified paid orders", icon: TrendingUp, tone: "text-walnut" },
      { label: "Customers", value: metrics.totalCustomers, note: "Accounts assigned the customer role", icon: Users, tone: "text-walnut" },
      { label: "Products", value: metrics.totalProducts, note: "All catalog products", icon: Package, tone: "text-walnut" },
      { label: "Pending orders", value: metrics.pendingOrders, note: "Awaiting confirmation", icon: ShoppingCart, tone: "text-amber-300" },
      { label: "Delivered orders", value: metrics.deliveredOrders, note: "Marked delivered", icon: Boxes, tone: "text-emerald-300" },
      { label: "Stock alerts", value: metrics.lowStockProducts + metrics.outOfStockProducts, note: `${metrics.lowStockProducts} low stock · ${metrics.outOfStockProducts} out of stock`, icon: Tags, tone: "text-red-300" },
    ];
  }, [data]);

  async function refresh() {
    setRefreshing(true);
    setRefreshVersion((version) => version + 1);
  }

  const orderStatusRows = data?.orderStatuses.map((item) => ({ label: dashboardStatusLabel(item.status), value: item.count })) ?? [];
  const paymentStatusRows = data?.paymentStatuses.map((item) => ({ label: item.status.replace(/_/g, " "), value: item.count })) ?? [];
  const paymentMethodRows = data?.paymentMethods.map((item) => ({ label: item.method.toUpperCase(), value: item.count })) ?? [];
  const bestProductRows = data?.bestSellingProducts.map((item) => ({ label: item.name, value: item.unitsSold, detail: `${item.sku} · ${formatINR(item.sales)} sales` })) ?? [];
  const categoryRows = data?.categoryPerformance.map((item) => ({ label: item.name, value: item.sales, detail: `${item.unitsSold} units sold` })) ?? [];

  return (
    <section className="relative -m-4 min-h-[calc(100vh-8rem)] bg-cream p-4 text-espresso sm:-m-8 sm:p-8">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-brass/40 pb-5">
        <div><p className="text-sm text-espresso/65">Overview</p><h1 className="mt-1 text-3xl text-walnut">Dashboard</h1></div>
        <div className="flex flex-wrap items-end gap-2"><label className="grid gap-1 text-xs text-espresso/65">From<input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} className="border border-brass/40 bg-white px-3 py-2 text-sm text-walnut" /></label><label className="grid gap-1 text-xs text-espresso/65">To<input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} className="border border-brass/40 bg-white px-3 py-2 text-sm text-walnut" /></label><button type="button" onClick={refresh} disabled={refreshing} className="inline-flex items-center gap-2 border border-brass/50 px-4 py-2 text-sm text-espresso hover:bg-[#eadbd2] disabled:opacity-50"><RefreshCw size={15} />{refreshing ? "Refreshing..." : "Refresh"}</button></div>
      </div>

      {error && <div role="alert" className="mt-5 border border-red-800 bg-red-950/30 p-4 text-sm text-red-200"><p>{error}</p><p className="mt-2 text-xs text-red-200/80">Verify that the order, inventory and customer migrations are applied and that this account has the super_admin role.</p></div>}

      <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {loading && !data ? Array.from({ length: 8 }, (_, index) => <SkeletonCard key={index} />) : metricCards.map((card) => <MetricCard key={card.label} {...card} />)}
      </div>

      <section className="mt-6 border border-brass/40 bg-white p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-medium text-walnut">Verified revenue trend</h2><p className="mt-1 text-xs text-espresso/65">Monthly totals by payment verification date. Date filters apply to verification dates.</p></div><BarChart3 size={18} className="text-walnut" /></div>
        {loading && !data ? <div className="mt-5 h-36 animate-pulse bg-[#eadbd2]" /> : data ? <div className="mt-5"><RevenueChart data={data.revenueTrend} /></div> : <p className="py-8 text-sm text-espresso/65">Analytics unavailable.</p>}
      </section>

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <section className="border border-brass/40 bg-white p-4 sm:p-5"><h2 className="text-lg font-medium text-walnut">Order status distribution</h2><p className="mt-1 text-xs text-espresso/65">Orders created within the selected period</p><div className="mt-5">{loading && !data ? <div className="h-40 animate-pulse bg-[#eadbd2]" /> : <BarList items={orderStatusRows} valueLabel="orders" formatValue={(value) => String(value)} />}</div></section>
        <section className="border border-brass/40 bg-white p-4 sm:p-5"><h2 className="text-lg font-medium text-walnut">Customer registrations</h2><p className="mt-1 text-xs text-espresso/65">Monthly profiles assigned the customer role</p><div className="mt-5">{loading && !data ? <div className="h-40 animate-pulse bg-[#eadbd2]" /> : <BarList items={data?.customerTrend.map((point) => ({ label: formatMonth(point.monthStart), value: point.value })) ?? []} valueLabel="registrations" formatValue={(value) => String(value)} />}</div></section>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <section className="border border-brass/40 bg-white p-4 sm:p-5"><h2 className="text-lg font-medium text-walnut">Best-selling products</h2><p className="mt-1 text-xs text-espresso/65">Confirmed-through-delivered units, less received returns</p><div className="mt-5"><BarList items={bestProductRows} valueLabel="units sold" formatValue={(value) => String(value)} /></div></section>
        <section className="border border-brass/40 bg-white p-4 sm:p-5"><h2 className="text-lg font-medium text-walnut">Category performance</h2><p className="mt-1 text-xs text-espresso/65">Sales value grouped by the product’s current category</p><div className="mt-5"><BarList items={categoryRows} valueLabel="sales" formatValue={formatINR} /></div></section>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <section className="border border-brass/40 bg-white p-4 sm:p-5"><h2 className="text-lg font-medium text-walnut">Payment status</h2><div className="mt-5"><BarList items={paymentStatusRows} valueLabel="payments" formatValue={(value) => String(value)} /></div></section>
        <section className="border border-brass/40 bg-white p-4 sm:p-5"><h2 className="text-lg font-medium text-walnut">Payment methods</h2><div className="mt-5"><BarList items={paymentMethodRows} valueLabel="payments" formatValue={(value) => String(value)} /></div></section>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <section className="border border-brass/40 bg-white p-4 sm:p-5"><div className="flex items-center justify-between gap-3"><div><h2 className="text-lg font-medium text-walnut">Recent orders</h2><p className="mt-1 text-xs text-espresso/65">Latest actual order records</p></div><Link to="/admin/orders" className="text-xs text-walnut hover:underline">All orders</Link></div>{loading && !recent ? <div className="mt-4 h-36 animate-pulse bg-[#eadbd2]" /> : recent?.orders.length ? <div className="mt-4 divide-y divide-slate-800">{recent.orders.map((order) => <Link key={order.id} to="/admin/orders" className="flex items-center justify-between gap-3 py-3"><span className="min-w-0"><span className="block truncate text-sm font-medium text-walnut">{order.order_number}</span><span className="mt-0.5 block truncate text-xs text-espresso/65">{order.customer_name} · {formatDate(order.created_at)}</span></span><span className="shrink-0 text-right"><span className="block text-sm text-espresso">{formatINR(Number(order.total_inr))}</span><span className="text-xs text-espresso/65">{dashboardStatusLabel(order.order_status)}</span></span></Link>)}</div> : <p className="py-8 text-sm text-espresso/65">No orders available.</p>}</section>
        <section className="border border-brass/40 bg-white p-4 sm:p-5"><div className="flex items-center justify-between gap-3"><div><h2 className="text-lg font-medium text-walnut">Inventory activity</h2><p className="mt-1 text-xs text-espresso/65">Latest stock movements</p></div><Link to="/admin/inventory" className="text-xs text-walnut hover:underline">Inventory</Link></div>{loading && !recent ? <div className="mt-4 h-36 animate-pulse bg-[#eadbd2]" /> : recent?.inventory.length ? <div className="mt-4 divide-y divide-slate-800">{recent.inventory.map((movement) => <div key={movement.id} className="flex items-start justify-between gap-3 py-3"><span className="min-w-0"><span className="block truncate text-sm text-walnut">{movement.productName}</span><span className="mt-0.5 block text-xs text-espresso/65">{movement.reason} · {formatDate(movement.created_at)}</span></span><span className="shrink-0 text-sm text-espresso">{movement.movement_type === "in" ? "+" : movement.movement_type === "out" ? "−" : "±"}{movement.quantity}</span></div>)}</div> : <p className="py-8 text-sm text-espresso/65">No stock movements available.</p>}</section>
      </div>
    </section>
  );
}
