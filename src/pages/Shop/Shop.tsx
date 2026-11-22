import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ArrowDownWideNarrow, ArrowRight, Heart, Search, SlidersHorizontal, Sparkles, X } from "lucide-react";
import ProductCard from "../../components/products/ProductCard";
import ProductArt from "../../components/common/ProductArt";
import { useCatalog } from "../../hooks/useCatalog";
import shopFloralBg from "../../assets/casaloom-shop-floral-bg.jpg";
import shopAllBanner from "../../assets/casaloom-shop-all-banner.jpg";
import "./ShopDesign.css";
import {
  activeFilterCount, applyFilters, filtersToParams, parseFilters, sortOptions,
  type ProductFilters, type SortKey, type StockFilter,
} from "../../services/productSearch";

const field = "w-full rounded-full border border-[#E8C7D3] bg-white/90 px-4 py-2.5 text-sm text-[#54243F] shadow-sm outline-none transition placeholder:text-[#A77D8E] focus:border-[#A83E70] focus:ring-2 focus:ring-[#E8B5CB]/50";
const tilePalettes = [
  "from-[#F8C9D7] to-[#FBE5DC]",
  "from-[#F8D7AE] to-[#FCEBCB]",
  "from-[#DCCDF4] to-[#F1E5FA]",
  "from-[#F4BDD0] to-[#F9DFE9]",
  "from-[#C7DED0] to-[#E5F0E5]",
  "from-[#F5D5B9] to-[#FBE9D9]",
  "from-[#D9D0F0] to-[#F0E9FB]",
];

