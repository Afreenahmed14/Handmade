import type { Category, Product } from "../types";
import type { CouponDiscountType, DbCouponDirectoryRow, Json, PaymentMethod } from "../types/database";
import { supabase } from "../lib/supabase";
import { getCategories, getProducts } from "./catalog";

export type CouponStatusFilter = "all" | "active" | "inactive" | "expired" | "scheduled";

export interface CouponListFilters {
  page: number;
  pageSize: number;
  search?: string;
  status?: CouponStatusFilter;
}

export interface CouponListResult {
  coupons: DbCouponDirectoryRow[];
  total: number;
}

export interface CouponSaveInput {
  id?: string;
  code: string;
  description: string;
  discountType: CouponDiscountType;
  discountValue: number;
  minimumOrderAmount: number;
  maximumDiscountAmount: number | null;
  startsAt: string;
  expiresAt: string;
  maxTotalUses: number | null;
  maxUsesPerCustomer: number;
  isActive: boolean;
  productIds: string[];
  categoryIds: string[];
}

export interface CouponPreview {
  valid: boolean;
  code?: string;
  discount_type?: CouponDiscountType;
  subtotal_inr?: number;
  eligible_subtotal_inr?: number;
  discount_inr?: number;
  final_subtotal_inr?: number;
  message: string;
}

function cleanSearch(value: string) {
  return value.replace(/[%,_()"\\]/g, " ").replace(/\s+/g, " ").trim();
}

export async function getCoupons(filters: CouponListFilters): Promise<CouponListResult> {
  const from = Math.max(0, filters.page - 1) * filters.pageSize;
  const now = new Date().toISOString();
  let query = supabase.from("admin_coupon_directory").select("*", { count: "exact" }).order("created_at", { ascending: false }).range(from, from + filters.pageSize - 1);
  const search = filters.search ? cleanSearch(filters.search).toUpperCase() : "";
  if (search) query = query.ilike("code", `%${search}%`);
  if (filters.status === "inactive") query = query.eq("is_active", false);
  if (filters.status === "expired") query = query.eq("is_active", true).lt("expires_at", now);
  if (filters.status === "scheduled") query = query.eq("is_active", true).gt("starts_at", now).gte("expires_at", now);
  if (filters.status === "active") query = query.eq("is_active", true).lte("starts_at", now).gte("expires_at", now);
  const { data, error, count } = await query;
  if (error) throw error;
  return { coupons: data, total: count ?? data.length };
}

export async function getCouponTargets(): Promise<{ products: Product[]; categories: Category[] }> {
  const [products, categories] = await Promise.all([getProducts(false), getCategories(true)]);
  return { products, categories };
}

export async function getCouponApplicability(couponId: string): Promise<{ productIds: string[]; categoryIds: string[] }> {
  const [{ data: products, error: productError }, { data: categories, error: categoryError }] = await Promise.all([
    supabase.from("coupon_products").select("product_id").eq("coupon_id", couponId),
    supabase.from("coupon_categories").select("category_id").eq("coupon_id", couponId),
  ]);
  if (productError) throw productError;
  if (categoryError) throw categoryError;
  return { productIds: products.map((row) => row.product_id), categoryIds: categories.map((row) => row.category_id) };
}

export async function saveCoupon(input: CouponSaveInput): Promise<string> {
  const code = input.code.trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9_-]{0,39}$/.test(code)) throw new Error("Code must be 1–40 uppercase letters, digits, underscores, or hyphens.");
  if (!Number.isFinite(input.discountValue) || input.discountValue <= 0 || (input.discountType === "percentage" && input.discountValue > 100)) {
    throw new Error(input.discountType === "percentage" ? "Percentage must be greater than 0 and no more than 100." : "Fixed discount must be greater than zero.");
  }
  if (!Number.isFinite(input.minimumOrderAmount) || input.minimumOrderAmount < 0) throw new Error("Minimum order amount must be non-negative.");
  if (input.maximumDiscountAmount !== null && (!Number.isFinite(input.maximumDiscountAmount) || input.maximumDiscountAmount <= 0 || input.discountType !== "percentage")) {
    throw new Error("Maximum discount is only valid as a positive amount for percentage coupons.");
  }
  if (new Date(input.expiresAt).getTime() <= new Date(input.startsAt).getTime()) throw new Error("Expiry date must be later than the start date.");
  if (input.maxTotalUses !== null && (!Number.isSafeInteger(input.maxTotalUses) || input.maxTotalUses <= 0)) throw new Error("Maximum total uses must be a positive whole number or unlimited.");
  if (!Number.isSafeInteger(input.maxUsesPerCustomer) || input.maxUsesPerCustomer <= 0) throw new Error("Maximum uses per customer must be a positive whole number.");

  const { data, error } = await supabase.rpc("admin_save_coupon", {
    p_coupon_id: input.id ?? null,
    p_code: code,
    p_description: input.description.trim() || null,
    p_discount_type: input.discountType,
    p_discount_value: input.discountValue,
    p_minimum_order_amount_inr: input.minimumOrderAmount,
    p_maximum_discount_amount_inr: input.maximumDiscountAmount,
    p_starts_at: new Date(input.startsAt).toISOString(),
    p_expires_at: new Date(input.expiresAt).toISOString(),
    p_max_total_uses: input.maxTotalUses,
    p_max_uses_per_customer: input.maxUsesPerCustomer,
    p_is_active: input.isActive,
    p_product_ids: input.productIds,
    p_category_ids: input.categoryIds,
  });
  if (error) throw error;
  return data;
}

