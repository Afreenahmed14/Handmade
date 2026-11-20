# Supabase Database

## Migration overview (12 files, apply in this order)

Apply status is not recorded in this repository. Check **Supabase → Database → Migrations** (or `supabase migration list`) before running anything, and never re-run a migration that is already in the history. Every file after the first is additive and idempotent where practical, and none contains seed or production data.

| # | File | What it does | Depends on |
| --- | --- | --- | --- |
| 1 | `202611050001_phase3_catalog_auth_storage.sql` | Foundation: `profiles`, `user_roles`, `categories`, `products`, `product_images`, `product_variants`, `inventory_movements`, `store_settings`; `has_role`, signup trigger, inventory trigger; RLS; the five storage buckets and policies. | none |
| 2 | `202611110001_phase_inventory_management.sql` | Inventory module: `products.low_stock_threshold`, movement metadata, `adjust_inventory_stock`, `get_inventory_snapshot`. | 1 |
| 3 | `202611110002_customer_management.sql` | `admin_customer_directory` view and `get_customer_registration_analytics`. | 1 |
| 4 | `202611110003_order_management.sql` | `orders`, `order_items`, `payment_records`, `order_status_history`, `order_shipments`; owner/admin read policies; `create_customer_order`, `admin_update_order_status`, `admin_verify_order_payment`, `admin_receive_order_return`, `get_order_dashboard_summary`. | 1, 2 |
| 5 | `202611110004_admin_dashboard_analytics.sql` | `get_admin_dashboard_analytics` and a partial index on verified payments. | 4 |
| 6 | `202611110005_coupons_promotions.sql` | `coupons`, `coupon_products`, `coupon_categories`, `coupon_redemptions`, `admin_coupon_directory`, `admin_save_coupon`, `validate_customer_coupon`, `create_customer_order_with_coupon`, redemption-release trigger on cancel. | 4 |
| 7 | `202611110006_admin_payment_summary.sql` | `get_admin_payment_summary` (admin Payments overview). | 4 |
| 8 | `202611110007_custom_requests.sql` | `custom_requests` plus status history, internal notes and responses tables; `admin_custom_request_directory`; `create_customer_custom_request`, `admin_update_custom_request`. | 1 |
| 9 | `202611110008_admin_settings.sql` | `private_store_configuration`, `public_store_settings` view (anonymous-safe), `get_admin_store_settings`, `admin_update_store_settings`. | 1 |
| 10 | `202611120001_customer_checkout_support.sql` | Replaces `create_customer_order` (same signature and grants): the free-shipping threshold is honoured when computing the delivery charge, and a payment method the store has switched off (`cod_enabled` / `upi_enabled`) is rejected on the server. `create_customer_order_with_coupon` is not redefined; it inherits both changes. No table is altered. | 4, 6, 9 |
| 11 | `202611120002_customer_payment_proof.sql` | UPI settings keys (`upi_id`, `upi_payee_name`, `upi_qr_url`) via replaced settings functions; `get_customer_upi_payment_details`, `customer_submit_payment_proof`, `customer_payment_proof_block_reason`. | 4, 9 |
| 12 | `202611120003_customer_order_tracking.sql` | `admin_update_order_shipment`, `get_customer_order_tracking`; makes `order_status_history` readable by super admins only. | 4 |

Not a migration: `docs/proposals/payment_records_customer_safe_read.sql` is a reviewed-but-unapplied proposal (see `SECURITY.md`).

The Phase 3 schema is defined in `supabase/migrations/202611050001_phase3_catalog_auth_storage.sql`. It creates:

- `profiles`: private customer contact and address data, linked to `auth.users`.
- `user_roles`: one server-controlled role per user (`super_admin`, `staff`, or `customer`). New accounts receive only `customer`.
- `categories`, `products`, `product_images`, and `product_variants`: storefront catalog with unique case-insensitive category/product slugs and SKUs.
- `inventory_movements`: append-only stock change history written by a database trigger.
- `store_settings`: singleton store configuration, restricted to super admins.

