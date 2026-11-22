import { useEffect, useState } from "react";
import { RefreshCw, CalendarDays, Image as ImageIcon, Download } from "lucide-react";
import { formatINR } from "../../utils/currency";
import { getOrders, getOrderDetail, updateOrderStatus, type OrderListItem, type OrderDetail } from "../../services/orders";
import { setSimpleOrderExpectedDeliveryDate } from "../../services/simpleOrders";
import { createPrivateDownloadUrl, createPrivateUploadUrl } from "../../services/storage";
import type { OrderStatus } from "../../types/database";

const nextStatus: Partial<Record<OrderStatus, OrderStatus>> = {
  pending: "confirmed",
  confirmed: "processing",
  processing: "shipped",
  shipped: "out_for_delivery",
  out_for_delivery: "delivered",
};

export default function Orders() {
  const [orders, setOrders] = useState<OrderListItem[]>([]);
  const [selected, setSelected] = useState<OrderDetail | null>(null);
  const [photoUrl, setPhotoUrl] = useState("");
  const [photoDownloadUrl, setPhotoDownloadUrl] = useState("");
  const [deliveryDate, setDeliveryDate] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function refresh() {
    const result = await getOrders({ page: 1, pageSize: 100, orderStatus: "all", paymentStatus: "all" });
    setOrders(result.orders);
  }

  useEffect(() => {
    void refresh().catch((reason) => setError(reason instanceof Error ? reason.message : "Unable to load orders"))
      .finally(() => setLoading(false));
  }, []);

  async function openOrder(order: OrderListItem) {
    setError(""); setNotice(""); setSelected(null); setPhotoUrl(""); setPhotoDownloadUrl("");
    try {
      const detail = await getOrderDetail(order.id);
      setSelected(detail);
      setDeliveryDate(detail.order.expected_delivery_date ?? "");
      if (detail.order.customization_photo_path) {
        const [preview, download] = await Promise.all([
          createPrivateUploadUrl("customization-uploads", detail.order.customization_photo_path),
          createPrivateDownloadUrl("customization-uploads", detail.order.customization_photo_path, `${detail.order.order_number}-customer-photo.${detail.order.customization_photo_path.split(".").pop() || "jpg"}`),
        ]);
        setPhotoUrl(preview);
        setPhotoDownloadUrl(download);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load order details");
    }
  }

  async function saveDeliveryDate() {
    if (!selected) return;
    if (!deliveryDate) { setError("Choose an expected delivery date."); return; }
    setBusy(true); setError(""); setNotice("");
    try {
      await setSimpleOrderExpectedDeliveryDate(selected.order.id, deliveryDate);
      await refresh();
      setSelected(await getOrderDetail(selected.order.id));
      setNotice("Expected delivery date saved.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to save expected delivery date");
    } finally { setBusy(false); }
  }

  async function advanceStatus() {
    if (!selected) return;
    const status = nextStatus[selected.order.order_status];
    if (!status) return;
    setBusy(true); setError(""); setNotice("");
    try {
      await updateOrderStatus(selected.order.id, status, `Order status updated to ${status.replaceAll("_", " ")}`);
      await refresh();
      setSelected(await getOrderDetail(selected.order.id));
      setNotice("Order status updated.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to update order status");
    } finally { setBusy(false); }
  }

  return <section className="space-y-6">
    <div className="flex flex-wrap items-end justify-between gap-3 border-b border-brass/40 pb-5">
      <div><p className="text-sm text-walnut/70">CasaLoom order desk</p><h1 className="mt-1 font-display text-3xl text-walnut">Orders</h1><p className="mt-1 text-sm text-espresso/60">View order history, download customer photos, set delivery dates and update order progress.</p></div>
      <button onClick={() => { setLoading(true); void refresh().catch((reason) => setError(reason.message)).finally(() => setLoading(false)); }} className="btn-outline"><RefreshCw size={15}/> Refresh</button>
    </div>
    {error && <p role="alert" className="border-l-2 border-red-700 pl-3 text-sm text-red-800">{error}</p>}
    <div className="grid gap-3">
      {loading && <p className="py-10 text-center text-walnut/60">Loading orders...</p>}
      {!loading && orders.length === 0 && <p className="rounded-xl border border-brass/30 bg-white p-8 text-center text-espresso/60">No customer orders yet.</p>}
      {orders.map((order) => <button key={order.id} onClick={() => void openOrder(order)} className="grid gap-2 rounded-xl border border-brass/30 bg-white p-4 text-left shadow-sm transition hover:border-walnut/50 sm:grid-cols-[1fr_auto]">
        <span><strong className="block text-walnut">{order.order_number}</strong><span className="text-sm text-espresso/70">{order.customer_name} · {order.customer_email}</span><span className="mt-1 block text-xs text-espresso/50">{order.itemCount} item(s) · {new Date(order.created_at).toLocaleString("en-IN")}</span></span>
        <span className="flex items-center justify-between gap-4 sm:flex-col sm:items-end"><strong>{formatINR(Number(order.total_inr))}</strong><span className="rounded-full bg-[#f3e9ed] px-3 py-1 text-xs capitalize text-[#64234e]">{order.order_status.replaceAll("_", " ")}</span></span>
      </button>)}
    </div>
    {selected && <div className="fixed inset-0 z-50 flex items-end justify-center bg-espresso/50 p-0 sm:items-center sm:p-5" onClick={() => setSelected(null)}>
      <section className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-t-2xl bg-cream p-5 sm:rounded-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-start justify-between gap-3"><div><p className="text-xs uppercase tracking-widest text-walnut/60">Order details</p><h2 className="mt-1 font-display text-2xl text-walnut">{selected.order.order_number}</h2></div><button onClick={() => setSelected(null)} className="p-2 text-walnut" aria-label="Close order details">×</button></div>
        <div className="mt-4 grid gap-2 text-sm sm:grid-cols-2"><p><b>Customer:</b> {selected.order.customer_name}</p><p><b>Phone:</b> {selected.order.customer_phone || "Not provided"}</p><p><b>Email:</b> {selected.order.customer_email}</p><p><b>Amount:</b> {formatINR(Number(selected.order.total_inr))}</p><p><b>Status:</b> <span className="capitalize">{selected.order.order_status.replaceAll("_", " ")}</span></p><p><b>Payment:</b> {selected.order.payment_method === "upi" ? "UPI" : selected.order.payment_method === "cod" ? "Cash on delivery" : "Not selected"}</p><p><b>Payment status:</b> {selected.order.payment_status.replaceAll("_", " ")}</p></div>
        <div className="mt-4 rounded-lg border border-brass/30 bg-white p-3 text-sm"><b>Delivery address</b><pre className="mt-2 whitespace-pre-wrap font-sans text-espresso/75">{JSON.stringify(selected.order.shipping_address, null, 2)}</pre></div>
        {selected.items.map((item) => <div key={item.id} className="mt-3 flex items-center justify-between border-b border-brass/20 py-2 text-sm"><span>{item.product_name} × {item.quantity}</span><b>{formatINR(Number(item.line_subtotal_inr))}</b></div>)}
        {photoUrl && <div className="mt-4"><p className="mb-2 flex items-center gap-2 text-sm font-medium text-walnut"><ImageIcon size={16}/> Customer photo</p><img src={photoUrl} alt="Customer uploaded photo" className="max-h-72 rounded-lg object-contain" />{photoDownloadUrl && <a href={photoDownloadUrl} className="mt-3 inline-flex items-center gap-2 rounded-md bg-plum px-4 py-2 text-sm font-medium text-white" download><Download size={16}/> Download customer photo</a>}</div>}
        {!(selected.order.order_status === "cancelled" || selected.order.order_status === "returned") && <div className="mt-5 rounded-xl border border-brass/40 bg-white p-4">
          <h3 className="font-medium text-walnut">Expected delivery</h3>
          <label className="mt-3 block text-sm">Delivery date<input type="date" min={new Date().toISOString().slice(0, 10)} value={deliveryDate} onChange={(event) => setDeliveryDate(event.target.value)} className="mt-1 w-full rounded-md border border-brass/50 bg-cream px-3 py-2" /></label>
          <button disabled={busy || !deliveryDate} onClick={() => void saveDeliveryDate()} className="btn-primary mt-3">Save delivery date</button>
          {selected.order.expected_delivery_date && <p className="mt-2 text-xs text-walnut/65">Current date: {new Date(`${selected.order.expected_delivery_date}T00:00:00`).toLocaleDateString("en-IN")}</p>}
        </div>}
        {nextStatus[selected.order.order_status] && <button disabled={busy} onClick={() => void advanceStatus()} className="btn-primary mt-5"><CalendarDays size={16}/> Mark as {nextStatus[selected.order.order_status]?.replaceAll("_", " ")}</button>}
        {notice && <p role="status" className="mt-3 text-sm text-green-800">{notice}</p>}
      </section>
    </div>}
  </section>;
}
