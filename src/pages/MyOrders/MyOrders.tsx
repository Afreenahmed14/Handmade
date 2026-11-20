import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  CalendarDays,
  Check,
  CheckCircle2,
  ClipboardList,
  Copy,
  CreditCard,
  Gift,
  MapPin,
  Package,
  Truck,
  Wallet,
} from "lucide-react";
import { supabase } from "../../lib/supabase";
import { formatINR } from "../../utils/currency";
import { selectSimpleOrderPayment, submitSimpleOrderFeedback } from "../../services/simpleOrders";
import type { DbOrderRow, OrderStatus, PaymentMethod } from "../../types/database";
import { customerPaymentLabel, customerOrderStatusLabel } from "../../utils/orderStatus";
import OrderThumb from "../../components/orders/OrderThumb";

type Item = {
  id: string;
  order_id: string;
  product_name: string;
  quantity: number;
  line_subtotal_inr: number;
  product_image_url: string | null;
};
type Filter = "all" | "confirmed" | "processing" | "delivered";

const deliveryStages = [
  { label: "Confirmed", icon: Check },
  { label: "Processing", icon: Truck },
  { label: "Out for Delivery", icon: Package },
  { label: "Delivered", icon: Gift },
] as const;

function stageForStatus(status: OrderStatus) {
  if (status === "confirmed") return 0;
  if (status === "processing" || status === "shipped") return 1;
  if (status === "out_for_delivery") return 2;
  if (status === "delivered") return 3;
  return -1;
}

function formatExpectedDate(value: string | null) {
  if (!value) return "To be confirmed";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return "To be confirmed";
  return new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric" }).format(date);
}

