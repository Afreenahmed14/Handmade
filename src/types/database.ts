export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];
export type AppRole = "super_admin" | "staff" | "customer";
export type InventoryAction = "received" | "sold" | "adjustment" | "returned" | "damaged" | "order_cancelled";
export type OrderStatus = "pending" | "confirmed" | "processing" | "shipped" | "out_for_delivery" | "delivered" | "cancelled" | "returned";
export type OrderPaymentStatus = "pending" | "verification_pending" | "paid" | "failed" | "cod_due" | "refunded";
export type PaymentMethod = "upi" | "cod";
export type CouponDiscountType = "percentage" | "fixed";
export type CustomRequestStatus = "new" | "pending" | "in_progress" | "completed" | "rejected";
export type QuotationStatus = "draft" | "sent" | "accepted" | "declined" | "expired" | "superseded";
export type QuotationItemKind = "product" | "printing" | "additional";

export type DbOrderRow = {
  id: string; order_number: string; customer_id: string; idempotency_key: string;
  customer_name: string; customer_email: string; customer_phone: string | null;
  shipping_address: Json; order_status: OrderStatus; payment_method: PaymentMethod | null;
  payment_status: OrderPaymentStatus; subtotal_inr: number; discount_inr: number;
  delivery_charge_inr: number; total_inr: number; customer_note: string | null;
  coupon_id: string | null; coupon_code: string | null; quotation_id: string | null;
  customization_photo_path: string | null; customization_note: string | null;
  expected_delivery_date: string | null; admin_decision_note: string | null;
  created_at: string; updated_at: string;
}

export type DbPaymentRecordRow = {
  id: string; order_id: string; payment_method: PaymentMethod; payment_status: OrderPaymentStatus;
  amount_inr: number; transaction_reference: string | null; payment_proof_path: string | null;
  provider: string | null; provider_event_id: string | null; verified_by: string | null;
  verified_at: string | null; verification_note: string | null; created_at: string; updated_at: string;
}

export type DbOrderShipmentRow = {
  id: string; order_id: string; carrier: string | null; tracking_number: string | null;
  tracking_url: string | null; shipment_status: string; shipped_at: string | null;
  delivered_at: string | null; created_at: string; updated_at: string;
}

export type DbCouponRow = {
  id: string; code: string; description: string | null; discount_type: CouponDiscountType;
  discount_value: number; minimum_order_amount_inr: number; maximum_discount_amount_inr: number | null;
  starts_at: string; expires_at: string; max_total_uses: number | null; max_uses_per_customer: number;
  is_active: boolean; created_at: string; updated_at: string;
}

export type DbCouponDirectoryRow = DbCouponRow & {
  active_usage_count: number; total_redemption_count: number; remaining_uses: number | null;
}

export type PersonalizationProductType = "photo_mug" | "water_bottle" | "plate" | "photo_frame" | "cushion" | "keychain" | "other";
export type DbProductPersonalizationRow = {
  product_id: string; is_enabled: boolean; product_type: PersonalizationProductType;
  printing_area_label: string | null; print_width_mm: number | null; print_height_mm: number | null;
  available_sizes: string[]; available_colours: string[]; available_materials: string[];
  allowed_image_formats: string[]; min_image_width_px: number | null; min_image_height_px: number | null;
  max_image_size_mb: number; max_images: number; image_notes: string | null;
  quotation_required: boolean; base_price_inr: number | null; created_at: string; updated_at: string;
};

type Table<Row, Insert = Partial<Row>, Update = Partial<Insert>> = {
  Row: Row;
  Insert: Insert;
  Update: Update;
  Relationships: [];
};

export type PublicStoreSettings = {
  id: string; store_name: string; contact_email: string | null; contact_phone: string | null; currency: string;
  store_description: string; logo_url: string | null; business_address: string | null;
  support_email: string | null; support_phone: string | null; time_zone: string; date_format: string;
  maintenance_mode: boolean; maintenance_message: string; shipping_charge_inr: number;
  free_shipping_threshold_inr: number | null; estimated_delivery_text: string;
  supported_regions: Json; cod_enabled: boolean; upi_enabled: boolean; payment_instructions: string;
  updated_at: string;
}

export type DbCustomRequestRow = {
  id: string; request_number: string; customer_id: string; product_id: string | null;
  requested_product: string; title: string; description: string; requirements: Json; preferences: Json;
  budget_min_inr: number | null; budget_max_inr: number | null; attachment_paths: string[];
  status: CustomRequestStatus; customer_response: string | null; response_updated_at: string | null;
  created_at: string; updated_at: string;
}

