import {
  ArrowRight,
  BadgeCheck,
  Flower2,
  Gift,
  Heart,
  Headphones,
  Sparkles,
  Truck,
} from "lucide-react";
import { Link } from "react-router-dom";
import { useEffect, useMemo, useRef, useState } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);
import { useCatalog } from "../../hooks/useCatalog";
import ProductArt from "../../components/common/ProductArt";
import ProductCard from "../../components/products/ProductCard";
import type { Category, Product } from "../../types";
import { useStoreSettings } from "../../context/StoreSettingsContext";
import { formatINR } from "../../utils/currency";

const editorial = {
  hero: "/images/casaloom-editorial/hero-pinterest-still-life.webp",
  tabletop: "/images/casaloom-editorial/editorial-tabletop.webp",
  display: "/images/casaloom-editorial/pink-boutique-display.webp",
  styling: "/images/casaloom-editorial/collection-styling.webp",
};

// function CategoryCard({ category, index, products, duplicate = false }: { category: Category; index: number; products: Product[]; duplicate?: boolean }) {
//   // const productImage = products.find((product) => product.categoryId === category.id && product.imageUrl)?.imageUrl;


//   const productImage = products.find(
//   (product) =>
//     product.categoryId === category.id && product.imageUrl
// )?.imageUrl;

// // Prioritise the newly uploaded product image
// const image = productImage || category.imageUrl;



//   const image = category.imageUrl || productImage;
//   return (
//     <Link to={`/category/${category.slug}`} tabIndex={duplicate ? -1 : 0} aria-hidden={duplicate ? true : undefined} data-3d-card data-reveal className="group block w-[clamp(140px,13vw,180px)] shrink-0 [transform-style:preserve-3d]">
//       <div className="relative aspect-square overflow-hidden rounded-t-[42%] rounded-b-xl bg-[#F1E4E2] shadow-[0_10px_24px_rgba(83,42,59,.08)]">
//         {image ? (
//           <img src={image} alt={category.name} loading="lazy" className="h-full w-full scale-[1.06] object-cover transition-transform duration-700 ease-out group-hover:scale-100" />
//         ) : (
//           <ProductArt kind={category.art} className="h-full w-full scale-[1.06] transition-transform duration-700 ease-out group-hover:scale-100" />
//         )}
//         <span className="absolute left-3 top-3 rounded-full border border-white/70 bg-[#FFF9F4]/90 px-3 py-1 text-[9px] font-bold uppercase tracking-[.18em] text-[#743C57]">0{index + 1}</span>
//         <span className="absolute bottom-3 right-3 grid h-9 w-9 place-items-center rounded-full bg-[#FFF9F4] text-[#743C57] shadow-sm transition group-hover:bg-[#743C57] group-hover:text-white"><ArrowRight size={16} /></span>
//       </div>
//       <div className="px-2 pt-3 text-center">
//         <h3 className="font-heading text-base font-semibold text-[#4B303D] transition group-hover:text-[#8B526A]">{category.name}</h3>
//         <span className="mt-1 block text-[9px] uppercase tracking-[.2em] text-[#A27C83]">Explore collection</span>
//       </div>
//     </Link>
//   );
// }



