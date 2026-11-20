
import { ArrowUpRight, Heart } from "lucide-react";
import { Link } from "react-router-dom";
import type { Product } from "../../types";
import { formatINR } from "../../utils/currency";
import ProductArt from "../common/ProductArt";
import { useCart } from "../../context/CartContext";
import { isPurchasable } from "../../services/cartPricing";

export default function ProductCard({ p }: { p: Product }) {
  const { isInWishlist, toggleWishlist } = useCart();
  const wished = isInWishlist(p.id);
  const available = isPurchasable(p);
  function handleWish() { toggleWishlist(p); }
  const discount = p.discountPrice && p.price > 0 ? Math.round((1 - p.discountPrice / p.price) * 100) : 0;

  return (
    <article data-3d-card data-reveal className="group min-w-0 overflow-hidden [transform-style:preserve-3d] rounded-lg border border-[#D9B9BD] ring-1 ring-[#EBD7D8]/70 bg-white shadow-[0_5px_18px_rgba(93,55,65,.07)] transition duration-300 hover:-translate-y-1 hover:shadow-soft">
      <div className="relative overflow-hidden bg-lavender">
        <Link to={`/product/${p.slug}`} aria-label={`View ${p.name}`} className="block">
          {p.imageUrl
            ? <img src={p.imageUrl} alt={p.name} loading="lazy" className="aspect-square w-full object-cover transition duration-700 group-hover:scale-[1.04]" />
            : <ProductArt kind={p.art} className="aspect-square w-full transition duration-700 group-hover:scale-[1.03]" />}
        </Link>
        {discount > 0 && <span className="absolute left-2.5 top-2.5 rounded-full bg-plum px-2 py-1 text-[8px] font-bold tracking-wide text-white">{discount}% OFF</span>}
        {p.tag === "new" && <span className="absolute left-2.5 top-2.5 rounded-full bg-dusty px-2 py-1 text-[8px] font-bold uppercase tracking-wide text-white">New</span>}
        <button type="button" aria-label={wished ? `Remove ${p.name} from wishlist` : `Save ${p.name} to wishlist`} aria-pressed={wished} onClick={handleWish} className="absolute right-2.5 top-2.5 grid h-7 w-7 place-items-center rounded-full border border-white/70 bg-white/90 text-plum shadow-sm transition hover:scale-105 hover:bg-plum hover:text-white">
          <Heart size={15} fill={wished ? "currentColor" : "none"} />
        </button>
        {p.customizable && <span className="absolute bottom-3 left-3 rounded-full bg-white/90 px-3 py-1.5 text-[9px] font-bold uppercase tracking-wider text-plum shadow-sm">Personalise it</span>}
        {!available && <span className="absolute bottom-3 right-3 rounded-full bg-charcoal/85 px-3 py-1.5 text-[9px] font-bold uppercase tracking-wider text-white">Out of stock</span>}
      </div>
      <div className="p-1.5 sm:p-2">
        <Link to={`/product/${p.slug}`} className="group/name flex items-start justify-between gap-2">
          <h3 className="line-clamp-2 min-h-[2rem] font-heading text-[10px] font-semibold leading-4 text-charcoal transition group-hover/name:text-plum sm:text-xs">{p.name}</h3>
          <ArrowUpRight size={15} className="mt-0.5 shrink-0 text-dusty opacity-0 transition group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:opacity-100" />
        </Link>
        <p className="mt-1 truncate text-[10px] text-charcoal/55 sm:text-xs">{p.material || "Curated for your home"}</p>
        <div className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="text-[11px] font-bold text-plum sm:text-xs">{formatINR(p.discountPrice ?? p.price)}</span>
          {p.discountPrice && <span className="text-[10px] text-charcoal/40 line-through sm:text-xs">{formatINR(p.price)}</span>}
        </div>
        <Link to={`/product/${p.slug}`} className="mt-1 inline-flex w-full items-center justify-center rounded-md border border-[#9C657B] bg-plum px-1 py-1 text-[8px] font-bold tracking-wide text-white transition hover:bg-plum-deep sm:text-xs">
          {available ? "View product & order" : "View product"}
        </Link>
      </div>
    </article>
  );
}
