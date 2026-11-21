import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ArrowDownWideNarrow, ArrowRight, Heart, Search, SlidersHorizontal, Sparkles, X } from "lucide-react";
import ProductCard from "../../components/products/ProductCard";
import ProductArt from "../../components/common/ProductArt";
import { useCatalog } from "../../hooks/useCatalog";
import shopFloralBg from "../../assets/casaloom-shop-floral-bg.jpg";
import "./ShopDesign.css";
import {
  activeFilterCount, applyFilters, filtersToParams, hasAnyFilter, parseFilters, priceRangeError, sortOptions,
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
  const [minInput, setMinInput] = useState(filters.min);
  const [maxInput, setMaxInput] = useState(filters.max);

  const setFilters = (patch: Partial<ProductFilters>, replace = false) => setParams(filtersToParams({ ...filters, ...patch }), { replace });
  useEffect(() => { setQInput(filters.q); setMinInput(filters.min); setMaxInput(filters.max); }, [filters.q, filters.min, filters.max]);
  useEffect(() => {
    const clean = (v: string) => (/^\d{0,9}(\.\d{0,2})?$/.test(v.trim()) ? v.trim().replace(/\.$/, "") : null);
    const nextMin = clean(minInput) ?? filters.min;
    const nextMax = clean(maxInput) ?? filters.max;
    const nextQ = qInput.replace(/\s+/g, " ").trim().slice(0, 100);
    if (nextQ === filters.q && nextMin === filters.min && nextMax === filters.max) return;
    const timer = window.setTimeout(() => setParams(filtersToParams({ ...filters, q: nextQ, min: nextMin, max: nextMax }), { replace: true }), 350);
    return () => window.clearTimeout(timer);
  }, [qInput, minInput, maxInput, filters, setParams]);

  useEffect(() => { setVisible(24); }, [params.toString()]);
  const results = useMemo(() => applyFilters(products, categories, filters), [products, categories, filters]);
  const unknownCategory = !!filters.category && !loading && !categories.some((c) => c.slug === filters.category);
  const rangeError = priceRangeError(filters) || priceRangeError({ min: minInput, max: maxInput });
  const activeCount = activeFilterCount(filters);
  const activeCategory = categories.find((c) => c.slug === filters.category);
  const clearAll = () => { setParams(new URLSearchParams()); setQInput(""); setMinInput(""); setMaxInput(""); };
  const chips: { key: string; label: string; clear: Partial<ProductFilters> }[] = [
    ...(filters.q ? [{ key: "q", label: `“${filters.q}”`, clear: { q: "" } }] : []),
    ...(activeCategory ? [{ key: "category", label: activeCategory.name, clear: { category: "" } }] : []),
    ...(filters.min ? [{ key: "min", label: `From ₹${Number(filters.min).toLocaleString("en-IN")}`, clear: { min: "" } }] : []),
    ...(filters.max ? [{ key: "max", label: `Up to ₹${Number(filters.max).toLocaleString("en-IN")}`, clear: { max: "" } }] : []),
    ...(filters.stock !== "all" ? [{ key: "stock", label: filters.stock === "in" ? "In stock" : "Out of stock", clear: { stock: "all" as StockFilter } }] : []),
    ...(filters.customizable ? [{ key: "custom", label: "Personalised", clear: { customizable: false } }] : []),
  ];
  const marqueeProducts = results.slice(0, visible);
  const repeatedProducts = marqueeProducts.length > 1 ? [...marqueeProducts, ...marqueeProducts] : marqueeProducts;

  return (
    <main className="casaloom-shop-page relative isolate min-h-screen overflow-hidden" style={{ backgroundImage: `linear-gradient(rgba(255,246,249,.28), rgba(255,246,249,.34)), url(${shopFloralBg})` }}>
      <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(circle_at_50%_10%,rgba(255,255,255,.72),transparent_45%),linear-gradient(120deg,rgba(255,225,232,.22),rgba(224,211,249,.22))]" />
      <div className="mx-auto max-w-[1500px] px-4 pb-10 pt-2 sm:px-6 lg:px-8">


        <section className="casaloom-shop-toolbar sticky top-2 z-30 mb-3 rounded-[16px] border border-white/95 bg-white/90 p-2 shadow-[0_5px_16px_rgba(116,61,88,.10)] backdrop-blur-xl sm:p-2.5" aria-label="Search and product filters">
          <div className="grid gap-1.5 lg:grid-cols-[minmax(190px,1.6fr)_repeat(4,minmax(95px,1fr))]">
            <label className="relative block">
              <span className="mb-0.5 block text-[8px] font-bold uppercase tracking-[.16em] text-[#8D5870]">Search the collection</span>
              <Search size={15} className="pointer-events-none absolute left-3 top-[29px] z-10 text-[#A45C7B]" />
              <input type="search" value={qInput} maxLength={100} onChange={(e) => setQInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") setFilters({ q: qInput.replace(/\s+/g, " ").trim().slice(0, 100) }); }} placeholder="Mugs, bottles, pretty things..." className={`${field} !rounded-full !min-h-[34px] !py-1 !pl-10 !pr-3 !text-[11px] !leading-5`} />
            </label>
            <label className="block">
              <span className="mb-0.5 block text-[8px] font-bold uppercase tracking-[.16em] text-[#8D5870]">Min price (₹)</span>
              <input inputMode="decimal" placeholder="From" value={minInput} onChange={(e) => setMinInput(e.target.value)} aria-invalid={rangeError ? true : undefined} className={`${field} !rounded-full !px-3 !py-1 !text-[11px] !leading-5`} />
            </label>
            <label className="block">
              <span className="mb-0.5 block text-[8px] font-bold uppercase tracking-[.16em] text-[#8D5870]">Max price (₹)</span>
              <input inputMode="decimal" placeholder="To" value={maxInput} onChange={(e) => setMaxInput(e.target.value)} aria-invalid={rangeError ? true : undefined} className={`${field} !rounded-full !px-3 !py-1 !text-[11px] !leading-5`} />
            </label>
            <label className="block">
              <span className="mb-0.5 block text-[8px] font-bold uppercase tracking-[.16em] text-[#8D5870]">Availability</span>
              <select value={filters.stock} onChange={(e) => setFilters({ stock: e.target.value as StockFilter })} className={`${field} !rounded-full !px-3 !py-1 !text-[11px] !leading-5`}>
                <option value="all">All pieces</option><option value="in">In stock</option><option value="out">Out of stock</option>
              </select>
            </label>
            <label className="block">
              <span className="mb-0.5 block text-[8px] font-bold uppercase tracking-[.16em] text-[#8D5870]">Sort by</span>
              <select value={filters.sort} onChange={(e) => setFilters({ sort: e.target.value as SortKey })} className={`${field} !rounded-full !px-3 !py-1 !text-[11px] !leading-5`}>{sortOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
            </label>
          </div>
          <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 border-t border-[#F0DCE4] pt-1.5">
            <label className="flex items-center gap-2 text-xs font-medium text-[#6F4A5B]"><input type="checkbox" checked={filters.customizable} onChange={(e) => setFilters({ customizable: e.target.checked })} className="accent-[#A13F70]" /> Can be personalised</label>
            <div className="flex items-center gap-3">
              {rangeError && <span role="alert" className="text-xs text-red-700">{rangeError}</span>}
              {activeCount > 0 && <button type="button" onClick={clearAll} className="inline-flex items-center gap-1 text-xs font-bold text-[#98466D] hover:underline">Clear filters <X size={13} /></button>}
            </div>
          </div>
        </section>

                {chips.length > 0 && <ul className="mt-4 flex flex-wrap gap-2" aria-label="Active filters">{chips.map((chip) => <li key={chip.key}><button type="button" onClick={() => setFilters(chip.clear)} className="inline-flex items-center gap-1 rounded-full border border-[#D9A8BC] bg-white/80 px-3 py-1.5 text-xs text-[#713B58]">{chip.label}<X size={12} /></button></li>)}</ul>}

        <section className="casaloom-shop-hero relative isolate overflow-hidden rounded-[20px] border border-white/90 px-3 py-4 shadow-[0_9px_24px_rgba(115,53,88,.11)] sm:px-5 sm:py-5 lg:py-5">
          <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(circle_at_12%_18%,rgba(255,255,255,.8),transparent_25%),radial-gradient(circle_at_88%_78%,rgba(255,190,213,.72),transparent_30%),linear-gradient(110deg,rgba(255,226,220,.88),rgba(231,216,248,.9)_48%,rgba(255,229,208,.9))]" />
          <div className="pointer-events-none absolute -left-12 top-1/2 h-40 w-40 -translate-y-1/2 rounded-full bg-[#F4AFC7]/30 blur-3xl" />
          <div className="pointer-events-none absolute -right-10 top-0 h-48 w-48 rounded-full bg-[#BCA6E7]/35 blur-3xl" />
          <div className="relative z-10 grid items-center gap-2 lg:grid-cols-[minmax(95px,.7fr)_minmax(260px,1.7fr)_minmax(95px,.7fr)]">
            <div className="hidden items-center justify-center lg:flex">
              {products.find((product) => product.imageUrl)?.imageUrl ? (
                <div className="w-28 rotate-[-7deg] overflow-hidden rounded-[28px] lg:w-32 xl:w-36 border-[5px] border-white/90 bg-white shadow-[0_18px_35px_rgba(100,45,77,.2)] transition duration-500 hover:rotate-0 hover:scale-105">
                  <img src={products.find((product) => product.imageUrl)!.imageUrl} alt="Featured CasaLoom product" className="aspect-[4/5] w-full object-cover" />
                </div>
              ) : <div className="text-8xl drop-shadow">🌷</div>}
            </div>
            <div className="mx-auto max-w-2xl text-center">
              <span className="inline-flex items-center gap-2 rounded-full border border-[#D99AB5] bg-white/75 px-4 py-2 text-[9px] font-extrabold uppercase tracking-[.24em] text-[#8B4567] shadow-sm"><Sparkles size={13} /> Curated little treasures</span>
              <h1 className="mt-3 font-display text-3xl font-semibold tracking-tight text-[#54243F] drop-shadow-sm sm:text-4xl lg:text-5xl">Shop All<span className="text-[#B84F7C]">.</span></h1>
              <p className="mx-auto mt-1 max-w-lg text-[11px] leading-4 sm:text-xs text-[#795468] sm:text-base">Pretty everyday pieces, thoughtful gifts and lovely details for every corner of your home.</p>
              <div className="mt-2 flex flex-wrap justify-center gap-1.5 text-[9px] font-extrabold uppercase tracking-[.15em] text-[#8B4567] sm:text-[10px]">
                <span className="rounded-full border border-white/90 bg-white/75 px-4 py-2 shadow-sm">♡ Mugs & tableware</span>
                <span className="rounded-full border border-white/90 bg-white/75 px-4 py-2 shadow-sm">✿ Glass bottles</span>
                <span className="rounded-full border border-white/90 bg-white/75 px-4 py-2 shadow-sm">✧ Frames & decor</span>
              </div>
            </div>
            <div className="hidden items-center justify-center lg:flex">
              {products.filter((product) => product.imageUrl).length > 1 ? (
                <div className="w-28 rotate-[7deg] overflow-hidden rounded-[28px] lg:w-32 xl:w-36 border-[5px] border-white/90 bg-white shadow-[0_18px_35px_rgba(100,45,77,.2)] transition duration-500 hover:rotate-0 hover:scale-105">
                  <img src={products.filter((product) => product.imageUrl)[1].imageUrl} alt="More CasaLoom decor" className="aspect-[4/5] w-full object-cover" />
                </div>
              ) : <div className="text-8xl drop-shadow">🦋</div>}
            </div>
          </div>
          <span className="pointer-events-none absolute left-5 top-4 text-4xl text-[#B86D8E]/55">✿</span>
          <span className="pointer-events-none absolute right-6 bottom-3 text-5xl text-[#A17AB5]/55">✽</span>
          <span className="pointer-events-none absolute right-[12%] top-4 text-2xl text-[#A17AB5]/65">✧</span>
        </section>

        <section className="casaloom-shop-categories mt-4" aria-label="Shop categories">
          <div className="mb-2 flex items-end justify-between gap-3">
            <div>
              <p className="text-[9px] font-bold uppercase tracking-[.25em] text-[#A45C7B]">Find your favourite</p>
              <h2 className="mt-1 font-display text-lg font-semibold text-[#54243F] sm:text-xl">Shop by category</h2>
            </div>
            <span className="hidden text-xs text-[#946D80] sm:block">A little something for every space</span>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
            <button type="button" onClick={() => setFilters({ category: "" })} aria-pressed={!filters.category} className={`group relative flex min-h-[112px] items-center justify-between overflow-hidden rounded-2xl border p-3 text-left sm:min-h-[126px] shadow-[0_5px_16px_rgba(108,58,87,.08)] transition duration-300 hover:-translate-y-1 hover:shadow-lg ${!filters.category ? "border-[#A94C79] ring-2 ring-[#E9B7CB]" : "border-white/80"} bg-gradient-to-br from-[#713B58] to-[#A94C79] text-white`}>
              <span className="pointer-events-none absolute -right-3 -top-5 h-24 w-24 rounded-full border border-white/20 bg-white/10" />
              <span className="pointer-events-none absolute -right-1 -top-1 h-16 w-16 rounded-full border border-white/25" />
              <span className="pointer-events-none absolute bottom-1 right-8 text-5xl text-[#F7C7D9]/35">✿</span>
              <span className="pointer-events-none absolute right-14 top-2 rotate-12 text-xl text-white/75">✧</span>
              <span className="relative z-10"><span className="block text-2xl drop-shadow-sm">✦</span><span className="mt-1 block text-[11px] font-extrabold tracking-wide">All products</span><span className="mt-0.5 block text-[8px] font-semibold uppercase tracking-[.18em] text-white/75">Explore every treasure</span></span>
              <span className="relative z-10 rounded-full border border-white/35 bg-white/15 p-1.5 shadow-inner"><ArrowRight size={16} /></span>
            </button>
            {categories.map((category, index) => {
              const categoryProduct = products.find(
                (product) => product.categoryId === category.id && product.imageUrl
              );
              // Use the latest product photo first; category.imageUrl is only a fallback.
              const image = categoryProduct?.imageUrl || category.imageUrl;
              const selected = filters.category === category.slug;
              return (
                <button key={category.id} type="button" onClick={() => setFilters({ category: selected ? "" : category.slug })} aria-pressed={selected} className={`group relative flex min-h-[112px] items-end overflow-hidden rounded-2xl border p-3 text-left sm:min-h-[126px] shadow-[0_5px_16px_rgba(108,58,87,.08)] transition duration-300 hover:-translate-y-1 hover:shadow-lg ${selected ? "border-[#A94C79] ring-2 ring-[#E9B7CB]" : "border-white/80"} bg-gradient-to-br ${tilePalettes[index % tilePalettes.length]}`}>
                  {image ? <img src={image} alt="" aria-hidden="true" loading="lazy" className="absolute inset-0 h-full w-full object-cover opacity-95 transition duration-500 group-hover:scale-110" /> : <div className="absolute inset-0 opacity-45"><ProductArt kind={category.art} className="h-full w-full" /></div>}
                  <span className="absolute inset-0 bg-gradient-to-t from-white/90 via-white/10 to-transparent" />
                  <span className="relative z-10 flex w-full items-center justify-between gap-1 text-[#552A43]"><span className="text-[11px] font-bold">{category.name}</span><ArrowRight size={15} className="shrink-0 transition group-hover:translate-x-1" /></span>
                  <span className="absolute right-2 top-1 text-xl text-white/90 drop-shadow">✧</span>
                </button>
              );
            })}
          </div>
        </section>





        <section className="casaloom-shop-products mt-7" aria-label="Products">
          <div className="casaloom-product-showcase grid gap-3 rounded-[24px] border border-white/90 bg-[linear-gradient(135deg,rgba(255,250,250,.96),rgba(255,238,245,.94)_48%,rgba(244,235,250,.94))] p-2.5 shadow-[0_16px_42px_rgba(104,43,83,.12)] sm:gap-3 sm:p-3 lg:grid-cols-[190px_minmax(0,1fr)] lg:items-start lg:gap-4 lg:p-4 xl:grid-cols-[205px_minmax(0,1fr)]">
            <aside className="casaloom-product-intro relative flex self-start flex-col justify-start overflow-hidden rounded-[18px] border border-white/80 bg-[radial-gradient(circle_at_10%_5%,rgba(255,255,255,.95),transparent_40%),linear-gradient(155deg,#FBE6E8,#F1DDF0_58%,#FCE9E5)] p-3 sm:p-3.5">
              <span aria-hidden="true" className="pointer-events-none absolute -right-7 -top-8 text-[100px] leading-none text-[#C17A9C]/15">✿</span>
              <span className="relative z-10 inline-flex w-fit items-center gap-2 rounded-full border border-[#D99AB5] bg-white/75 px-3 py-1.5 text-[8px] font-extrabold uppercase tracking-[.2em] text-[#8B4567]">
                <Sparkles size={12} /> Lovely little finds
              </span>
              <p className="relative z-10 mt-3 text-[8px] font-bold uppercase tracking-[.2em] text-[#A45C7B]">CasaLoom collection</p>
              <h2 className="relative z-10 mt-2 font-display text-2xl font-medium leading-[1.02] text-[#54243F] sm:text-3xl">
                Handpicked <span className="italic text-[#A45E78]">for your home.</span>
              </h2>
              <p className="relative z-10 mt-2 max-w-[30rem] text-[11px] leading-5 text-[#795468]">
                A thoughtful mix of pretty tableware, floral bottles and keepsake décor to make everyday spaces feel special.
              </p>
              <div className="relative z-10 mt-3 flex items-center gap-1.5">
                {products.filter((product) => product.imageUrl).slice(0, 3).map((product) => (
                  <div key={product.id} className="h-[48px] w-[44px] overflow-hidden rounded-lg border-[2px] border-white bg-white shadow-[0_5px_12px_rgba(104,43,83,.12)] transition duration-300 hover:-translate-y-1">
                    <img src={product.imageUrl} alt={product.name} loading="lazy" className="h-full w-full object-cover" />
                  </div>
                ))}
              </div>
              <button
                type="button"
                onClick={clearAll}
                className="relative z-10 mt-3 inline-flex w-fit items-center gap-2 rounded-full bg-[#713B58] px-4 py-2 text-[9px] font-bold tracking-wide text-white shadow-[0_7px_16px_rgba(113,59,88,.18)] transition hover:-translate-y-0.5 hover:bg-[#572A43]"
              >
                Explore all products <ArrowRight size={14} />
              </button>
              <div className="relative z-10 mt-3 flex items-center gap-2 text-[7px] font-bold uppercase tracking-[.16em] text-[#9B6B80]">
                <span className="h-px w-7 bg-[#C99EA4]" /> Curated with a little extra love
              </div>
            </aside>

            <div className="min-w-0">
              <div className="mb-2 flex flex-wrap items-end justify-between gap-2 px-1">
                <div>
                  <p className="text-[9px] font-bold uppercase tracking-[.24em] text-[#A45C7B]">Lovely things, waiting to be yours</p>
                  <h2 className="mt-1 font-display text-lg font-semibold text-[#54243F] sm:text-xl">
                    {activeCategory?.name || (filters.q ? "Search results" : "Our little collection")}
                  </h2>
                </div>
                {!loading && !error && (
                  <span className="rounded-full border border-white/90 bg-white/80 px-3 py-1.5 text-xs font-bold text-[#8B4567] shadow-sm">
                    {results.length} {results.length === 1 ? "piece" : "pieces"}
                  </span>
                )}
              </div>

              {loading && <p role="status" className="rounded-2xl border border-white bg-white/75 py-12 text-center text-sm text-[#795468]">Gathering the lovely things...</p>}
              {error && <p role="alert" className="rounded-2xl border border-white bg-white/85 py-12 text-center text-sm text-red-800">{error}</p>}
              {!loading && !error && products.length === 0 && <p className="rounded-2xl border border-white bg-white/80 py-12 text-center text-sm text-[#795468]">No pieces are available in this collection yet.</p>}
              {!loading && !error && results.length === 0 && products.length > 0 && (
                <div className="rounded-2xl border border-white bg-white/85 py-12 text-center">
                  <h3 className="font-display text-2xl text-[#54243F]">No pieces match just yet</h3>
                  <p className="mt-2 text-sm text-[#795468]">{unknownCategory ? "That category isn't available. " : ""}Try a different search or clear your filters.</p>
                  <button type="button" onClick={clearAll} className="btn-primary mt-5">Show all products</button>
                </div>
              )}
              {!loading && !error && results.length > 0 && (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-5" aria-label="Product collection">
                  {results.slice(0, visible).map((product) => (
                    <ProductCard key={product.id} p={product} />
                  ))}
                </div>
              )}
              {!loading && !error && results.length > visible && (
                <div className="mt-5 text-center">
                  <button type="button" onClick={() => setVisible((n) => n + 24)} className="rounded-full border border-[#B96E91] bg-white/90 px-6 py-2.5 text-xs font-bold text-[#713B58] shadow-sm transition hover:bg-[#713B58] hover:text-white">
                    Load more lovely finds <ArrowRight size={14} className="ml-1 inline" />
                  </button>
                </div>
              )}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