export async function deleteCoupon(couponId: string): Promise<void> {
  const { error } = await supabase.from("coupons").delete().eq("id", couponId);
  if (error) throw error;
}

export async function validateCustomerCoupon(code: string, items: { productId: string; quantity: number }[]): Promise<CouponPreview> {
  if (!items.length) throw new Error("Add products to your cart before applying a coupon.");
  const { data, error } = await supabase.rpc("validate_customer_coupon", {
    p_code: code.trim().toUpperCase(),
    p_items: items.map((item) => ({ product_id: item.productId, quantity: item.quantity })) as Json,
  });
  if (error) throw error;
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Coupon validation returned an invalid response.");
  const result = data as Record<string, Json | undefined>;
  return {
    valid: result.valid === true,
    code: typeof result.code === "string" ? result.code : undefined,
    discount_type: result.discount_type === "fixed" || result.discount_type === "percentage" ? result.discount_type : undefined,
    subtotal_inr: typeof result.subtotal_inr === "number" ? result.subtotal_inr : undefined,
    eligible_subtotal_inr: typeof result.eligible_subtotal_inr === "number" ? result.eligible_subtotal_inr : undefined,
    discount_inr: typeof result.discount_inr === "number" ? result.discount_inr : undefined,
    final_subtotal_inr: typeof result.final_subtotal_inr === "number" ? result.final_subtotal_inr : undefined,
    message: typeof result.message === "string" ? result.message : "Unable to validate this coupon.",
  };
}

export async function createCustomerOrderWithCoupon(input: {
  items: { productId: string; quantity: number }[];
  shippingAddress: Json;
  paymentMethod: PaymentMethod;
  idempotencyKey: string;
  couponCode: string;
  customerNote?: string;
}): Promise<string> {
  if (!input.items.length || input.items.length > 50) throw new Error("An order must contain between 1 and 50 product entries.");
  const { data, error } = await supabase.rpc("create_customer_order_with_coupon", {
    p_items: input.items.map((item) => ({ product_id: item.productId, quantity: item.quantity })) as Json,
    p_shipping_address: input.shippingAddress,
    p_payment_method: input.paymentMethod,
    p_idempotency_key: input.idempotencyKey,
    p_coupon_code: input.couponCode.trim().toUpperCase(),
    p_customer_note: input.customerNote?.trim() || null,
  });
  if (error) throw error;
  return data;
}