All eight tables have RLS enabled. Public reads are limited to active categories, published products, and images/variants of published products. Customers may read their own profile and update only profile fields; roles, email, and other profiles are not writable to them. Only `super_admin` can manage catalog, inventory history, and store settings. Staff currently receive no extra permissions.

## Inventory management migration

The additive inventory module migration is `supabase/migrations/202611110001_phase_inventory_management.sql`. It adds `products.low_stock_threshold` and movement action, previous/new quantity, and reference metadata to the existing `inventory_movements` table. It also adds:

- `adjust_inventory_stock`: locks the product row with `FOR UPDATE`, validates the action and quantity, rejects negative stock, updates `products.stock_quantity`, and lets the existing stock trigger record an audit row in the same transaction. Authenticated calls require `super_admin`; `service_role` calls are restricted to `sold` and `order_cancelled` actions.
- `get_inventory_snapshot`: returns aggregate counts and a retail-price stock value to authorized inventory operators.

This migration does not create another inventory table and does not change existing rows except setting defaults for the newly added columns. Apply this new migration once, after reviewing it, using the Supabase Dashboard SQL Editor or the linked Supabase CLI. Do not re-run the Phase 3 migration. After applying, verify the migration history and test the RPC as an existing super admin. The inventory screen will return a missing-function/column error until this migration has been applied.

The displayed stock value is quantity multiplied by the product's regular listed price; the current schema has no purchase-cost field, so this is not accounting cost valuation. Future order creation must move order insertion and calls that deduct stock into one database transaction/RPC; order cancellation must restore stock through the same controlled path using an order reference. Calling stock adjustment and order insert as separate client requests would not be atomic.

## Order management migration

The order module migration is `supabase/migrations/202611110003_order_management.sql`. It adds `orders`, `order_items`, `payment_records`, `order_status_history`, and `order_shipments`; enables RLS; and adds customer-owned/admin-read policies with no direct client insert or update grants. Apply it only after `202611110001_phase_inventory_management.sql`, because order confirmation/cancellation calls `adjust_inventory_stock`. The customer management migration is independent.

The database functions provide the only write paths:

- `create_customer_order` derives prices, totals, product names, SKUs and images from the database, uses a customer-scoped idempotency key, and creates the order/items/payment/history rows in one transaction. It does not deduct stock at placement.
- `admin_update_order_status` validates allowed transitions. Pending → confirmed deducts every item via the inventory RPC atomically with the status/history change. Cancellation restores stock only for previously confirmed/processing orders. Shipped orders cannot be cancelled; use the return flow instead.
- `admin_receive_order_return` is a separate, idempotent stock receipt that requires a returned order, an inspected quantity, and reason. Marking an order returned alone does not restock goods.
- `admin_verify_order_payment` requires a super admin and a transaction reference, records verifier/time/note, and marks UPI paid only after an operator independently confirms settlement. An uploaded screenshot is never sufficient.
- `get_order_dashboard_summary` exposes totals to super admins and counts only paid, non-cancelled, non-returned orders as revenue.

This migration is prepared but has not been applied or executed in the project database. Review it and apply it later only after the inventory migration is in place. Validate RLS as an anonymous visitor, customer, staff member and existing super admin; test order idempotency, concurrent stock depletion, cancellation, returns and manual payment verification. No refunds or live payment-provider settlement integration are implemented. Customer UPI proof upload and submission were added later by `202611120002_customer_payment_proof.sql`.

## Admin dashboard analytics

`supabase/migrations/202611110004_admin_dashboard_analytics.sql` adds the `get_admin_dashboard_analytics` aggregate function and a partial index on verified payment timestamps; it creates no dashboard tables. Execute access is limited to authenticated users, with the function itself requiring `super_admin`.

Revenue includes only payment records with `payment_status = 'paid'` and `verified_at IS NOT NULL`, excluding orders currently cancelled or returned. Monthly revenue buckets use `verified_at`; order counts and status filters use `orders.created_at`. Average order value averages verified payments grouped by order. Product/category unit performance excludes pending/cancelled/returned orders and subtracts recorded returned quantities; category grouping uses each product's current category. Apply and validate this migration only after the order and inventory migrations; test its results against verified project records.

