import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import ProductArt from "../../components/common/ProductArt";
import { formatINR } from "../../utils/currency";
import {
  PERSONALIZATION_TYPES, getPersonalizedProducts, personalizationTypeLabel, type PersonalizedProduct,
} from "../../services/personalization";

function priceLine(product: PersonalizedProduct) {
  const { base_price_inr: base, quotation_required: quote } = product.personalization;
  if (base !== null) return `${quote ? "From " : ""}${formatINR(base)}`;
  return quote ? "Quotation on request" : formatINR(product.discountPrice ?? product.price);
}

export default function PersonalisedGifts() {
  const [products, setProducts] = useState<PersonalizedProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [type, setType] = useState("all");

  useEffect(() => {
    let active = true;
    void getPersonalizedProducts().then((list) => { if (active) setProducts(list); })
      .catch(() => { if (active) setError("We couldn't load personalised gifts. Please check your connection and try again."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const presentTypes = useMemo(() => PERSONALIZATION_TYPES.filter((entry) => products.some((p) => p.personalization.product_type === entry.value)), [products]);
  const shown = type === "all" ? products : products.filter((p) => p.personalization.product_type === type);

  return (
    <section className="container-x py-12 md:py-16">
      <div className="border-b border-brass/40 pb-6">
        <p className="text-sm uppercase text-walnut/70">Made with your photos</p>
        <h1 className="mt-2 text-4xl text-walnut">Personalised gifts</h1>
        <p className="mt-3 max-w-2xl text-espresso/80">Pick a product, upload your photos and tell us how you'd like it. We'll send you a quotation; production starts only after you accept it and pay.</p>
      </div>

      {presentTypes.length > 1 && (
        <div role="group" aria-label="Filter by product type" className="mt-6 flex flex-wrap gap-2">
          {[{ value: "all", label: "All" }, ...presentTypes].map((entry) => (
            <button key={entry.value} type="button" aria-pressed={type === entry.value} onClick={() => setType(entry.value)}
              className={`border px-3 py-1.5 text-sm ${type === entry.value ? "border-plum bg-plum text-white" : "border-brass/50 text-walnut hover:bg-brass/10"}`}>{entry.label}</button>
          ))}
        </div>
      )}

      <div className="mt-8">
        {loading && <p role="status" className="py-12 text-center text-walnut/70">Loading personalised gifts...</p>}
        {error && <p role="alert" className="py-12 text-center text-red-800">{error}</p>}
        {!loading && !error && products.length === 0 && (
          <div className="py-12 text-center">
            <h2 className="text-2xl text-walnut">Personalised gifts are coming soon</h2>
            <p className="mt-2 text-sm text-espresso/70">Nothing is available to personalise yet.</p>
            <Link to="/shop" className="btn-primary mt-6">Browse the collection</Link>
          </div>
        )}
        {!loading && !error && shown.length > 0 && (
          <div className="grid grid-cols-2 gap-5 md:grid-cols-3 xl:grid-cols-4">
            {shown.map((product) => (
              <article key={product.id} className="group min-w-0 overflow-hidden rounded-xl border border-[#E9E3E9] bg-white shadow-card transition duration-300 hover:-translate-y-1 hover:shadow-soft">
                <Link to={`/product/${product.slug}`} aria-label={`View ${product.name}`} className="block bg-lavender">
                  {product.imageUrl
                    ? <img src={product.imageUrl} alt={product.name} loading="lazy" className="aspect-[4/4.4] w-full object-cover" />
                    : <ProductArt kind={product.art} className="aspect-[4/4.4] w-full" />}
                </Link>
                <div className="p-3 sm:p-4">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-dusty">{personalizationTypeLabel(product.personalization.product_type)}</p>
                  <Link to={`/product/${product.slug}`}><h2 className="mt-1 line-clamp-2 min-h-[2.5rem] font-heading text-sm font-semibold leading-5 text-charcoal hover:text-plum sm:text-base">{product.name}</h2></Link>
                  <p className="mt-2 text-sm font-bold text-plum sm:text-base">{priceLine(product)}</p>
                  <Link to={`/customize/${product.slug}`} className="mt-3 inline-flex w-full items-center justify-center rounded-md bg-plum px-2 py-2.5 text-[10px] font-bold tracking-wide text-white transition hover:bg-plum-deep sm:text-xs">Personalise this</Link>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
