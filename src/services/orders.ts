import type { Database, DbOrderRow, DbPaymentRecordRow, Json, OrderPaymentStatus, OrderStatus } from "../types/database";
import { supabase } from "../lib/supabase";

export type OrderItemRecord = Database["public"]["Tables"]["order_items"]["Row"];
export type OrderStatusHistoryRecord = Database["public"]["Tables"]["order_status_history"]["Row"];
export type OrderShipmentRecord = Database["public"]["Tables"]["order_shipments"]["Row"];

export interface OrderListItem extends DbOrderRow {
  itemCount: number;
}

export interface OrderListFilters {
  page: number;
  pageSize: number;
  search?: string;
  dateFrom?: string;
  dateTo?: string;
  paymentStatus?: OrderPaymentStatus | "all";
  orderStatus?: OrderStatus | "all";
}

export interface OrderListResult {
  orders: OrderListItem[];
  total: number;
}

export interface OrderDashboardSummary {
  totalOrders: number;
  pendingOrders: number;
  confirmedOrders: number;
  processingOrders: number;
  shippedOrders: number;
  deliveredOrders: number;
  cancelledOrders: number;
  returnedOrders: number;
  totalRevenue: number;
}

export interface OrderDetail {
  order: DbOrderRow;
  items: OrderItemRecord[];
  payments: DbPaymentRecordRow[];
  history: OrderStatusHistoryRecord[];
  shipment: OrderShipmentRecord | null;
}

export interface CustomerOrderInput {
  items: { productId: string; quantity: number }[];
  shippingAddress: Json;
  paymentMethod: "upi" | "cod";
  idempotencyKey: string;
  customerNote?: string;
}

