import type { Json, PublicStoreSettings } from "../types/database";
import { supabase } from "../lib/supabase";

export type StoreSettings = Omit<PublicStoreSettings, "id" | "updated_at" | "supported_regions"> & { supported_regions: string[] };

/** Admin view of the settings: the public settings plus the UPI payee details that only admins can read or write. */
export type AdminStoreSettings = StoreSettings & { upi_id: string; upi_payee_name: string; upi_qr_url: string | null };

export const defaultStoreSettings: StoreSettings = {
  store_name: "The Vintage Home", contact_email: null, contact_phone: null, currency: "INR",
  store_description: "", logo_url: null, business_address: null, support_email: null, support_phone: null,
  time_zone: "Asia/Kolkata", date_format: "DD/MM/YYYY", maintenance_mode: false, maintenance_message: "",
  shipping_charge_inr: 0, free_shipping_threshold_inr: null, estimated_delivery_text: "",
  supported_regions: [], cod_enabled: true, upi_enabled: true, payment_instructions: "",
};

function isRecord(value: Json | null): value is Record<string, Json | undefined> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: Json | undefined, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function numberValue(value: Json | undefined, fallback: number | null) {
  return typeof value === "number" ? value : fallback;
}

function booleanValue(value: Json | undefined, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

export function parseStoreSettings(value: Json | null): StoreSettings {
  if (!isRecord(value)) return defaultStoreSettings;
  const regions = value.supported_regions;
  return {
    store_name: stringValue(value.store_name, defaultStoreSettings.store_name),
    contact_email: stringValue(value.contact_email) || null,
    contact_phone: stringValue(value.contact_phone) || null,
    currency: stringValue(value.currency, "INR"),
    store_description: stringValue(value.store_description),
    logo_url: stringValue(value.logo_url) || null,
    business_address: stringValue(value.business_address) || null,
    support_email: stringValue(value.support_email) || null,
    support_phone: stringValue(value.support_phone) || null,
    time_zone: stringValue(value.time_zone, "Asia/Kolkata"),
    date_format: stringValue(value.date_format, "DD/MM/YYYY"),
    maintenance_mode: booleanValue(value.maintenance_mode, false),
    maintenance_message: stringValue(value.maintenance_message),
    shipping_charge_inr: numberValue(value.shipping_charge_inr, 0) ?? 0,
    free_shipping_threshold_inr: numberValue(value.free_shipping_threshold_inr, null),
    estimated_delivery_text: stringValue(value.estimated_delivery_text),
    supported_regions: Array.isArray(regions) ? regions.filter((region): region is string => typeof region === "string") : [],
    cod_enabled: booleanValue(value.cod_enabled, true),
    upi_enabled: booleanValue(value.upi_enabled, true),
    payment_instructions: stringValue(value.payment_instructions),
  };
}

export async function getAdminStoreSettings(): Promise<AdminStoreSettings> {
  const { data, error } = await supabase.rpc("get_admin_store_settings");
  if (error) throw error;
  const record = isRecord(data) ? data : {};
  return {
    ...parseStoreSettings(data),
    upi_id: stringValue(record.upi_id),
    upi_payee_name: stringValue(record.upi_payee_name),
    upi_qr_url: stringValue(record.upi_qr_url) || null,
  };
}

export async function getPublicStoreSettings(): Promise<PublicStoreSettings | null> {
  const { data, error } = await supabase.from("public_store_settings").select("*").limit(1).maybeSingle();
  if (error) throw error;
  return data;
}

export async function saveAdminStoreSettings(settings: AdminStoreSettings): Promise<string> {
  const configuration: Json = {
    store_description: settings.store_description,
    logo_url: settings.logo_url,
    business_address: settings.business_address,
    support_email: settings.support_email,
    support_phone: settings.support_phone,
    time_zone: settings.time_zone,
    date_format: settings.date_format,
    maintenance_mode: settings.maintenance_mode,
    maintenance_message: settings.maintenance_message,
    shipping_charge_inr: settings.shipping_charge_inr,
    free_shipping_threshold_inr: settings.free_shipping_threshold_inr,
    estimated_delivery_text: settings.estimated_delivery_text,
    supported_regions: settings.supported_regions,
    cod_enabled: settings.cod_enabled,
    upi_enabled: settings.upi_enabled,
    payment_instructions: settings.payment_instructions,
    upi_id: settings.upi_id.trim(),
    upi_payee_name: settings.upi_payee_name.trim(),
    upi_qr_url: settings.upi_qr_url,
  };
  const { data, error } = await supabase.rpc("admin_update_store_settings", {
    p_store_name: settings.store_name.trim(),
    p_contact_email: settings.contact_email?.trim() || null,
    p_contact_phone: settings.contact_phone?.trim() || null,
    p_currency: settings.currency,
    p_configuration: configuration,
  });
  if (error) throw error;
  return data;
}

export interface AdminProfileSettings {
  full_name: string;
  mobile_number: string;
}

export async function getAdminProfileSettings(userId: string): Promise<AdminProfileSettings> {
  const { data, error } = await supabase.from("profiles").select("full_name,mobile_number").eq("id", userId).single();
  if (error) throw error;
  return { full_name: data.full_name, mobile_number: data.mobile_number ?? "" };
}

export async function updateOwnAdminProfile(userId: string, input: AdminProfileSettings): Promise<void> {
  const fullName = input.full_name.trim();
  const mobile = input.mobile_number.trim();
  if (fullName.length > 160) throw new Error("Name must be 160 characters or fewer.");
  if (mobile.length > 40) throw new Error("Phone number must be 40 characters or fewer.");
  const { error } = await supabase.from("profiles").update({ full_name: fullName, mobile_number: mobile || null }).eq("id", userId);
  if (error) throw error;
}

/** Converts a row of the public_store_settings view into storefront settings (null when no row exists yet). */
export function parsePublicStoreSettings(row: PublicStoreSettings | null): StoreSettings | null {
  return row ? parseStoreSettings(row) : null;
}
