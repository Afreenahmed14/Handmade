import type { Product } from "../types";

/**
 * Persisted cart + wishlist store (framework-agnostic).
 *
 * Only product ids and quantities are stored. Prices, names, images and stock are always
 * resolved from the live catalog, so a tampered or stale localStorage can never change a price.
 *
 * Persistence is scoped by owner:
 *   vh.cart.v1.guest / vh.wishlist.v1.guest      -> anonymous visitors
 *   vh.cart.v1.<auth user id> / vh.wishlist.v1.<id> -> signed-in customers
 * Signing in merges the guest lists into the customer's lists (then clears the guest lists), so nothing
 * added before login is lost. Signing out switches back to the (empty) guest lists; the customer's own
 * lists stay stored under their id and come back on the next sign-in.
 *
 * This module is the single persistence seam: a server-side cart table can later be synced from
 * `commit()` / `loadOwner()` without touching any component.
 */

export const GUEST_OWNER = "guest";
export const MAX_LINE_QUANTITY = 99;
const MAX_LINES = 100;

export interface CartLine { productId: string; quantity: number }
export interface ShopState {
  owner: string;
  cart: CartLine[];
  wishlist: string[];
  /** false when the browser refused to store data (private mode, quota, blocked storage). */
  persisted: boolean;
}

export type CartActionResult = { ok: true; quantity: number; message: string } | { ok: false; message: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const keyFor = (kind: "cart" | "wishlist", owner: string) => `vh.${kind}.v1.${owner}`;

export function isValidProductId(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

export function clampQuantity(quantity: number, stock?: number): number {
  const whole = Number.isFinite(quantity) ? Math.floor(quantity) : 1;
  const ceiling = Math.max(1, Math.min(MAX_LINE_QUANTITY, stock === undefined ? MAX_LINE_QUANTITY : Math.floor(stock)));
  return Math.min(Math.max(whole, 1), ceiling);
}

/** Cleans untrusted cart data: valid ids only, positive integer quantities, one line per product. */
export function sanitizeCart(raw: unknown): CartLine[] {
  if (!Array.isArray(raw)) return [];
  const lines = new Map<string, number>();
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) continue;
    const { productId, quantity } = entry as Record<string, unknown>;
    if (!isValidProductId(productId) || typeof quantity !== "number" || !Number.isFinite(quantity) || quantity < 1) continue;
    const id = productId.toLowerCase();
    lines.set(id, clampQuantity((lines.get(id) ?? 0) + Math.floor(quantity)));
  }
  return [...lines].slice(0, MAX_LINES).map(([productId, quantity]) => ({ productId, quantity }));
}

export function sanitizeWishlist(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.filter(isValidProductId).map((id) => id.toLowerCase()))].slice(0, MAX_LINES);
}

export function mergeCarts(base: CartLine[], incoming: CartLine[]): CartLine[] {
  return sanitizeCart([...base, ...incoming]);
}

