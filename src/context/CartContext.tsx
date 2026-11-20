import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import type { Product } from "../types";
import { getProductsByIds } from "../services/catalog";
import { isPurchasable, type ProductMap } from "../services/cartPricing";
import { shopStore, type CartActionResult, type CartLine } from "../services/shopStore";
import { useAuth } from "./AuthContext";

export type WishlistToggleResult = { wished: boolean; message: string };

interface Ctx {
  /** total units in the cart (drives the header badge) */
  count: number;
  cartItems: CartLine[];
  /** product ids saved to the wishlist */
  wishlist: string[];
  wishlistCount: number;
  /** false when the browser can't store data, so lists vanish on refresh */
  persisted: boolean;

  /** live catalog data keyed by product id: Product, null (no longer available) or missing (not loaded) */
  products: ProductMap;
  productsLoading: boolean;
  productsError: string;
  loadProducts: (ids: string[], options?: { force?: boolean }) => Promise<void>;

  cartQuantity: (productId: string) => number;
  addToCart: (product: Product, quantity?: number) => CartActionResult;
  setQuantity: (productId: string, quantity: number) => void;
  removeFromCart: (productId: string | string[]) => void;
  clearCart: () => void;

  isInWishlist: (productId: string) => boolean;
  toggleWishlist: (product: Product) => WishlistToggleResult;
  removeFromWishlist: (productId: string | string[]) => void;
  moveToCart: (productId: string) => CartActionResult;
}

const unavailable = (): never => { throw new Error("useCart must be used inside <CartProvider>"); };
const C = createContext<Ctx>({
  count: 0, cartItems: [], wishlist: [], wishlistCount: 0, persisted: true,
  products: {}, productsLoading: false, productsError: "", loadProducts: unavailable,
  cartQuantity: () => 0, addToCart: unavailable, setQuantity: unavailable, removeFromCart: unavailable, clearCart: unavailable,
  isInWishlist: () => false, toggleWishlist: unavailable, removeFromWishlist: unavailable, moveToCart: unavailable,
});
export const useCart = () => useContext(C);
/** Alias so wishlist code reads naturally; cart and wishlist share one provider. */
export const useWishlist = useCart;

export function CartProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const state = useSyncExternalStore(shopStore.subscribe, shopStore.getState, shopStore.getState);

  // Switch between guest and per-customer lists (guest lists merge into the customer's on sign-in).
  useEffect(() => { shopStore.setOwner(userId); }, [userId]);

  const cache = useRef<ProductMap>({});
  const inflight = useRef(new Map<string, Promise<void>>());
  const [products, setProducts] = useState<ProductMap>({});
  const [productsLoading, setProductsLoading] = useState(false);
  const [productsError, setProductsError] = useState("");

  const publishCache = useCallback((next: ProductMap) => { cache.current = next; setProducts(next); }, []);

  /** Fetches current catalog data for ids we haven't resolved yet (or all of them with `force`). Identical requests share one call. */
  const loadProducts = useCallback((ids: string[], options?: { force?: boolean }) => {
    const wanted = [...new Set(ids)];
    const missing = options?.force ? wanted : wanted.filter((id) => !(id in cache.current));
    if (!missing.length) return Promise.resolve();
    const key = [...missing].sort().join(",");
    const running = inflight.current.get(key);
    if (running) return running;

    setProductsLoading(true);
    setProductsError("");
    const request = getProductsByIds(missing)
      .then((found) => {
        const next = { ...cache.current };
        for (const id of missing) next[id] = found.get(id) ?? null;
        publishCache(next);
      })
      .catch((reason: unknown) => {
        // A failed request says nothing about availability, so keep whatever we already knew.
        setProductsError(reason instanceof Error ? reason.message : "Unable to load product details.");
      })
      .finally(() => {
        inflight.current.delete(key);
        setProductsLoading(inflight.current.size > 0);
      });
    inflight.current.set(key, request);
    return request;
  }, [publishCache]);

  /** Seed the cache with fresh data we already hold (from a card or detail page) without overriding newer data. */
  const remember = useCallback((product: Product) => {
    const id = product.id.toLowerCase();
    if (cache.current[id] === undefined) publishCache({ ...cache.current, [id]: product });
  }, [publishCache]);

  const stockOf = useCallback((productId: string) => {
    const known = cache.current[productId.toLowerCase()];
    return known ? known.stock : undefined;
  }, []);

  const addToCart = useCallback((product: Product, quantity = 1) => {
    remember(product);
    return shopStore.addToCart(product, quantity);
  }, [remember]);

  const toggleWishlist = useCallback((product: Product): WishlistToggleResult => {
    const id = product.id.toLowerCase();
    if (shopStore.getState().wishlist.includes(id)) {
      shopStore.removeFromWishlist(id);
      return { wished: false, message: "Removed from wishlist" };
    }
    remember(product);
    shopStore.addToWishlist(id);
    return { wished: true, message: "Saved to wishlist" };
  }, [remember]);

  const moveToCart = useCallback((productId: string): CartActionResult => {
    const product = cache.current[productId.toLowerCase()];
    if (!product) return { ok: false, message: "This product is no longer available." };
    if (!isPurchasable(product)) return { ok: false, message: `${product.name} is out of stock.` };
    const result = shopStore.addToCart(product, 1);
    // The wishlist entry is only removed once the product really is in the cart.
    if (result.ok) shopStore.removeFromWishlist(productId);
    return result;
  }, []);

  const value = useMemo<Ctx>(() => ({
    count: state.cart.reduce((sum, line) => sum + line.quantity, 0),
    cartItems: state.cart,
    wishlist: state.wishlist,
    wishlistCount: state.wishlist.length,
    persisted: state.persisted,
    products, productsLoading, productsError, loadProducts,
    cartQuantity: (productId) => state.cart.find((line) => line.productId === productId.toLowerCase())?.quantity ?? 0,
    addToCart,
    setQuantity: (productId, quantity) => shopStore.setQuantity(productId, quantity, stockOf(productId)),
    removeFromCart: shopStore.removeFromCart,
    clearCart: shopStore.clearCart,
    isInWishlist: (productId) => state.wishlist.includes(productId.toLowerCase()),
    toggleWishlist,
    removeFromWishlist: shopStore.removeFromWishlist,
    moveToCart,
  }), [state, products, productsLoading, productsError, loadProducts, addToCart, toggleWishlist, moveToCart, stockOf]);

  return <C.Provider value={value}>{children}</C.Provider>;
}
