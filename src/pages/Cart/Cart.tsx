import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Minus, Plus, Trash2 } from "lucide-react";
import ProductArt from "../../components/common/ProductArt";
import { useCart } from "../../context/CartContext";
import { formatINR } from "../../utils/currency";
import { buildCartSummary, estimateDelivery, stockLabel, type CartLineView } from "../../services/cartPricing";
import { useStoreSettings } from "../../context/StoreSettingsContext";

const statusText: Partial<Record<CartLineView["status"], string>> = {
  unavailable: "This product is no longer available.",
  out_of_stock: "This product is out of stock.",
  unverified: "Checking availability...",
};

function LineRow({ line, onQuantity, onRemove }: { line: CartLineView; onQuantity: (quantity: number) => void; onRemove: () => void }) {
  const { product } = line;
  const blocked = line.status === "unavailable" || line.status === "out_of_stock" || line.status === "unverified";
  const art = product?.art ?? "vase";
  const image = product?.imageUrl
    ? <img src={product.imageUrl} alt={product.name} loading="lazy" className="aspect-[4/5] w-full object-cover" />
    : <ProductArt kind={art} className="aspect-[4/5] w-full" />;

  return (
    <li className="grid grid-cols-[6rem_minmax(0,1fr)] gap-4 border-b border-brass/40 py-6 sm:grid-cols-[8rem_minmax(0,1fr)] sm:gap-6">
      <div className={blocked ? "opacity-50" : ""}>{product ? <Link to={`/product/${product.slug}`} aria-label={product.name}>{image}</Link> : image}</div>
      <div className="flex min-w-0 flex-col">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-lg text-espresso">{product ? <Link to={`/product/${product.slug}`} className="hover:text-brass">{product.name}</Link> : "Product unavailable"}</h3>
            {product && <p className="mt-0.5 text-sm text-walnut/70">SKU {product.sku}{product.material ? ` · ${product.material}` : ""}</p>}
          </div>
          {!blocked && <p className="shrink-0 font-medium">{formatINR(line.lineTotal)}</p>}
        </div>

        {blocked ? (
          <p role={line.status === "unverified" ? "status" : "alert"} className={`mt-3 text-sm ${line.status === "unverified" ? "text-walnut/70" : "text-red-800"}`}>{statusText[line.status]}</p>
        ) : (
          <>
            <div className="mt-1 flex items-baseline gap-2 text-sm">
              <span>{formatINR(line.unitPrice)} each</span>
              {line.listPrice > line.unitPrice && <span className="text-walnut/60 line-through">{formatINR(line.listPrice)}</span>}
            </div>
            <p className={`mt-1 text-sm ${line.maxQuantity <= 5 ? "text-brass" : "text-walnut/70"}`}>{stockLabel(line.maxQuantity)}</p>
          </>
        )}

        <div className="mt-auto flex flex-wrap items-center gap-4 pt-4">
          {!blocked && (
            <div className="inline-flex items-center border border-brass/50" role="group" aria-label={`Quantity for ${product?.name ?? "product"}`}>
              <button type="button" aria-label="Decrease quantity" disabled={line.quantity <= 1} onClick={() => onQuantity(line.quantity - 1)} className="p-2 text-walnut disabled:opacity-40"><Minus size={16} /></button>
              <span aria-live="polite" className="min-w-10 px-2 text-center text-sm">{line.quantity}</span>
              <button type="button" aria-label="Increase quantity" disabled={line.quantity >= line.maxQuantity} onClick={() => onQuantity(line.quantity + 1)} className="p-2 text-walnut disabled:opacity-40"><Plus size={16} /></button>
            </div>
          )}
          {!blocked && line.quantity >= line.maxQuantity && <span className="text-xs text-walnut/70">Maximum available</span>}
          <button type="button" onClick={onRemove} className="inline-flex items-center gap-1 text-sm text-walnut underline underline-offset-4 hover:text-brass"><Trash2 size={14} />Remove</button>
        </div>
      </div>
    </li>
  );
}

