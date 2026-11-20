import { supabase } from "../lib/supabase";
import type { DbOrderRow, Json, OrderPaymentStatus, OrderStatus, PaymentMethod } from "../types/database";
import { isOrderStatus, isPaymentStatus } from "../utils/orderStatus";

/**
 * Customer-side order reads. Ownership is enforced by row-level security and by the get_customer_order_tracking
 * function; the explicit customer_id filters below are an additional guard, not the only one. Columns are listed
 * explicitly so internal fields (idempotency key, admin verification notes, status-change reasons) are never requested.
 */

export type CustomerOrderFilter = "all" | "in_progress" | "delivered" | "closed";

const FILTER_STATUSES: Record<Exclude<CustomerOrderFilter, "all">, OrderStatus[]> = {
  in_progress: ["pending", "confirmed", "processing", "shipped", "out_for_delivery"],
  delivered: ["delivered"],
  closed: ["cancelled", "returned"],
};

const ORDER_COLUMNS = "id,order_number,customer_name,customer_phone,shipping_address,order_status,payment_method,payment_status,subtotal_inr,discount_inr,delivery_charge_inr,total_inr,customer_note,coupon_code,created_at,updated_at";
const ORDER_NUMBER_PATTERN = /^(?:CL|VH)-\d{8}-[A-Z0-9]{8}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type CustomerOrder = Pick<DbOrderRow,
  "id" | "order_number" | "customer_name" | "customer_phone" | "shipping_address" | "order_status" | "payment_method" | "payment_status"
  | "subtotal_inr" | "discount_inr" | "delivery_charge_inr" | "total_inr" | "customer_note" | "coupon_code" | "created_at" | "updated_at">;

export interface CustomerOrderItem {
  id: string;
  order_id: string;
  product_name: string;
  product_image_url: string | null;
  quantity: number;
  unit_price_inr: number;
  line_subtotal_inr: number;
}

export interface CustomerPayment {
  id: string;
  payment_method: PaymentMethod;
  payment_status: OrderPaymentStatus;
  amount_inr: number;
  transaction_reference: string | null;
  verified_at: string | null;
  created_at: string;
}

export interface CustomerOrderSummary extends CustomerOrder {
  items: Pick<CustomerOrderItem, "id" | "product_name" | "product_image_url" | "quantity">[];
  itemCount: number;
}

export interface CustomerOrderDetail {
  order: CustomerOrder;
  items: CustomerOrderItem[];
  payments: CustomerPayment[];
}

export interface TrackingShipment {
  carrier: string | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
  status: string;
  shippedAt: string | null;
  deliveredAt: string | null;
}

export interface TrackingEvent { status: OrderStatus; at: string }

export interface OrderTracking {
  orderId: string;
  orderNumber: string;
  orderStatus: OrderStatus;
  paymentMethod: PaymentMethod | null;
  paymentStatus: OrderPaymentStatus;
  createdAt: string;
  updatedAt: string;
  shipment: TrackingShipment | null;
  timeline: TrackingEvent[];
}

export class OrderNotFoundError extends Error {
  constructor() { super("We couldn't find that order in your account."); this.name = "OrderNotFoundError"; }
}

export interface MyOrdersResult { orders: CustomerOrderSummary[]; total: number }

export async function getMyOrders(customerId: string, options: { page: number; pageSize: number; filter: CustomerOrderFilter }): Promise<MyOrdersResult> {
  const from = Math.max(0, options.page - 1) * options.pageSize;
  let query = supabase.from("orders").select(ORDER_COLUMNS, { count: "exact" })
    .eq("customer_id", customerId)
    .order("created_at", { ascending: false })
    .range(from, from + options.pageSize - 1);
  if (options.filter !== "all") query = query.in("order_status", FILTER_STATUSES[options.filter]);

  const { data, error, count } = await query;
  if (error) throw error;
  const orders = (data ?? []) as unknown as CustomerOrder[];
  if (!orders.length) return { orders: [], total: count ?? 0 };

  const { data: itemRows, error: itemError } = await supabase.from("order_items")
    .select("id,order_id,product_name,product_image_url,quantity")
    .in("order_id", orders.map((order) => order.id))
    .order("created_at");
  if (itemError) throw itemError;

  const byOrder = new Map<string, CustomerOrderSummary["items"]>();
  for (const row of itemRows ?? []) {
    const list = byOrder.get(row.order_id) ?? [];
    list.push({ id: row.id, product_name: row.product_name, product_image_url: row.product_image_url, quantity: row.quantity });
    byOrder.set(row.order_id, list);
  }
  return {
    orders: orders.map((order) => {
      const items = byOrder.get(order.id) ?? [];
      return { ...order, items, itemCount: items.reduce((sum, item) => sum + item.quantity, 0) };
    }),
    total: count ?? orders.length,
  };
}

