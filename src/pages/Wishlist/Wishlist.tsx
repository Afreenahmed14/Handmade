// import { useEffect, useMemo, useRef, useState } from "react";
// import { Link } from "react-router-dom";
// import { X } from "lucide-react";
// import ProductArt from "../../components/common/ProductArt";
// import { useCart } from "../../context/CartContext";
// import { formatINR } from "../../utils/currency";
// import { isPurchasable, stockLabel, unitPriceOf } from "../../services/cartPricing";

// export default function Wishlist() {
//   const { wishlist, products, productsLoading, productsError, loadProducts, removeFromWishlist, moveToCart, cartQuantity } = useCart();
//   const [messages, setMessages] = useState<Record<string, { ok: boolean; text: string }>>({});
//   const [removedNotice, setRemovedNotice] = useState("");

//   const idsKey = wishlist.join(",");
//   const idsRef = useRef(wishlist);
//   idsRef.current = wishlist;

//   // Refresh details on open (never trust stored data), then only fetch products we haven't seen.
//   const freshened = useRef(false);
//   useEffect(() => {
//     void loadProducts(idsRef.current, { force: !freshened.current });
//     freshened.current = true;
//   }, [idsKey, loadProducts]);
//   useEffect(() => {
//     const refresh = () => { if (document.visibilityState === "visible") void loadProducts(idsRef.current, { force: true }); };
//     document.addEventListener("visibilitychange", refresh);
//     return () => document.removeEventListener("visibilitychange", refresh);
//   }, [loadProducts]);

//   // Products that were deleted or unpublished are dropped from the wishlist with a notice.
//   // `null` only appears after a successful lookup, so a network error never removes anything.
//   const gone = useMemo(() => wishlist.filter((id) => products[id] === null), [wishlist, products]);
//   useEffect(() => {
//     if (!gone.length) return;
//     removeFromWishlist(gone);
//     setRemovedNotice(`${gone.length} saved ${gone.length === 1 ? "piece is" : "pieces are"} no longer available and ${gone.length === 1 ? "was" : "were"} removed from your wishlist.`);
//   }, [gone, removeFromWishlist]);

//   const visible = wishlist.flatMap((id) => { const product = products[id]; return product ? [product] : []; });
//   const pending = wishlist.filter((id) => products[id] === undefined);

//   function move(id: string) {
//     const result = moveToCart(id);
//     setMessages((current) => ({ ...current, [id]: { ok: result.ok, text: result.ok ? "Moved to cart" : result.message } }));
//   }

//   if (!wishlist.length) {
//     return (
//       <section className="container-x py-24 text-center">
//         <h1 className="text-5xl text-walnut">Your wishlist is empty</h1>
//         <p className="mt-4 text-espresso/70">Tap the heart on any piece to save it for later.</p>
//         <div className="mt-8 flex flex-wrap justify-center gap-4"><Link to="/shop" className="btn-primary">Continue shopping</Link><Link to="/cart" className="btn-outline">View cart</Link></div>
//         {removedNotice && <p role="status" className="mx-auto mt-8 max-w-md text-sm text-walnut/80">{removedNotice}</p>}
//       </section>
//     );
//   }

//   return (
//     <section className="container-x py-12 md:py-16">
//       <div className="flex flex-wrap items-end justify-between gap-5 border-b border-brass/40 pb-6">
//         <div><p className="text-sm uppercase text-walnut/70">Saved for later</p><h1 className="mt-2 text-4xl text-walnut">Wishlist</h1></div>
//         <Link to="/shop" className="text-sm text-walnut underline underline-offset-4 hover:text-brass">← Continue shopping</Link>
//       </div>

//       {removedNotice && (
//         <div role="status" className="mt-4 flex items-start justify-between gap-3 border border-brass/40 px-4 py-3 text-sm text-walnut">
//           <span>{removedNotice}</span>
//           <button type="button" onClick={() => setRemovedNotice("")} className="shrink-0 underline underline-offset-4">Dismiss</button>
//         </div>
//       )}
//       {productsError && (
//         <div role="alert" className="mt-4 flex flex-wrap items-center justify-between gap-3 border border-red-800/40 px-4 py-3 text-sm text-red-800">
//           <span>We couldn't load your saved pieces. {productsError}</span>
//           <button type="button" onClick={() => void loadProducts(wishlist, { force: true })} className="underline underline-offset-4">Try again</button>
//         </div>
//       )}
//       {productsLoading && pending.length > 0 && <p role="status" className="py-8 text-center text-walnut/70">Loading your saved pieces...</p>}