/** Admin-only (super admin RLS). Never selected by customer screens. */
export type DbPhotoPreparationRow = {
  id: string; request_id: string; original_path: string; version: number; prepared_path: string;
  preparation_meta: Json; production_notes: string | null; is_ready_for_quotation: boolean;
  ready_marked_at: string | null; ready_marked_by: string | null; prepared_by: string | null;
  prepared_at: string; updated_at: string;
}

/** Admin-only (super admin RLS). Customers never read this table; they receive CustomerQuotation from get_my_quotations. */
export type DbQuotationRow = {
  id: string; quote_number: string; request_id: string; version: number; status: QuotationStatus; currency: string;
  subtotal_inr: number; printing_charges_inr: number; discount_inr: number; shipping_charge_inr: number; final_total_inr: number;
  customer_notes: string | null; internal_notes: string | null; validity_days: number; valid_until: string | null;
  created_by: string | null; created_at: string; updated_at: string; sent_at: string | null; sent_by: string | null;
  accepted_at: string | null; declined_at: string | null; decline_reason: string | null; expired_at: string | null;
  superseded_at: string | null; superseded_by: string | null; payment_eligible_at: string | null;
}

export type DbQuotationItemRow = {
  id: string; quotation_id: string; position: number; kind: QuotationItemKind; description: string;
  quantity: number; unit_price_inr: number; line_total_inr: number; created_at: string;
}