function cleanSearch(value: string) {
  return value.replace(/[%,_()"\\]/g, " ").replace(/\s+/g, " ").trim();
}

export async function getOrderDashboardSummary(): Promise<OrderDashboardSummary> {
  const { data, error } = await supabase.rpc("get_order_dashboard_summary");
  if (error) throw error;
  const row = data[0];
  if (!row) throw new Error("Order summary was not returned by the database.");
  return {
    totalOrders: Number(row.total_orders), pendingOrders: Number(row.pending_orders),
    confirmedOrders: Number(row.confirmed_orders), processingOrders: Number(row.processing_orders),
    shippedOrders: Number(row.shipped_orders), deliveredOrders: Number(row.delivered_orders),
    cancelledOrders: Number(row.cancelled_orders), returnedOrders: Number(row.returned_orders),
    totalRevenue: Number(row.total_revenue_inr),
  };
}

export async function getOrders(filters: OrderListFilters): Promise<OrderListResult> {
  const from = Math.max(0, filters.page - 1) * filters.pageSize;
  let query = supabase.from("orders").select("*", { count: "exact" }).order("created_at", { ascending: false }).range(from, from + filters.pageSize - 1);
  const search = filters.search ? cleanSearch(filters.search) : "";
  if (search) query = query.or(`order_number.ilike.%${search}%,customer_name.ilike.%${search}%,customer_email.ilike.%${search}%`);
  if (filters.dateFrom) query = query.gte("created_at", new Date(`${filters.dateFrom}T00:00:00`).toISOString());
  if (filters.dateTo) query = query.lte("created_at", new Date(`${filters.dateTo}T23:59:59.999`).toISOString());
  if (filters.paymentStatus && filters.paymentStatus !== "all") query = query.eq("payment_status", filters.paymentStatus);
  if (filters.orderStatus && filters.orderStatus !== "all") query = query.eq("order_status", filters.orderStatus);

  const { data: orders, error, count } = await query;
  if (error) throw error;
  if (!orders.length) return { orders: [], total: count ?? 0 };

  const { data: items, error: itemError } = await supabase.from("order_items").select("order_id,quantity").in("order_id", orders.map((order) => order.id));
  if (itemError) throw itemError;
  const itemCounts = new Map<string, number>();
  for (const item of items) itemCounts.set(item.order_id, (itemCounts.get(item.order_id) ?? 0) + item.quantity);
  return { orders: orders.map((order) => ({ ...order, itemCount: itemCounts.get(order.id) ?? 0 })), total: count ?? orders.length };
}

export async function getOrderDetail(orderId: string): Promise<OrderDetail> {
  const [orderResult, itemsResult, paymentsResult, historyResult, shipmentResult] = await Promise.all([
    supabase.from("orders").select("*").eq("id", orderId).single(),
    supabase.from("order_items").select("*").eq("order_id", orderId).order("created_at"),
    supabase.from("payment_records").select("id,order_id,payment_method,payment_status,amount_inr,transaction_reference,payment_proof_path,verified_by,verified_at,verification_note,created_at,updated_at,provider").eq("order_id", orderId).order("created_at", { ascending: false }),
    supabase.from("order_status_history").select("*").eq("order_id", orderId).order("created_at"),
    supabase.from("order_shipments").select("*").eq("order_id", orderId).maybeSingle(),
  ]);
  if (orderResult.error) throw orderResult.error;
  if (itemsResult.error) throw itemsResult.error;
  if (paymentsResult.error) throw paymentsResult.error;
  if (historyResult.error) throw historyResult.error;
  if (shipmentResult.error) throw shipmentResult.error;
  return {
    order: orderResult.data,
    items: itemsResult.data,
    payments: paymentsResult.data as DbPaymentRecordRow[],
    history: historyResult.data,
    shipment: shipmentResult.data,
  };
}

export async function updateOrderStatus(orderId: string, status: OrderStatus, reason: string): Promise<DbOrderRow> {
  const cleanedReason = reason.trim();
  if (!cleanedReason || cleanedReason.length > 1000) throw new Error("Provide a status-change reason of 1 to 1000 characters.");
  const { data, error } = await supabase.rpc("admin_update_order_status", {
    p_order_id: orderId,
    p_new_status: status,
    p_reason: cleanedReason,
  });
  if (error) throw error;
  return data;
}

export async function verifyOrderPayment(paymentId: string, transactionReference: string, note?: string): Promise<DbPaymentRecordRow> {
  const reference = transactionReference.trim();
  if (!reference || reference.length > 200) throw new Error("Enter a transaction reference of 1 to 200 characters.");
  if (note && note.length > 1000) throw new Error("Verification note must be 1000 characters or fewer.");
  const { data, error } = await supabase.rpc("admin_verify_order_payment", {
    p_payment_id: paymentId,
    p_transaction_reference: reference,
    p_verification_note: note?.trim() || null,
  });
  if (error) throw error;
  return data;
}

export async function receiveOrderReturn(orderItemId: string, quantity: number, reason: string, requestId: string): Promise<number> {
  if (!Number.isSafeInteger(quantity) || quantity <= 0) throw new Error("Return quantity must be a positive whole number.");
  const cleanedReason = reason.trim();
  if (!cleanedReason || cleanedReason.length > 500) throw new Error("Provide a return reason of 1 to 500 characters.");
  const { data, error } = await supabase.rpc("admin_receive_order_return", {
    p_order_item_id: orderItemId,
    p_quantity: quantity,
    p_reason: cleanedReason,
    p_request_id: requestId,
  });
  if (error) throw error;
  return data;
}

export async function createCustomerOrder(input: CustomerOrderInput): Promise<string> {
  if (!input.items.length || input.items.length > 50) throw new Error("An order must contain between 1 and 50 product entries.");
  const { data, error } = await supabase.rpc("create_customer_order", {
    p_items: input.items.map((item) => ({ product_id: item.productId, quantity: item.quantity })),
    p_shipping_address: input.shippingAddress,
    p_payment_method: input.paymentMethod,
    p_idempotency_key: input.idempotencyKey,
    p_customer_note: input.customerNote?.trim() || null,
  });
  if (error) throw error;
  return data;
}

export interface ShipmentInput { carrier: string; trackingNumber: string; trackingUrl: string }

const TRACKING_NUMBER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 ._/#-]*$/;

/** Mirrors the database rules so mistakes are caught before a request is sent; the database still has the final say. */
export function validateShipmentInput(input: ShipmentInput): { carrier: string | null; trackingNumber: string | null; trackingUrl: string | null } {
  const carrier = input.carrier.trim();
  const trackingNumber = input.trackingNumber.trim();
  const trackingUrl = input.trackingUrl.trim();
  if (carrier.length > 80 || /[\u0000-\u001f\u007f]/.test(carrier)) throw new Error("Carrier must be 80 characters or fewer.");
  if (trackingNumber && (trackingNumber.length > 100 || !TRACKING_NUMBER_PATTERN.test(trackingNumber))) throw new Error("Tracking number can use letters, numbers and - _ . / # only (100 characters at most).");
  if (trackingUrl) {
    let parsed: URL | null = null;
    try { parsed = new URL(trackingUrl); } catch { parsed = null; }
    if (!parsed || parsed.protocol !== "https:" || trackingUrl.length > 2000 || /[\s<>"'\\]/.test(trackingUrl)) throw new Error("Tracking link must be a secure https:// URL.");
  }
  return { carrier: carrier || null, trackingNumber: trackingNumber || null, trackingUrl: trackingUrl || null };
}

export async function updateOrderShipment(orderId: string, input: ShipmentInput): Promise<OrderShipmentRecord> {
  const cleaned = validateShipmentInput(input);
  const { data, error } = await supabase.rpc("admin_update_order_shipment", {
    p_order_id: orderId,
    p_carrier: cleaned.carrier,
    p_tracking_number: cleaned.trackingNumber,
    p_tracking_url: cleaned.trackingUrl,
  });
  if (error) throw error;
  return data;
}