export default function MyOrders() {
  const [orders, setOrders] = useState<DbOrderRow[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [ratings, setRatings] = useState<Record<string, number>>({});
  const [comments, setComments] = useState<Record<string, string>>({});
  const [done, setDone] = useState<string[]>([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>("all");
  const [copied, setCopied] = useState("");

  async function load() {
    const { data, error: orderError } = await supabase.from("orders").select("*").order("created_at", { ascending: false });
    if (orderError) throw orderError;
    setOrders(data ?? []);
    const ids = (data ?? []).map((order) => order.id);
    if (ids.length) {
      const result = await supabase
        .from("order_items")
        .select("id,order_id,product_name,quantity,line_subtotal_inr,product_image_url")
        .in("order_id", ids);
      if (result.error) throw result.error;
      setItems(result.data ?? []);
    } else setItems([]);
  }

  useEffect(() => {
    void load().catch((e) => setError(e instanceof Error ? e.message : "Unable to load orders")).finally(() => setLoading(false));
  }, []);

  async function choosePayment(orderId: string, method: PaymentMethod) {
    setBusy(orderId);
    setError("");
    try {
      await selectSimpleOrderPayment(orderId, method);
      await load();
      if (method === "upi") window.location.assign(`/payment/${orderId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to select payment");
    } finally {
      setBusy("");
    }
  }

  async function feedback(orderId: string) {
    setBusy(orderId);
    setError("");
    try {
      await submitSimpleOrderFeedback(orderId, ratings[orderId] ?? 5, comments[orderId] ?? "");
      setDone((value) => [...value, orderId]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to submit feedback");
    } finally {
      setBusy("");
    }
  }

  async function copyOrderNumber(orderNumber: string) {
    try {
      await navigator.clipboard.writeText(orderNumber);
      setCopied(orderNumber);
      window.setTimeout(() => setCopied(""), 1600);
    } catch {
      setError("Unable to copy the order number on this browser.");
    }
  }

  const counts = useMemo(() => ({
    all: orders.length,
    confirmed: orders.filter((order) => order.order_status === "confirmed").length,
    processing: orders.filter((order) => ["processing", "shipped", "out_for_delivery"].includes(order.order_status)).length,
    delivered: orders.filter((order) => order.order_status === "delivered").length,
  }), [orders]);

  const visibleOrders = orders.filter((order) => {
    if (filter === "all") return true;
    if (filter === "processing") return ["processing", "shipped", "out_for_delivery"].includes(order.order_status);
    return order.order_status === filter;
  });

  const filters: { key: Filter; label: string; icon: typeof Package }[] = [
    { key: "all", label: "All Orders", icon: Package },
    { key: "confirmed", label: "Confirmed", icon: CheckCircle2 },
    { key: "processing", label: "Processing", icon: Truck },
    { key: "delivered", label: "Delivered", icon: CheckCircle2 },
  ];

  return (
    <main className="casaloom-orders-page min-h-screen overflow-hidden">
      <div className="casaloom-orders-shell">
        <header className="casaloom-orders-heading">
          <div>
            <p className="casaloom-orders-eyebrow">Your CasaLoom account</p>
            <h1>My Orders</h1>
            <p className="casaloom-orders-subtitle">Your requests, payment choices and delivery updates in one place.</p>
          </div>
          <div className="casaloom-orders-heading-art" aria-hidden="true">
            <span className="casaloom-orders-art-flower">✿</span>
            <span className="casaloom-orders-gift"><Gift size={46} strokeWidth={1.3} /></span>
            <span className="casaloom-orders-art-mug">♡</span>
          </div>
        </header>

        <nav className="casaloom-order-filters" aria-label="Filter orders">
          {filters.map(({ key, label, icon: Icon }) => (
            <button key={key} type="button" onClick={() => setFilter(key)} className={filter === key ? "active" : ""} aria-pressed={filter === key}>
              <Icon size={20} strokeWidth={1.9} />
              <span>{label} ({counts[key]})</span>
            </button>
          ))}
        </nav>

        {error && <p role="alert" className="casaloom-orders-error">{error}</p>}

        {loading ? (
          <div className="casaloom-orders-empty">Loading your orders...</div>
        ) : visibleOrders.length === 0 ? (
          <div className="casaloom-orders-empty">
            <Package size={34} />
            <h2>{orders.length ? "No orders in this category" : "Your little treasures are waiting"}</h2>
            <p>{orders.length ? "Choose another order filter to see your purchases." : "You haven't placed an order yet."}</p>
            {!orders.length && <Link to="/shop">Explore the collection</Link>}
          </div>
        ) : (
          <div className="casaloom-order-list">
            {visibleOrders.map((order) => {
              const orderItems = items.filter((item) => item.order_id === order.id);
              const firstItem = orderItems[0];
              const currentStage = stageForStatus(order.order_status);
              const isTerminal = order.order_status === "cancelled" || order.order_status === "returned";
              const paymentText = order.payment_method
                ? `${order.payment_method.toUpperCase()} · ${customerPaymentLabel[order.payment_status]}`
                : "Not selected yet";

              return (
                <article key={order.id} className="casaloom-order-card">
                  <div className="casaloom-order-card-main">
                    <OrderThumb src={firstItem?.product_image_url ?? null} className="casaloom-order-product-image" />

                    <div className="casaloom-order-info">
                      <p className="casaloom-order-date"><CalendarDays size={15} /> {new Date(order.created_at).toLocaleString("en-IN", { day: "2-digit", month: "2-digit", year: "numeric", hour: "numeric", minute: "2-digit" })}</p>
                      <div className="casaloom-order-number-row">
                        <h2>{order.order_number}</h2>
                        <button type="button" onClick={() => void copyOrderNumber(order.order_number)} aria-label="Copy order number" title={copied === order.order_number ? "Copied" : "Copy order number"}>
                          {copied === order.order_number ? <Check size={17} /> : <Copy size={17} />}
                        </button>
                      </div>
                      <div className="casaloom-order-products">
                        {orderItems.length ? orderItems.map((item) => <p key={item.id}>{item.product_name} × {item.quantity}</p>) : <p>Order items</p>}
                      </div>
                      <strong className="casaloom-order-total">{formatINR(Number(order.total_inr))}</strong>
                    </div>

                    <div className="casaloom-order-progress-wrap">
                      {isTerminal ? (
                        <div className="casaloom-order-terminal">{customerOrderStatusLabel[order.order_status]}</div>
                      ) : (
                        <ol className="casaloom-order-progress" aria-label={`Order status: ${customerOrderStatusLabel[order.order_status]}`}>
                          {deliveryStages.map(({ label, icon: Icon }, index) => {
                            const reached = currentStage >= index;
                            const current = currentStage === index;
                            return (
                              <li key={label} className={`${reached ? "reached" : ""} ${current ? "current" : ""}`}>
                                <span className="casaloom-order-progress-icon">{reached && index < currentStage ? <Check size={17} /> : <Icon size={18} />}</span>
                                <span className="casaloom-order-progress-label">{label}</span>
                              </li>
                            );
                          })}
                        </ol>
                      )}
                    </div>

                    <div className="casaloom-order-actions">
                      <span className={`casaloom-order-status status-${order.order_status}`}>
                        {order.order_status === "confirmed" && <Check size={15} />}
                        {order.order_status === "processing" && <Truck size={15} />}
                        {order.order_status === "delivered" && <CheckCircle2 size={15} />}
                        {customerOrderStatusLabel[order.order_status]}
                      </span>
                      {order.order_status !== "pending" && order.order_status !== "cancelled" && (
                        <Link to={`/track/${order.id}`} className="casaloom-order-track"><MapPin size={17} /> Track Order</Link>
                      )}
                      <Link to={`/track/${order.id}`} className="casaloom-order-details"><ClipboardList size={17} /> Order Details</Link>
                    </div>
                  </div>

                  <div className="casaloom-order-meta">
                    <span><Wallet size={20} /> <span>Total: <b>{formatINR(Number(order.total_inr))}</b></span></span>
                    <span><CreditCard size={20} /> <span>Payment: <b>{paymentText}</b></span></span>
                    <span><CalendarDays size={20} /> <span>Expected delivery: <b>{formatExpectedDate(order.expected_delivery_date)}</b></span></span>
                  </div>

                  {order.order_status === "pending" && (
                    <div className="casaloom-order-inline-note">Your order request is waiting for CasaLoom approval. You can choose payment after it is accepted.</div>
                  )}
                  {order.order_status === "cancelled" && <div className="casaloom-order-inline-note cancelled">This order request was declined or cancelled.</div>}

                  {order.order_status === "confirmed" && !order.payment_method && (
                    <div className="casaloom-order-payment-choice">
                      <p>Your order is accepted. Choose how you would like to pay:</p>
                      <button disabled={busy === order.id} onClick={() => void choosePayment(order.id, "upi")}>Pay online (UPI)</button>
                      <button disabled={busy === order.id} onClick={() => void choosePayment(order.id, "cod")}>Cash on delivery</button>
                    </div>
                  )}

                  {order.order_status === "delivered" && !done.includes(order.id) && (
                    <div className="casaloom-order-feedback">
                      <p>How was your order?</p>
                      <div className="casaloom-order-stars">
                        {[1, 2, 3, 4, 5].map((number) => (
                          <button key={number} type="button" onClick={() => setRatings((value) => ({ ...value, [order.id]: number }))} aria-label={`${number} stars`} className={number <= (ratings[order.id] ?? 5) ? "selected" : ""}>★</button>
                        ))}
                      </div>
                      <textarea value={comments[order.id] ?? ""} onChange={(event) => setComments((value) => ({ ...value, [order.id]: event.target.value }))} rows={2} placeholder="Share your feedback (optional)" />
                      <button disabled={busy === order.id} onClick={() => void feedback(order.id)}>Submit feedback</button>
                    </div>
                  )}
                  {done.includes(order.id) && <p className="casaloom-order-thanks">Thank you for your feedback!</p>}
                </article>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}