## Customer UPI payment proof (`202611120002_customer_payment_proof.sql`)

Additive. Adds three admin-managed settings keys (`upi_id`, `upi_payee_name`, `upi_qr_url`) to `store_settings.configuration` by replacing `admin_update_store_settings` and `get_admin_store_settings` (same signatures and grants). The keys are deliberately not exposed by the `public_store_settings` view. Customers read them only through `get_customer_upi_payment_details(order_id)`, which also returns the payment amount and status for an order the caller owns.

`customer_submit_payment_proof(order_id, reference, proof_path)` records the customer's transaction reference and private proof path and moves the payment record and order to the existing `verification_pending` status. It verifies ownership, UPI method, order and payment eligibility, the amount, the proof path (own folder of `payment-proofs`, exact file-name format, object exists in Storage) and that neither the reference nor the file is attached to another payment. It never sets `paid`; only `admin_verify_order_payment` does. No enum value or table is added.

## Customer order tracking and shipments (`202611120003_customer_order_tracking.sql`)

Additive; not applied. Apply after `202611110003_order_management.sql`. It adds no table, column, enum value or index.

- `admin_update_order_shipment(order_id, carrier, tracking_number, tracking_url)`: super admin only. Allowed once an order is `processing`, `shipped`, `out_for_delivery` or `delivered`. It writes only carrier, tracking number and tracking link (upserting the single `order_shipments` row), so `shipment_status`, `shipped_at` and `delivered_at` stay controlled by `admin_update_order_status`. The tracking link must be `https://`; the tracking number and carrier are length- and character-checked.
- `get_customer_order_tracking(order_id)`: returns, for one order the caller owns, the status, payment status, shipment details and a timeline of `(status, time)` pairs. The admin-written reason and the admin's user id are not returned.
- Policy change: `order_status_history` is now readable by super admins only (policy `order_status_history_read_super_admin`). The previous policy let a customer read the free-text reasons on their own orders directly. Admin screens are unaffected. To keep the old behaviour, delete section 3 of the migration before applying it.

Verify after applying, as a customer and as an admin: the customer can call `get_customer_order_tracking` for their own order and gets `Order not found` for someone else's; a direct `select` on `order_status_history` returns no rows for a customer; `admin_update_order_shipment` is refused for a customer and for an order in `pending`, `confirmed`, `cancelled` or `returned`; a `javascript:` or `http://` tracking link is rejected.

## Coupons and promotions (`202611110005_coupons_promotions.sql`)

Adds `coupons` (percentage or fixed discount, validity window, total and per-customer use limits, minimum order amount, optional maximum discount for percentage coupons), the optional restriction tables `coupon_products` and `coupon_categories`, and `coupon_redemptions`. All four tables are super-admin only under RLS; customers never read them directly. `admin_save_coupon` is the admin write path. `validate_customer_coupon(code, items)` returns the discount for a cart without recording anything, and `create_customer_order_with_coupon` places the order and records the redemption in one transaction. A trigger releases the redemption when an order is cancelled.

## Payment summary (`202611110006_admin_payment_summary.sql`)

`get_admin_payment_summary(from, to)` returns the admin Payments overview (summary, status distribution, method distribution). Super admin only; it is a `SECURITY DEFINER` function that reads `payment_records`.

## Store settings (`202611110008_admin_settings.sql`)

Settings live in `store_settings` plus `private_store_configuration.configuration` (JSON, no direct client access). The anonymous-safe `public_store_settings` view exposes only storefront fields (name, contact details, logo, shipping, delivery text, payment toggles, maintenance mode). `get_admin_store_settings` and `admin_update_store_settings` are the super-admin read and write paths. UPI payee fields are added later by `202611120002` and are deliberately not in the public view.

## Checkout support (`202611120001_customer_checkout_support.sql`)

Additive; changes one function only. It replaces `create_customer_order` so that (1) the delivery charge honours the free-shipping threshold, compared with the product subtotal before any coupon discount, and (2) a payment method switched off in store settings is rejected by the server instead of only being hidden in the storefront. Signature, return type and grants are unchanged; no table, column or existing row is modified; replaying an existing idempotency key still returns the existing order. Apply after the coupon and settings migrations.

