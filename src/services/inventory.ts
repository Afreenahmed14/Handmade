import type { Database, InventoryAction } from "../types/database";
import { supabase } from "../lib/supabase";

type ProductRow = Database["public"]["Tables"]["products"]["Row"];
type MovementRow = Database["public"]["Tables"]["inventory_movements"]["Row"];
type InventoryProductRow = Pick<ProductRow, "id" | "name" | "sku" | "category_id" | "price_inr" | "stock_quantity" | "low_stock_threshold" | "updated_at">;

export interface InventoryProduct {
  id: string;
  name: string;
  sku: string;
  categoryId: string | null;
  categoryName: string;
  imageUrl: string | null;
  price: number;
  quantity: number;
  lowStockThreshold: number;
  updatedAt: string;
}

export interface InventorySnapshot {
  productsInStock: number;
  stockUnits: number;
  lowStockProducts: number;
  outOfStockProducts: number;
  inventoryValue: number;
}

export interface InventoryMovement extends MovementRow {
  productName: string;
  sku: string;
  adminName: string;
}

export interface AdjustInventoryInput {
  productId: string;
  action: InventoryAction;
  reason: string;
  quantity?: number;
  newQuantity?: number;
  reference?: string;
}

const queryPageSize = 500;
const relatedChunkSize = 100;

export async function getInventoryProducts(): Promise<InventoryProduct[]> {
  const rows: InventoryProductRow[] = [];
  for (let from = 0; ; from += queryPageSize) {
    const { data, error } = await supabase.from("products")
      .select("id,name,sku,category_id,price_inr,stock_quantity,low_stock_threshold,updated_at")
      .order("name")
      .range(from, from + queryPageSize - 1);
    if (error) throw error;
    rows.push(...data);
    if (data.length < queryPageSize) break;
  }

  if (!rows.length) return [];
  const { data: categories, error: categoryError } = await supabase.from("categories").select("id,name");
  if (categoryError) throw categoryError;
  const categoryNames = new Map(categories.map((category) => [category.id, category.name]));
  const images: { product_id: string; image_url: string; is_primary: boolean; display_order: number }[] = [];

  for (let index = 0; index < rows.length; index += relatedChunkSize) {
    const ids = rows.slice(index, index + relatedChunkSize).map((product) => product.id);
    const { data, error } = await supabase.from("product_images")
      .select("product_id,image_url,is_primary,display_order")
      .in("product_id", ids)
      .order("is_primary", { ascending: false })
      .order("display_order");
    if (error) throw error;
    images.push(...data);
  }

  const imageByProduct = new Map<string, string>();
  for (const image of images) if (!imageByProduct.has(image.product_id)) imageByProduct.set(image.product_id, image.image_url);

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    sku: row.sku,
    categoryId: row.category_id,
    categoryName: row.category_id ? categoryNames.get(row.category_id) ?? "" : "",
    imageUrl: imageByProduct.get(row.id) ?? null,
    price: Number(row.price_inr),
    quantity: row.stock_quantity,
    lowStockThreshold: row.low_stock_threshold,
    updatedAt: row.updated_at,
  }));
}

export async function getInventorySnapshot(): Promise<InventorySnapshot> {
  const { data, error } = await supabase.rpc("get_inventory_snapshot");
  if (error) throw error;
  const snapshot = data[0];
  if (!snapshot) throw new Error("Inventory summary was not returned by the database.");
  return {
    productsInStock: Number(snapshot.products_in_stock),
    stockUnits: Number(snapshot.stock_units),
    lowStockProducts: Number(snapshot.low_stock_products),
    outOfStockProducts: Number(snapshot.out_of_stock_products),
    inventoryValue: Number(snapshot.inventory_value),
  };
}

export async function getRecentInventoryMovements(limit = 12): Promise<InventoryMovement[]> {
  const { data: movements, error } = await supabase.from("inventory_movements")
    .select("*").order("created_at", { ascending: false }).limit(limit);
  if (error) throw error;
  if (!movements.length) return [];

  const productIds = [...new Set(movements.map((movement) => movement.product_id))];
  const actorIds = [...new Set(movements.map((movement) => movement.created_by).filter((id): id is string => Boolean(id)))];
  const [{ data: products, error: productsError }, { data: profiles, error: profilesError }] = await Promise.all([
    supabase.from("products").select("id,name,sku").in("id", productIds),
    actorIds.length ? supabase.from("profiles").select("id,full_name").in("id", actorIds) : Promise.resolve({ data: [], error: null }),
  ]);
  if (productsError) throw productsError;
  if (profilesError) throw profilesError;

  const productById = new Map(products.map((product) => [product.id, product]));
  const adminById = new Map(profiles.map((profile) => [profile.id, profile.full_name]));
  return movements.map((movement) => ({
    ...movement,
    productName: productById.get(movement.product_id)?.name ?? "Deleted product",
    sku: productById.get(movement.product_id)?.sku ?? "",
    adminName: movement.created_by ? adminById.get(movement.created_by) ?? "Admin" : "System",
  }));
}

export async function adjustInventoryStock(input: AdjustInventoryInput): Promise<{ previousQuantity: number; newQuantity: number }> {
  const reason = input.reason.trim();
  if (!reason || reason.length > 500) throw new Error("Provide a reason of 1 to 500 characters.");
  if (input.reference && input.reference.trim().length > 200) throw new Error("Reference must be 200 characters or fewer.");

  if (input.action === "adjustment") {
    if (!Number.isSafeInteger(input.newQuantity) || (input.newQuantity ?? -1) < 0) throw new Error("Enter a non-negative whole-number target stock quantity.");
  } else if (!Number.isSafeInteger(input.quantity) || (input.quantity ?? 0) <= 0) {
    throw new Error("Enter a positive whole-number stock quantity.");
  }

  const { data, error } = await supabase.rpc("adjust_inventory_stock", {
    p_product_id: input.productId,
    p_action: input.action,
    p_reason: reason,
    p_quantity: input.quantity ?? null,
    p_new_quantity: input.newQuantity ?? null,
    p_reference: input.reference?.trim() || null,
  });
  if (error) throw error;
  const result = data[0];
  if (!result) throw new Error("The database did not return the updated stock quantity.");
  return { previousQuantity: result.previous_quantity, newQuantity: result.new_quantity };
}

export async function updateLowStockThreshold(productId: string, threshold: number): Promise<void> {
  if (!Number.isSafeInteger(threshold) || threshold < 0) throw new Error("Low-stock threshold must be a non-negative whole number.");
  const { error } = await supabase.from("products").update({ low_stock_threshold: threshold }).eq("id", productId);
  if (error) throw error;
}