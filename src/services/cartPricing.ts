import type { Product } from "../types";
import type { CartLine } from "./shopStore";

/** undefined = not loaded yet · null = confirmed deleted/unpublished · Product = current catalog data */
export type ResolvedProduct = Product | null | undefined;
export type ProductMap = Record<string, ResolvedProduct>;

export type LineStatus = "ok" | "adjusted" | "out_of_stock" | "unavailable" | "unverified";

export interface CartLineView {
  productId: string;
  product: Product | null | undefined;
  status: LineStatus;
  /** quantity saved in the browser */
  storedQuantity: number;
  /** quantity that can actually be bought right now (never above stock) */
  quantity: number;
  maxQuantity: number;
  unitPrice: number;
  listPrice: number;
  lineTotal: number;
}

export interface CartSummary {
  lines: CartLineView[];
  /** units that will be purchased (ok + adjusted lines) */
  units: number;
  subtotal: number;
  savings: number;
  /** lines that must be fixed or removed before checkout */
  blockedCount: number;
  canCheckout: boolean;
}

const round2 = (value: number) => Math.round(value * 100) / 100;

export const unitPriceOf = (product: Product) =>
  product.discountPrice !== undefined && product.discountPrice < product.price ? product.discountPrice : product.price;

export const isPurchasable = (product: Product | null | undefined): boolean =>
  !!product && product.published !== false && product.stock > 0;

export function stockLabel(stock: number): string {
  if (stock < 1) return "Out of stock";
  if (stock <= 5) return `Only ${stock} left`;
  return "In stock";
}

export function buildCartSummary(cart: CartLine[], products: ProductMap): CartSummary {
  const lines: CartLineView[] = cart.map(({ productId, quantity }) => {
    const product = products[productId];
    const base = { productId, product, storedQuantity: quantity };
    if (product === undefined) return { ...base, status: "unverified", quantity, maxQuantity: quantity, unitPrice: 0, listPrice: 0, lineTotal: 0 };
    if (product === null || product.published === false) return { ...base, product: null, status: "unavailable", quantity: 0, maxQuantity: 0, unitPrice: 0, listPrice: 0, lineTotal: 0 };
    const unitPrice = unitPriceOf(product);
    if (product.stock < 1) return { ...base, status: "out_of_stock", quantity: 0, maxQuantity: 0, unitPrice, listPrice: product.price, lineTotal: 0 };
    const effective = Math.min(quantity, product.stock);
    return {
      ...base,
      status: effective < quantity ? "adjusted" : "ok",
      quantity: effective,
      maxQuantity: product.stock,
      unitPrice,
      listPrice: product.price,
      lineTotal: round2(unitPrice * effective),
    };
  });

  const buyable = lines.filter((line) => line.status === "ok" || line.status === "adjusted");
  const blockedCount = lines.length - buyable.length;
  return {
    lines,
    units: buyable.reduce((sum, line) => sum + line.quantity, 0),
    subtotal: round2(buyable.reduce((sum, line) => sum + line.lineTotal, 0)),
    savings: round2(buyable.reduce((sum, line) => sum + (line.listPrice - line.unitPrice) * line.quantity, 0)),
    blockedCount,
    canCheckout: buyable.length > 0 && blockedCount === 0,
  };
}

export interface DeliveryRules { shippingCharge: number; freeThreshold: number | null }

/** Estimated delivery from the store's public settings. Returns null when the rules are unknown. */
export function estimateDelivery(subtotal: number, rules: DeliveryRules | null) {
  if (!rules || subtotal <= 0) return null;
  const free = rules.freeThreshold !== null && subtotal >= rules.freeThreshold;
  const charge = free ? 0 : rules.shippingCharge;
  const remainingForFree = rules.freeThreshold !== null && !free && rules.shippingCharge > 0 ? round2(rules.freeThreshold - subtotal) : null;
  return { charge, remainingForFree };
}