function CategoryCard({
  category,
  index,
  products,
  duplicate = false,
}: {
  category: Category;
  index: number;
  products: Product[];
  duplicate?: boolean;
}) {
  const productImage = products.find(
    (product) =>
      product.categoryId === category.id && product.imageUrl
  )?.imageUrl;

  // Newly uploaded product image takes priority
  const image = productImage || category.imageUrl;

  return (
    // <Link
    //   to={`/category/${category.slug}`}
    <Link to={`/shop?category=${encodeURIComponent(category.slug)}`}
      tabIndex={duplicate ? -1 : 0}
      aria-hidden={duplicate ? true : undefined}
      data-3d-card
      data-reveal
      className="group block w-[clamp(140px,13vw,180px)] shrink-0 [transform-style:preserve-3d]"
    >
      <div className="relative aspect-square overflow-hidden rounded-t-[42%] rounded-b-xl bg-[#F1E4E2] shadow-[0_10px_24px_rgba(83,42,59,.08)]">
        {image ? (
          <img
            src={image}
            alt={category.name}
            loading="lazy"
            className="h-full w-full scale-[1.06] object-cover transition-transform duration-700 ease-out group-hover:scale-100"
          />
        ) : (
          <ProductArt
            kind={category.art}
            className="h-full w-full scale-[1.06] transition-transform duration-700 ease-out group-hover:scale-100"
          />
        )}

        <span className="absolute left-3 top-3 rounded-full border border-white/70 bg-[#FFF9F4]/90 px-3 py-1 text-[9px] font-bold uppercase tracking-[.18em] text-[#743C57]">
          0{index + 1}
        </span>

        <span className="absolute bottom-3 right-3 grid h-9 w-9 place-items-center rounded-full bg-[#FFF9F4] text-[#743C57] shadow-sm transition group-hover:bg-[#743C57] group-hover:text-white">
          <ArrowRight size={16} />
        </span>
      </div>

      <div className="px-2 pt-3 text-center">
        <h3 className="font-heading text-base font-semibold text-[#4B303D] transition group-hover:text-[#8B526A]">
          {category.name}
        </h3>
        <span className="mt-1 block text-[9px] uppercase tracking-[.2em] text-[#A27C83]">
          Explore collection
        </span>
      </div>
    </Link>
  );
}