//       {visible.length > 0 && (
//         <ul className="mt-8 grid grid-cols-2 gap-5 md:grid-cols-3 lg:grid-cols-4">
//           {visible.map((product) => {
//             const available = isPurchasable(product);
//             const inCart = cartQuantity(product.id);
//             const message = messages[product.id];
//             return (
//               <li key={product.id}>
//                 <div className="relative">
//                   <Link to={`/product/${product.slug}`} aria-label={product.name} className={available ? "" : "opacity-60"}>
//                     {product.imageUrl
//                       ? <img src={product.imageUrl} alt={product.name} loading="lazy" className="aspect-[4/5] w-full object-cover" />
//                       : <ProductArt kind={product.art} className="aspect-[4/5] w-full" />}
//                   </Link>
//                   <button type="button" aria-label={`Remove ${product.name} from wishlist`} onClick={() => removeFromWishlist(product.id)} className="absolute right-3 top-3 rounded-full bg-cream/90 p-2 text-walnut"><X size={16} /></button>
//                 </div>
//                 <h3 className="mt-3 text-lg text-espresso"><Link to={`/product/${product.slug}`} className="hover:text-brass">{product.name}</Link></h3>
//                 <p className="text-sm text-walnut/80">SKU {product.sku}</p>
//                 <div className="mt-1 flex items-baseline gap-2">
//                   <span className="font-medium">{formatINR(unitPriceOf(product))}</span>
//                   {unitPriceOf(product) < product.price && <span className="text-sm text-walnut/60 line-through">{formatINR(product.price)}</span>}
//                 </div>
//                 <p className={`mt-1 text-sm ${available ? (product.stock <= 5 ? "text-brass" : "text-walnut/70") : "text-red-800"}`}>{stockLabel(product.stock)}{inCart > 0 && available ? ` · ${inCart} in cart` : ""}</p>
//                 <button type="button" disabled={!available} onClick={() => move(product.id)} className="btn-outline mt-3 w-full py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50">{available ? "Move to cart" : "Out of stock"}</button>
//                 <p role="status" className={`mt-1 text-xs ${message && !message.ok ? "text-red-800" : "text-walnut/70"}`}>{message?.text}</p>
//               </li>
//             );
//           })}
//         </ul>
//       )}
//     </section>
//   );
// }
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { X, Heart, Tag, ArrowUpRight } from "lucide-react";

import ProductArt from "../../components/common/ProductArt";
import { useCart } from "../../context/CartContext";
import { formatINR } from "../../utils/currency";
import {
  isPurchasable,
  stockLabel,
  unitPriceOf,
} from "../../services/cartPricing";

import "./CustomerPages.css";

