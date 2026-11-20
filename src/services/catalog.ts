import type { Category, Product, ArtKind } from "../types";
import type { Database } from "../types/database";
import { supabase } from "../lib/supabase";
import { deleteCategoryImage } from "./storage";

type CategoryRow = Database["public"]["Tables"]["categories"]["Row"];
type ProductRow = Database["public"]["Tables"]["products"]["Row"];
export type ProductImageRow = Database["public"]["Tables"]["product_images"]["Row"];
export type ProductWrite = Database["public"]["Tables"]["products"]["Insert"];
export type CategoryWrite = Database["public"]["Tables"]["categories"]["Insert"];

const artBySlug: Record<string, ArtKind> = {
  lighting: "lamp", "wall-decor": "shelf", paintings: "frame", "home-accessories": "vase",
  mirrors: "mirror", clocks: "clock", "kitchen-decor": "tray", furniture: "chair",
};

function categoryArt(slug: string): ArtKind {
  return artBySlug[slug] ?? "vase";
}

function mapCategory(row: CategoryRow): Category {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description ?? undefined,
    imageUrl: row.image_url ?? undefined,
    isActive: row.is_active,
    art: categoryArt(row.slug),
  };
}

function mapProduct(row: ProductRow, categoryName: string, imageUrl?: string, categorySlug?: string): Product {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    sku: row.sku,
    category: categoryName,
    price: Number(row.price_inr),
    discountPrice: row.discount_price_inr === null ? undefined : Number(row.discount_price_inr),
    material: row.material ?? "",
    colour: row.colour ?? "",
    art: categoryArt(row.slug),
    customizable: row.is_customizable,
    stock: row.stock_quantity,
    tag: row.is_featured ? "featured" : undefined,
    description: row.description,
    imageUrl,
    categorySlug,
    categoryId: row.category_id ?? undefined,
    published: row.is_published,
  };
}

/** Ids of products with photo personalisation enabled. Best-effort: a failure must never break the normal catalog. */
async function getPersonalisedIds(): Promise<Set<string>> {
  try {
    const { data, error } = await supabase.from("product_personalization").select("product_id").eq("is_enabled", true);
    if (error) return new Set();
    return new Set(data.map(({ product_id }) => product_id));
  } catch {
    return new Set();
  }
}

export async function getCategories(includeInactive = false): Promise<Category[]> {
  let query = supabase.from("categories").select("*").order("name");
  if (!includeInactive) query = query.eq("is_active", true);
  const { data, error } = await query;
  if (error) throw error;
  return data.map(mapCategory);
}

export async function getProducts(publishedOnly = true): Promise<Product[]> {
  let productQuery = supabase.from("products").select("*").order("created_at", { ascending: false });
  if (publishedOnly) productQuery = productQuery.eq("is_published", true);
  const [{ data: products, error: productError }, { data: categories, error: categoryError }] = await Promise.all([
    productQuery,
    supabase.from("categories").select("id,name,slug"),
  ]);
  if (productError) throw productError;
  if (categoryError) throw categoryError;

  const productIds = products.map(({ id }) => id);
  const { data: images, error: imageError } = productIds.length
    ? await supabase.from("product_images").select("product_id,image_url,is_primary,display_order").in("product_id", productIds).order("display_order")
    : { data: [], error: null };
  if (imageError) throw imageError;

  const categoryNames = new Map(categories.map(({ id, name }) => [id, name]));
  const artSlugs = new Map(categories.map(({ id, slug }) => [id, slug]));
  const primaryImages = new Map<string, string>();
  for (const image of images) {
    if (image.is_primary || !primaryImages.has(image.product_id)) primaryImages.set(image.product_id, image.image_url);
  }

  const personalisedIds = await getPersonalisedIds();
  return products.map((row) => {
    const categorySlug = row.category_id ? artSlugs.get(row.category_id) : undefined;
    const mapped = mapProduct(row, row.category_id ? categoryNames.get(row.category_id) ?? "" : "", primaryImages.get(row.id), categorySlug);
    return { ...mapped, art: categoryArt(categorySlug ?? ""), personalised: personalisedIds.has(row.id) };
  });
}