export default function Home() {
  const { categories = [], products = [], loading, error } = useCatalog();
  const { settings, configured } = useStoreSettings();
  const [activeFilter, setActiveFilter] = useState("All");
  const heroRef = useRef<HTMLElement | null>(null);
  const heroImageRef = useRef<HTMLImageElement | null>(null);
  const pageBackdropRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const section = heroRef.current;
    const image = heroImageRef.current;
    const backdrop = pageBackdropRef.current;
    if (!section || !image || !backdrop) return;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion) return;

    const context = gsap.context(() => {
      // A slow cinematic breathing zoom keeps the hero image alive without
      // distracting from the headline or shopping controls.
      gsap.fromTo(
        backdrop,
        { scale: 1.02, xPercent: -1, yPercent: -1, transformOrigin: "50% 50%" },
        {
          scale: 1.1,
          xPercent: 1,
          yPercent: 1,
          duration: 32,
          ease: "sine.inOut",
          yoyo: true,
          repeat: -1,
        },
      );

      gsap.fromTo(
        image,
        { scale: 1.025, transformOrigin: "50% 50%" },
        {
          scale: 1.16,
          duration: 10,
          ease: "sine.inOut",
          yoyo: true,
          repeat: -1,
        },
      );
    }, section);

    // Scroll reveals and restrained 3D card tilt for the rest of the storefront.
    const revealElements = gsap.utils.toArray<HTMLElement>("[data-reveal]", section.parentElement ?? undefined);
    revealElements.forEach((element) => {
      gsap.fromTo(
        element,
        { y: 24, autoAlpha: 0 },
        {
          y: 0,
          autoAlpha: 1,
          duration: 0.75,
          ease: "power2.out",
          scrollTrigger: {
            trigger: element,
            start: "top 88%",
            once: true,
          },
        },
      );
    });

    const tiltElements = gsap.utils.toArray<HTMLElement>("[data-3d-card]", section.parentElement ?? undefined);
    const tiltCleanups: Array<() => void> = [];
    tiltElements.forEach((card) => {
      const move = (event: PointerEvent) => {
        if (event.pointerType === "touch") return;
        const rect = card.getBoundingClientRect();
        const px = (event.clientX - rect.left) / rect.width;
        const py = (event.clientY - rect.top) / rect.height;
        gsap.to(card, {
          rotateY: (px - 0.5) * 7,
          rotateX: (0.5 - py) * 7,
          y: -3,
          transformPerspective: 900,
          transformOrigin: "center",
          duration: 0.35,
          ease: "power2.out",
          overwrite: "auto",
        });
      };
      const reset = () => gsap.to(card, {
        rotateX: 0,
        rotateY: 0,
        y: 0,
        duration: 0.65,
        ease: "power3.out",
        overwrite: "auto",
      });
      card.addEventListener("pointermove", move);
      card.addEventListener("pointerleave", reset);
      tiltCleanups.push(() => {
        card.removeEventListener("pointermove", move);
        card.removeEventListener("pointerleave", reset);
      });
    });

    const handlePointerMove = (event: PointerEvent) => {
      if (event.pointerType === "touch") return;
      const bounds = section.getBoundingClientRect();
      const x = (event.clientX - bounds.left) / bounds.width - 0.5;
      const y = (event.clientY - bounds.top) / bounds.height - 0.5;
      gsap.to(image, {
        x: x * -10,
        y: y * -7,
        duration: 0.45,
        ease: "power2.out",
        overwrite: "auto",
      });
    };
    const resetPointer = () => {
      gsap.to(image, { x: 0, y: 0, duration: 0.6, ease: "power2.out", overwrite: "auto" });
    };

    section.addEventListener("pointermove", handlePointerMove);
    section.addEventListener("pointerleave", resetPointer);
    return () => {
      section.removeEventListener("pointermove", handlePointerMove);
      section.removeEventListener("pointerleave", resetPointer);
      tiltCleanups.forEach((cleanup) => cleanup());
      context.revert();
    };
  }, []);

  const filters = useMemo(() => ["All", ...categories.slice(0, 4).map((category) => category.name)], [categories]);
  const visibleProducts = useMemo(() => {
    const filtered = activeFilter === "All" ? products : products.filter((product) => {
      const category = categories.find((item) => item.id === product.categoryId || item.name === product.category);
      return category?.name === activeFilter;
    });
    return filtered.slice(0, 4);
  }, [activeFilter, categories, products]);

  const shippingText = configured && settings.free_shipping_threshold_inr !== null
    ? `Free shipping on orders above ${formatINR(settings.free_shipping_threshold_inr)}`
    : settings.shipping_charge_inr === 0 ? "Complimentary shipping on every order" : "Thoughtful finds for beautiful everyday living";

  return (
    <div className="casaloom-page-shell relative isolate overflow-hidden bg-[#FFF4F1] text-[#49343D]">
      <div
        ref={pageBackdropRef}
        aria-hidden="true"
        className="casaloom-page-backdrop pointer-events-none fixed inset-[-4%] z-[-1]"
        style={{ backgroundImage: `url("${editorial.tabletop}")` }}
      />
      <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-[-1] bg-[linear-gradient(135deg,rgba(255,244,240,.78),rgba(255,250,246,.84)_48%,rgba(246,220,219,.72))]" />
      {/* Pinterest-inspired hero */}
      <section ref={heroRef} className="relative isolate min-h-[310px] overflow-hidden bg-[#F4E2DF] sm:min-h-[340px] lg:min-h-[370px]">
        <img ref={heroImageRef} src={editorial.hero} alt="CasaLoom floral bottles, bow mugs, scalloped plates and vintage botanical frames" loading="eager" className="absolute inset-0 h-full w-full object-cover object-center will-change-transform" />
        <div className="absolute inset-0 bg-gradient-to-r from-[#FFF7F1]/95 via-[#FFF7F1]/82 to-[#FFF7F1]/5" />
        <div className="absolute inset-y-0 left-0 w-full bg-[radial-gradient(ellipse_at_10%_55%,rgba(255,250,244,.55),transparent_58%)]" />
        <div className="container-x relative mx-auto max-w-[1120px] flex min-h-[310px] items-center py-7 sm:min-h-[340px] lg:min-h-[370px]">
          <div className="max-w-[370px] animate-rise">
            <span className="inline-flex items-center gap-2 rounded-full border border-[#D8B4B0]/70 bg-white/65 px-4 py-2 text-[9px] font-bold uppercase tracking-[.25em] text-[#875368] backdrop-blur-sm"><Sparkles size={13} /> The little things make a home</span>
            <h1 className="mt-5 font-display text-[clamp(2.2rem,4.2vw,3.8rem)] font-medium leading-[.82] tracking-[-.045em] text-[#4A2B3A]">A little more <span className="italic text-[#A45E78]">lovely.</span></h1>
            <p className="mt-4 max-w-[360px] font-body text-sm leading-6 text-[#654C54] sm:text-base">Romantic details, pretty everyday pieces and thoughtful gifts to make your space feel like you.</p>
            <div className="mt-5 flex flex-wrap gap-2.5">
              <Link to="/shop" className="inline-flex items-center gap-3 rounded-full bg-[#713B58] px-5 py-2.5 text-[11px] font-bold tracking-wide text-white shadow-[0_12px_28px_rgba(113,59,88,.2)] transition hover:-translate-y-0.5 hover:bg-[#572A43]">Shop the collection <ArrowRight size={16} /></Link>
              <Link to="/personalised-gifts" className="inline-flex items-center gap-2 rounded-full border border-[#9D6C7D]/45 bg-white/65 px-5 py-2.5 text-[11px] font-bold text-[#713B58] backdrop-blur-sm transition hover:bg-white">Personalised gifts</Link>
            </div>
            <div className="mt-5 flex items-center gap-3 text-[9px] font-bold uppercase tracking-[.22em] text-[#946D78]"><span className="h-px w-10 bg-[#C99EA4]" /> Curated with a little extra love</div>
          </div>
        </div>
        <span className="pointer-events-none absolute bottom-6 right-7 hidden font-display text-5xl italic text-white/90 drop-shadow-sm lg:block">made to delight</span>
      </section>

      {/* Brand promise strip */}
      <section data-reveal className="border-y border-[#EBDAD6]/80 bg-[#FFFDF9]/78 backdrop-blur-[3px]">
        <div className="container-x mx-auto max-w-[1080px] grid grid-cols-2 divide-x divide-y divide-[#EBDAD6] sm:grid-cols-4 sm:divide-y-0">
          {[
            [Truck, "Thoughtful delivery", shippingText],
            [BadgeCheck, "Lovely quality", "Chosen for everyday moments"],
            [Gift, "Gift-ready finds", "Little things, big smiles"],
            [Headphones, "Here to help", "A friendly team when you need us"],
          ].map(([Icon, title, detail]: any) => (
            <div key={title} className="flex items-center gap-3 px-2.5 py-3 sm:justify-center sm:px-3">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#F7E8E7] text-[#94566D]"><Icon size={18} strokeWidth={1.6} /></span>
              <span><strong className="block text-[11px] font-bold text-[#573B46] sm:text-xs">{title}</strong><span className="mt-1 block max-w-[170px] text-[9px] leading-4 text-[#987F83] sm:text-[10px]">{detail}</span></span>
            </div>
          ))}
        </div>
      </section>

      {/* Shop by collection */}
      <section data-reveal className="container-x mx-auto max-w-[1080px] py-5 sm:py-7">
        <div className="mx-auto mb-4 max-w-md text-center">
          <p className="section-kicker mb-3 !text-[#A56C7B]">A collection to fall for</p>
          <h2 className="font-display text-2xl font-medium tracking-tight text-[#4B303D] sm:text-3xl">Find your <span className="italic text-[#A45E78]">favourite</span> little things</h2>
          <p className="mx-auto mt-2 max-w-md text-xs leading-5 text-[#8B7479]">From pretty tableware to keepsake frames, discover pieces that make ordinary days feel special.</p>
        </div>
        {loading && <p role="status" className="py-8 text-center text-sm text-[#8B7479]">Gathering the collections...</p>}
        {error && <p role="alert" className="py-6 text-center text-sm text-red-700">{error}</p>}
        {!loading && categories.length === 0 && <div className="rounded-2xl border border-dashed border-[#DDBFC0] bg-white/70 p-8 text-center text-sm text-[#8B7479]">Our collections are being prepared. Please check back soon.</div>}
        {categories.length > 0 && (
          <div
            className="category-marquee relative -mx-4 overflow-hidden py-3 sm:-mx-6 lg:-mx-10"
            aria-label="Browse CasaLoom collections"
          >
            <div className="category-marquee-track">
              {[0, 1, 2, 3].map((copy) => (
                <div className="category-marquee-group" key={copy} aria-hidden={copy !== 0 ? true : undefined}>
                  {categories.slice(0, 8).map((category, index) => (
                    <CategoryCard
                      key={`${copy}-${category.id}`}
                      category={category}
                      index={index}
                      products={products}
                      duplicate={copy !== 0}
                    />
                  ))}
                </div>
              ))}
            </div>
          </div>
        )}
        <div className="mt-4 text-center"><Link to="/shop" className="inline-flex items-center gap-2 border-b border-[#A56C7B] pb-1 text-[10px] font-bold uppercase tracking-[.2em] text-[#79465C]">Explore all collections <ArrowRight size={14} /></Link></div>
      </section>

      {/* Editorial split banner */}
      <section data-reveal className="container-x mx-auto max-w-[1080px] pb-5 sm:pb-7">
        <div className="grid overflow-hidden rounded-[22px] border border-white/70 bg-[#F3E2DE]/90 shadow-[0_18px_50px_rgba(93,55,65,.08)] md:grid-cols-[.92fr_1.08fr]">
          <div className="flex flex-col justify-center px-5 py-7 sm:px-7 sm:py-8 lg:px-9">
            <p className="section-kicker mb-4 !text-[#A56C7B]">The CasaLoom mood</p>
            <h2 className="font-display text-4xl font-medium leading-[.94] text-[#4B303D] sm:text-5xl">Make room for <span className="italic text-[#A45E78]">pretty.</span></h2>
            <p className="mt-3 max-w-md text-xs leading-6 text-[#765D65]">A soft mix of vintage charm and modern sweetness — little details that bring warmth, colour and personality to your everyday.</p>
            <Link to="/shop" className="btn-primary mt-5 w-fit !rounded-full !bg-[#713B58] !px-7">Discover the edit <ArrowRight size={15} /></Link>
            <div className="mt-5 flex items-center gap-2 text-[9px] font-bold uppercase tracking-[.2em] text-[#A0717C]"><Heart size={13} /> Made for your kind of lovely</div>
          </div>
          <div className="min-h-[180px] overflow-hidden sm:min-h-[230px]"><img src={editorial.tabletop} alt="Floral tableware and romantic home styling" loading="lazy" className="h-full w-full object-cover" /></div>
        </div>
      </section>

      {/* Featured products */}
      <section data-reveal className="bg-[#F9EFEB]/78 py-5 backdrop-blur-[3px] sm:py-7">
        <div className="container-x mx-auto max-w-[1080px]">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div><p className="section-kicker mb-2 !text-[#A56C7B]">Little treasures, picked for you</p><h2 className="font-display text-3xl font-medium text-[#4B303D] sm:text-4xl">The <span className="italic text-[#A45E78]">lovely</span> edit</h2></div>
            <div className="flex max-w-full gap-2 overflow-x-auto pb-1" aria-label="Filter featured products">
              {filters.map((filter) => <button key={filter} type="button" onClick={() => setActiveFilter(filter)} aria-pressed={activeFilter === filter} className={`shrink-0 rounded-full border px-4 py-2 text-[10px] font-bold transition ${activeFilter === filter ? "border-[#713B58] bg-[#713B58] text-white" : "border-[#DCC5C2] bg-[#FFF9F5] text-[#795A64] hover:border-[#713B58]"}`}>{filter}</button>)}
            </div>
          </div>
          {loading && <p role="status" className="py-8 text-sm text-[#8B7479]">Loading lovely finds...</p>}
          {!loading && !error && visibleProducts.length > 0 && <div className="mx-auto grid max-w-[1180px] grid-cols-2 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-4">{visibleProducts.map((product) => <ProductCard key={product.id} p={product} />)}</div>}
          {!loading && !error && visibleProducts.length === 0 && <div className="rounded-2xl border border-dashed border-[#DDBFC0] bg-white/70 p-8 text-center text-sm text-[#8B7479]">New little treasures are on their way. Browse the shop to explore what is available.</div>}
          <div className="mt-4 text-center"><Link to="/shop" className="inline-flex items-center gap-2 rounded-full border border-[#8D5B70] px-7 py-3 text-[10px] font-bold uppercase tracking-[.18em] text-[#713B58] transition hover:bg-[#713B58] hover:text-white">Shop all products <ArrowRight size={15} /></Link></div>
        </div>
      </section>

      {/* Personalised gift feature */}
      <section data-reveal className="container-x mx-auto max-w-[1080px] py-5 sm:py-7">
        <div className="relative isolate overflow-hidden rounded-[22px] bg-[#EAD1D1]/90 backdrop-blur-[2px]">
          <img src={editorial.display} alt="Romantic floral mugs, bottles, plates and vintage frames" loading="lazy" className="absolute inset-0 h-full w-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-r from-[#FFF8F1]/95 via-[#FFF8F1]/80 to-[#FFF8F1]/10" />
          <div className="relative max-w-md px-5 py-7 sm:px-7 sm:py-8">
            <p className="section-kicker mb-3 !text-[#A56C7B]">A gift with your touch</p>
            <h2 className="font-display text-4xl font-medium leading-[.94] text-[#4B303D] sm:text-5xl">Made a little more <span className="italic text-[#A45E78]">personal.</span></h2>
            <p className="mt-5 max-w-sm text-sm leading-6 text-[#765D65]">Turn a thoughtful find into a keepsake. Share your inspiration with us and let’s make something meaningful.</p>
            <Link to="/personalised-gifts" className="btn-primary mt-7 !rounded-full !bg-[#713B58]">Explore personalised gifts <ArrowRight size={15} /></Link>
          </div>
        </div>
      </section>

      {/* Moodboard gallery */}
      <section data-reveal className="container-x mx-auto max-w-[1080px] pb-5 sm:pb-7">
        <div className="mb-5 text-center"><p className="section-kicker mb-2 !text-[#A56C7B]">A little inspiration</p><h2 className="font-display text-3xl font-medium text-[#4B303D] sm:text-4xl">The CasaLoom <span className="italic text-[#A45E78]">moodboard</span></h2><p className="mt-3 text-sm text-[#8B7479]">Pretty corners, thoughtful details and everyday inspiration.</p></div>
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 sm:gap-3">
          {[editorial.tabletop, editorial.display, editorial.styling, editorial.hero].map((src, index) => <div key={src} className={`overflow-hidden rounded-2xl bg-[#F1E4E2] ${index === 1 || index === 3 ? "translate-y-5" : ""}`}><img src={src} alt={["Floral table setting inspiration", "Pink boutique product display", "CasaLoom collection styling", "Romantic home accessories moodboard"][index]} loading="lazy" className="aspect-[4/5] h-full w-full object-cover transition duration-700 hover:scale-105" /></div>)}
        </div>
      </section>

      {/* Soft closing note */}
      <section className="border-y border-[#EBDAD6]/80 bg-[#FFFDF9]/78 backdrop-blur-[3px] py-8 text-center">
        <div className="container-x mx-auto max-w-[1080px]"><Flower2 className="mx-auto text-[#A56C7B]" size={20} strokeWidth={1.3} /><p className="mt-3 font-display text-3xl italic text-[#75465B] sm:text-4xl">A home is made of little lovely things.</p><p className="mt-2 text-[9px] font-bold uppercase tracking-[.24em] text-[#A27C83]">CasaLoom · Home & Lifestyle</p></div>
      </section>
    </div>
  );
}
