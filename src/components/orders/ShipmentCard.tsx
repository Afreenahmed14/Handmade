import { ExternalLink, Truck } from "lucide-react";
import type { OrderStatus } from "../../types/database";
import type { TrackingShipment } from "../../services/customerOrders";
import { formatDateTime, safeHttpsUrl } from "../../utils/orderStatus";

export default function ShipmentCard({ shipment, orderStatus }: { shipment: TrackingShipment | null; orderStatus: OrderStatus }) {
  const link = safeHttpsUrl(shipment?.trackingUrl);
  const hasDetails = Boolean(shipment && (shipment.carrier || shipment.trackingNumber || link));
  const shipped = orderStatus === "shipped" || orderStatus === "out_for_delivery" || orderStatus === "delivered";

  return (
    <div className="border border-brass/40 p-6">
      <h2 className="flex items-center gap-2 text-xl text-walnut"><Truck size={18} aria-hidden="true" />Shipment</h2>
      {hasDetails && shipment
        ? <dl className="mt-3 grid gap-2 text-sm">
            {shipment.carrier && <div className="flex justify-between gap-4"><dt className="text-walnut/70">Carrier</dt><dd>{shipment.carrier}</dd></div>}
            {shipment.trackingNumber && <div className="flex justify-between gap-4"><dt className="text-walnut/70">Tracking number</dt><dd className="break-all font-medium">{shipment.trackingNumber}</dd></div>}
            {shipment.shippedAt && <div className="flex justify-between gap-4"><dt className="text-walnut/70">Shipped</dt><dd>{formatDateTime(shipment.shippedAt)}</dd></div>}
            {shipment.deliveredAt && <div className="flex justify-between gap-4"><dt className="text-walnut/70">Delivered</dt><dd>{formatDateTime(shipment.deliveredAt)}</dd></div>}
            {link && <div className="pt-2"><a href={link} target="_blank" rel="noopener noreferrer" className="btn-outline px-4 py-2 text-sm">Track with carrier<ExternalLink size={14} aria-hidden="true" /><span className="sr-only"> (opens in a new tab)</span></a></div>}
          </dl>
        : <p className="mt-3 text-sm text-espresso/80">
            {orderStatus === "cancelled" || orderStatus === "returned" ? "No shipment is active for this order."
              : shipped ? "Your order is on its way. Carrier and tracking details will appear here as soon as we have them."
              : "Your order hasn't shipped yet. Tracking details will appear here once it does."}
          </p>}
    </div>
  );
}