export async function getProductBySlug(slug: string): Promise<Product | null> {
  const { data, error } = await supabase.from("products").select("*").eq("slug", slug).eq("is_published", true).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const [{ data: category }, { data: image }] = await Promise.all([
    data.category_id ? supabase.from("categories").select("name,slug").eq("id", data.category_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
    supabase.from("product_images").select("image_url").eq("product_id", data.id).order("is_primary", { ascending: false }).order("display_order").limit(1).maybeSingle(),
  ]);
  const personalised = (await getPersonalisedIds()).has(data.id);
  return { ...mapProduct(data, category?.name ?? "", image?.image_url, category?.slug), art: category ? categoryArt(category.slug) : "vase", personalised };
}

/**
 * Current catalog data for specific products (cart/wishlist). Only published products are returned,
 * so deleted and unpublished products are simply absent from the result.
 */
export async function getProductsByIds(ids: string[]): Promise<Map<string, Product>> {
  const uniqueIds = [...new Set(ids)];
  const found = new Map<string, Product>();
  const personalisedIds = uniqueIds.length ? await getPersonalisedIds() : new Set<string>();
  for (let start = 0; start < uniqueIds.length; start += 50) {
    const chunk = uniqueIds.slice(start, start + 50);
    const { data: products, error } = await supabase.from("products").select("*").in("id", chunk).eq("is_published", true);
    if (error) throw error;
    if (!products.length) continue;

    const categoryIds = [...new Set(products.flatMap(({ category_id }) => category_id ? [category_id] : []))];
    const [{ data: categories, error: categoryError }, { data: images, error: imageError }] = await Promise.all([
      categoryIds.length ? supabase.from("categories").select("id,name,slug").in("id", categoryIds) : Promise.resolve({ data: [], error: null }),
      supabase.from("product_images").select("product_id,image_url,is_primary,display_order").in("product_id", products.map(({ id }) => id)).order("display_order"),
    ]);
    if (categoryError) throw categoryError;
    if (imageError) throw imageError;

    const categoryById = new Map(categories.map((category) => [category.id, category]));
    const primaryImages = new Map<string, string>();
    for (const image of images) {
      if (image.is_primary || !primaryImages.has(image.product_id)) primaryImages.set(image.product_id, image.image_url);
    }
    for (const row of products) {
      const category = row.category_id ? categoryById.get(row.category_id) : undefined;
      found.set(row.id, { ...mapProduct(row, category?.name ?? "", primaryImages.get(row.id), category?.slug), art: categoryArt(category?.slug ?? ""), personalised: personalisedIds.has(row.id) });
    }
  }
  return found;
}

export async function saveProduct(input: ProductWrite, productId?: string): Promise<ProductRow> {
  const result = productId
    ? await supabase.from("products").update(input).eq("id", productId).select().single()
    : await supabase.from("products").insert(input).select().single();
  if (result.error) throw result.error;
  return result.data;
}

export async function deleteProduct(productId: string): Promise<string | null> {
  const { error } = await supabase.from("products").delete().eq("id", productId);
  if (error) throw error;

  const { data: files, error: listError } = await supabase.storage.from("product-images").list(productId);
  if (listError) return "Product deleted, but image cleanup could not be checked. Remove its folder from Storage when convenient.";
  if (!files.length) return null;

  const { error: removeError } = await supabase.storage.from("product-images").remove(files.map((file) => `${productId}/${file.name}`));
  return removeError ? "Product deleted, but one or more stored images could not be removed." : null;
}

export async function saveCategory(input: CategoryWrite, categoryId?: string): Promise<CategoryRow> {
  const result = categoryId
    ? await supabase.from("categories").update(input).eq("id", categoryId).select().single()
    : await supabase.from("categories").insert(input).select().single();
  if (result.error) throw result.error;
  return result.data;
}

export async function getCategoryProductCounts(categoryIds: string[]): Promise<Record<string, number>> {
  const entries = await Promise.all(categoryIds.map(async (categoryId) => {
    const { count, error } = await supabase.from("products").select("id", { count: "exact", head: true }).eq("category_id", categoryId);
    if (error) throw error;
    return [categoryId, count ?? 0] as const;
  }));
  return Object.fromEntries(entries);
}

export async function deleteCategory(categoryId: string): Promise<string | null> {
  const { count, error: countError } = await supabase.from("products").select("id", { count: "exact", head: true }).eq("category_id", categoryId);
  if (countError) throw countError;
  if (count) throw new Error(`This category has ${count} assigned product${count === 1 ? "" : "s"}. Reassign or unassign them in Product Management before deleting it.`);

  const { data: category, error: categoryError } = await supabase.from("categories").select("image_url").eq("id", categoryId).single();
  if (categoryError) throw categoryError;

  const { error } = await supabase.from("categories").delete().eq("id", categoryId);
  if (error) throw error;

  if (!category.image_url) return null;
  return deleteCategoryImage(category.image_url);
}

export async function getProductImages(productId: string): Promise<ProductImageRow[]> {
  const { data, error } = await supabase.from("product_images").select("*").eq("product_id", productId).order("display_order");
  if (error) throw error;
  return data;
}