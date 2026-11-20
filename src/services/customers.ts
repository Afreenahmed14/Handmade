import type { Database } from "../types/database";
import { supabase } from "../lib/supabase";

export type CustomerRecord = Database["public"]["Views"]["admin_customer_directory"]["Row"];
export type CustomerDirectoryItem = Pick<CustomerRecord, "id" | "full_name" | "email" | "mobile_number" | "city" | "state" | "created_at" | "updated_at">;

export interface CustomerDirectoryFilters {
  page: number;
  pageSize: number;
  search?: string;
  registeredFrom?: string;
  registeredTo?: string;
  recentlyUpdated?: boolean;
}

export interface CustomerDirectoryResult {
  customers: CustomerDirectoryItem[];
  total: number;
}

export interface CustomerRegistrationMonth {
  monthStart: string;
  registrations: number;
}

export interface CustomerSummary {
  totalCustomers: number;
  newCustomers30Days: number;
  registrations: CustomerRegistrationMonth[];
}

function safeSearchTerm(value: string) {
  return value.replace(/[%,_()"\\]/g, " ").replace(/\s+/g, " ").trim();
}

export async function getCustomerDirectory(filters: CustomerDirectoryFilters): Promise<CustomerDirectoryResult> {
  const from = Math.max(0, filters.page - 1) * filters.pageSize;
  let query = supabase.from("admin_customer_directory").select("id,full_name,email,mobile_number,city,state,created_at,updated_at", { count: "exact" }).order("created_at", { ascending: false }).range(from, from + filters.pageSize - 1);
  const search = filters.search ? safeSearchTerm(filters.search) : "";
  if (search) query = query.or(`full_name.ilike.%${search}%,email.ilike.%${search}%`);
  if (filters.registeredFrom) query = query.gte("created_at", new Date(`${filters.registeredFrom}T00:00:00`).toISOString());
  if (filters.registeredTo) query = query.lte("created_at", new Date(`${filters.registeredTo}T23:59:59.999`).toISOString());
  if (filters.recentlyUpdated) query = query.gte("updated_at", new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString());
  const { data, error, count } = await query;
  if (error) throw error;
  return { customers: data, total: count ?? data.length };
}

export async function getCustomerById(customerId: string): Promise<CustomerRecord> {
  const { data, error } = await supabase.from("admin_customer_directory").select("*").eq("id", customerId).single();
  if (error) throw error;
  return data;
}

export async function getCustomerSummary(months = 6): Promise<CustomerSummary> {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const [{ count: total, error: totalError }, { count: recent, error: recentError }, { data: registrationRows, error: analyticsError }] = await Promise.all([
    supabase.from("admin_customer_directory").select("id", { count: "exact", head: true }),
    supabase.from("admin_customer_directory").select("id", { count: "exact", head: true }).gte("created_at", since),
    supabase.rpc("get_customer_registration_analytics", { p_months: months }),
  ]);
  if (totalError) throw totalError;
  if (recentError) throw recentError;
  if (analyticsError) throw analyticsError;
  return {
    totalCustomers: total ?? 0,
    newCustomers30Days: recent ?? 0,
    registrations: registrationRows.map((row) => ({ monthStart: row.month_start, registrations: Number(row.registration_count) })),
  };
}