/** Accepts the order id (UUID) or the printed order number (VH-YYYYMMDD-XXXXXXXX); anything else is "not found". */
function orderRefFilter(reference: string): { column: "id" | "order_number"; value: string } {
  const cleaned = reference.trim();
  if (UUID_PATTERN.test(cleaned)) return { column: "id", value: cleaned.toLowerCase() };
  const upper = cleaned.toUpperCase();
  if (ORDER_NUMBER_PATTERN.test(upper)) return { column: "order_number", value: upper };
  throw new OrderNotFoundError();
}

export async function resolveMyOrder(customerId: string, reference: string): Promise<{ id: string; order_number: string }> {
  const filter = orderRefFilter(reference);
  const { data, error } = await supabase.from("orders").select("id,order_number").eq("customer_id", customerId).eq(filter.column, filter.value).maybeSingle();
  if (error) throw error;
  if (!data) throw new OrderNotFoundError();
  return data;
}

export async function getMyOrderDetail(customerId: string, reference: string): Promise<CustomerOrderDetail> {
  const filter = orderRefFilter(reference);
  const { data: orderData, error } = await supabase.from("orders").select(ORDER_COLUMNS).eq("customer_id", customerId).eq(filter.column, filter.value).maybeSingle();
  if (error) throw error;
  if (!orderData) throw new OrderNotFoundError();
  const order = orderData as unknown as CustomerOrder;

  const [itemsResult, paymentsResult] = await Promise.all([
    supabase.from("order_items").select("id,order_id,product_name,product_image_url,quantity,unit_price_inr,line_subtotal_inr").eq("order_id", order.id).order("created_at"),
    supabase.rpc("get_customer_order_payments", { p_order_id: order.id }),
  ]);
  if (itemsResult.error) throw itemsResult.error;
  if (paymentsResult.error) throw paymentsResult.error;
  const paymentRows = Array.isArray(paymentsResult.data) ? paymentsResult.data as unknown as CustomerPayment[] : [];
  return { order, items: itemsResult.data as CustomerOrderItem[], payments: paymentRows };
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const textOrNull = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value : null);

/** Calls the existing-owner-checked RPC and validates the JSON it returns instead of trusting its shape. */
export async function getOrderTracking(orderId: string): Promise<OrderTracking> {
  const { data, error } = await supabase.rpc("get_customer_order_tracking", { p_order_id: orderId });
  if (error) throw error;
  return parseTracking(data);
}

export function parseTracking(data: Json): OrderTracking {
  if (!isRecord(data)) throw new Error("Tracking details were not returned in the expected format.");
  const { order_id, order_number, order_status, payment_method, payment_status, created_at, updated_at, shipment, timeline } = data;
  if (typeof order_id !== "string" || typeof order_number !== "string" || !isOrderStatus(order_status) || !isPaymentStatus(payment_status)
    || (payment_method !== null && payment_method !== "upi" && payment_method !== "cod") || typeof created_at !== "string" || typeof updated_at !== "string") {
    throw new Error("Tracking details were not returned in the expected format.");
  }
  let parsedShipment: TrackingShipment | null = null;
  if (isRecord(shipment)) {
    parsedShipment = {
      carrier: textOrNull(shipment.carrier),
      trackingNumber: textOrNull(shipment.tracking_number),
      trackingUrl: textOrNull(shipment.tracking_url),
      status: typeof shipment.shipment_status === "string" ? shipment.shipment_status : "pending",
      shippedAt: textOrNull(shipment.shipped_at),
      deliveredAt: textOrNull(shipment.delivered_at),
    };
  }
  const events: TrackingEvent[] = [];
  if (Array.isArray(timeline)) {
    for (const entry of timeline) {
      if (isRecord(entry) && isOrderStatus(entry.status) && typeof entry.at === "string") events.push({ status: entry.status, at: entry.at });
    }
  }
  return {
    orderId: order_id, orderNumber: order_number, orderStatus: order_status, paymentMethod: payment_method as PaymentMethod | null,
    paymentStatus: payment_status, createdAt: created_at, updatedAt: updated_at, shipment: parsedShipment, timeline: events,
  };
}

export function friendlyOrderError(reason: unknown): string {
  if (reason instanceof OrderNotFoundError) return reason.message;
  const e = (typeof reason === "object" && reason !== null ? reason : {}) as { code?: string; message?: string };
  if (e.code === "P0002") return "We couldn't find that order in your account.";
  if (e.code === "42501") return "Please sign in again to see your orders.";
  if (e.code === "42883" || e.code === "PGRST202") return "Order tracking isn't available yet. Please try again later.";
  return "We couldn't load your orders. Please check your connection and try again.";
}

export type { Json };
