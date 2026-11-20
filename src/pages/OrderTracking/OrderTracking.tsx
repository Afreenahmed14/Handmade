import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { RefreshCw } from "lucide-react";
import OrderProgress from "../../components/orders/OrderProgress";
import OrderStatusBadge from "../../components/orders/OrderStatusBadge";
import ShipmentCard from "../../components/orders/ShipmentCard";
import { useAuth } from "../../context/AuthContext";
import { friendlyOrderError, getOrderTracking, resolveMyOrder, type OrderTracking as Tracking } from "../../services/customerOrders";
import { customerPaymentLabel, formatDateTime } from "../../utils/orderStatus";

function TrackLookup() {
  const navigate = useNavigate();
  const [value, setValue] = useState("");
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cleaned = value.trim();
    if (cleaned) navigate(`/track/${encodeURIComponent(cleaned)}`);
  }
  return (
    <section className="container-x max-w-xl py-14 md:py-20">
      <h1 className="text-4xl text-walnut">Track an order</h1>
      <p className="mt-2 text-sm text-espresso/70">Enter the order number from your confirmation, for example VH-20261112-AB12CD34.</p>
      <form onSubmit={submit} className="mt-8 grid gap-4">
        <label className="grid gap-2 text-sm">Order number<input value={value} onChange={(event) => setValue(event.target.value)} autoComplete="off" spellCheck={false} className="border border-brass/50 bg-transparent px-4 py-3" /></label>
        <button disabled={!value.trim()} className="btn-primary disabled:opacity-60">Track order</button>
      </form>
      <p className="mt-6 text-sm text-walnut/70">Or <Link to="/my-orders" className="underline underline-offset-4">see all of your orders</Link>.</p>
    </section>
  );
}

export default function OrderTracking() {
  const { orderRef } = useParams();
  if (!orderRef) return <TrackLookup />;
  return <TrackOrder orderRef={orderRef} />;
}

function TrackOrder({ orderRef }: { orderRef: string }) {
  const { user } = useAuth();
  const userId = user?.id ?? "";
  const [tracking, setTracking] = useState<Tracking | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!userId) return;
    let active = true;
    setLoading(true);
    setError("");
    void (async () => {
      try {
        const order = await resolveMyOrder(userId, orderRef);
        const result = await getOrderTracking(order.id);
        if (active) setTracking(result);
      } catch (reason) {
        if (active) { setTracking(null); setError(friendlyOrderError(reason)); }
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [userId, orderRef, attempt]);

  if (loading && !tracking) return <section className="container-x py-24 text-center"><p role="status" className="text-walnut/70">Loading tracking...</p></section>;
  if (error || !tracking) {
    return (
      <section className="container-x py-24 text-center">
        <h1 className="text-4xl text-walnut">Tracking unavailable</h1>
        <p role="alert" className="mx-auto mt-4 max-w-md text-espresso/80">{error || "We couldn't find that order in your account."}</p>
        <div className="mt-8 flex flex-wrap justify-center gap-4">
          <button type="button" onClick={() => setAttempt((n) => n + 1)} className="btn-outline">Try again</button>
          <Link to="/my-orders" className="btn-primary">My orders</Link>
        </div>
      </section>
    );
  }

  return (
    <section className="container-x max-w-3xl py-12 md:py-16">
      <p className="text-sm text-walnut/70"><Link to="/my-orders" className="underline underline-offset-4">My orders</Link></p>
      <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm text-walnut/70">Order tracking</p>
          <h1 className="text-4xl text-walnut">{tracking.orderNumber}</h1>
          <p className="mt-1 text-sm text-walnut/70">Placed {formatDateTime(tracking.createdAt)} · {customerPaymentLabel[tracking.paymentStatus]}</p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <OrderStatusBadge status={tracking.orderStatus} />
          <button type="button" onClick={() => setAttempt((n) => n + 1)} disabled={loading} className="inline-flex items-center gap-1 text-sm text-walnut underline underline-offset-4 disabled:opacity-50"><RefreshCw size={14} aria-hidden="true" />{loading ? "Refreshing..." : "Refresh"}</button>
        </div>
      </div>

      <div className="mt-8 grid gap-6">
        <div className="border border-brass/40 p-6">
          <h2 className="text-xl text-walnut">Progress</h2>
          <div className="mt-5"><OrderProgress status={tracking.orderStatus} timeline={tracking.timeline} /></div>
          <p className="mt-5 border-t border-brass/30 pt-3 text-xs text-walnut/60">Last updated {formatDateTime(tracking.updatedAt)}</p>
        </div>
        <ShipmentCard shipment={tracking.shipment} orderStatus={tracking.orderStatus} />
      </div>

      <div className="mt-8 flex flex-wrap gap-4">
        <Link to={`/my-orders/${tracking.orderId}`} className="btn-primary">View order details</Link>
        <Link to="/shop" className="btn-outline">Continue shopping</Link>
      </div>
    </section>
  );
}
