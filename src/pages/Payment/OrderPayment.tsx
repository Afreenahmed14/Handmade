import { Link, useParams } from "react-router-dom";
import UpiPaymentPanel from "../../components/payment/UpiPaymentPanel";

/**
 * Standalone payment page for one UPI order. It lets a customer come back later to pay, submit or correct their
 * transaction reference and proof, and check the verification status. Ownership is enforced by the database.
 */
export default function OrderPayment() {
  const { orderId = "" } = useParams();
  return (
    <section className="container-x max-w-3xl py-12 md:py-16">
      <p className="text-sm text-walnut/70"><Link to="/my-orders" className="underline">My orders</Link></p>
      <h1 className="mt-2 text-4xl text-walnut">Order payment</h1>
      <UpiPaymentPanel orderId={orderId} />
      <div className="mt-8 flex flex-wrap gap-4"><Link to="/my-orders" className="btn-outline">My orders</Link><Link to="/shop" className="btn-outline">Continue shopping</Link></div>
    </section>
  );
}
