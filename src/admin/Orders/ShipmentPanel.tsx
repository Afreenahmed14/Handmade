import { useEffect, useState, type FormEvent } from "react";
import { AlertTriangle, ExternalLink, Truck } from "lucide-react";
import { updateOrderShipment, type OrderDetail } from "../../services/orders";
import { safeHttpsUrl } from "../../utils/orderStatus";

const EDITABLE = ["processing", "shipped", "out_for_delivery", "delivered"] as const;
const CARRIER_SUGGESTIONS = ["Delhivery", "Blue Dart", "DTDC", "India Post", "Ecom Express", "XpressBees", "Shadowfax"];

const formatDate = (value: string | null) => value ? new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "";

function errorText(reason: unknown) {
  return reason instanceof Error ? reason.message : "The shipment details could not be saved.";
}

interface Props {
  detail: OrderDetail;
  /** Reloads the order detail and list after a successful save. */
  onSaved: () => Promise<void>;
  notify: (text: string, tone: "success" | "error" | "warning") => void;
}

/**
 * Carrier and tracking details for one order. Saving only writes those three fields through admin_update_order_shipment;
 * the order status itself still moves only through the existing status form above.
 */
export default function ShipmentPanel({ detail, onSaved, notify }: Props) {
  const { order, shipment } = detail;
  const editable = (EDITABLE as readonly string[]).includes(order.order_status);
  const [carrier, setCarrier] = useState(shipment?.carrier ?? "");
  const [trackingNumber, setTrackingNumber] = useState(shipment?.tracking_number ?? "");
  const [trackingUrl, setTrackingUrl] = useState(shipment?.tracking_url ?? "");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  // Re-seed the form whenever a different order is opened or the saved shipment changes.
  useEffect(() => {
    setCarrier(shipment?.carrier ?? "");
    setTrackingNumber(shipment?.tracking_number ?? "");
    setTrackingUrl(shipment?.tracking_url ?? "");
    setFormError("");
  }, [order.id, shipment?.updated_at, shipment?.carrier, shipment?.tracking_number, shipment?.tracking_url]);

  const dirty = carrier.trim() !== (shipment?.carrier ?? "") || trackingNumber.trim() !== (shipment?.tracking_number ?? "") || trackingUrl.trim() !== (shipment?.tracking_url ?? "");
  const link = safeHttpsUrl(shipment?.tracking_url);
  const inTransit = order.order_status === "shipped" || order.order_status === "out_for_delivery";
  const missingTracking = inTransit && !shipment?.tracking_number && !shipment?.tracking_url;

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError("");
    setSaving(true);
    try {
      await updateOrderShipment(order.id, { carrier, trackingNumber, trackingUrl });
      await onSaved();
      notify(`Shipment details saved for ${order.order_number}.`, "success");
    } catch (reason) {
      setFormError(errorText(reason));
    } finally {
      setSaving(false);
    }
  }

  const input = "border border-brass/40 bg-cream px-3 py-2 text-sm text-white placeholder:text-espresso/55 disabled:opacity-50";

  return (
    <section className="border border-brass/40 p-4">
      <h3 className="flex items-center gap-2 font-medium text-white"><Truck size={16} className="text-walnut" />Shipping</h3>

      <div className="mt-3 space-y-1 text-sm text-espresso/80">
        <p>Status: <span className="text-espresso">{shipment ? shipment.shipment_status.replace(/_/g, " ") : "not shipped"}</span></p>
        {shipment?.shipped_at && <p>Shipped: {formatDate(shipment.shipped_at)}</p>}
        {shipment?.delivered_at && <p>Delivered: {formatDate(shipment.delivered_at)}</p>}
        {link && <a href={link} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-walnut hover:underline">Open tracking <ExternalLink size={13} /></a>}
        {shipment?.tracking_url && !link && <p className="text-amber-200">The saved tracking link is not a secure https:// URL and is hidden from customers.</p>}
      </div>

      {missingTracking && <p role="status" className="mt-3 flex items-start gap-2 border border-amber-800/70 bg-amber-950/20 p-2 text-xs text-amber-100"><AlertTriangle size={14} className="mt-px shrink-0" />This order is in transit but has no carrier or tracking details, so the customer sees none.</p>}

      {editable
        ? <form onSubmit={save} className="mt-4 grid gap-3">
            <label className="grid gap-1 text-xs text-espresso/65">Carrier
              <input list="shipment-carriers" value={carrier} maxLength={80} onChange={(event) => setCarrier(event.target.value)} placeholder="e.g. Delhivery" className={input} disabled={saving} />
              <datalist id="shipment-carriers">{CARRIER_SUGGESTIONS.map((name) => <option key={name} value={name} />)}</datalist>
            </label>
            <label className="grid gap-1 text-xs text-espresso/65">Tracking number
              <input value={trackingNumber} maxLength={100} onChange={(event) => setTrackingNumber(event.target.value)} autoComplete="off" spellCheck={false} className={input} disabled={saving} />
            </label>
            <label className="grid gap-1 text-xs text-espresso/65">Tracking link (https)
              <input type="url" inputMode="url" value={trackingUrl} maxLength={2000} onChange={(event) => setTrackingUrl(event.target.value)} placeholder="https://" autoComplete="off" spellCheck={false} className={input} disabled={saving} />
            </label>
            {formError && <p role="alert" className="border-l-2 border-red-400 pl-3 text-xs text-red-200">{formError}</p>}
            <div className="flex flex-wrap items-center gap-3">
              <button disabled={saving || !dirty} className="inline-flex items-center gap-2 border border-brass/50 bg-[#f7edf2] px-4 py-2 text-sm text-walnut hover:bg-[#eadbd2] disabled:opacity-50">{saving ? "Saving..." : "Save shipment details"}</button>
              {!dirty && !saving && <span className="text-xs text-espresso/55">No changes to save.</span>}
            </div>
            <p className="text-xs text-espresso/55">Saving does not change the order status. Customers see these details on My orders and Track order.</p>
          </form>
        : <p className="mt-4 text-sm text-espresso/65">
            {order.order_status === "cancelled" || order.order_status === "returned"
              ? "This order is closed, so shipment details can't be edited."
              : "Move the order to Processing to add carrier and tracking details."}
          </p>}
    </section>
  );
}
