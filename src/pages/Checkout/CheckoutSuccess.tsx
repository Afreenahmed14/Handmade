import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { CheckCircle2 } from "lucide-react";
import UpiPaymentPanel from "../../components/payment/UpiPaymentPanel";
import { useStoreSettings } from "../../context/StoreSettingsContext";
import { formatINR } from "../../utils/currency";
import { useAuth } from "../../context/AuthContext";
import { getMyOrderDetail, type CustomerOrderDetail } from "../../services/customerOrders";
import type { Json } from "../../types/database";

const addressLine = (address: Json): string[] => {
  if (!address || typeof address !== "object" || Array.isArray(address)) return [];
  const read = (key: string) => { const value = address[key]; return typeof value === "string" ? value : ""; };
  return [read("full_name"), read("phone"), read("address_line1"), read("address_line2"), [read("city"), read("state"), read("postal_code")].filter(Boolean).join(", "), read("country")].filter(Boolean);
};

export default function CheckoutSuccess() {
  const { orderId = "" } = useParams();
  const { settings } = useStoreSettings();
  const { user } = useAuth();
  const userId = user?.id ?? "";
  const [detail, setDetail] = useState<CustomerOrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!userId) return;
    let active = true;
    setLoading(true);
    setError("");
    // Row-level security only returns orders that belong to the signed-in customer.
    void getMyOrderDetail(userId, orderId).then((result) => { if (active) setDetail(result); }).catch(() => {
      if (active) setError("We couldn't load this order. If you just placed it, it is safe — check My orders shortly.");
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [orderId, userId]);

  if (loading) return <section className="container-x py-24 text-center"><p role="status" className="text-walnut/70">Loading your order...</p></section>;
  if (error || !detail) {
    return (
      <section className="container-x py-24 text-center">
        <h1 className="text-4xl text-walnut">Order confirmation unavailable</h1>
        <p role="alert" className="mx-auto mt-4 max-w-md text-espresso/80">{error || "We couldn't find this order."}</p>
        <div className="mt-8 flex flex-wrap justify-center gap-4"><Link to="/my-orders" className="btn-primary">My orders</Link><Link to="/shop" className="btn-outline">Continue shopping</Link></div>
      </section>
    );
  }

  const { order, items } = detail;
  return (
    <section className="container-x max-w-3xl py-14 md:py-20">
      <div className="text-center">
        <CheckCircle2 size={40} className="mx-auto text-olive" aria-hidden="true" />
        <h1 className="mt-4 text-4xl text-walnut">Thank you, your order is placed</h1>
        <p className="mt-3 text-espresso/80">Order number <strong>{order.order_number}</strong>. Keep it handy if you contact us.</p>
        <p className="mt-1 text-sm text-walnut/70">Your order is pending confirmation by our team.</p>
      </div>

      {order.payment_method === "cod"
        ? <div className="mt-10 border border-brass/40 p-6">
            <h2 className="text-2xl text-walnut">Cash on delivery</h2>
            <p className="mt-2 text-sm text-espresso/80">Please keep {formatINR(order.total_inr)} ready to pay in cash when your order arrives.</p>
          </div>
        : <UpiPaymentPanel orderId={order.id} />}

      <div className="mt-6 grid gap-6 md:grid-cols-2">
        <div className="border border-brass/40 p-6">
          <h2 className="text-xl text-walnut">Items</h2>
          <ul className="mt-3 grid gap-2 text-sm">{items.map((item) => <li key={item.id} className="flex justify-between gap-3"><span>{item.product_name} × {item.quantity}</span><span>{formatINR(item.line_subtotal_inr)}</span></li>)}</ul>
          <dl className="mt-4 grid gap-2 border-t border-brass/40 pt-3 text-sm">
            <div className="flex justify-between"><dt>Subtotal</dt><dd>{formatINR(order.subtotal_inr)}</dd></div>
            {order.discount_inr > 0 && <div className="flex justify-between"><dt>Coupon{order.coupon_code ? ` (${order.coupon_code})` : ""}</dt><dd>−{formatINR(order.discount_inr)}</dd></div>}
            <div className="flex justify-between"><dt>Delivery</dt><dd>{order.delivery_charge_inr === 0 ? "Free" : formatINR(order.delivery_charge_inr)}</dd></div>
            <div className="flex justify-between border-t border-brass/40 pt-2 font-medium"><dt>Total</dt><dd>{formatINR(order.total_inr)}</dd></div>
          </dl>
        </div>
        <div className="border border-brass/40 p-6">
          <h2 className="text-xl text-walnut">Delivering to</h2>
          <address className="mt-3 grid gap-1 text-sm not-italic">{addressLine(order.shipping_address).map((line, index) => <span key={index}>{line}</span>)}</address>
          {settings.estimated_delivery_text && <p className="mt-4 text-sm text-walnut/80">Estimated delivery: {settings.estimated_delivery_text}</p>}
        </div>
      </div>

      <div className="mt-10 flex flex-wrap justify-center gap-4"><Link to="/my-orders" className="btn-primary">View my orders</Link><Link to="/shop" className="btn-outline">Continue shopping</Link></div>
    </section>
  );
}