export default function Wishlist() {
  const {
    wishlist,
    products,
    productsLoading,
    productsError,
    loadProducts,
    removeFromWishlist,
    moveToCart,
    cartQuantity,
  } = useCart();

  const [messages, setMessages] = useState<
    Record<string, { ok: boolean; text: string }>
  >({});

  const [removedNotice, setRemovedNotice] = useState("");

  const idsKey = wishlist.join(",");
  const idsRef = useRef(wishlist);
  idsRef.current = wishlist;

  const freshened = useRef(false);

  useEffect(() => {
    void loadProducts(idsRef.current, {
      force: !freshened.current,
    });

    freshened.current = true;
  }, [idsKey, loadProducts]);

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") {
        void loadProducts(idsRef.current, { force: true });
      }
    };

    document.addEventListener("visibilitychange", refresh);

    return () =>
      document.removeEventListener("visibilitychange", refresh);
  }, [loadProducts]);

  const gone = useMemo(
    () => wishlist.filter((id) => products[id] === null),
    [wishlist, products],
  );

  useEffect(() => {
    if (!gone.length) return;

    removeFromWishlist(gone);

    setRemovedNotice(
      `${gone.length} saved ${
        gone.length === 1 ? "piece is" : "pieces are"
      } no longer available and ${
        gone.length === 1 ? "was" : "were"
      } removed from your wishlist.`,
    );
  }, [gone, removeFromWishlist]);

  const visible = wishlist.flatMap((id) => {
    const product = products[id];
    return product ? [product] : [];
  });

  const pending = wishlist.filter(
    (id) => products[id] === undefined,
  );

  function move(id: string) {
    const result = moveToCart(id);

    setMessages((current) => ({
      ...current,
      [id]: {
        ok: result.ok,
        text: result.ok ? "Moved to cart" : result.message,
      },
    }));
  }

  return (
    <main className="customer-art-page wishlist-page">
      <div className="customer-art-container">

        <header className="wishlist-hero">
          <div className="hero-decoration wishlist-flower">✿</div>
          <div className="hero-decoration wishlist-sparkle">✧</div>

          <div className="wishlist-hero-content">
            <p className="art-eyebrow">SAVED FOR LATER</p>
            <h1>
              Wishlist <Heart className="wishlist-title-heart" />
            </h1>

            <p className="art-subtitle">
              Your favourite CasaLoom pieces, all in one place.
            </p>
          </div>

          <Link to="/shop" className="continue-shopping">
            ← Continue shopping
          </Link>
        </header>

        {removedNotice && (
          <div role="status" className="wishlist-notice">
            <span>{removedNotice}</span>
            <button
              type="button"
              onClick={() => setRemovedNotice("")}
            >
              Dismiss
            </button>
          </div>
        )}

        {productsError && (
          <div role="alert" className="wishlist-notice error">
            <span>
              We couldn't load your saved pieces. {productsError}
            </span>
            <button
              type="button"
              onClick={() =>
                void loadProducts(wishlist, { force: true })
              }
            >
              Try again
            </button>
          </div>
        )}

        {productsLoading && pending.length > 0 && (
          <p role="status" className="wishlist-loading">
            Loading your saved pieces...
          </p>
        )}

        {!wishlist.length && (
          <div className="art-empty-state">
            <Heart size={42} />
            <h2>Your wishlist is empty</h2>
            <p>
              Tap the heart on any piece to save it for later.
            </p>

            <div className="mt-5 flex flex-wrap justify-center gap-3">
              <Link to="/shop" className="art-primary-button">
                Continue shopping
              </Link>
              <Link to="/cart" className="art-primary-button wishlist-cart-secondary">
                View cart
              </Link>
            </div>
            {removedNotice && (
              <p role="status" className="mt-5 text-sm">{removedNotice}</p>
            )}
          </div>
        )}

        {visible.length > 0 && (
          <div className="wishlist-products">
            {visible.map((product, index) => {
              const available = isPurchasable(product);
              const inCart = cartQuantity(product.id);
              const message = messages[product.id];

              return (
                <article
                  key={product.id}
                  className={`wishlist-product-card card-tone-${index % 3}`}
                >
                  <div className="wishlist-image-wrap">
                    <Link
                      to={`/product/${product.slug}`}
                      aria-label={product.name}
                      className={!available ? "opacity-60" : ""}
                    >
                      {product.imageUrl ? (
                        <img
                          src={product.imageUrl}
                          alt={product.name}
                          loading="lazy"
                        />
                      ) : (
                        <ProductArt
                          kind={product.art}
                          className="wishlist-product-art"
                        />
                      )}
                    </Link>

                    <button
                      type="button"
                      aria-label={`Remove ${product.name} from wishlist`}
                      onClick={() => removeFromWishlist(product.id)}
                      className="wishlist-remove"
                    >
                      <X size={19} />
                    </button>
                  </div>

                  <div className="wishlist-product-info">
                    <Link
                      to={`/product/${product.slug}`}
                      className="wishlist-product-name"
                    >
                      {product.name}
                      <ArrowUpRight size={17} />
                    </Link>

                    <p className="wishlist-material">
                      <Tag size={14} />
                      {product.material || "CasaLoom collection"}
                    </p>

                    <div className="wishlist-price">
                      <strong>
                        {formatINR(unitPriceOf(product))}
                      </strong>

                      {unitPriceOf(product) < product.price && (
                        <del>{formatINR(product.price)}</del>
                      )}
                    </div>

                    <p
                      className={`wishlist-stock ${
                        available ? "" : "out-of-stock"
                      }`}
                    >
                      {stockLabel(product.stock)}
                      {inCart > 0 && available
                        ? ` · ${inCart} in cart`
                        : ""}
                    </p>

                    <button
                      type="button"
                      disabled={!available}
                      onClick={() => move(product.id)}
                      className="wishlist-cart-button"
                    >
                      {available ? "Move to cart ↗" : "Out of stock"}
                    </button>

                    <p
                      role="status"
                      className={`wishlist-message ${
                        message && !message.ok ? "error" : ""
                      }`}
                    >
                      {message?.text}
                    </p>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}