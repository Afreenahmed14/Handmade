import type { Json, OrderStatus } from "../types/database";
import { getRecentInventoryMovements, type InventoryMovement } from "./inventory";
import { getOrders, type OrderListItem } from "./orders";
import { supabase } from "../lib/supabase";

export interface AdminDashboardMetrics {
  totalOrders: number;
  pendingOrders: number;
  confirmedOrders: number;
  processingOrders: number;
  shippedOrders: number;
  deliveredOrders: number;
  cancelledOrders: number;
  returnedOrders: number;
  verifiedRevenue: number;
  paidOrderCount: number;
  averageOrderValue: number;
  totalCustomers: number;
  totalProducts: number;
  lowStockProducts: number;
  outOfStockProducts: number;
}

export interface AdminDashboardPoint {
  monthStart: string;
  value: number;
  orderCount?: number;
}

export interface AdminDashboardStatusCount {
  status: string;
  count: number;
}

export interface AdminDashboardMethodCount {
  method: string;
  count: number;
}

export interface AdminDashboardProductPerformance {
  name: string;
  sku: string;
  unitsSold: number;
  sales: number;
}

export interface AdminDashboardCategoryPerformance {
  name: string;
  unitsSold: number;
  sales: number;
}

export interface AdminDashboardData {
  metrics: AdminDashboardMetrics;
  revenueTrend: AdminDashboardPoint[];
  orderTrend: AdminDashboardPoint[];
  customerTrend: AdminDashboardPoint[];
  orderStatuses: AdminDashboardStatusCount[];
  paymentStatuses: AdminDashboardStatusCount[];
  paymentMethods: AdminDashboardMethodCount[];
  bestSellingProducts: AdminDashboardProductPerformance[];
  categoryPerformance: AdminDashboardCategoryPerformance[];
}

export interface AdminDashboardRecentActivity {
  orders: OrderListItem[];
  inventory: InventoryMovement[];
}

function record(value: Json | undefined): Record<string, Json | undefined> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function array(value: Json | undefined): Json[] {
  return Array.isArray(value) ? value : [];
}

function numberField(source: Record<string, Json | undefined>, key: string): number {
  const value = source[key];
  return typeof value === "number" ? value : 0;
}

function stringField(source: Record<string, Json | undefined>, key: string): string {
  const value = source[key];
  return typeof value === "string" ? value : "";
}

function statusCounts(value: Json | undefined): AdminDashboardStatusCount[] {
  return array(value).map((entry) => {
    const item = record(entry);
    return { status: stringField(item, "status"), count: numberField(item, "count") };
  });
}

export async function getAdminDashboardAnalytics(fromDate?: string, toDate?: string): Promise<AdminDashboardData> {
  const { data, error } = await supabase.rpc("get_admin_dashboard_analytics", {
    p_from_date: fromDate || null,
    p_to_date: toDate || null,
    p_trend_months: 12,
  });
  if (error) throw error;
  const result = data[0];
  if (!result) throw new Error("Dashboard analytics were not returned by the database.");

  const metrics = record(result.metrics);
  return {
    metrics: {
      totalOrders: numberField(metrics, "total_orders"), pendingOrders: numberField(metrics, "pending_orders"),
      confirmedOrders: numberField(metrics, "confirmed_orders"), processingOrders: numberField(metrics, "processing_orders"),
      shippedOrders: numberField(metrics, "shipped_orders"), deliveredOrders: numberField(metrics, "delivered_orders"),
      cancelledOrders: numberField(metrics, "cancelled_orders"), returnedOrders: numberField(metrics, "returned_orders"),
      verifiedRevenue: numberField(metrics, "verified_revenue_inr"), paidOrderCount: numberField(metrics, "paid_order_count"),
      averageOrderValue: numberField(metrics, "average_order_value_inr"), totalCustomers: numberField(metrics, "total_customers"),
      totalProducts: numberField(metrics, "total_products"), lowStockProducts: numberField(metrics, "low_stock_products"),
      outOfStockProducts: numberField(metrics, "out_of_stock_products"),
    },
    revenueTrend: array(result.revenue_trend).map((entry) => {
      const item = record(entry);
      return { monthStart: stringField(item, "month_start"), value: numberField(item, "revenue_inr"), orderCount: numberField(item, "order_count") };
    }),
    orderTrend: array(result.revenue_trend).map((entry) => {
      const item = record(entry);
      return { monthStart: stringField(item, "month_start"), value: numberField(item, "order_count") };
    }),
    customerTrend: array(result.customer_registration_trend).map((entry) => {
      const item = record(entry);
      return { monthStart: stringField(item, "month_start"), value: numberField(item, "registrations") };
    }),
    orderStatuses: statusCounts(result.order_status_distribution),
    paymentStatuses: statusCounts(result.payment_status_distribution),
    paymentMethods: array(result.payment_method_distribution).map((entry) => {
      const item = record(entry);
      return { method: stringField(item, "method"), count: numberField(item, "count") };
    }),
    bestSellingProducts: array(result.best_selling_products).map((entry) => {
      const item = record(entry);
      return { name: stringField(item, "product_name"), sku: stringField(item, "sku"), unitsSold: numberField(item, "units_sold"), sales: numberField(item, "sales_inr") };
    }),
    categoryPerformance: array(result.category_performance).map((entry) => {
      const item = record(entry);
      return { name: stringField(item, "category_name"), unitsSold: numberField(item, "units_sold"), sales: numberField(item, "sales_inr") };
    }),
  };
}

export async function getAdminDashboardRecentActivity(): Promise<AdminDashboardRecentActivity> {
  const [{ orders }, inventory] = await Promise.all([
    getOrders({ page: 1, pageSize: 8, orderStatus: "all", paymentStatus: "all" }),
    getRecentInventoryMovements(8),
  ]);
  return { orders, inventory };
}

export function dashboardStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    pending: "Pending", confirmed: "Confirmed", processing: "Processing", shipped: "Shipped",
    out_for_delivery: "Out for delivery", delivered: "Delivered", cancelled: "Cancelled", returned: "Returned",
  };
  return labels[status as OrderStatus] ?? status.replace(/_/g, " ");
}