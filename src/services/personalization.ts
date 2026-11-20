import type { DbProductPersonalizationRow, PersonalizationProductType } from "../types/database";
import type { Product } from "../types";
import { supabase } from "../lib/supabase";
import { getProductsByIds } from "./catalog";

export type PersonalizationConfig = DbProductPersonalizationRow;
export type PersonalizationWrite = Omit<DbProductPersonalizationRow, "created_at" | "updated_at">;
export type PersonalizedProduct = Product & { personalization: PersonalizationConfig };

export const PERSONALIZATION_TYPES: { value: PersonalizationProductType; label: string }[] = [
  { value: "photo_mug", label: "Photo mug" },
  { value: "water_bottle", label: "Water bottle" },
  { value: "plate", label: "Plate" },
  { value: "photo_frame", label: "Photo frame" },
  { value: "cushion", label: "Cushion" },
  { value: "keychain", label: "Keychain" },
  { value: "other", label: "Other printable" },
];

export const IMAGE_FORMATS: { value: string; label: string; mime: string }[] = [
  { value: "jpeg", label: "JPEG", mime: "image/jpeg" },
  { value: "png", label: "PNG", mime: "image/png" },
  { value: "webp", label: "WebP", mime: "image/webp" },
];

export const personalizationTypeLabel = (type: string) => PERSONALIZATION_TYPES.find((entry) => entry.value === type)?.label ?? "Personalised";

export const personalizationAccept = (config: Pick<PersonalizationConfig, "allowed_image_formats">) =>
  IMAGE_FORMATS.filter((format) => config.allowed_image_formats.includes(format.value)).map((format) => format.mime).join(",");

export const personalizationFormatLabel = (config: Pick<PersonalizationConfig, "allowed_image_formats">) =>
  IMAGE_FORMATS.filter((format) => config.allowed_image_formats.includes(format.value)).map((format) => format.label).join(", ");

/** One-line print area summary, e.g. "Wrap-around · 200 × 90 mm". */
export function printingAreaSummary(config: PersonalizationConfig): string {
  const size = config.print_width_mm && config.print_height_mm ? `${config.print_width_mm} × ${config.print_height_mm} mm` : "";
  return [config.printing_area_label, size].filter(Boolean).join(" · ");
}

/** Public/customer read. RLS only returns enabled configs of published products. */
export async function getPersonalization(productId: string): Promise<PersonalizationConfig | null> {
  const { data, error } = await supabase.from("product_personalization").select("*").eq("product_id", productId).eq("is_enabled", true).maybeSingle();
  if (error) throw error;
  return data;
}

/** Admin read: the config whether or not it is enabled. */
export async function getPersonalizationForAdmin(productId: string): Promise<PersonalizationConfig | null> {
  const { data, error } = await supabase.from("product_personalization").select("*").eq("product_id", productId).maybeSingle();
  if (error) throw error;
  return data;
}

/** Ids of products with personalisation enabled, for flagging rows in the admin list. */
export async function getEnabledPersonalizationIds(): Promise<Set<string>> {
  const { data, error } = await supabase.from("product_personalization").select("product_id").eq("is_enabled", true);
  if (error) throw error;
  return new Set(data.map(({ product_id }) => product_id));
}

export async function savePersonalization(input: PersonalizationWrite): Promise<PersonalizationConfig> {
  const { data, error } = await supabase.from("product_personalization").upsert(input, { onConflict: "product_id" }).select().single();
  if (error) throw error;
  return data;
}

/** Published products with personalisation enabled, in newest-first catalog order. */
export async function getPersonalizedProducts(): Promise<PersonalizedProduct[]> {
  const { data, error } = await supabase.from("product_personalization").select("*").eq("is_enabled", true);
  if (error) throw error;
  if (!data.length) return [];
  const products = await getProductsByIds(data.map(({ product_id }) => product_id));
  const list: PersonalizedProduct[] = [];
  for (const config of data) {
    const product = products.get(config.product_id);
    if (product) list.push({ ...product, personalised: true, personalization: config });
  }
  return list.sort((a, b) => a.name.localeCompare(b.name));
}
