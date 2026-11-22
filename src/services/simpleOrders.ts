import { supabase } from "../lib/supabase";
import type { Json, PaymentMethod, DbOrderRow } from "../types/database";
import { deletePrivateFile, uploadPrivateFile } from "./storage";

export interface CustomerPhotoOrderInput {
  productId: string;
  quantity: number;
  shippingAddress: Json;
  paymentMethod: PaymentMethod;
  idempotencyKey: string;
  photo: File;
}

/** Creates a normal order with one private customer photo attached. Price, stock, shipping and payment availability are validated by the database. */
export async function createCustomerPhotoOrder(input: CustomerPhotoOrderInput): Promise<string> {
  const photoPath = await uploadPrivateFile("customization-uploads", input.photo);
  const { data, error } = await supabase.rpc("create_customer_photo_order", {
    p_product_id: input.productId,
    p_quantity: input.quantity,
    p_shipping_address: input.shippingAddress,
    p_payment_method: input.paymentMethod,
    p_idempotency_key: input.idempotencyKey,
    p_customization_photo_path: photoPath,
  });
  if (error) {
    await deletePrivateFile("customization-uploads", photoPath);
    throw error;
  }
  return data;
}

export interface SimpleOrderRequestInput {
  productId: string;
  quantity: number;
  shippingAddress: Json;
  paymentMethod: PaymentMethod;
  idempotencyKey: string;
  customizationPhoto: File;
}

/** Backwards-compatible name used by the product details order form. */
export async function createSimpleOrderRequest(input: SimpleOrderRequestInput): Promise<string> {
  return createCustomerPhotoOrder({
    productId: input.productId,
    quantity: input.quantity,
    shippingAddress: input.shippingAddress,
    paymentMethod: input.paymentMethod,
    idempotencyKey: input.idempotencyKey,
    photo: input.customizationPhoto,
  });
}

/** Admin sets or clears the expected delivery date on an existing order. */
export async function setSimpleOrderExpectedDeliveryDate(orderId: string, expectedDeliveryDate: string | null): Promise<DbOrderRow> {
  const { data, error } = await supabase.rpc("admin_set_order_expected_delivery_date", {
    p_order_id: orderId,
    p_expected_delivery_date: expectedDeliveryDate,
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
