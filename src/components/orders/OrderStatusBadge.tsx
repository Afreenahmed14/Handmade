import type { OrderStatus } from "../../types/database";
import { customerOrderStatusLabel } from "../../utils/orderStatus";

const tone: Record<OrderStatus, string> = {
  pending: "border-brass bg-brass/10 text-walnut",
  confirmed: "border-brass bg-brass/10 text-walnut",
  processing: "border-brass bg-brass/10 text-walnut",
  shipped: "border-walnut bg-walnut/10 text-walnut",
  out_for_delivery: "border-walnut bg-walnut/10 text-walnut",
  delivered: "border-olive bg-olive/10 text-olive",
  cancelled: "border-red-700 bg-red-50 text-red-800",
  returned: "border-red-700 bg-red-50 text-red-800",
};

export default function OrderStatusBadge({ status }: { status: OrderStatus }) {
  return <span className={`inline-block border px-3 py-1 text-xs font-medium ${tone[status]}`}>{customerOrderStatusLabel[status]}</span>;
}
