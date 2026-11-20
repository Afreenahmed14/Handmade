import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import OrderStatusBadge from "../../components/orders/OrderStatusBadge";
import OrderThumb from "../../components/orders/OrderThumb";
import ShipmentCard from "../../components/orders/ShipmentCard";
import { useAuth } from "../../context/AuthContext";
import { formatINR } from "../../utils/currency";
import { friendlyOrderError, getMyOrderDetail, getOrderTracking, type CustomerOrderDetail, type OrderTracking } from "../../services/customerOrders";
import { shippingAddressLines } from "../../utils/address";
import { canOpenPaymentPage, customerOrderStatusMessage, customerPaymentLabel, formatDateTime } from "../../utils/orderStatus";

export default function OrderDetails() {
  const { orderId = "" } = useParams();
  const { user } = useAuth();
  const userId = user?.id ?? "";
  const [detail, setDetail] = useState<CustomerOrderDetail | null>(null);
  const [tracking, setTracking] = useState<OrderTracking | null>(null);
  const [trackingFailed, setTrackingFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!userId) return;
    let active = true;
    setLoading(true);
    setError("");
    setDetail(null);
    setTracking(null);
    setTrackingFailed(false);
    void (async () => {
      try {
        const result = await getMyOrderDetail(userId, orderId);
        if (!active) return;
        setDetail(result);
        setLoading(false);
        // Shipment details are secondary: if they fail, the rest of the order still shows.
        try {
          const next = await getOrderTracking(result.order.id);
          if (active) setTracking(next);
        } catch {
          if (active) setTrackingFailed(true);
        }
      } catch (reason) {
        if (active) { setError(friendlyOrderError(reason)); setLoading(false); }
      }
    })();
    return () => { active = false; };
  }, [userId, orderId, attempt]);

  if (loading) return <section className="container-x py-24 text-center"><p role="status" className="text-walnut/70">Loading your order...</p></section>;
  if (error || !detail) {
    return (
      <section className="container-x py-24 text-center">
        <h1 className="text-4xl text-walnut">Order unavailable</h1>
        <p role="alert" className="mx-auto mt-4 max-w-md text-espresso/80">{error || "We couldn't find that order in your account."}</p>
        <div className="mt-8 flex flex-wrap justify-center gap-4">
          <button type="button" onClick={() => setAttempt((n) => n + 1)} className="btn-outline">Try again</button>
          <Link to="/my-orders" className="btn-primary">My orders</Link>
        </div>
      </section>
    );
  }

  const { order, items, payments } = detail;
  const payment = payments[0] ?? null;
  const address = shippingAddressLines(order.shipping_address);
  const unitCount = items.reduce((sum, item) => sum + item.quantity, 0);

  return (
    <section className="container-x max-w-4xl py-12 md:py-16">
      <p className="text-sm text-walnut/70"><Link to="/my-orders" className="underline underline-offset-4">My orders</Link></p>
      <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-4xl text-walnut">{order.order_number}</h1>
          <p className="mt-1 text-sm text-walnut/70">Placed {formatDateTime(order.created_at)} · {unitCount} {unitCount === 1 ? "item" : "items"}</p>
        </div>
        <OrderStatusBadge status={order.order_status} />
      </div>
      <p className="mt-4 text-espresso/80">{customerOrderStatusMessage[order.order_status]}</p>
      <div className="mt-5 flex flex-wrap gap-3">
        <Link to={`/track/${order.id}`} className="btn-primary px-5 py-2.5 text-sm">Track this order</Link>
        {canOpenPaymentPage(order) && <Link to={`/payment/${order.id}`} className="btn-outline px-5 py-2.5 text-sm">{order.payment_status === "verification_pending" ? "View payment" : "Complete payment"}</Link>}
      </div>

      <div className="mt-8 grid gap-6 md:grid-cols-[1.4fr_1fr]">
        <div className="border border-brass/40 p-6">
          <h2 className="text-xl text-walnut">Items</h2>
          <ul className="mt-4 grid gap-4">
            {items.map((item) => (
              <li key={item.id} className="flex items-center gap-4">
                <OrderThumb src={item.product_image_url} />
                <div className="min-w-0 flex-1 text-sm"><p className="font-medium text-walnut">{item.product_name}</p><p className="text-walnut/70">{formatINR(item.unit_price_inr)} × {item.quantity}</p></div>
                <p className="text-sm font-medium">{formatINR(item.line_subtotal_inr)}</p>
              </li>
            ))}
          </ul>
          <dl className="mt-5 grid gap-2 border-t border-brass/40 pt-4 text-sm">
            <div className="flex justify-between"><dt>Subtotal</dt><dd>{formatINR(order.subtotal_inr)}</dd></div>
            {order.discount_inr > 0 && <div className="flex justify-between"><dt>Coupon{order.coupon_code ? ` (${order.coupon_code})` : ""}</dt><dd>−{formatINR(order.discount_inr)}</dd></div>}
            <div className="flex justify-between"><dt>Delivery</dt><dd>{order.delivery_charge_inr === 0 ? "Free" : formatINR(order.delivery_charge_inr)}</dd></div>
            <div className="flex justify-between border-t border-brass/40 pt-2 font-medium"><dt>Total</dt><dd>{formatINR(order.total_inr)}</dd></div>
          </dl>
        </div>

        <div className="grid content-start gap-6">
          <div className="border border-brass/40 p-6">
            <h2 className="text-xl text-walnut">Payment</h2>
            <dl className="mt-3 grid gap-2 text-sm">
              <div className="flex justify-between gap-4"><dt className="text-walnut/70">Method</dt><dd>{order.payment_method === "upi" ? "UPI" : "Cash on delivery"}</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-walnut/70">Status</dt><dd className="font-medium">{customerPaymentLabel[order.payment_status]}</dd></div>
              {payment && <div className="flex justify-between gap-4"><dt className="text-walnut/70">Amount</dt><dd>{formatINR(payment.amount_inr)}</dd></div>}
              {payment?.transaction_reference && <div className="flex justify-between gap-4"><dt className="text-walnut/70">Reference</dt><dd className="break-all">{payment.transaction_reference}</dd></div>}
              {payment?.verified_at && <div className="flex justify-between gap-4"><dt className="text-walnut/70">Verified</dt><dd>{formatDateTime(payment.verified_at)}</dd></div>}
            </dl>
            {order.payment_method === "upi" && order.payment_status === "verification_pending" && <p className="mt-3 text-xs text-walnut/70">We are checking your payment against our bank records. You'll see it marked as paid once confirmed.</p>}
          </div>
          <div className="border border-brass/40 p-6">
            <h2 className="text-xl text-walnut">Delivering to</h2>
            <address className="mt-3 grid gap-1 text-sm not-italic">{address.map((line, index) => <span key={index}>{line}</span>)}</address>
          </div>
        </div>
      </div>

      <div className="mt-6">
        {tracking
          ? <ShipmentCard shipment={tracking.shipment} orderStatus={order.order_status} />
          : trackingFailed
            ? <div className="border border-brass/40 p-6"><h2 className="text-xl text-walnut">Shipment</h2><p role="status" className="mt-3 text-sm text-espresso/80">We couldn't load shipment details just now. <button type="button" onClick={() => setAttempt((n) => n + 1)} className="underline underline-offset-4">Try again</button></p></div>
            : <div className="border border-brass/40 p-6"><h2 className="text-xl text-walnut">Shipment</h2><p role="status" className="mt-3 text-sm text-walnut/70">Loading shipment details...</p></div>}
      </div>

      {order.customer_note && <div className="mt-6 border border-brass/40 p-6"><h2 className="text-xl text-walnut">Your note</h2><p className="mt-3 whitespace-pre-wrap text-sm text-espresso/80">{order.customer_note}</p></div>}
    </section>
  );
}
