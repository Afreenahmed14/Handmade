# CasaLoom backend recovery and release plan

**Purpose:** safely bring the existing Supabase backend into a consistent state, then verify standard checkout, manual UPI, manual shipping, and personalised quotation payments.

## Critical environment warning

The Supabase screenshots supplied during development show the `main` project marked **PRODUCTION**. Do not run the remaining schema-changing migrations on that project as a troubleshooting experiment. Take a database backup and create/use a separate staging Supabase project first. Apply and verify the complete migration sequence on staging before production rollout.

## What the inspected source establishes

- `202611050001_phase3_catalog_auth_storage.sql` creates the original `inventory_movements` table with `movement_type public.inventory_movement_type`, whose observed values are `in`, `out`, and `adjustment`.
- `202611110001_phase_inventory_management.sql` is the compatibility migration. It adds `low_stock_threshold`, `movement_action`, `previous_quantity`, `new_quantity`, and `reference`; it replaces `record_inventory_change()` so it reads the transaction-local `vintage.inventory_*` settings; and it defines `adjust_inventory_stock()` / `get_inventory_snapshot()`.
- `202611110003_order_management.sql` creates `orders`, `order_items`, `payment_records`, `order_status_history`, and `order_shipments`. Its final return-protection index requires `inventory_movements.movement_action` and `reference`, so it must run after `202611110001`.
- `202611120001_customer_checkout_support.sql` replaces the standard checkout RPC and depends on the order tables.
- `202611190001_personalised_quotations.sql` creates the quotation tables/RPCs.
- `202611200001_quotation_payments.sql` adds `orders.quotation_id` and creates a payment order from an accepted quotation. It depends on both the quotation schema and order/payment tables.
- `202611210001_payment_operations_hardening.sql` restricts direct payment-record reads, adds customer-safe payment reads, admin rejection/refund RPCs, and payment-operation history. It depends on the order/payment schema.

## Required migration order for a fresh staging database

Use the repository's chronological order. Do not skip earlier prerequisites or apply later features first:

1. `202611050001_phase3_catalog_auth_storage.sql`
2. `202611110001_phase_inventory_management.sql`
3. `202611110002_customer_management.sql`
4. `202611110003_order_management.sql`
5. `202611110004_admin_dashboard_analytics.sql`
6. `202611110005_coupons_promotions.sql`
7. `202611110006_admin_payment_summary.sql`
8. `202611110007_custom_requests.sql`
9. `202611110008_admin_settings.sql`
10. `202611120001_customer_checkout_support.sql`
11. `202611120002_customer_payment_proof.sql`
12. `202611120003_customer_order_tracking.sql`
13. `202611180001_personalised_products.sql`
14. `202611180002_admin_photo_preparation.sql`
15. `202611190001_personalised_quotations.sql`
16. `202611200001_quotation_payments.sql`
17. `202611210001_payment_operations_hardening.sql`

If a migration has already been applied successfully, do not blindly replay it. First inspect actual objects and the migration history. SQL Editor manual execution may not be recorded in `supabase_migrations.schema_migrations`.

## Recovery for the current database state reported in the conversation

The screenshots showed:
- `products`, `profiles`, `user_roles`, and `inventory_movements` exist.
- `orders`, `order_items`, `payment_records`, `order_status_history`, and `order_shipments` were reported missing.
- `inventory_movements` originally had `movement_type`, `quantity`, `reason`, `created_at`, and `created_by`; it did not yet show the four inventory-management columns.
- `public.order_payment_status` was manually created and verified with six values.
- `has_role()` exists.

That state strongly indicates the inventory-management migration has not successfully completed in that database, while the order migration was attempted prematurely. On staging, after backup and after confirming the migration is not already applied, apply `202611110001_phase_inventory_management.sql` first. Verify its columns and functions. Then apply `202611110003_order_management.sql` and verify the five order tables. Do not recreate the enum manually again; the order migration safely handles its own enum creation if absent.

If the database is not a fresh staging database, run `supabase/verification/backend_preflight.sql` first and reconcile every `EXISTS`/`MISSING` result against the migration history. Do not run the full sequence on production just because an object is missing: a partially applied or manually modified database needs a tailored repair plan.

## Staging acceptance checks

### Inventory
- A product stock increase creates one `in` movement with action `received` or `adjustment` according to the RPC context.
- Confirming an order deducts stock once and records action `sold` with the order ID reference.
- Cancelling a confirmed/processing order restores stock once and records `order_cancelled`.
- A repeated stock operation with the same order reference is rejected atomically; the product quantity must not change on a failed duplicate.
- Receiving a return requires the order to be in `returned` status, an authorized admin, a valid quantity, and a unique request ID.

### Standard checkout and UPI
- Customer order creation calculates price and shipping on the server.
- COD and UPI settings are enforced server-side.
- UPI proof submission is not treated as payment; only admin verification marks it paid.
- Admin rejection requires a reason; the customer can resubmit according to the existing proof RPC.
- Customer reads use the safe payment summary RPC, not raw verification metadata.

### Personalised quotation payment
- Only an accepted, payment-eligible INR quotation can create a payment order.
- One quotation maps to at most one order.
- Order amount is copied from the database quotation total, never accepted from the browser.
- The payment remains pending until admin verifies UPI settlement.
- Production does not start merely because a quotation was accepted or a proof was uploaded.

### Manual shipping
- Admin enters carrier, tracking number and tracking URL manually.
- Customer sees shipment status for their own order only.
- No courier webhook/API is assumed to be configured.

### Security
- Customers cannot write order/payment/shipment rows directly.
- Customer A cannot read Customer B's orders, quotations, or payment summaries.
- Only super admins can verify/reject/refund payments or change operational order statuses.
- Refund RPC records a full refund after the external refund has actually been sent; it does not transfer money itself.
- Verify storage bucket privacy and RLS separately, especially payment proof objects.

## Known limitations / remaining work

- No email/SMS/WhatsApp provider is configured; notifications are not sent yet.
- Shipping is manual; no courier integration is configured.
- UPI verification is manual; no payment gateway is integrated.
- Refund recording is an audit/status operation, not an automated bank/UPI refund.
- Customer self-service cancellation/return request workflow still needs a dedicated customer RPC and UI; the current order migration supports admin status changes and admin receipt of returned stock.
- Full end-to-end RLS and staging acceptance tests have not been run in this environment.
- The frontend build has not been verified in this environment because dependencies are not installed and npm registry access is unavailable.
