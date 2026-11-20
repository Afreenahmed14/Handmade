import { useEffect, useMemo, useState, type FormEvent } from "react";
import { ArrowLeft, ArrowRight, Pencil, Plus, RefreshCw, Search, TicketPercent, Trash2, X } from "lucide-react";
import { formatINR } from "../../utils/currency";
import { deleteCoupon, getCouponApplicability, getCouponTargets, getCoupons, saveCoupon, type CouponListResult, type CouponSaveInput, type CouponStatusFilter } from "../../services/coupons";
import { supabase } from "../../lib/supabase";
import type { Category, Product } from "../../types";
import type { DbCouponDirectoryRow, CouponDiscountType } from "../../types/database";

const pageSize = 20;
type Toast = { text: string; tone: "success" | "warning" | "error" };
interface CouponForm {
  code: string;
  description: string;
  discountType: CouponDiscountType;
  discountValue: string;
  minimumOrderAmount: string;
  maximumDiscountAmount: string;
  startsAt: string;
  expiresAt: string;
  maxTotalUses: string;
  maxUsesPerCustomer: string;
  isActive: boolean;
  productIds: string[];
  categoryIds: string[];
}

const emptyForm: CouponForm = {
  code: "", description: "", discountType: "percentage", discountValue: "", minimumOrderAmount: "0",
  maximumDiscountAmount: "", startsAt: "", expiresAt: "", maxTotalUses: "", maxUsesPerCustomer: "1",
  isActive: true, productIds: [], categoryIds: [],
};