export default function Cart() {
  const { cartItems, products, productsLoading, productsError, loadProducts, setQuantity, removeFromCart, clearCart, persisted } = useCart();
  const { deliveryRules: rules, settings } = useStoreSettings();
  const [notices, setNotices] = useState<string[]>([]);
  const [confirmClear, setConfirmClear] = useState(false);

  const ids = useMemo(() => cartItems.map((line) => line.productId), [cartItems]);
  const idsKey = ids.join(",");
  const idsRef = useRef(ids);
  idsRef.current = ids;

  // Product details are never trusted from storage: refresh everything when the page opens or the tab regains focus,
  // and fetch only unseen products when the cart changes (e.g. another tab adds an item).
  const freshened = useRef(false);
  useEffect(() => {
    void loadProducts(idsRef.current, { force: !freshened.current });
    freshened.current = true;
  }, [idsKey, loadProducts]);
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === "visible") void loadProducts(idsRef.current, { force: true }); };
    document.addEventListener("visibilitychange", refresh);
    return () => document.removeEventListener("visibilitychange", refresh);
  }, [loadProducts]);

  const summary = useMemo(() => buildCartSummary(cartItems, products), [cartItems, products]);

  // Quantities above current stock are reduced (and saved) so the cart never holds more than can be bought.
  useEffect(() => {
    const adjusted = summary.lines.filter((line) => line.status === "adjusted");
    if (!adjusted.length) return;
    const messages = adjusted.map((line) => `${line.product?.name ?? "An item"} was reduced to ${line.quantity} because only ${line.quantity} ${line.quantity === 1 ? "is" : "are"} in stock.`);
    setNotices((current) => [...current, ...messages.filter((message) => !current.includes(message))]);
    adjusted.forEach((line) => setQuantity(line.productId, line.quantity));
  }, [summary.lines, setQuantity]);

  const delivery = estimateDelivery(summary.subtotal, rules);
  const total = summary.subtotal + (delivery?.charge ?? 0);
  const unresolved = summary.lines.some((line) => line.status === "unverified");
  const removable = summary.lines.filter((line) => line.status === "unavailable" || line.status === "out_of_stock").map((line) => line.productId);

  if (!cartItems.length) {
    return (
      <section className="container-x py-24 text-center">
        <h1 className="text-5xl text-walnut">Your cart is empty</h1>
        <p className="mt-4 text-espresso/70">Pieces you add will wait for you here.</p>
        <div className="mt-8 flex flex-wrap justify-center gap-4"><Link to="/shop" className="btn-primary">Continue shopping</Link><Link to="/wishlist" className="btn-outline">View wishlist</Link></div>
        {notices.length > 0 && <ul className="mx-auto mt-8 max-w-md text-sm text-walnut/80">{notices.map((n, i) => <li key={i}>{n}</li>)}</ul>}
      </section>
    );
  }

  return (
    <section className="container-x py-12 md:py-16">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-brass/40 pb-6">
        <div><p className="text-sm uppercase text-walnut/70">Your selection</p><h1 className="mt-2 text-4xl text-walnut">Cart</h1></div>
        {confirmClear ? (
          <div className="flex items-center gap-3 text-sm" role="group" aria-label="Confirm clearing the cart">
            <span>Remove everything from your cart?</span>
            <button type="button" onClick={() => { clearCart(); setConfirmClear(false); }} className="text-red-800 underline underline-offset-4">Yes, clear cart</button>
            <button type="button" onClick={() => setConfirmClear(false)} className="text-walnut underline underline-offset-4">Keep items</button>
          </div>
        ) : <button type="button" onClick={() => setConfirmClear(true)} className="text-sm text-walnut underline underline-offset-4 hover:text-brass">Clear cart</button>}
      </div>

      {!persisted && <p role="status" className="mt-4 border border-brass/40 px-4 py-3 text-sm text-walnut">Your browser is blocking storage, so this cart will be lost when you refresh.</p>}
      {productsError && (
        <div role="alert" className="mt-4 flex flex-wrap items-center justify-between gap-3 border border-red-800/40 px-4 py-3 text-sm text-red-800">
          <span>We couldn't confirm current prices and stock. {productsError}</span>
          <button type="button" onClick={() => void loadProducts(ids, { force: true })} className="underline underline-offset-4">Try again</button>
        </div>
      )}
      {notices.length > 0 && (
        <div role="status" className="mt-4 flex items-start justify-between gap-3 border border-brass/40 px-4 py-3 text-sm text-walnut">
          <ul>{notices.map((n, i) => <li key={i}>{n}</li>)}</ul>
          <button type="button" onClick={() => setNotices([])} className="shrink-0 underline underline-offset-4">Dismiss</button>
        </div>
      )}
      {removable.length > 0 && (
        <div role="alert" className="mt-4 flex flex-wrap items-center justify-between gap-3 border border-red-800/40 px-4 py-3 text-sm text-red-800">
          <span>{removable.length === 1 ? "One item in your cart can't be purchased." : `${removable.length} items in your cart can't be purchased.`} Remove {removable.length === 1 ? "it" : "them"} to continue to checkout.</span>
          <button type="button" onClick={() => removeFromCart(removable)} className="underline underline-offset-4">Remove unavailable items</button>
        </div>
      )}

      <div className="mt-2 grid gap-10 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div>
          {productsLoading && unresolved && <p role="status" className="pt-6 text-sm text-walnut/70">Checking current prices and availability...</p>}
          <ul>{summary.lines.map((line) => (
            <LineRow key={line.productId} line={line} onQuantity={(quantity) => setQuantity(line.productId, quantity)} onRemove={() => removeFromCart(line.productId)} />
          ))}</ul>
          <Link to="/shop" className="mt-6 inline-block text-sm text-walnut underline underline-offset-4 hover:text-brass">← Continue shopping</Link>
        </div>

        <aside className="h-fit border border-brass/40 p-6 lg:sticky lg:top-32" aria-labelledby="order-summary">
          <h2 id="order-summary" className="text-2xl text-walnut">Order summary</h2>
          <dl className="mt-5 grid gap-3 text-sm">
            <div className="flex justify-between"><dt>Subtotal ({summary.units} {summary.units === 1 ? "item" : "items"})</dt><dd>{unresolved ? "—" : formatINR(summary.subtotal)}</dd></div>
            {summary.savings > 0 && <div className="flex justify-between text-walnut"><dt>You save</dt><dd>−{formatINR(summary.savings)}</dd></div>}
            <div className="flex justify-between"><dt>Delivery</dt><dd>{summary.subtotal <= 0 ? "—" : delivery ? (delivery.charge === 0 ? "Free" : formatINR(delivery.charge)) : "Calculated at checkout"}</dd></div>
            <div className="flex justify-between border-t border-brass/40 pt-3 text-base font-medium"><dt>Estimated total</dt><dd>{unresolved ? "—" : formatINR(total)}</dd></div>
          </dl>
          {delivery?.remainingForFree != null && <p className="mt-3 text-xs text-walnut/70">Add {formatINR(delivery.remainingForFree)} more for free delivery.</p>}
          {settings.estimated_delivery_text && <p className="mt-3 text-xs text-walnut/70">Estimated delivery: {settings.estimated_delivery_text}</p>}
          <p className="mt-3 text-xs text-walnut/70">Final delivery, coupons and any taxes are confirmed at checkout. Prices and stock are checked again when you order.</p>
          {summary.canCheckout && !unresolved
            ? <Link to="/checkout" className="btn-primary mt-6 w-full">Proceed to checkout</Link>
            : <button type="button" disabled className="btn-primary mt-6 w-full cursor-not-allowed opacity-50">Proceed to checkout</button>}
          {!summary.canCheckout && summary.blockedCount > 0 && <p className="mt-2 text-xs text-walnut/70">Resolve the highlighted items to continue.</p>}
        </aside>
      </div>
    </section>
  );
}
