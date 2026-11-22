import type { OrderPaymentStatus, OrderStatus } from "../types/database";

/** The happy path, in order. cancelled and returned are terminal side branches and are not part of it. */
export const ORDER_STEPS: readonly OrderStatus[] = ["pending", "confirmed", "processing", "shipped", "out_for_delivery", "delivered"];

export const ALL_ORDER_STATUSES: readonly OrderStatus[] = [...ORDER_STEPS, "cancelled", "returned"];

/** Customer-facing wording. The admin screens keep their own operational labels. */
export const customerOrderStatusLabel: Record<OrderStatus, string> = {
  pending: "Order placed",
  confirmed: "Confirmed",
  processing: "Being prepared",
  shipped: "Shipped",
  out_for_delivery: "Out for delivery",
  delivered: "Delivered",
  cancelled: "Cancelled",
  returned: "Returned",
};

export const customerOrderStatusMessage: Record<OrderStatus, string> = {
  pending: "Your order has been placed. We will update its progress here.",
  confirmed: "Your order is confirmed. We will start preparing it soon.",
  processing: "Your pieces are being checked and carefully packed.",
  shipped: "Your order is on its way to you.",
  out_for_delivery: "Your order is out for delivery and should reach you today.",
  delivered: "Your order has been delivered. We hope you enjoy it.",
  cancelled: "This order was cancelled.",
  returned: "This order was returned to us.",
};

export const customerPaymentLabel: Record<OrderPaymentStatus, string> = {
  pending: "Payment pending",
  verification_pending: "Payment being verified",
  paid: "Paid",
  failed: "Payment needs attention",
  cod_due: "Pay on delivery",
  refunded: "Refunded",
};

export function isOrderStatus(value: unknown): value is OrderStatus {
  return typeof value === "string" && (ALL_ORDER_STATUSES as readonly string[]).includes(value);
}

export function isPaymentStatus(value: unknown): value is OrderPaymentStatus {
  return typeof value === "string" && ["pending", "verification_pending", "paid", "failed", "cod_due", "refunded"].includes(value);
}

/** An order is "open" while it is still moving through fulfilment. */
export function isOrderOpen(status: OrderStatus): boolean {
  return status !== "cancelled" && status !== "returned" && status !== "delivered";
}

/** A UPI payment the customer may still need to act on from the payment page. */
export function canOpenPaymentPage(order: { payment_method: string; payment_status: OrderPaymentStatus; order_status: OrderStatus }): boolean {
  return order.payment_method === "upi"
    && (order.payment_status === "pending" || order.payment_status === "failed" || order.payment_status === "verification_pending")
    && order.order_status !== "cancelled" && order.order_status !== "returned";
}

/**
 * Only https links are ever rendered as hrefs. The database enforces the same rule when an admin saves a tracking
 * link; this is the second line of defence for rows written before that rule existed.
 */
export function safeHttpsUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-IN", { dateStyle: "medium" }).format(date);
}
