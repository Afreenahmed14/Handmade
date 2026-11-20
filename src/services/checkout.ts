import type { Database, Json, PaymentMethod } from "../types/database";
import { supabase } from "../lib/supabase";
import { estimateDelivery, type DeliveryRules } from "./cartPricing";
import { createCustomerOrder } from "./orders";
import { createCustomerOrderWithCoupon } from "./coupons";

export interface ShippingAddress {
  full_name: string; phone: string; address_line1: string; address_line2: string;
  city: string; state: string; postal_code: string; country: string;
}
export type AddressErrors = Partial<Record<keyof ShippingAddress, string>>;
export const emptyAddress: ShippingAddress = {
  full_name: "", phone: "", address_line1: "", address_line2: "", city: "", state: "", postal_code: "", country: "India",
};

const round2 = (value: number) => Math.round(value * 100) / 100;
const isIndia = (country: string) => ["india", "in", "bharat"].includes(country.trim().toLowerCase());

/** Returns a normalised phone number, or null when it isn't a plausible number. Indian mobiles become +91XXXXXXXXXX. */
export function normalizePhone(raw: string, country: string): string | null {
  const compact = raw.replace(/[\s\-()]/g, "");
  if (isIndia(country)) {
    let digits = compact.replace(/^\+/, "");
    if (digits.startsWith("91") && digits.length === 12) digits = digits.slice(2);
    else if (digits.startsWith("0") && digits.length === 11) digits = digits.slice(1);
    return /^[6-9]\d{9}$/.test(digits) ? `+91${digits}` : null;
  }
  return /^\+?\d{7,15}$/.test(compact) ? compact : null;
}

export function cleanAddress(address: ShippingAddress): ShippingAddress {
  const country = address.country.trim();
  const phone = address.phone.trim();
  return {
    full_name: address.full_name.trim().replace(/\s+/g, " "),
    phone: normalizePhone(phone, country) ?? phone,
    address_line1: address.address_line1.trim(),
    address_line2: address.address_line2.trim(),
    city: address.city.trim(),
    state: address.state.trim(),
    postal_code: address.postal_code.trim(),
    country,
  };
}

/** The store's supported regions (informational setting): empty means "deliver anywhere". A region may name a country, state or city. */
export function matchesRegions(address: ShippingAddress, regions: string[]): boolean {
  const wanted = regions.map((region) => region.trim().toLowerCase()).filter(Boolean);
  if (!wanted.length) return true;
  return [address.country, address.state, address.city].some((part) => wanted.includes(part.trim().toLowerCase()));
}

export function validateAddress(raw: ShippingAddress, regions: string[]): AddressErrors {
  const address = cleanAddress(raw);
  const errors: AddressErrors = {};
  if (address.full_name.length < 2) errors.full_name = "Enter the recipient's full name.";
  else if (address.full_name.length > 120) errors.full_name = "Name must be 120 characters or fewer.";
  if (!address.country) errors.country = "Enter the country.";
  else if (address.country.length > 100) errors.country = "Country must be 100 characters or fewer.";
  if (!address.phone) errors.phone = "Enter a phone number we can reach for delivery.";
  else if (!normalizePhone(address.phone, address.country)) {
    errors.phone = isIndia(address.country) ? "Enter a valid 10-digit Indian mobile number." : "Enter a valid phone number (7 to 15 digits).";
  }
  if (!address.address_line1) errors.address_line1 = "Enter the street address.";
  else if (address.address_line1.length > 200) errors.address_line1 = "Address must be 200 characters or fewer.";
  if (address.address_line2.length > 200) errors.address_line2 = "Address must be 200 characters or fewer.";
  if (!address.city) errors.city = "Enter the city.";
  else if (address.city.length > 100) errors.city = "City must be 100 characters or fewer.";
  if (!address.state) errors.state = "Enter the state.";
  else if (address.state.length > 100) errors.state = "State must be 100 characters or fewer.";
  const postalOk = isIndia(address.country) ? /^[1-9]\d{5}$/.test(address.postal_code) : /^[A-Za-z0-9][A-Za-z0-9 -]{1,9}$/.test(address.postal_code);
  if (!address.postal_code) errors.postal_code = isIndia(address.country) ? "Enter the 6-digit PIN code." : "Enter the postal code.";
  else if (!postalOk) errors.postal_code = isIndia(address.country) ? "PIN code must be 6 digits." : "Enter a valid postal code.";
  if (!errors.country && !errors.state && !errors.city && !matchesRegions(address, regions)) {
    const shown = regions.slice(0, 6).join(", ");
    errors.state = `We don't deliver to this location yet. We currently deliver to: ${shown}${regions.length > 6 ? ", …" : ""}.`;
  }
  return errors;
}

