
-- =====================================================
-- CASALOOM BACKEND PREFLIGHT
-- Read-only verification. No database changes.
-- =====================================================

-- 1. CHECK REQUIRED TABLES

SELECT
  expected.table_name,
  CASE
    WHEN t.table_name IS NULL THEN 'MISSING'
    ELSE 'EXISTS'
  END AS status
FROM (
  VALUES
    ('products'),
    ('profiles'),
    ('user_roles'),
    ('product_images'),
    ('inventory_movements'),
    ('store_settings'),
    ('custom_requests'),
    ('custom_request_quotations'),
    ('custom_request_quotation_items'),
    ('orders'),
    ('order_items'),
    ('payment_records'),
    ('order_status_history'),
    ('order_shipments')
) AS expected(table_name)
LEFT JOIN information_schema.tables t
  ON t.table_schema = 'public'
  AND t.table_name = expected.table_name
ORDER BY expected.table_name;


-- 2. CHECK INVENTORY COLUMNS

SELECT
  expected.column_name,
  CASE
    WHEN c.column_name IS NULL THEN 'MISSING'
    ELSE 'EXISTS'
  END AS status,
  c.data_type,
  c.udt_name
FROM (
  VALUES
    ('movement_type'),
    ('movement_action'),
    ('quantity'),
    ('previous_quantity'),
    ('new_quantity'),
    ('reason'),
    ('reference'),
    ('created_by')
) AS expected(column_name)
LEFT JOIN information_schema.columns c
  ON c.table_schema = 'public'
  AND c.table_name = 'inventory_movements'
  AND c.column_name = expected.column_name
ORDER BY expected.column_name;


-- 3. CHECK REQUIRED FUNCTIONS

SELECT
  expected.function_name,
  CASE
    WHEN p.oid IS NULL THEN 'MISSING'
    ELSE 'EXISTS'
  END AS status
FROM (
  VALUES
    ('has_role'),
    ('record_inventory_change'),
    ('adjust_inventory_stock'),
    ('create_customer_order'),
    ('admin_update_order_status'),
    ('admin_verify_order_payment'),
    ('admin_receive_order_return'),
    ('get_customer_order_payments'),
    ('admin_reject_order_payment'),
    ('admin_record_payment_refund'),
    ('get_admin_payment_operation_history'),
    ('capture_payment_operation_history')
) AS expected(function_name)
LEFT JOIN pg_proc p
  ON p.pronamespace = 'public'::regnamespace
  AND p.proname = expected.function_name
GROUP BY expected.function_name, p.oid
ORDER BY expected.function_name;


-- 4. CHECK ENUM VALUES

SELECT
  n.nspname AS schema_name,
  t.typname AS type_name,
  e.enumlabel AS enum_value
FROM pg_type t
JOIN pg_namespace n
  ON n.oid = t.typnamespace
JOIN pg_enum e
  ON e.enumtypid = t.oid
WHERE n.nspname = 'public'
  AND t.typname IN (
    'inventory_movement_type',
    'order_status',
    'order_payment_status'
  )
ORDER BY t.typname, e.enumsortorder;


-- 5. CHECK PAYMENT HISTORY RLS

SELECT
  c.relname AS table_name,
  c.relrowsecurity AS rls_enabled
FROM pg_class c
JOIN pg_namespace n
  ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname = 'payment_operation_history';