function localDateTime(value: string) {
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

function errorText(reason: unknown) {
  return reason instanceof Error ? reason.message : "The coupon request could not be completed.";
}

function couponStatus(coupon: DbCouponDirectoryRow, now: number) {
  if (!coupon.is_active) return { label: "Inactive", tone: "border-brass/50 bg-white text-espresso/80" };
  if (new Date(coupon.expires_at).getTime() <= now) return { label: "Expired", tone: "border-red-800 bg-red-950/40 text-red-200" };
  if (new Date(coupon.starts_at).getTime() > now) return { label: "Scheduled", tone: "border-indigo-800 bg-indigo-950/40 text-indigo-200" };
  return { label: "Active", tone: "border-emerald-800 bg-emerald-950/40 text-emerald-200" };
}

function formFromCoupon(coupon: DbCouponDirectoryRow): CouponForm {
  return {
    code: coupon.code, description: coupon.description ?? "", discountType: coupon.discount_type,
    discountValue: String(coupon.discount_value), minimumOrderAmount: String(coupon.minimum_order_amount_inr),
    maximumDiscountAmount: coupon.maximum_discount_amount_inr === null ? "" : String(coupon.maximum_discount_amount_inr),
    startsAt: localDateTime(coupon.starts_at), expiresAt: localDateTime(coupon.expires_at),
    maxTotalUses: coupon.max_total_uses === null ? "" : String(coupon.max_total_uses),
    maxUsesPerCustomer: String(coupon.max_uses_per_customer), isActive: coupon.is_active,
    productIds: [], categoryIds: [],
  };
}

export default function Coupons() {
  const [coupons, setCoupons] = useState<DbCouponDirectoryRow[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<CouponStatusFilter>("all");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [listError, setListError] = useState("");
  const [formError, setFormError] = useState("");
  const [toast, setToast] = useState<Toast | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<DbCouponDirectoryRow | null>(null);
  const [form, setForm] = useState<CouponForm>(emptyForm);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [changingStatusId, setChangingStatusId] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true);
    setListError("");
    void getCoupons({ page, pageSize, search, status: statusFilter }).then((result: CouponListResult) => {
      if (!active) return;
      setCoupons(result.coupons);
      setTotal(result.total);
    }).catch((reason: unknown) => {
      if (!active) return;
      setListError(errorText(reason));
      setCoupons([]);
      setTotal(0);
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [page, search, statusFilter, refreshVersion]);

  useEffect(() => {
    let active = true;
    void getCouponTargets().then((targets) => {
      if (active) { setProducts(targets.products); setCategories(targets.categories); }
    }).catch((reason: unknown) => {
      if (active) setListError(errorText(reason));
    });
    return () => { active = false; };
  }, []);

  useEffect(() => { setPage(1); }, [search, statusFilter]);
  useEffect(() => { if (!toast) return; const timer = window.setTimeout(() => setToast(null), 6000); return () => window.clearTimeout(timer); }, [toast]);

  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  useEffect(() => { if (page > pageCount) setPage(pageCount); }, [page, pageCount]);
  const now = Date.now();
  const stats = useMemo(() => ({
    active: coupons.filter((coupon) => couponStatus(coupon, now).label === "Active").length,
    scheduled: coupons.filter((coupon) => couponStatus(coupon, now).label === "Scheduled").length,
    expiring: coupons.filter((coupon) => coupon.is_active && new Date(coupon.expires_at).getTime() > now && new Date(coupon.expires_at).getTime() <= now + 7 * 86400000).length,
  }), [coupons, now]);

  async function reload() {
    const result = await getCoupons({ page, pageSize, search, status: statusFilter });
    setCoupons(result.coupons);
    setTotal(result.total);
    setListError("");
  }

  function startCreate() {
    setEditing(null);
    setForm({ ...emptyForm, startsAt: localDateTime(new Date().toISOString()), expiresAt: localDateTime(new Date(Date.now() + 30 * 86400000).toISOString()) });
    setFormError("");
    setFormOpen(true);
  }

  async function startEdit(coupon: DbCouponDirectoryRow) {
    setEditing(coupon);
    setForm(formFromCoupon(coupon));
    setFormError("");
    setFormOpen(true);
    try {
      const applicability = await getCouponApplicability(coupon.id);
      setForm((current) => ({ ...current, productIds: applicability.productIds, categoryIds: applicability.categoryIds }));
    } catch (reason) {
      setFormError(errorText(reason));
    }
  }

  function closeForm() {
    if (!saving) setFormOpen(false);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError("");
    const discount = Number(form.discountValue);
    const minimum = Number(form.minimumOrderAmount);
    const maxDiscount = form.maximumDiscountAmount.trim() ? Number(form.maximumDiscountAmount) : null;
    const maxUses = form.maxTotalUses.trim() ? Number(form.maxTotalUses) : null;
    const perCustomer = Number(form.maxUsesPerCustomer);
    if (!form.startsAt || !form.expiresAt) return setFormError("Set both start and expiry dates.");
    if (form.discountType === "percentage" && (!Number.isFinite(discount) || discount <= 0 || discount > 100)) return setFormError("Percentage discount must be greater than 0 and no more than 100.");
    if (form.discountType === "fixed" && (!Number.isFinite(discount) || discount <= 0)) return setFormError("Fixed discount must be greater than zero.");
    if (!Number.isFinite(minimum) || minimum < 0) return setFormError("Minimum order amount must be non-negative.");
    if (maxDiscount !== null && (!Number.isFinite(maxDiscount) || maxDiscount <= 0 || form.discountType !== "percentage")) return setFormError("Maximum discount is only valid for percentage coupons and must be positive.");
    if (maxUses !== null && (!Number.isSafeInteger(maxUses) || maxUses <= 0)) return setFormError("Maximum total uses must be a positive whole number or unlimited.");
    if (!Number.isSafeInteger(perCustomer) || perCustomer <= 0) return setFormError("Maximum uses per customer must be a positive whole number.");

    const input: CouponSaveInput = {
      id: editing?.id, code: form.code, description: form.description, discountType: form.discountType,
      discountValue: discount, minimumOrderAmount: minimum, maximumDiscountAmount: maxDiscount,
      startsAt: form.startsAt, expiresAt: form.expiresAt, maxTotalUses: maxUses,
      maxUsesPerCustomer: perCustomer, isActive: form.isActive,
      productIds: form.productIds, categoryIds: form.categoryIds,
    };
    setSaving(true);
    try {
      await saveCoupon(input);
      await reload();
      setFormOpen(false);
      setToast({ text: "Coupon saved.", tone: "success" });
    } catch (reason) {
      setFormError(errorText(reason));
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(coupon: DbCouponDirectoryRow) {
    setChangingStatusId(coupon.id);
    try {
      const applicability = await getCouponApplicability(coupon.id);
      await saveCoupon({
        id: coupon.id, code: coupon.code, description: coupon.description ?? "", discountType: coupon.discount_type,
        discountValue: Number(coupon.discount_value), minimumOrderAmount: Number(coupon.minimum_order_amount_inr),
        maximumDiscountAmount: coupon.maximum_discount_amount_inr === null ? null : Number(coupon.maximum_discount_amount_inr),
        startsAt: coupon.starts_at, expiresAt: coupon.expires_at, maxTotalUses: coupon.max_total_uses,
        maxUsesPerCustomer: coupon.max_uses_per_customer, isActive: !coupon.is_active,
        productIds: applicability.productIds, categoryIds: applicability.categoryIds,
      });
      await reload();
      setToast({ text: `Coupon ${coupon.is_active ? "deactivated" : "activated"}.`, tone: "success" });
    } catch (reason) {
      setToast({ text: errorText(reason), tone: "error" });
    } finally {
      setChangingStatusId("");
    }
  }

  async function removeCoupon(coupon: DbCouponDirectoryRow) {
    if (coupon.total_redemption_count > 0) {
      setToast({ text: "This coupon has redemption history and cannot be deleted. Deactivate it instead.", tone: "warning" });
      return;
    }
    if (!window.confirm(`Delete coupon ${coupon.code}? This cannot be undone.`)) return;
    try {
      await deleteCoupon(coupon.id);
      await reload();
      setToast({ text: "Coupon deleted.", tone: "success" });
    } catch (reason) {
      setToast({ text: errorText(reason), tone: "error" });
    }
  }

  return (
    <section className="relative -m-4 min-h-[calc(100vh-8rem)] bg-cream p-4 text-espresso sm:-m-8 sm:p-8">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-brass/40 pb-5"><div><p className="text-sm text-espresso/65">Marketing</p><h1 className="mt-1 text-3xl text-white">Coupons & promotions</h1></div><div className="flex gap-2"><button type="button" onClick={() => setRefreshVersion((version) => version + 1)} className="inline-flex items-center gap-2 border border-brass/50 px-4 py-2 text-sm text-espresso hover:bg-[#eadbd2]"><RefreshCw size={15} />Refresh</button><button type="button" onClick={startCreate} className="inline-flex items-center gap-2 bg-walnut px-4 py-2 text-sm font-medium text-white hover:bg-[#4c173b]"><Plus size={16} />Create coupon</button></div></div>

      <div className="mt-6 grid gap-3 sm:grid-cols-3"><StatCard label="Total coupons" value={total} /><StatCard label="Active on current page" value={stats.active} /><StatCard label="Scheduled / expiring soon" value={`${stats.scheduled} / ${stats.expiring}`} /></div>

      {listError && <p role="alert" className="mt-4 border-l-2 border-red-400 pl-3 text-sm text-red-200">{listError}</p>}
      <div className="mt-6 grid gap-3 sm:grid-cols-[minmax(12rem,1fr)_14rem]"><label className="relative"><span className="sr-only">Search coupon code</span><Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-espresso/65" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search coupon code" className="w-full border border-brass/40 bg-white py-2 pl-9 pr-3 text-sm text-white placeholder:text-espresso/55" /></label><label><span className="sr-only">Filter coupon status</span><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as CouponStatusFilter)} className="w-full border border-brass/40 bg-white px-3 py-2 text-sm text-white"><option value="all">All statuses</option><option value="active">Active</option><option value="inactive">Inactive</option><option value="expired">Expired</option><option value="scheduled">Scheduled</option></select></label></div>

      {loading && <p role="status" className="py-12 text-center text-sm text-espresso/80">Loading coupons...</p>}
      {!loading && !listError && !coupons.length && <div className="py-14 text-center"><div className="mx-auto grid h-12 w-12 place-items-center border border-brass/40 bg-white text-espresso/65"><TicketPercent size={20} /></div><p className="mt-4 text-espresso">No coupons match these filters.</p>{!total && <button type="button" onClick={startCreate} className="mt-4 border border-walnut px-4 py-2 text-sm text-walnut hover:bg-[#f7edf2]">Create your first coupon</button>}</div>}
      {!loading && coupons.length > 0 && <div className="mt-4 overflow-x-auto border-y border-brass/40"><table className="w-full min-w-[68rem] text-left text-sm"><thead className="border-b border-brass/40 text-xs uppercase text-espresso/65"><tr><th className="py-3 pr-4">Coupon</th><th className="py-3 pr-4">Discount</th><th className="py-3 pr-4">Status</th><th className="py-3 pr-4">Usage</th><th className="py-3 pr-4">Starts</th><th className="py-3 pr-4">Expires</th><th className="py-3">Actions</th></tr></thead><tbody>{coupons.map((coupon) => {
        const status = couponStatus(coupon, now);
        return <tr key={coupon.id} className="border-b border-brass/30 last:border-0"><td className="py-3 pr-4"><p className="font-semibold tracking-wide text-white">{coupon.code}</p><p className="mt-0.5 max-w-xs truncate text-xs text-espresso/65">{coupon.description || "No description"}</p></td><td className="py-3 pr-4 text-espresso">{coupon.discount_type === "percentage" ? `${Number(coupon.discount_value)}%` : formatINR(Number(coupon.discount_value))}<span className="block text-xs text-espresso/55">Min. {formatINR(Number(coupon.minimum_order_amount_inr))}</span></td><td className="py-3 pr-4"><span className={`inline-flex border px-2 py-1 text-xs ${status.tone}`}>{status.label}</span></td><td className="py-3 pr-4 text-espresso/80">{coupon.active_usage_count}{coupon.max_total_uses === null ? " / unlimited" : ` / ${coupon.max_total_uses}`}<span className="block text-xs text-espresso/55">{coupon.remaining_uses === null ? "Unlimited remaining" : `${coupon.remaining_uses} remaining`} · {coupon.max_uses_per_customer}/customer</span></td><td className="py-3 pr-4 whitespace-nowrap text-xs text-espresso/80">{new Date(coupon.starts_at).toLocaleString()}</td><td className="py-3 pr-4 whitespace-nowrap text-xs text-espresso/80">{new Date(coupon.expires_at).toLocaleString()}</td><td className="py-3"><div className="flex gap-1"><button type="button" onClick={() => void startEdit(coupon)} aria-label={`Edit ${coupon.code}`} className="border border-brass/50 p-2 text-espresso hover:bg-[#eadbd2]"><Pencil size={15} /></button><button type="button" onClick={() => void toggleActive(coupon)} disabled={changingStatusId === coupon.id} className="border border-brass/50 px-2 py-1 text-xs text-espresso hover:bg-[#eadbd2] disabled:opacity-50">{coupon.is_active ? "Deactivate" : "Activate"}</button><button type="button" onClick={() => void removeCoupon(coupon)} disabled={coupon.total_redemption_count > 0} title={coupon.total_redemption_count > 0 ? "Coupons with redemption history cannot be deleted" : "Delete coupon"} aria-label={`Delete ${coupon.code}`} className="border border-red-900 p-2 text-red-300 hover:bg-red-950 disabled:cursor-not-allowed disabled:opacity-40"><Trash2 size={15} /></button></div></td></tr>;
      })}</tbody></table></div>}

      {pageCount > 1 && <nav aria-label="Coupon pages" className="mt-5 flex items-center justify-center gap-4 text-sm"><button type="button" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={page === 1} aria-label="Previous page" className="border border-brass/50 p-2 text-espresso disabled:opacity-40"><ArrowLeft size={16} /></button><span className="text-espresso/80">Page {page} of {pageCount}</span><button type="button" onClick={() => setPage((current) => Math.min(pageCount, current + 1))} disabled={page === pageCount} aria-label="Next page" className="border border-brass/50 p-2 text-espresso disabled:opacity-40"><ArrowRight size={16} /></button></nav>}

      {formOpen && <div className="fixed inset-0 z-50 overflow-y-auto bg-black/70 p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) setFormOpen(false); }}><section role="dialog" aria-modal="true" aria-labelledby="coupon-form-title" className="mx-auto my-6 max-w-3xl border border-brass/40 bg-white p-5 text-espresso shadow-2xl sm:p-7"><div className="flex items-start justify-between gap-4 border-b border-brass/40 pb-4"><div><p className="text-sm text-espresso/65">Promotions</p><h2 id="coupon-form-title" className="mt-1 text-2xl text-white">{editing ? "Edit coupon" : "Create coupon"}</h2></div><button type="button" onClick={closeForm} disabled={saving} aria-label="Close coupon form" className="p-2 text-espresso/80 hover:bg-[#eadbd2]"><X size={19} /></button></div>
        <form onSubmit={submit} className="mt-5 grid gap-4 sm:grid-cols-2"><label className="grid gap-1.5 text-sm">Coupon code<input required maxLength={40} pattern="[A-Za-z0-9][A-Za-z0-9_-]*" value={form.code} onChange={(event) => setForm((current) => ({ ...current, code: event.target.value.toUpperCase().replace(/\s/g, "") }))} className="border border-brass/50 bg-cream px-3 py-2 font-mono uppercase text-white" /></label><label className="grid gap-1.5 text-sm">Discount type<select value={form.discountType} onChange={(event) => setForm((current) => ({ ...current, discountType: event.target.value as CouponDiscountType, maximumDiscountAmount: event.target.value === "fixed" ? "" : current.maximumDiscountAmount }))} className="border border-brass/50 bg-cream px-3 py-2 text-white"><option value="percentage">Percentage</option><option value="fixed">Fixed amount (INR)</option></select></label><label className="grid gap-1.5 text-sm">Discount value<input required type="number" min="0.01" max={form.discountType === "percentage" ? 100 : undefined} step="0.01" value={form.discountValue} onChange={(event) => setForm((current) => ({ ...current, discountValue: event.target.value }))} className="border border-brass/50 bg-cream px-3 py-2 text-white" /></label><label className="grid gap-1.5 text-sm">Minimum order (INR)<input required type="number" min="0" step="0.01" value={form.minimumOrderAmount} onChange={(event) => setForm((current) => ({ ...current, minimumOrderAmount: event.target.value }))} className="border border-brass/50 bg-cream px-3 py-2 text-white" /></label>{form.discountType === "percentage" && <label className="grid gap-1.5 text-sm">Maximum discount (INR, optional)<input type="number" min="0.01" step="0.01" value={form.maximumDiscountAmount} onChange={(event) => setForm((current) => ({ ...current, maximumDiscountAmount: event.target.value }))} className="border border-brass/50 bg-cream px-3 py-2 text-white" /></label>}<label className="grid gap-1.5 text-sm">Maximum total uses (blank = unlimited)<input type="number" min="1" step="1" value={form.maxTotalUses} onChange={(event) => setForm((current) => ({ ...current, maxTotalUses: event.target.value }))} className="border border-brass/50 bg-cream px-3 py-2 text-white" /></label><label className="grid gap-1.5 text-sm">Uses per customer<input required type="number" min="1" step="1" value={form.maxUsesPerCustomer} onChange={(event) => setForm((current) => ({ ...current, maxUsesPerCustomer: event.target.value }))} className="border border-brass/50 bg-cream px-3 py-2 text-white" /></label><label className="grid gap-1.5 text-sm">Starts at<input required type="datetime-local" value={form.startsAt} onChange={(event) => setForm((current) => ({ ...current, startsAt: event.target.value }))} className="border border-brass/50 bg-cream px-3 py-2 text-white" /></label><label className="grid gap-1.5 text-sm">Expires at<input required type="datetime-local" value={form.expiresAt} onChange={(event) => setForm((current) => ({ ...current, expiresAt: event.target.value }))} className="border border-brass/50 bg-cream px-3 py-2 text-white" /></label><label className="grid gap-1.5 text-sm sm:col-span-2">Description<textarea maxLength={500} rows={2} value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} className="resize-y border border-brass/50 bg-cream px-3 py-2 text-white" /></label>
          <label className="grid gap-1.5 text-sm sm:col-span-2">Applicable products (empty means all products)<select multiple value={form.productIds} onChange={(event) => setForm((current) => ({ ...current, productIds: Array.from(event.target.selectedOptions, (option) => option.value) }))} className="min-h-28 border border-brass/50 bg-cream px-3 py-2 text-white">{products.map((product) => <option key={product.id} value={product.id}>{product.name} · {product.sku}</option>)}</select></label>
          <label className="grid gap-1.5 text-sm sm:col-span-2">Applicable categories (empty means all categories)<select multiple value={form.categoryIds} onChange={(event) => setForm((current) => ({ ...current, categoryIds: Array.from(event.target.selectedOptions, (option) => option.value) }))} className="min-h-24 border border-brass/50 bg-cream px-3 py-2 text-white">{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
          <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={form.isActive} onChange={(event) => setForm((current) => ({ ...current, isActive: event.target.checked }))} />Active</label>{formError && <p role="alert" className="sm:col-span-2 text-sm text-red-200">{formError}</p>}<div className="flex justify-end gap-3 border-t border-brass/40 pt-4 sm:col-span-2"><button type="button" onClick={closeForm} disabled={saving} className="border border-brass/50 px-4 py-2 text-sm text-espresso">Cancel</button><button type="submit" disabled={saving} className="bg-walnut px-5 py-2 text-sm text-white hover:bg-[#4c173b] disabled:opacity-50">{saving ? "Saving..." : "Save coupon"}</button></div>
        </form></section></div>}

      {toast && <div role="status" aria-live="polite" className={`fixed bottom-5 right-5 z-[60] max-w-sm border px-4 py-3 text-sm shadow-xl ${toast.tone === "success" ? "border-emerald-700 bg-[#0d2b2a] text-emerald-100" : toast.tone === "warning" ? "border-amber-700 bg-[#382a10] text-amber-100" : "border-red-800 bg-[#3a1720] text-red-100"}`}>{toast.text}</div>}
    </section>
  );
}

function StatCard({ label, value }: { label: string; value: number | string }) {
  return <article className="border border-brass/40 bg-white p-4"><p className="text-sm text-espresso/65">{label}</p><p className="mt-3 text-2xl font-semibold text-white">{value}</p></article>;
}