/** The JSON stored on the order. Keys match what the admin order screen reads. */
export function addressToJson(raw: ShippingAddress): Json {
  const address = cleanAddress(raw);
  const json: Record<string, Json> = {
    full_name: address.full_name, phone: address.phone, address_line1: address.address_line1,
    city: address.city, state: address.state, postal_code: address.postal_code, country: address.country,
  };
  if (address.address_line2) json.address_line2 = address.address_line2;
  return json;
}

export interface CheckoutTotals {
  subtotal: number;
  discount: number;
  delivery: number;
  /** false when the store's delivery rules couldn't be read, so `delivery` and `total` are not reliable */
  deliveryKnown: boolean;
  remainingForFree: number | null;
  total: number;
}

/** Mirrors the database: free shipping is judged on the subtotal BEFORE the coupon discount. */
export function computeTotals(subtotal: number, discount: number, rules: DeliveryRules | null): CheckoutTotals {
  const capped = round2(Math.min(Math.max(discount, 0), subtotal));
  const delivery = estimateDelivery(subtotal, rules);
  const charge = delivery?.charge ?? 0;
  return {
    subtotal, discount: capped, delivery: charge, deliveryKnown: rules !== null,
    remainingForFree: delivery?.remainingForFree ?? null,
    total: round2(subtotal - capped + charge),
  };
}

// ---- Duplicate-submission protection -------------------------------------------------------------------------
// The order RPCs return the existing order when they see the same idempotency key. So the key must stay the same
// while the customer retries the SAME order (double click, refresh, lost response) and change as soon as anything
// about the order changes. The key therefore lives in sessionStorage next to a fingerprint of the order.
const attemptStorageKey = (userId: string) => `vh.checkout.attempt.v1.${userId}`;

export interface OrderFingerprintInput {
  items: { productId: string; quantity: number }[];
  paymentMethod: PaymentMethod;
  couponCode: string | null;
  address: ShippingAddress;
  note: string;
}
export function orderFingerprint(input: OrderFingerprintInput): string {
  return JSON.stringify({
    items: [...input.items].sort((a, b) => a.productId.localeCompare(b.productId)),
    method: input.paymentMethod, coupon: input.couponCode, address: cleanAddress(input.address), note: input.note.trim(),
  });
}
export function getAttemptKey(userId: string, fingerprint: string): string {
  try {
    const stored = window.sessionStorage.getItem(attemptStorageKey(userId));
    if (stored) {
      const parsed = JSON.parse(stored) as { fingerprint?: unknown; key?: unknown };
      if (parsed.fingerprint === fingerprint && typeof parsed.key === "string" && parsed.key) return parsed.key;
    }
  } catch { /* fall through to a new key */ }
  const key = crypto.randomUUID();
  try { window.sessionStorage.setItem(attemptStorageKey(userId), JSON.stringify({ fingerprint, key })); } catch { /* storage unavailable: the in-flight lock still prevents double clicks */ }
  return key;
}
export function clearAttemptKey(userId: string) {
  try { window.sessionStorage.removeItem(attemptStorageKey(userId)); } catch { /* nothing to clear */ }
}

export interface PlaceOrderInput extends OrderFingerprintInput { idempotencyKey: string }

