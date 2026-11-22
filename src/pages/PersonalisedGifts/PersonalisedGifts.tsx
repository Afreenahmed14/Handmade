import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import ProductArt from "../../components/common/ProductArt";
import { formatINR } from "../../utils/currency";
import { getProducts } from "../../services/catalog";
import type { Product } from "../../types";

export default function PersonalisedGifts() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [category, setCategory] = useState("all");

  useEffect(() => {
    let active = true;
    void getProducts().then((items) => {
      if (active) setProducts(items.filter((product) => product.customizable && product.published !== false));
    }).catch(() => {
      if (active) setError("We couldn't load products right now. Please try again.");
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const categories = useMemo(() => ["all", ...Array.from(new Set(products.map((product) => product.category).filter(Boolean)))], [products]);
  const shown = category === "all" ? products : products.filter((product) => product.category === category);

  return (
    <section className="container-x py-12 md:py-16">
      <div className="border-b border-brass/40 pb-6">
        <p className="text-sm uppercase text-walnut/70">Made with your photos</p>
        <h1 className="mt-2 text-4xl text-walnut">Personalised gifts</h1>
        <p className="mt-3 max-w-2xl text-espresso/80">Choose a product, send us your photo and select how you'd like to pay. You can review and track your order anytime.</p>
      </div>

      {categories.length > 2 && (
        <div role="group" aria-label="Filter by category" className="mt-6 flex flex-wrap gap-2">
          {categories.map((entry) => (
            <button key={entry} type="button" aria-pressed={category === entry} onClick={() => setCategory(entry)}
              className={`border px-3 py-1.5 text-sm capitalize ${category === entry ? "border-plum bg-plum text-white" : "border-brass/50 text-walnut hover:bg-brass/10"}`}>
              {entry === "all" ? "All products" : entry}
            </button>
          ))}
        </div>
      )}

      <div className="mt-8">
        {loading && <p role="status" className="py-12 text-center text-walnut/70">Loading products...</p>}
        {error && <p role="alert" className="py-12 text-center text-red-800">{error}</p>}
        {!loading && !error && products.length === 0 && (
          <div className="py-12 text-center">
            <h2 className="text-2xl text-walnut">No personalised products yet</h2>
            <p className="mt-2 text-sm text-espresso/70">Products enabled for photo personalisation will appear here.</p>
            <Link to="/shop" className="btn-primary mt-6">Browse the collection</Link>
          </div>
        )}
        {!loading && !error && shown.length > 0 && (
          <div className="grid grid-cols-2 gap-5 md:grid-cols-3 xl:grid-cols-4">
            {shown.map((product) => (
              <article key={product.id} className="group min-w-0 overflow-hidden rounded-xl border border-[#E9E3E9] bg-white shadow-card transition duration-300 hover:-translate-y-1 hover:shadow-soft">
                <Link to={`/customize/${product.slug}`} aria-label={`Select ${product.name}`} className="block bg-lavender">
                  {product.imageUrl
                    ? <img src={product.imageUrl} alt={product.name} loading="lazy" className="aspect-[4/4.4] w-full object-cover" />
                    : <ProductArt kind={product.art} className="aspect-[4/4.4] w-full" />}
                </Link>
                <div className="p-3 sm:p-4">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-dusty">{product.category || "CasaLoom"}</p>
                  <Link to={`/customize/${product.slug}`}><h2 className="mt-1 line-clamp-2 min-h-[2.5rem] font-heading text-sm font-semibold leading-5 text-charcoal hover:text-plum sm:text-base">{product.name}</h2></Link>
                  <p className="mt-2 text-sm font-bold text-plum sm:text-base">{formatINR(product.discountPrice ?? product.price)}</p>
                  <Link to={`/customize/${product.slug}`} className="mt-3 inline-flex w-full items-center justify-center rounded-md bg-plum px-2 py-2.5 text-[10px] font-bold tracking-wide text-white transition hover:bg-plum-deep sm:text-xs">Select product</Link>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