## Customer management (`202611110002_customer_management.sql`)

`admin_customer_directory` (a `security_invoker` view of the profiles that hold the `customer` role, for the admin Customers screen) and `get_customer_registration_analytics(months)` (monthly sign-up counts); both are super admin only.

## Custom requests (`202611110007_custom_requests.sql`)

`custom_requests` (customer-owned; readable by the owner and super admins), `custom_request_status_history` and `custom_request_internal_notes` (super admin only; they hold internal reasons and notes), and `custom_request_responses` (readable by the owner and super admins). Customers write only through `create_customer_custom_request`; status, notes and replies are written only by `admin_update_custom_request`. Attachments live in the private `customization-uploads` bucket under the customer's own folder, with at most 10 per request.

## Admin photo preparation (`202611180002_admin_photo_preparation.sql`) — created, NOT applied

Additive only. `custom_request_photo_preparations` holds one row per admin-prepared **version** of a customer photo: `request_id`, `original_path` (the customer's original attachment, which identifies the photo), `version`, `prepared_path`, `preparation_meta` (editor output: transform, text layers, output size, effective DPI, plus `admin_preparation.prepared_from`), `production_notes`, `is_ready_for_quotation` with `ready_marked_at/by`, and `prepared_by` / `prepared_at`. Rows are append-only per photo; the highest `version` is current, and earlier prepared files are kept.

It is a separate table on purpose: `custom_requests` (including `preferences`) is readable by the owning customer, so admin-only data cannot live there. The table has RLS with a single `super_admin` select policy and no customer or staff policy; writes go through two `security definer` RPCs that check `has_role('super_admin')`: `admin_save_photo_preparation(p_request_id, p_original_path, p_prepared_path, p_preparation_meta, p_production_notes, p_mark_ready)` and `admin_update_photo_preparation(p_preparation_id, p_production_notes, p_mark_ready)`. The save RPC verifies that the original is an image attachment of the request, that the prepared path is `<calling admin id>/admin-prepared/<request id>/<uuid>.<jpg|png|webp>` and exists in the `customization-uploads` bucket, that metadata is a JSON object (max 50,000 characters) and notes are at most 5,000 characters, and that the request is not completed or rejected. No existing table, view, policy, RPC or RPC signature is changed.

Storage needs no policy change. Prepared files are written to `customization-uploads/<admin user id>/admin-prepared/<request id>/<uuid>.<ext>`, which the existing owner-folder policy allows and the existing super-admin read policy can read. Until the migration is applied the admin screen still previews and downloads photos and shows a notice that preparation is not enabled.

## Apply the migrations

From the project root, install the Supabase CLI, run `supabase init` once if this repository has not been initialized for the CLI, then link the project and apply the pending migrations (in the order of the table above). `supabase db push` applies everything not yet in the history, so check `supabase migration list` first:

```powershell
supabase link --project-ref YOUR_PROJECT_REF
supabase db push
```

Alternatively, review and run the migration in the Supabase Dashboard SQL Editor. This repository has no configured project reference or database connection, so none of the migrations has been live-tested from here.

## Bootstrap the first administrator

There is deliberately no admin registration flow. After a trusted administrator account has been created through Supabase Auth, promote it from the Dashboard SQL Editor (replace the email):

```sql
update public.user_roles
set role = 'super_admin'
where user_id = (
	select id from auth.users where email = 'admin@example.com'
);
```

Run this using the trusted Dashboard SQL Editor, never from browser code. Confirm exactly one row was updated. Do not expose a service-role key to the frontend.

## Verify RLS after deployment

Test with an anonymous session, a customer session, a staff session, and the administrator session. Anonymous reads should return active categories and published catalog rows only. A customer must see/update only their own profile and must be denied catalog writes. Staff have no catalog write access. The promoted administrator should be able to manage the catalog. Also test direct Storage requests for private buckets; they must require a signed-in owner path or administrator authorization.
