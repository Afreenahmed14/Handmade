import { supabase } from "../lib/supabase";
import type { Json, PaymentMethod, DbOrderRow } from "../types/database";
import { uploadPrivateFile } from "./storage";

export interface SimpleOrderRequestInput {
  productId: string;
  quantity: number;
  shippingAddress: Json;
  idempotencyKey: string;
  customizationPhoto?: File | null;
  customizationNote?: string;
}

/** Uploads the customer's optional customization photo to private storage. */
export async function uploadOrderCustomizationPhoto(file: File): Promise<string> {
  return uploadPrivateFile("customization-uploads", file);
}

/** Creates a pending order request. Payment is intentionally not selected yet. */
export async function createSimpleOrderRequest(input: SimpleOrderRequestInput): Promise<string> {
  const photoPath = input.customizationPhoto
    ? await uploadOrderCustomizationPhoto(input.customizationPhoto)
    : null;

  const { data, error } = await supabase.rpc("create_customer_order_request", {
    p_product_id: input.productId,
    p_quantity: input.quantity,
    p_shipping_address: input.shippingAddress,
    p_idempotency_key: input.idempotencyKey,
    p_customization_photo_path: photoPath,
    p_customization_note: input.customizationNote?.trim() || null,
  });
  if (error) throw error;
  return data;
}

/** Admin accepts with a delivery date or declines the customer's order request. */
export async function reviewSimpleOrder(
  orderId: string,
  accept: boolean,
  expectedDeliveryDate?: string,
  note?: string,
): Promise<DbOrderRow> {
  const { data, error } = await supabase.rpc("admin_review_customer_order", {
    p_order_id: orderId,
    p_accept: accept,
    p_expected_delivery_date: accept ? expectedDeliveryDate ?? null : null,
    p_note: note?.trim() || null,
  });
  if (error) throw error;
  return data;
}

/** Customer chooses UPI or COD only after admin acceptance. */
export async function selectSimpleOrderPayment(
  orderId: string,
  method: PaymentMethod,
): Promise<DbOrderRow> {
  const { data, error } = await supabase.rpc("customer_select_order_payment", {
    p_order_id: orderId,
    p_payment_method: method,
  });
  if (error) throw error;
  return data;
}

/** Customer feedback is accepted only when the order is delivered. */
export async function submitSimpleOrderFeedback(
  orderId: string,
  rating: number,
  comment?: string,
): Promise<string> {
  const { data, error } = await supabase.rpc("customer_submit_order_feedback", {
    p_order_id: orderId,
    p_rating: rating,
    p_comment: comment?.trim() || null,
  });
  if (error) throw error;
  return data;
}

export interface SimpleOrderNotification {
  id: string;
  recipient_id: string;
  order_id: string | null;
  title: string;
  message: string;
  notification_type: string;
  is_read: boolean;
  created_at: string;
}

/** Returns notifications belonging to the signed-in user only (RLS enforced). */
export async function getSimpleOrderNotifications(): Promise<SimpleOrderNotification[]> {
  const { data, error } = await supabase
    .from("order_notifications")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw error;
  return data ?? [];
}

export async function markSimpleOrderNotificationRead(notificationId: string): Promise<void> {
  const { error } = await supabase
    .from("order_notifications")
    .update({ is_read: true })
    .eq("id", notificationId);
  if (error) throw error;
}