export default function Shop() {
  const { categories, products, loading, error } = useCatalog();
  const [params, setParams] = useSearchParams();
  const filters = useMemo(() => parseFilters(params), [params]);
  const [visible, setVisible] = useState(24);
  const [qInput, setQInput] = useState(filters.q);
  const setFilters = (patch: Partial<ProductFilters>, replace = false) => setParams(filtersToParams({ ...filters, ...patch }), { replace });
  useEffect(() => { setQInput(filters.q); }, [filters.q]);
  useEffect(() => {
    const nextQ = qInput.replace(/\s+/g, " ").trim().slice(0, 100);
    if (nextQ === filters.q) return;
    const timer = window.setTimeout(() => setParams(filtersToParams({ ...filters, q: nextQ }), { replace: true }), 350);
    return () => window.clearTimeout(timer);
  }, [qInput, filters, setParams]);

  useEffect(() => { setVisible(24); }, [params.toString()]);
  const results = useMemo(() => applyFilters(products, categories, filters), [products, categories, filters]);
  const unknownCategory = !!filters.category && !loading && !categories.some((c) => c.slug === filters.category);
  const activeCount = activeFilterCount(filters);
  const activeCategory = categories.find((c) => c.slug === filters.category);
  const clearAll = () => { setParams(new URLSearchParams()); setQInput(""); };
  const chips: { key: string; label: string; clear: Partial<ProductFilters> }[] = [
    ...(filters.q ? [{ key: "q", label: `“${filters.q}”`, clear: { q: "" } }] : []),
    ...(activeCategory ? [{ key: "category", label: activeCategory.name, clear: { category: "" } }] : []),
    ...(filters.stock !== "all" ? [{ key: "stock", label: filters.stock === "in" ? "In stock" : "Out of stock", clear: { stock: "all" as StockFilter } }] : []),
    ...(filters.customizable ? [{ key: "custom", label: "Personalised", clear: { customizable: false } }] : []),
  ];
  const marqueeProducts = results.slice(0, visible);
  const repeatedProducts = marqueeProducts.length > 1 ? [...marqueeProducts, ...marqueeProducts] : marqueeProducts;

  return (
    <main className="casaloom-shop-page relative isolate min-h-screen overflow-hidden" style={{ backgroundImage: `linear-gradient(rgba(255,246,249,.28), rgba(255,246,249,.34)), url(${shopFloralBg})` }}>
      <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(circle_at_50%_10%,rgba(255,255,255,.72),transparent_45%),linear-gradient(120deg,rgba(255,225,232,.22),rgba(224,211,249,.22))]" />
      <div className="mx-auto max-w-[1500px] px-4 pb-10 pt-2 sm:px-6 lg:px-8">



                <section className="casaloom-shop-toolbar mb-3 rounded-[14px] border border-white/95 bg-white/90 p-2 shadow-[0_5px_16px_rgba(116,61,88,.10)] backdrop-blur-xl" aria-label="Search and product filters">
          <div className="casaloom-toolbar-row">
            <label className="casaloom-toolbar-search relative block">
              <span className="mb-0.5 block text-[8px] font-bold uppercase tracking-[.14em] text-[#8D5870]">Search</span>
              <Search size={14} className="pointer-events-none absolute left-3 top-[25px] z-10 text-[#A45C7B]" />
              <input type="search" value={qInput} maxLength={100} onChange={(e) => setQInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") setFilters({ q: qInput.replace(/\s+/g, " ").trim().slice(0, 100) }); }} placeholder="Search products..." className={`${field} casaloom-toolbar-input !rounded-full !min-h-[31px] !py-1 !pl-9 !pr-3 !text-[10px] !leading-4`} />
            </label>
            <label className="block">
              <span className="mb-0.5 block text-[8px] font-bold uppercase tracking-[.14em] text-[#8D5870]">Availability</span>
              <select value={filters.stock} onChange={(e) => setFilters({ stock: e.target.value as StockFilter })} className={`${field} casaloom-toolbar-input !rounded-full !px-2.5 !py-1 !text-[10px] !leading-4`}>
                <option value="all">All pieces</option><option value="in">In stock</option><option value="out">Out of stock</option>
              </select>
            </label>
            <label className="block">
              <span className="mb-0.5 block text-[8px] font-bold uppercase tracking-[.14em] text-[#8D5870]">Sort by</span>
              <select value={filters.sort} onChange={(e) => setFilters({ sort: e.target.value as SortKey })} className={`${field} casaloom-toolbar-input !rounded-full !px-2.5 !py-1 !text-[10px] !leading-4`}>{sortOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
            </label>
            <label className="casaloom-personalised-toggle">
              <input type="checkbox" checked={filters.customizable} onChange={(e) => setFilters({ customizable: e.target.checked })} className="accent-[#A13F70]" />
              <span>Can be personalised</span>
            </label>
          </div>
          {activeCount > 0 && <div className="mt-1 flex justify-end border-t border-[#F0DCE4] pt-1">
            <button type="button" onClick={clearAll} className="inline-flex items-center gap-1 text-[10px] font-bold text-[#98466D] hover:underline">Clear filters <X size={12} /></button>
          </div>}
        </section>




        <section className="casaloom-shop-hero" aria-label="CasaLoom Shop All">
          <img
            src={shopAllBanner}
            alt="CasaLoom Shop All — curated little treasures, floral products and home decor"
            className="casaloom-shop-hero-image"
          />
        </section>

        <section className="casaloom-shop-categories mt-4" aria-label="Shop categories">
          <div className="mb-2 flex items-end justify-between gap-3">
            <div>
              <p className="text-[9px] font-bold uppercase tracking-[.25em] text-[#A45C7B]">Find your favourite</p>
              <h2 className="mt-1 font-display text-xl font-semibold text-[#54243F] sm:text-2xl">Shop by category</h2>
            </div>
            <span className="hidden text-xs text-[#946D80] sm:block">A little something for every space</span>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-8">
            <button type="button" onClick={() => setFilters({ category: "" })} aria-pressed={!filters.category} className={`group relative flex min-h-[76px] items-center justify-between overflow-hidden rounded-xl border p-2 text-left shadow-[0_5px_16px_rgba(108,58,87,.08)] transition duration-300 hover:-translate-y-1 hover:shadow-lg ${!filters.category ? "border-[#A94C79] ring-2 ring-[#E9B7CB]" : "border-white/80"} bg-gradient-to-br from-[#713B58] to-[#A94C79] text-white`}>
              <span className="pointer-events-none absolute -right-3 -top-5 h-24 w-24 rounded-full border border-white/20 bg-white/10" />
              <span className="pointer-events-none absolute -right-1 -top-1 h-16 w-16 rounded-full border border-white/25" />
              <span className="pointer-events-none absolute bottom-1 right-8 text-5xl text-[#F7C7D9]/35">✿</span>
              <span className="pointer-events-none absolute right-14 top-2 rotate-12 text-xl text-white/75">✧</span>
              <span className="relative z-10"><span className="block text-2xl drop-shadow-sm">✦</span><span className="mt-1 block text-[11px] font-extrabold tracking-wide">All products</span><span className="mt-0.5 block text-[8px] font-semibold uppercase tracking-[.18em] text-white/75">Explore every treasure</span></span>
              <span className="relative z-10 rounded-full border border-white/35 bg-white/15 p-1.5 shadow-inner"><ArrowRight size={16} /></span>
            </button>
            {categories.map((category, index) => {
              // Use the customer's actual uploaded product photo first; keep the category image as fallback.
              const categoryProduct = products.find(
                (product) => product.categoryId === category.id && Boolean(product.imageUrl),
              );
              const image = categoryProduct?.imageUrl || category.imageUrl;
              const selected = filters.category === category.slug;
              return (
                <button key={category.id} type="button" onClick={() => setFilters({ category: selected ? "" : category.slug })} aria-pressed={selected} className={`group relative flex min-h-[76px] items-end overflow-hidden rounded-xl border p-2 text-left shadow-[0_5px_16px_rgba(108,58,87,.08)] transition duration-300 hover:-translate-y-1 hover:shadow-lg ${selected ? "border-[#A94C79] ring-2 ring-[#E9B7CB]" : "border-white/80"} bg-gradient-to-br ${tilePalettes[index % tilePalettes.length]}`}>
                  {image ? <img src={image} alt="" aria-hidden="true" loading="lazy" className="absolute inset-0 h-full w-full object-cover opacity-55 mix-blend-multiply transition duration-500 group-hover:scale-110" /> : <div className="absolute inset-0 opacity-45"><ProductArt kind={category.art} className="h-full w-full" /></div>}
                  <span className="absolute inset-0 bg-gradient-to-t from-white/95 via-white/30 to-transparent" />
                  <span className="relative z-10 flex w-full items-center justify-between gap-1 text-[#552A43]"><span className="text-[11px] font-bold">{category.name}</span><ArrowRight size={15} className="shrink-0 transition group-hover:translate-x-1" /></span>
                  <span className="absolute right-2 top-1 text-xl text-white/90 drop-shadow">✧</span>
                </button>
              );
            })}
          </div>
        </section>







                        {chips.length > 0 && <ul className="mt-4 flex flex-wrap gap-2" aria-label="Active filters">{chips.map((chip) => <li key={chip.key}><button type="button" onClick={() => setFilters(chip.clear)} className="inline-flex items-center gap-1 rounded-full border border-[#D9A8BC] bg-white/80 px-3 py-1.5 text-xs text-[#713B58]">{chip.label}<X size={12} /></button></li>)}</ul>}

        <section className="casaloom-shop-products mt-5" aria-label="Products">
          <div className="mb-2 flex items-end justify-between gap-3">
            <div><p className="text-[9px] font-bold uppercase tracking-[.24em] text-[#A45C7B]">Lovely things, waiting to be yours</p><h2 className="mt-1 font-display text-xl font-semibold text-[#54243F] sm:text-2xl">{activeCategory?.name || (filters.q ? "Search results" : "Our little collection")}</h2></div>
            {!loading && !error && <span className="rounded-full border border-white/90 bg-white/75 px-3 py-1.5 text-xs font-bold text-[#8B4567]">{results.length} {results.length === 1 ? "piece" : "pieces"}</span>}
          </div>
          {loading && <p role="status" className="rounded-2xl bg-white/75 py-12 text-center text-[#795468]">Gathering the lovely things...</p>}
          {error && <p role="alert" className="rounded-2xl bg-white/85 py-12 text-center text-red-800">{error}</p>}
          {!loading && !error && products.length === 0 && <p className="rounded-2xl bg-white/80 py-12 text-center text-[#795468]">No pieces are available in this collection yet.</p>}
          {!loading && !error && results.length === 0 && products.length > 0 && <div className="rounded-2xl bg-white/85 py-12 text-center"><h3 className="font-display text-2xl text-[#54243F]">No pieces match just yet</h3><p className="mt-2 text-sm text-[#795468]">{unknownCategory ? "That category isn't available. " : ""}Try a different search or clear your filters.</p><button type="button" onClick={clearAll} className="btn-primary mt-5">Show all products</button></div>}
          {!loading && !error && results.length > 0 && (
            <div className="casaloom-products-layout">
              <aside className="casaloom-collection-note">
                <span className="casaloom-note-pill"><Sparkles size={12} /> Lovely little finds</span>
                <p className="casaloom-note-kicker">CasaLoom collection</p>
                <h3>Handpicked<br />for your<br />home.</h3>
                <p className="casaloom-note-description">
                  A thoughtful mix of pretty tableware, floral bottles and keepsake décor to make everyday spaces feel special.
                </p>
                <div className="casaloom-note-thumbnails">
                  {products.filter((product) => product.imageUrl).slice(0, 3).map((product) => (
                    <img key={product.id} src={product.imageUrl} alt={product.name} loading="lazy" />
                  ))}
                </div>
                <button type="button" onClick={clearAll} className="casaloom-note-button">
                  Explore Collection <ArrowRight size={14} />
                </button>
              </aside>
              <div className="casaloom-product-grid" aria-label="Product collection">
                {results.slice(0, visible).map((product) => (
                  <ProductCard key={product.id} p={product} />
                ))}
              </div>
            </div>
          )}
          {!loading && !error && results.length > visible && <div className="mt-5 text-center"><button type="button" onClick={() => setVisible((n) => n + 24)} className="rounded-full border border-[#B96E91] bg-white/85 px-6 py-2.5 text-xs font-bold text-[#713B58] shadow-sm transition hover:bg-[#713B58] hover:text-white">Load more lovely finds <ArrowRight size={14} className="ml-1 inline" /></button></div>}
        </section>
      </div>
    </main>
  );
}
