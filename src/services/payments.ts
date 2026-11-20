import type { Database, DbPaymentRecordRow, Json, OrderPaymentStatus, PaymentMethod } from "../types/database";
import { getOrderDetail, verifyOrderPayment, type OrderDetail } from "./orders";
import { supabase } from "../lib/supabase";

type PaymentRow = Database["public"]["Tables"]["payment_records"]["Row"];

export interface AdminPaymentRecord extends Pick<PaymentRow,
  "id" | "order_id" | "payment_method" | "payment_status" | "amount_inr" | "transaction_reference" | "payment_proof_path" | "verified_by" | "verified_at" | "verification_note" | "created_at" | "updated_at"
> {
  orderNumber: string;
  customerName: string;
  customerEmail: string;
  orderStatus: string;
}

export interface PaymentListFilters {
  page: number;
  pageSize: number;
  search?: string;
  fromDate?: string;
  toDate?: string;
  status?: OrderPaymentStatus | "all" | "pending_group";
  method?: PaymentMethod | "all";
}

export interface PaymentListResult {
  payments: AdminPaymentRecord[];
  total: number;
}

export interface PaymentDistribution {
  label: string;
  count: number;
}

export interface PaymentSummary {
  totalRecords: number;
  verifiedAmount: number;
  pendingCount: number;
  failedCount: number;
  refundedCount: number;
  statuses: PaymentDistribution[];
  methods: PaymentDistribution[];
}

export interface AdminPaymentDetail {
  payment: DbPaymentRecordRow;
  order: OrderDetail;
}

