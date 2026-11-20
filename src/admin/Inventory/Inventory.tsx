import { useEffect, useMemo, useState, type FormEvent } from "react";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Boxes, CircleAlert, History, PackageCheck, Plus, Search, X } from "lucide-react";
import { formatINR } from "../../utils/currency";
import { getCategories } from "../../services/catalog";
import { adjustInventoryStock, getInventoryProducts, getInventorySnapshot, getRecentInventoryMovements, updateLowStockThreshold, type InventoryMovement, type InventoryProduct, type InventorySnapshot } from "../../services/inventory";
import type { InventoryAction } from "../../types/database";

const pageSize = 12;
type StockFilter = "all" | "in_stock" | "low_stock" | "out_of_stock";
type Toast = { text: string; tone: "success" | "warning" | "error" };

function stockStatus(product: InventoryProduct) {
  if (product.quantity === 0) return { label: "Out of stock", tone: "border-red-800 bg-red-950/60 text-red-200" };
  if (product.quantity <= product.lowStockThreshold) return { label: "Low stock", tone: "border-amber-700 bg-amber-950/50 text-amber-200" };
  return { label: "In stock", tone: "border-emerald-800 bg-emerald-950/40 text-emerald-200" };
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function displayAction(action: InventoryAction) {
  const labels: Record<InventoryAction, string> = {
    received: "Stock received", sold: "Stock reduced / sold", adjustment: "Manual adjustment",
    returned: "Returned stock", damaged: "Damaged stock", order_cancelled: "Order cancellation",
  };
  return labels[action];
}

function ThresholdEditor({ product, saving, onSave }: { product: InventoryProduct; saving: boolean; onSave: (id: string, value: number) => void }) {
  const [value, setValue] = useState(String(product.lowStockThreshold));
  useEffect(() => setValue(String(product.lowStockThreshold)), [product.id, product.lowStockThreshold]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < 0) return;
    onSave(product.id, parsed);
  }

  return <form onSubmit={submit} className="flex items-center gap-1.5">
    <label className="sr-only" htmlFor={`threshold-${product.id}`}>Low-stock threshold for {product.name}</label>
    <input id={`threshold-${product.id}`} type="number" min="0" step="1" value={value} onChange={(event) => setValue(event.target.value)} className="w-16 border border-brass/50 bg-cream px-2 py-1 text-center text-xs text-white" />
    <button type="submit" disabled={saving || Number(value) === product.lowStockThreshold} className="border border-brass/50 px-2 py-1 text-xs text-espresso hover:bg-[#eadbd2] disabled:opacity-40">Save</button>
  </form>;
}

