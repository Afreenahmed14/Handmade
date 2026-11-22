import type { Category, Product } from "../types";
import { isPurchasable } from "./cartPricing";

// Search, filter and sort over the real, already-loaded catalog (published products and active categories only,
// as returned by getProducts()/getCategories()). Pure functions; no network access.

export type StockFilter = "all" | "in" | "out";
export type SortKey = "newest" | "price-asc" | "price-desc" | "name" | "featured";

export interface ProductFilters {
  q: string;
  category: string; // category slug, "" for all
  stock: StockFilter;
  customizable: boolean;
  sort: SortKey;
}

export const defaultFilters: ProductFilters = { q: "", category: "", stock: "all", customizable: false, sort: "newest" };
export const sortOptions: { value: SortKey; label: string }[] = [
  { value: "newest", label: "Newest" },
  { value: "featured", label: "Featured" },
  { value: "price-asc", label: "Amount: Increasing" },
  { value: "price-desc", label: "Amount: Decreasing" },
  { value: "name", label: "Name: A–Z" },
];
const sortKeys = sortOptions.map((o) => o.value);


/** Reads filters from the URL; anything invalid falls back to the default so a hand-edited URL can't break the page. */
export function parseFilters(params: URLSearchParams): ProductFilters {
  const sort = params.get("sort") as SortKey | null;
  const stock = params.get("stock");
  return {
    q: (params.get("q") ?? "").replace(/\s+/g, " ").trim().slice(0, 100),
    category: /^[a-z0-9-]{1,80}$/.test(params.get("category") ?? "") ? params.get("category")! : "",
    stock: stock === "in" || stock === "out" ? stock : "all",
    customizable: params.get("custom") === "1",
    sort: sort && sortKeys.includes(sort) ? sort : "newest",
  };
}

/** Writes only non-default values, keeping URLs short and shareable. */
export function filtersToParams(filters: ProductFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (filters.category) params.set("category", filters.category);
  if (filters.stock !== "all") params.set("stock", filters.stock);
  if (filters.customizable) params.set("custom", "1");
  if (filters.sort !== "newest") params.set("sort", filters.sort);
  return params;
}

export const effectivePrice = (product: Product) => product.discountPrice ?? product.price;
export function activeFilterCount(f: ProductFilters): number {
  return [f.category, f.stock !== "all", f.customizable].filter(Boolean).length;
}
export const hasAnyFilter = (f: ProductFilters) => activeFilterCount(f) > 0 || !!f.q;

function haystack(product: Product): string {
  return [product.name, product.sku, product.description, product.category, product.material, product.colour].join(" ").toLowerCase();
}

/**
 * `products` must be in newest-first order (as getProducts returns them); that order is the "newest" sort.
 * Every search word must appear in the name, SKU, description, category, material or colour.
 */
export function applyFilters(products: Product[], categories: Category[], f: ProductFilters): Product[] {
  const category = f.category ? categories.find((c) => c.slug === f.category) : undefined;
  const words = f.q.toLowerCase().split(" ").filter(Boolean);
  const indexed = products.map((product, index) => ({ product, index })).filter(({ product }) => {
    if (f.category && (!category || product.categoryId !== category.id)) return false;
    if (words.length) { const text = haystack(product); if (!words.every((w) => text.includes(w))) return false; }
    if (f.stock === "in" && !isPurchasable(product)) return false;
    if (f.stock === "out" && isPurchasable(product)) return false;
    if (f.customizable && !product.customizable) return false;
    return true;
  });

  const byNewest = (a: { index: number }, b: { index: number }) => a.index - b.index;
  indexed.sort((a, b) => {
    switch (f.sort) {
      case "price-asc": return effectivePrice(a.product) - effectivePrice(b.product) || byNewest(a, b);
      case "price-desc": return effectivePrice(b.product) - effectivePrice(a.product) || byNewest(a, b);
      case "name": return a.product.name.localeCompare(b.product.name, "en", { sensitivity: "base" }) || byNewest(a, b);
      case "featured": return Number(b.product.tag === "featured") - Number(a.product.tag === "featured") || byNewest(a, b);
      default: return byNewest(a, b);
    }
  });
  return indexed.map(({ product }) => product);
}
