import { useEffect, useState } from "react";
import type { Category, Product } from "../types";
import { getCategories, getProducts } from "../services/catalog";

// The storefront catalog (published products, active categories) is shared by the Header, Home, Shop and Category
// pages. Requests are cached briefly and shared, so navigating between pages doesn't refetch. Categories are cached
// on their own so the Header (on every page) never triggers a product load, and a later product load reuses them.
const CACHE_MS = 60_000;
interface Snapshot { categories: Category[]; products: Product[] }
interface Entry<T> { at: number; promise: Promise<T> }
let categoriesCache: Entry<Category[]> | null = null;
let catalogCache: Entry<Snapshot> | null = null;

function remember<T>(current: Entry<T> | null, load: () => Promise<T>, store: (entry: Entry<T> | null) => void): Promise<T> {
  if (current && Date.now() - current.at < CACHE_MS) return current.promise;
  const entry: Entry<T> = { at: Date.now(), promise: load() };
  store(entry);
  entry.promise.catch(() => { store(null); }); // never cache a failure
  return entry.promise;
}

const loadCategories = () => remember(categoriesCache, getCategories, (entry) => { categoriesCache = entry; });
const loadCatalog = () => remember(catalogCache, () => Promise.all([loadCategories(), getProducts()]).then(([categories, products]) => ({ categories, products })), (entry) => { catalogCache = entry; });

/** Active categories only (visibility is enforced by getCategories and the database's row-level security). */
export function useActiveCategories() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    void loadCategories().then((next) => { if (active) setCategories(next); })
      .catch(() => { if (active) setError(true); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  return { categories, loading, error };
}

export function useCatalog() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void loadCatalog().then((snapshot) => {
      if (!active) return;
      setCategories(snapshot.categories);
      setProducts(snapshot.products);
    }).catch((reason: unknown) => {
      if (active) setError(reason instanceof Error ? reason.message : "Unable to load the collection.");
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, []);

  return { categories, products, loading, error };
}