export default function Inventory() {
  const [products, setProducts] = useState<InventoryProduct[]>([]);
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([]);
  const [snapshot, setSnapshot] = useState<InventorySnapshot | null>(null);
  const [movements, setMovements] = useState<InventoryMovement[]>([]);
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [stockFilter, setStockFilter] = useState<StockFilter>("all");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState<Toast | null>(null);
  const [selectedProduct, setSelectedProduct] = useState<InventoryProduct | null>(null);
  const [action, setAction] = useState<InventoryAction>("received");
  const [quantity, setQuantity] = useState("");
  const [newQuantity, setNewQuantity] = useState("");
  const [reason, setReason] = useState("");
  const [reference, setReference] = useState("");
  const [adjusting, setAdjusting] = useState(false);
  const [thresholdSavingId, setThresholdSavingId] = useState("");

  async function loadAll() {
    const [nextProducts, nextSnapshot, nextMovements, nextCategories] = await Promise.all([
      getInventoryProducts(), getInventorySnapshot(), getRecentInventoryMovements(12), getCategories(true),
    ]);
    setProducts(nextProducts);
    setSnapshot(nextSnapshot);
    setMovements(nextMovements);
    setCategories(nextCategories.map(({ id, name }) => ({ id, name })));
  }

  useEffect(() => {
    let active = true;
    void Promise.all([getInventoryProducts(), getInventorySnapshot(), getRecentInventoryMovements(12), getCategories(true)]).then(([nextProducts, nextSnapshot, nextMovements, nextCategories]) => {
      if (!active) return;
      setProducts(nextProducts);
      setSnapshot(nextSnapshot);
      setMovements(nextMovements);
      setCategories(nextCategories.map(({ id, name }) => ({ id, name })));
    }).catch((failure: unknown) => {
      if (active) setError(failure instanceof Error ? failure.message : "Unable to load inventory.");
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 5000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => { setPage(1); }, [query, categoryFilter, stockFilter]);

  const filteredProducts = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return products.filter((product) => {
      const status = stockStatus(product).label;
      const matchesQuery = !normalized || product.name.toLowerCase().includes(normalized) || product.sku.toLowerCase().includes(normalized);
      const matchesCategory = categoryFilter === "all" || product.categoryId === categoryFilter;
      const matchesStock = stockFilter === "all" || (stockFilter === "in_stock" && status === "In stock") || (stockFilter === "low_stock" && status === "Low stock") || (stockFilter === "out_of_stock" && status === "Out of stock");
      return matchesQuery && matchesCategory && matchesStock;
    });
  }, [products, query, categoryFilter, stockFilter]);

  const pageCount = Math.max(1, Math.ceil(filteredProducts.length / pageSize));
  const pageProducts = filteredProducts.slice((page - 1) * pageSize, page * pageSize);
  useEffect(() => { if (page > pageCount) setPage(pageCount); }, [page, pageCount]);

  async function refresh() {
    setRefreshing(true);
    setError("");
    try {
      await loadAll();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Unable to refresh inventory.");
    } finally {
      setRefreshing(false);
    }
  }

  function openAdjustment(product: InventoryProduct, initialAction: InventoryAction = "received") {
    setSelectedProduct(product);
    setAction(initialAction);
    setQuantity("");
    setNewQuantity(String(product.quantity));
    setReason("");
    setReference("");
  }

  async function submitAdjustment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedProduct) return;
    setAdjusting(true);
    setError("");
    try {
      const result = await adjustInventoryStock({
        productId: selectedProduct.id,
        action,
        reason,
        quantity: action === "adjustment" ? undefined : Number(quantity),
        newQuantity: action === "adjustment" ? Number(newQuantity) : undefined,
        reference: reference.trim() || undefined,
      });
      await refresh();
      setToast({ text: `Stock updated from ${result.previousQuantity} to ${result.newQuantity}.`, tone: "success" });
      setSelectedProduct(null);
    } catch (failure) {
      setToast({ text: failure instanceof Error ? failure.message : "Stock could not be updated.", tone: "error" });
    } finally {
      setAdjusting(false);
    }
  }

  async function saveThreshold(productId: string, threshold: number) {
    setThresholdSavingId(productId);
    try {
      await updateLowStockThreshold(productId, threshold);
      await refresh();
      setToast({ text: "Low-stock threshold updated.", tone: "success" });
    } catch (failure) {
      setToast({ text: failure instanceof Error ? failure.message : "Threshold could not be saved.", tone: "error" });
    } finally {
      setThresholdSavingId("");
    }
  }

  return (
    <section className="relative -m-4 min-h-[calc(100vh-8rem)] bg-cream p-4 text-espresso sm:-m-8 sm:p-8">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-brass/40 pb-5">
        <div><p className="text-sm text-espresso/65">Operations</p><h1 className="mt-1 text-3xl text-white">Inventory</h1></div>
        <button type="button" onClick={() => void refresh()} disabled={refreshing} className="border border-brass/50 px-4 py-2 text-sm text-espresso hover:bg-[#eadbd2] disabled:opacity-50">{refreshing ? "Refreshing..." : "Refresh"}</button>
      </div>

      {error && <p role="alert" className="mt-4 border-l-2 border-red-400 pl-3 text-sm text-red-200">{error}</p>}

      <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {[
          { label: "Products in stock", value: snapshot?.productsInStock ?? "—", icon: PackageCheck, tone: "text-emerald-300" },
          { label: "Stock units", value: snapshot?.stockUnits ?? "—", icon: Boxes, tone: "text-walnut" },
          { label: "Low stock", value: snapshot?.lowStockProducts ?? "—", icon: CircleAlert, tone: "text-amber-300" },
          { label: "Out of stock", value: snapshot?.outOfStockProducts ?? "—", icon: X, tone: "text-red-300" },
          { label: "Retail stock value", value: snapshot ? formatINR(snapshot.inventoryValue) : "—", icon: History, tone: "text-walnut" },
        ].map((stat) => <article key={stat.label} className="border border-brass/40 bg-white p-4"><div className="flex items-center justify-between text-sm text-espresso/65"><span>{stat.label}</span><stat.icon size={17} className={stat.tone} /></div><p className="mt-3 text-2xl font-semibold text-white">{loading ? "..." : stat.value}</p></article>)}
      </div>

      <section className="mt-9">
        <div className="flex flex-wrap items-end justify-between gap-4"><div><h2 className="text-xl font-medium text-white">Stock levels</h2><p className="mt-1 text-sm text-espresso/65">Thresholds determine low-stock alerts.</p></div><div className="text-sm text-espresso/65">{filteredProducts.length} product{filteredProducts.length === 1 ? "" : "s"}</div></div>
        <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(12rem,1fr)_12rem_12rem]">
          <label className="relative"><span className="sr-only">Search inventory</span><Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-espresso/65" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search product or SKU" className="w-full border border-brass/40 bg-white py-2 pl-9 pr-3 text-sm text-white placeholder:text-espresso/55" /></label>
          <label><span className="sr-only">Filter by category</span><select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)} className="w-full border border-brass/40 bg-white px-3 py-2 text-sm text-white"><option value="all">All categories</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
          <label><span className="sr-only">Filter by stock status</span><select value={stockFilter} onChange={(event) => setStockFilter(event.target.value as StockFilter)} className="w-full border border-brass/40 bg-white px-3 py-2 text-sm text-white"><option value="all">All stock statuses</option><option value="in_stock">In stock</option><option value="low_stock">Low stock</option><option value="out_of_stock">Out of stock</option></select></label>
        </div>

        {loading && <p role="status" className="py-12 text-center text-sm text-espresso/80">Loading inventory...</p>}
        {!loading && !error && !filteredProducts.length && <p className="py-12 text-center text-sm text-espresso/65">{products.length ? "No products match these filters." : "No products found."}</p>}
        {!loading && filteredProducts.length > 0 && <div className="mt-4 overflow-x-auto border-y border-brass/40">
          <table className="w-full min-w-[66rem] text-left text-sm">
            <thead className="border-b border-brass/40 text-xs uppercase text-espresso/65"><tr><th className="py-3 pr-4 font-medium">Product</th><th className="py-3 pr-4 font-medium">Category</th><th className="py-3 pr-4 font-medium">Quantity</th><th className="py-3 pr-4 font-medium">Status</th><th className="py-3 pr-4 font-medium">Threshold</th><th className="py-3 pr-4 font-medium">Updated</th><th className="py-3 text-right font-medium">Stock action</th></tr></thead>
            <tbody>{pageProducts.map((product) => {
              const status = stockStatus(product);
              return <tr key={product.id} className="border-b border-brass/30 last:border-0">
                <td className="py-3 pr-4"><div className="flex items-center gap-3">{product.imageUrl ? <img src={product.imageUrl} alt="" className="h-12 w-10 object-cover" /> : <div className="grid h-12 w-10 place-items-center bg-[#eadbd2]"><Boxes size={16} className="text-espresso/55" /></div>}<div><p className="font-medium text-white">{product.name}</p><p className="text-xs text-espresso/65">{product.sku}</p></div></div></td>
                <td className="py-3 pr-4 text-espresso/80">{product.categoryName || "Unassigned"}</td>
                <td className="py-3 pr-4 font-medium text-white">{product.quantity}</td>
                <td className="py-3 pr-4"><span className={`inline-flex border px-2 py-1 text-xs ${status.tone}`}>{status.label}</span></td>
                <td className="py-3 pr-4"><ThresholdEditor product={product} saving={thresholdSavingId === product.id} onSave={(id, value) => void saveThreshold(id, value)} /></td>
                <td className="py-3 pr-4 whitespace-nowrap text-xs text-espresso/65">{formatDate(product.updatedAt)}</td>
                <td className="py-3"><div className="flex justify-end gap-1"><button type="button" onClick={() => openAdjustment(product, "received")} title="Add stock" aria-label={`Add stock to ${product.name}`} className="border border-brass/50 p-2 text-emerald-200 hover:bg-emerald-950/50"><Plus size={16} /></button><button type="button" onClick={() => openAdjustment(product, "sold")} title="Reduce stock" aria-label={`Reduce stock for ${product.name}`} className="border border-brass/50 p-2 text-amber-200 hover:bg-amber-950/50"><ArrowDown size={16} /></button><button type="button" onClick={() => openAdjustment(product, "adjustment")} title="Set stock quantity" aria-label={`Adjust stock for ${product.name}`} className="border border-brass/50 p-2 text-walnut hover:bg-sky-950/50"><ArrowUp size={16} /></button></div></td>
              </tr>;
            })}</tbody>
          </table>
        </div>}

        {pageCount > 1 && <nav aria-label="Inventory pages" className="mt-5 flex items-center justify-center gap-4 text-sm"><button type="button" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={page === 1} aria-label="Previous page" className="border border-brass/50 p-2 text-espresso disabled:opacity-40"><ArrowLeft size={16} /></button><span className="text-espresso/80">Page {page} of {pageCount}</span><button type="button" onClick={() => setPage((current) => Math.min(pageCount, current + 1))} disabled={page === pageCount} aria-label="Next page" className="border border-brass/50 p-2 text-espresso disabled:opacity-40"><ArrowRight size={16} /></button></nav>}
      </section>

      <section className="mt-10 border-t border-brass/40 pt-7">
        <div className="flex items-center gap-2"><History size={18} className="text-walnut" /><h2 className="text-xl font-medium text-white">Recent stock movements</h2></div>
        {!loading && !movements.length && <p className="py-8 text-sm text-espresso/65">No stock movements recorded yet.</p>}
        {movements.length > 0 && <div className="mt-4 overflow-x-auto border-y border-brass/40"><table className="w-full min-w-[58rem] text-left text-sm"><thead className="border-b border-brass/40 text-xs uppercase text-espresso/65"><tr><th className="py-3 pr-4 font-medium">Product</th><th className="py-3 pr-4 font-medium">Movement</th><th className="py-3 pr-4 font-medium">Previous</th><th className="py-3 pr-4 font-medium">New</th><th className="py-3 pr-4 font-medium">Reason / reference</th><th className="py-3 pr-4 font-medium">Admin</th><th className="py-3 font-medium">Date</th></tr></thead><tbody>{movements.map((movement) => <tr key={movement.id} className="border-b border-brass/30 last:border-0"><td className="py-3 pr-4"><p className="text-white">{movement.productName}</p><p className="text-xs text-espresso/65">{movement.sku}</p></td><td className="py-3 pr-4 text-espresso">{displayAction(movement.movement_action)}</td><td className="py-3 pr-4 text-espresso/80">{movement.previous_quantity ?? "—"}</td><td className="py-3 pr-4 text-espresso/80">{movement.new_quantity ?? "—"}</td><td className="max-w-xs py-3 pr-4 text-espresso/80"><p>{movement.reason}</p>{movement.reference && <p className="mt-1 text-xs text-espresso/65">Ref: {movement.reference}</p>}</td><td className="py-3 pr-4 text-espresso/80">{movement.adminName}</td><td className="py-3 whitespace-nowrap text-xs text-espresso/65">{formatDate(movement.created_at)}</td></tr>)}</tbody></table></div>}
      </section>

      {selectedProduct && <div className="fixed inset-0 z-50 overflow-y-auto bg-black/70 p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !adjusting) setSelectedProduct(null); }}>
        <section role="dialog" aria-modal="true" aria-labelledby="inventory-dialog-title" className="mx-auto my-12 max-w-xl border border-brass/40 bg-white p-5 text-espresso shadow-2xl sm:p-7">
          <div className="flex items-start justify-between gap-4 border-b border-brass/40 pb-4"><div><p className="text-sm text-espresso/65">{selectedProduct.sku} · Available {selectedProduct.quantity}</p><h2 id="inventory-dialog-title" className="mt-1 text-2xl text-white">Update stock</h2></div><button type="button" onClick={() => setSelectedProduct(null)} disabled={adjusting} aria-label="Close stock adjustment" className="p-2 text-espresso/80 hover:bg-[#eadbd2]"><X size={19} /></button></div>
          <form onSubmit={submitAdjustment} className="mt-5 grid gap-4">
            <label className="grid gap-1.5 text-sm">Movement type<select value={action} onChange={(event) => setAction(event.target.value as InventoryAction)} className="border border-brass/50 bg-cream px-3 py-2 text-white"><option value="received">Stock received (add)</option><option value="sold">Reduce stock / sold</option><option value="adjustment">Manual quantity adjustment</option><option value="returned">Returned stock (add)</option><option value="damaged">Damaged stock (remove)</option></select></label>
            {action === "adjustment" ? <label className="grid gap-1.5 text-sm">New total quantity<input required type="number" min="0" step="1" value={newQuantity} onChange={(event) => setNewQuantity(event.target.value)} className="border border-brass/50 bg-cream px-3 py-2 text-white" /></label> : <label className="grid gap-1.5 text-sm">Quantity<input required type="number" min="1" step="1" value={quantity} onChange={(event) => setQuantity(event.target.value)} className="border border-brass/50 bg-cream px-3 py-2 text-white" /></label>}
            <label className="grid gap-1.5 text-sm">Reason<input required maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} className="border border-brass/50 bg-cream px-3 py-2 text-white" placeholder="e.g. Supplier delivery, damaged in storage" /></label>
            <label className="grid gap-1.5 text-sm">Admin reference{action === "sold" ? " (required)" : " (optional)"}<input required={action === "sold"} maxLength={200} value={reference} onChange={(event) => setReference(event.target.value)} className="border border-brass/50 bg-cream px-3 py-2 text-white" placeholder={action === "sold" ? "Manual sale reference" : "Supplier, return or internal reference"} /></label>
            {action !== "adjustment" && <p className="text-xs text-espresso/65">The database locks the product row and rejects changes that would make stock negative.</p>}
            <div className="flex justify-end gap-3 border-t border-brass/40 pt-4"><button type="button" onClick={() => setSelectedProduct(null)} disabled={adjusting} className="border border-brass/50 px-4 py-2 text-sm text-espresso hover:bg-[#eadbd2]">Cancel</button><button type="submit" disabled={adjusting} className="bg-walnut px-5 py-2 text-sm font-medium text-white hover:bg-[#4c173b] disabled:opacity-60">{adjusting ? "Updating..." : "Confirm stock change"}</button></div>
          </form>
        </section>
      </div>}

      {toast && <div role="status" aria-live="polite" className={`fixed bottom-5 right-5 z-[60] max-w-sm border px-4 py-3 text-sm shadow-xl ${toast.tone === "success" ? "border-emerald-700 bg-[#0d2b2a] text-emerald-100" : toast.tone === "warning" ? "border-amber-700 bg-[#382a10] text-amber-100" : "border-red-800 bg-[#3a1720] text-red-100"}`}>{toast.text}</div>}
    </section>
  );
}