function safeSearch(value: string) {
  return value.replace(/[%,_()"\\]/g, " ").replace(/\s+/g, " ").trim();
}

function record(value: Json | undefined): Record<string, Json | undefined> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function numberField(source: Record<string, Json | undefined>, key: string) {
  const value = source[key];
  return typeof value === "number" ? value : 0;
}

function stringField(source: Record<string, Json | undefined>, key: string) {
  const value = source[key];
  return typeof value === "string" ? value : "";
}

function distribution(value: Json | undefined, key: "status" | "method"): PaymentDistribution[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => {
    const item = record(entry);
    return { label: stringField(item, key), count: numberField(item, "count") };
  });
}

export async function getPaymentSummary(fromDate?: string, toDate?: string): Promise<PaymentSummary> {
  const { data, error } = await supabase.rpc("get_admin_payment_summary", {
    p_from_date: fromDate || null,
    p_to_date: toDate || null,
  });
  if (error) throw error;
  const row = data[0];
  if (!row) throw new Error("Payment summary was not returned by the database.");
  const summary = record(row.summary);
  return {
    totalRecords: numberField(summary, "total_records"),
    verifiedAmount: numberField(summary, "verified_amount_inr"),
    pendingCount: numberField(summary, "pending_count"),
    failedCount: numberField(summary, "failed_count"),
    refundedCount: numberField(summary, "refunded_count"),
    statuses: distribution(row.status_distribution, "status"),
    methods: distribution(row.method_distribution, "method"),
  };
}

export async function getPaymentRecords(filters: PaymentListFilters): Promise<PaymentListResult> {
  const from = Math.max(0, filters.page - 1) * filters.pageSize;
  let query = supabase.from("payment_records")
    .select("id,order_id,payment_method,payment_status,amount_inr,transaction_reference,payment_proof_path,verified_by,verified_at,verification_note,created_at,updated_at", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(from, from + filters.pageSize - 1);

  if (filters.status === "pending_group") query = query.in("payment_status", ["pending", "verification_pending", "cod_due"]);
  else if (filters.status === "paid") query = query.eq("payment_status", "paid").not("verified_at", "is", null);
  else if (filters.status && filters.status !== "all") query = query.eq("payment_status", filters.status);
  if (filters.method && filters.method !== "all") query = query.eq("payment_method", filters.method);
  if (filters.fromDate) query = query.gte("created_at", new Date(`${filters.fromDate}T00:00:00`).toISOString());
  if (filters.toDate) query = query.lte("created_at", new Date(`${filters.toDate}T23:59:59.999`).toISOString());

  const search = filters.search ? safeSearch(filters.search) : "";
  if (search) {
    const paymentUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(search);
    query = paymentUuid ? query.eq("id", search) : query.ilike("transaction_reference", `%${search}%`);
  }

  const { data: payments, error, count } = await query;
  if (error) throw error;
  if (!payments.length) return { payments: [], total: count ?? 0 };

  const { data: orders, error: orderError } = await supabase.from("orders")
    .select("id,order_number,customer_name,customer_email,order_status")
    .in("id", [...new Set(payments.map((payment) => payment.order_id))]);
  if (orderError) throw orderError;
  const orderById = new Map(orders.map((order) => [order.id, order]));
  return {
    payments: payments.map((payment) => {
      const order = orderById.get(payment.order_id);
      return {
        ...payment,
        orderNumber: order?.order_number ?? "Unknown order",
        customerName: order?.customer_name ?? "Unknown customer",
        customerEmail: order?.customer_email ?? "",
        orderStatus: order?.order_status ?? "unknown",
      };
    }),
    total: count ?? payments.length,
  };
}

export async function getPaymentDetail(paymentId: string): Promise<AdminPaymentDetail> {
  const { data: payment, error } = await supabase.from("payment_records")
    .select("id,order_id,payment_method,payment_status,amount_inr,transaction_reference,payment_proof_path,verified_by,verified_at,verification_note,created_at,updated_at,provider")
    .eq("id", paymentId).single();
  if (error) throw error;
  const order = await getOrderDetail(payment.order_id);
  return { payment: payment as DbPaymentRecordRow, order };
}

export async function verifyPaymentAgainstExistingRpc(paymentId: string, reference: string, note?: string): Promise<DbPaymentRecordRow> {
  return verifyOrderPayment(paymentId, reference, note);
}

/** Rejects an unverified UPI submission; the customer can submit corrected details afterwards. */
export async function rejectPayment(paymentId: string, reason: string): Promise<DbPaymentRecordRow> {
  const cleaned = reason.trim();
  if (!cleaned || cleaned.length > 1000) throw new Error("Provide a rejection reason of 1 to 1000 characters.");
  const { data, error } = await supabase.rpc("admin_reject_order_payment", {
    p_payment_id: paymentId, p_rejection_reason: cleaned,
  });
  if (error) throw error;
  return data as DbPaymentRecordRow;
}

/** Records a full refund only after it has actually been sent through the bank/UPI channel. */
export async function recordFullRefund(paymentId: string, amountInr: number, externalReference: string, note?: string): Promise<DbPaymentRecordRow> {
  const reference = externalReference.trim();
  if (!Number.isFinite(amountInr) || amountInr <= 0) throw new Error("Enter a valid refund amount.");
  if (!reference || reference.length > 200) throw new Error("Enter the bank or UPI refund reference.");
  const { data, error } = await supabase.rpc("admin_record_payment_refund", {
    p_payment_id: paymentId, p_refund_amount_inr: amountInr, p_external_reference: reference,
    p_note: note?.trim() || null,
  });
  if (error) throw error;
  return data as DbPaymentRecordRow;
}


export interface PaymentOperationHistoryRow {
  id: string; payment_id: string; order_id: string; action: string;
  previous_status: OrderPaymentStatus | null; new_status: OrderPaymentStatus;
  amount_inr: number; note: string | null; external_reference: string | null;
  performed_by: string | null; created_at: string;
}

export async function getPaymentOperationHistory(paymentId: string): Promise<PaymentOperationHistoryRow[]> {
  const { data, error } = await supabase.rpc("get_admin_payment_operation_history", { p_payment_id: paymentId });
  if (error) throw error;
  return data ?? [];
}