/** Places the order through the existing RPCs. The database recomputes prices, stock, discount and delivery. */
export async function placeOrder(input: PlaceOrderInput): Promise<string> {
  const common = {
    items: input.items, shippingAddress: addressToJson(input.address), paymentMethod: input.paymentMethod,
    idempotencyKey: input.idempotencyKey, customerNote: input.note,
  };
  return input.couponCode
    ? createCustomerOrderWithCoupon({ ...common, couponCode: input.couponCode })
    : createCustomerOrder(common);
}

// ---- Profile prefill / save ----------------------------------------------------------------------------------
export interface CheckoutProfile { address: ShippingAddress; hasName: boolean }

export async function getCheckoutProfile(userId: string): Promise<CheckoutProfile> {
  const { data, error } = await supabase.from("profiles")
    .select("full_name,mobile_number,address_line1,address_line2,city,state,postal_code,country").eq("id", userId).single();
  if (error) throw error;
  return {
    hasName: data.full_name.trim().length > 0,
    address: {
      full_name: data.full_name, phone: data.mobile_number ?? "", address_line1: data.address_line1 ?? "", address_line2: data.address_line2 ?? "",
      city: data.city ?? "", state: data.state ?? "", postal_code: data.postal_code ?? "", country: data.country || "India",
    },
  };
}

/**
 * Best effort, never blocks an order. The phone number is always saved because the order record takes the customer's
 * phone from their profile; the rest of the address is saved only when the customer asked for it.
 */
export async function saveCheckoutProfile(userId: string, address: ShippingAddress, before: CheckoutProfile, saveAddress: boolean): Promise<boolean> {
  const next = cleanAddress(address);
  const changes: Database["public"]["Tables"]["profiles"]["Update"] = {};
  if (next.phone && next.phone !== before.address.phone.trim()) changes.mobile_number = next.phone;
  if (saveAddress) {
    for (const field of ["address_line1", "address_line2", "city", "state", "postal_code"] as const) {
      if (next[field] !== (before.address[field] ?? "").trim()) changes[field] = next[field] || null;
    }
    if (next.country && next.country !== before.address.country.trim()) changes.country = next.country;
    if (!before.hasName && next.full_name) changes.full_name = next.full_name;
  }
  if (!Object.keys(changes).length) return true;
  const { error } = await supabase.from("profiles").update(changes).eq("id", userId);
  return !error;
}

// ---- Errors --------------------------------------------------------------------------------------------------
export class CheckoutAbort extends Error {}

export function friendlyOrderError(error: unknown): { message: string; refreshCart: boolean } {
  if (error instanceof CheckoutAbort) return { message: error.message, refreshCart: false };
  const e = (typeof error === "object" && error !== null ? error : {}) as { code?: string; message?: string };
  const message = typeof e.message === "string" ? e.message : "";
  switch (e.code) {
    case "42501": return { message: "Only customer accounts can place orders. Please sign in with a customer account.", refreshCart: false };
    case "23514":
      if (/insufficient stock/i.test(message)) return { message: "One or more items no longer have enough stock. We've refreshed your cart prices and availability — please review it.", refreshCart: true };
      if (/profile is incomplete/i.test(message)) return { message: "Your account profile is incomplete. Please update your profile and try again.", refreshCart: false };
      return { message: "We couldn't place this order. Please review your details and try again.", refreshCart: false };
    case "P0002":
      if (/coupon/i.test(message)) return { message: "That coupon code wasn't found.", refreshCart: false };
      return { message: "An item in your cart is no longer available. We've refreshed your cart — please review it.", refreshCart: true };
    case "22023": return { message: message || "This order couldn't be placed. Please review your details.", refreshCart: false };
    case "23505": return { message: "This order conflicts with an earlier attempt. Please refresh the page and try again.", refreshCart: false };
    default:
      return { message: "We couldn't place your order. Please check your connection and try again — you won't be charged twice.", refreshCart: false };
  }
}