function readJson(key: string): unknown {
  try {
    const text = window.localStorage.getItem(key);
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): boolean {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function removeKey(key: string) {
  try { window.localStorage.removeItem(key); } catch { /* storage unavailable */ }
}

const listeners = new Set<() => void>();

function loadOwner(owner: string): ShopState {
  return {
    owner,
    cart: sanitizeCart(readJson(keyFor("cart", owner))),
    wishlist: sanitizeWishlist(readJson(keyFor("wishlist", owner))),
    persisted: true,
  };
}

// Hydrate the guest lists immediately so a refresh never shows an empty cart while auth is still resolving.
let state: ShopState = typeof window === "undefined" ? { owner: GUEST_OWNER, cart: [], wishlist: [], persisted: true } : loadOwner(GUEST_OWNER);

function emit() { listeners.forEach((listener) => listener()); }

function commit(next: Partial<Pick<ShopState, "cart" | "wishlist">>) {
  const cart = next.cart ?? state.cart;
  const wishlist = next.wishlist ?? state.wishlist;
  let persisted = true;
  if (next.cart) persisted = writeJson(keyFor("cart", state.owner), cart) && persisted;
  if (next.wishlist) persisted = writeJson(keyFor("wishlist", state.owner), wishlist) && persisted;
  state = { ...state, cart, wishlist, persisted };
  emit();
}

export const shopStore = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  },
  getState: () => state,

  /** Switch to a signed-in user's lists (merging guest lists in) or back to the guest lists. */
  setOwner(userId: string | null) {
    const owner = userId ?? GUEST_OWNER;
    if (owner === state.owner) return;
    const comingFromGuest = state.owner === GUEST_OWNER;
    const next = loadOwner(owner);
    if (owner !== GUEST_OWNER && comingFromGuest) {
      const guest = loadOwner(GUEST_OWNER);
      const cart = mergeCarts(next.cart, guest.cart);
      const wishlist = sanitizeWishlist([...next.wishlist, ...guest.wishlist]);
      const savedCart = writeJson(keyFor("cart", owner), cart);
      const savedWishlist = writeJson(keyFor("wishlist", owner), wishlist);
      if (savedCart && savedWishlist) {
        removeKey(keyFor("cart", GUEST_OWNER));
        removeKey(keyFor("wishlist", GUEST_OWNER));
      }
      state = { owner, cart, wishlist, persisted: savedCart && savedWishlist };
    } else {
      state = next;
    }
    emit();
  },

  /** Re-read the current owner's lists (used for cross-tab updates). */
  reload() {
    state = loadOwner(state.owner);
    emit();
  },

  addToCart(product: Pick<Product, "id" | "name" | "stock" | "published">, quantity = 1): CartActionResult {
    const id = product.id.toLowerCase();
    if (!isValidProductId(id)) return { ok: false, message: "This product can't be added right now." };
    if (product.published === false || product.stock < 1) return { ok: false, message: `${product.name} is currently unavailable.` };
    const existing = state.cart.find((line) => line.productId === id);
    const current = existing?.quantity ?? 0;
    const limit = Math.min(product.stock, MAX_LINE_QUANTITY);
    if (current >= limit) return { ok: false, message: `All ${limit} available are already in your cart.` };
    if (!existing && state.cart.length >= MAX_LINES) return { ok: false, message: "Your cart is full. Remove something to add more." };
    const nextQuantity = Math.min(current + Math.max(1, Math.floor(quantity)), limit);
    commit({ cart: existing
      ? state.cart.map((line) => line.productId === id ? { ...line, quantity: nextQuantity } : line)
      : [...state.cart, { productId: id, quantity: nextQuantity }] });
    return { ok: true, quantity: nextQuantity, message: nextQuantity < current + quantity ? `Added — only ${limit} available.` : "Added to cart" };
  },

  setQuantity(productId: string, quantity: number, stock?: number) {
    const id = productId.toLowerCase();
    if (!state.cart.some((line) => line.productId === id)) return;
    const next = clampQuantity(quantity, stock);
    if (state.cart.find((line) => line.productId === id)?.quantity === next) return;
    commit({ cart: state.cart.map((line) => line.productId === id ? { ...line, quantity: next } : line) });
  },

  removeFromCart(productIds: string | string[]) {
    const ids = new Set((Array.isArray(productIds) ? productIds : [productIds]).map((id) => id.toLowerCase()));
    if (!state.cart.some((line) => ids.has(line.productId))) return;
    commit({ cart: state.cart.filter((line) => !ids.has(line.productId)) });
  },

  clearCart() {
    if (state.cart.length) commit({ cart: [] });
  },

  addToWishlist(productId: string) {
    const id = productId.toLowerCase();
    if (!isValidProductId(id) || state.wishlist.includes(id) || state.wishlist.length >= MAX_LINES) return;
    commit({ wishlist: [...state.wishlist, id] });
  },

  removeFromWishlist(productIds: string | string[]) {
    const ids = new Set((Array.isArray(productIds) ? productIds : [productIds]).map((id) => id.toLowerCase()));
    if (!state.wishlist.some((id) => ids.has(id))) return;
    commit({ wishlist: state.wishlist.filter((id) => !ids.has(id)) });
  },
};

// Keep several open tabs in sync, and keep this tab current if another tab changes our lists.
if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key === null || event.key === keyFor("cart", state.owner) || event.key === keyFor("wishlist", state.owner)) shopStore.reload();
  });
}