export interface Database {
  public: {
    Tables: {
      profiles: Table<{
        id: string; full_name: string; email: string; mobile_number: string | null;
        address_line1: string | null; address_line2: string | null; city: string | null;
        state: string | null; postal_code: string | null; country: string;
        created_at: string; updated_at: string;
      }>;
      user_roles: Table<{ id: string; user_id: string; role: AppRole; created_at: string }>;
      categories: Table<{
        id: string; name: string; slug: string; description: string | null; image_url: string | null;
        is_active: boolean; created_at: string; updated_at: string;
      }>;
      products: Table<{
        id: string; name: string; slug: string; sku: string; description: string;
        category_id: string | null; price_inr: number; discount_price_inr: number | null;
        material: string | null; colour: string | null; stock_quantity: number; low_stock_threshold: number;
        is_customizable: boolean; is_published: boolean; is_featured: boolean;
        created_at: string; updated_at: string;
      }>;
      product_personalization: Table<DbProductPersonalizationRow, Partial<DbProductPersonalizationRow> & { product_id: string }>;
      product_images: Table<{
        id: string; product_id: string; image_url: string; display_order: number;
        is_primary: boolean; created_at: string;
      }>;
      product_variants: Table<{
        id: string; product_id: string; variant_type: string; variant_name: string;
        additional_price_inr: number; stock_quantity: number; created_at: string; updated_at: string;
      }>;
      inventory_movements: Table<{
        id: string; product_id: string; movement_type: "in" | "out" | "adjustment"; movement_action: InventoryAction;
        quantity: number; previous_quantity: number | null; new_quantity: number | null;
        reason: string; reference: string | null; created_at: string; created_by: string | null;
      }>;
      store_settings: Table<{
        id: string; store_name: string; contact_email: string | null; contact_phone: string | null;
        currency: string; configuration: Json; created_at: string; updated_at: string;
      }>;
      private_store_configuration: Table<{
        id: string; store_settings_id: string; configuration: Json; created_at: string; updated_at: string;
      }>;
      orders: Table<DbOrderRow>;
      order_items: Table<{
        id: string; order_id: string; product_id: string | null; product_name: string;
        product_sku: string; product_image_url: string | null; quantity: number; returned_quantity: number;
        unit_price_inr: number; list_price_inr: number; line_subtotal_inr: number; created_at: string;
      }>;
      payment_records: Table<DbPaymentRecordRow>;
      order_status_history: Table<{
        id: string; order_id: string; previous_status: OrderStatus | null; new_status: OrderStatus;
        reason: string; changed_by: string | null; created_at: string;
      }>;
      order_shipments: Table<DbOrderShipmentRow>;
      order_notifications: Table<{
        id: string; recipient_id: string; order_id: string | null; title: string; message: string;
        notification_type: string; is_read: boolean; created_at: string;
      }>;
      order_feedback: Table<{
        id: string; order_id: string; customer_id: string; rating: number;
        comment: string | null; created_at: string;
      }>;
      coupons: Table<DbCouponRow>;
      coupon_products: Table<{ coupon_id: string; product_id: string }>;
      coupon_categories: Table<{ coupon_id: string; category_id: string }>;
      coupon_redemptions: Table<{
        id: string; coupon_id: string; customer_id: string; order_id: string; coupon_code: string;
        discount_amount_inr: number; redeemed_at: string; released_at: string | null; release_reason: string | null;
      }>;
      custom_requests: Table<DbCustomRequestRow>;
      custom_request_status_history: Table<{
        id: string; request_id: string; previous_status: CustomRequestStatus | null;
        new_status: CustomRequestStatus; reason: string; changed_by: string | null; created_at: string;
      }>;
      custom_request_internal_notes: Table<{
        id: string; request_id: string; note: string; created_by: string | null; created_at: string;
      }>;
      custom_request_responses: Table<{
        id: string; request_id: string; response: string; created_by: string | null; created_at: string;
      }>;
      custom_request_photo_preparations: Table<DbPhotoPreparationRow>;
      custom_request_quotations: Table<DbQuotationRow>;
      custom_request_quotation_items: Table<DbQuotationItemRow>;
    };
    Views: {
      admin_customer_directory: {
        Row: {
          id: string; full_name: string; email: string; mobile_number: string | null;
          address_line1: string | null; address_line2: string | null; city: string | null;
          state: string | null; postal_code: string | null; country: string;
          created_at: string; updated_at: string;
        };
        Relationships: [];
      };
      admin_coupon_directory: {
        Row: DbCouponDirectoryRow;
        Relationships: [];
      };
      admin_custom_request_directory: {
        Row: DbCustomRequestRow & { customer_name: string; customer_email: string; customer_phone: string | null };
        Relationships: [];
      };
      public_store_settings: {
        Row: PublicStoreSettings;
        Relationships: [];
      };
    };
    Functions: {
      adjust_inventory_stock: {
        Args: {
          p_product_id: string;
          p_action: InventoryAction;
          p_reason: string;
          p_quantity?: number | null;
          p_new_quantity?: number | null;
          p_reference?: string | null;
        };
        Returns: { previous_quantity: number; new_quantity: number }[];
      };
      get_inventory_snapshot: {
        Args: Record<string, never>;
        Returns: {
          products_in_stock: number;
          stock_units: number;
          low_stock_products: number;
          out_of_stock_products: number;
          inventory_value: number;
        }[];
      };
      create_customer_order_request: {
        Args: {
          p_product_id: string;
          p_quantity: number;
          p_shipping_address: Json;
          p_idempotency_key: string;
          p_customization_photo_path?: string | null;
          p_customization_note?: string | null;
        };
        Returns: string;
      };
      admin_review_customer_order: {
        Args: {
          p_order_id: string;
          p_accept: boolean;
          p_expected_delivery_date?: string | null;
          p_note?: string | null;
        };
        Returns: DbOrderRow;
      };
      customer_select_order_payment: {
        Args: { p_order_id: string; p_payment_method: PaymentMethod };
        Returns: DbOrderRow;
      };
      customer_submit_order_feedback: {
        Args: { p_order_id: string; p_rating: number; p_comment?: string | null };
        Returns: string;
      };
      get_customer_registration_analytics: {
        Args: { p_months?: number };
        Returns: { month_start: string; registration_count: number }[];
      };
      create_customer_order: {
        Args: { p_items: Json; p_shipping_address: Json; p_payment_method: PaymentMethod; p_idempotency_key: string; p_customer_note?: string | null };
        Returns: string;
      };
      admin_update_order_status: {
        Args: { p_order_id: string; p_new_status: OrderStatus; p_reason: string };
        Returns: DbOrderRow;
      };
      admin_verify_order_payment: {
        Args: { p_payment_id: string; p_transaction_reference: string; p_verification_note?: string | null };
        Returns: DbPaymentRecordRow;
      };
      get_customer_upi_payment_details: {
        Args: { p_order_id: string };
        Returns: Json;
      };
      customer_submit_payment_proof: {
        Args: { p_order_id: string; p_reference: string; p_proof_path?: string | null };
        Returns: DbPaymentRecordRow;
      };
      admin_update_order_shipment: {
        Args: { p_order_id: string; p_carrier: string | null; p_tracking_number: string | null; p_tracking_url: string | null };
        Returns: DbOrderShipmentRow;
      };
      get_customer_order_tracking: {
        Args: { p_order_id: string };
        Returns: Json;
      };
      get_customer_order_payments: { Args: { p_order_id: string }; Returns: Json };
      admin_reject_order_payment: { Args: { p_payment_id: string; p_rejection_reason: string }; Returns: DbPaymentRecordRow };
      admin_record_payment_refund: { Args: { p_payment_id: string; p_refund_amount_inr: number; p_external_reference: string; p_note?: string | null }; Returns: DbPaymentRecordRow };
      get_admin_payment_operation_history: { Args: { p_payment_id: string }; Returns: { id: string; payment_id: string; order_id: string; action: string; previous_status: OrderPaymentStatus | null; new_status: OrderPaymentStatus; amount_inr: number; note: string | null; external_reference: string | null; performed_by: string | null; created_at: string }[] };
      admin_receive_order_return: {
        Args: { p_order_item_id: string; p_quantity: number; p_reason: string; p_request_id: string };
        Returns: number;
      };
      get_order_dashboard_summary: {
        Args: Record<string, never>;
        Returns: {
          total_orders: number; pending_orders: number; confirmed_orders: number; processing_orders: number;
          shipped_orders: number; delivered_orders: number; cancelled_orders: number; returned_orders: number;
          total_revenue_inr: number;
        }[];
      };
      get_admin_dashboard_analytics: {
        Args: { p_from_date?: string | null; p_to_date?: string | null; p_trend_months?: number };
        Returns: {
          metrics: Json;
          revenue_trend: Json;
          order_status_distribution: Json;
          payment_status_distribution: Json;
          payment_method_distribution: Json;
          best_selling_products: Json;
          category_performance: Json;
          customer_registration_trend: Json;
        }[];
      };
      admin_save_coupon: {
        Args: {
          p_coupon_id: string | null; p_code: string; p_description: string | null;
          p_discount_type: CouponDiscountType; p_discount_value: number; p_minimum_order_amount_inr: number;
          p_maximum_discount_amount_inr: number | null; p_starts_at: string; p_expires_at: string;
          p_max_total_uses: number | null; p_max_uses_per_customer: number; p_is_active: boolean;
          p_product_ids: string[]; p_category_ids: string[];
        };
        Returns: string;
      };
      validate_customer_coupon: { Args: { p_code: string; p_items: Json }; Returns: Json };
      create_customer_order_with_coupon: {
        Args: { p_items: Json; p_shipping_address: Json; p_payment_method: PaymentMethod; p_idempotency_key: string; p_coupon_code: string; p_customer_note?: string | null };
        Returns: string;
      };
      get_admin_payment_summary: {
        Args: { p_from_date?: string | null; p_to_date?: string | null };
        Returns: { summary: Json; status_distribution: Json; method_distribution: Json }[];
      };
      create_customer_custom_request: {
        Args: {
          p_product_id: string | null; p_requested_product: string; p_title: string; p_description: string;
          p_requirements?: Json; p_preferences?: Json; p_budget_min_inr?: number | null;
          p_budget_max_inr?: number | null; p_attachment_paths?: string[];
        };
        Returns: string;
      };
      admin_update_custom_request: {
        Args: {
          p_request_id: string; p_new_status: CustomRequestStatus | null;
          p_status_reason?: string | null; p_internal_note?: string | null; p_customer_response?: string | null;
        };
        Returns: string;
      };
      admin_save_photo_preparation: {
        Args: {
          p_request_id: string; p_original_path: string; p_prepared_path: string; p_preparation_meta: Json;
          p_production_notes?: string | null; p_mark_ready?: boolean;
        };
        Returns: string;
      };
      admin_update_photo_preparation: {
        Args: { p_preparation_id: string; p_production_notes: string | null; p_mark_ready: boolean };
        Returns: string;
      };
      admin_save_quotation_draft: {
        Args: {
          p_request_id: string; p_items: Json; p_discount_inr?: number; p_shipping_charge_inr?: number;
          p_customer_notes?: string | null; p_internal_notes?: string | null; p_validity_days?: number; p_quotation_id?: string | null;
        };
        Returns: string;
      };
      admin_send_quotation: { Args: { p_quotation_id: string }; Returns: string };
      admin_discard_quotation_draft: { Args: { p_quotation_id: string }; Returns: string };
      get_my_quotations: { Args: { p_request_id: string }; Returns: Json };
      get_my_quotation_overview: {
        Args: { p_request_ids: string[] };
        Returns: { request_id: string; quotation_id: string; version: number; status: QuotationStatus; final_total_inr: number; valid_until: string | null }[];
      };
      customer_create_quotation_payment_order: { Args: { p_quotation_id: string }; Returns: string };
      customer_respond_to_quotation: {
        Args: { p_quotation_id: string; p_decision: "accept" | "decline"; p_reason?: string | null };
        Returns: string;
      };
      get_admin_store_settings: { Args: Record<string, never>; Returns: Json };
      admin_update_store_settings: {
        Args: {
          p_store_name: string; p_contact_email: string | null; p_contact_phone: string | null;
          p_currency: string; p_configuration: Json;
        };
        Returns: string;
      };
    };
    Enums: { app_role: AppRole };
    CompositeTypes: Record<string, never>;
  };
}