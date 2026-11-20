# DATABASE_AUDIT.md

Method: static reading of the 12 migrations plus automated cross-checks against the frontend. **No database was contacted and nothing was applied.** Nothing here is a statement about the live project's actual state.

## 1. Migration inventory and apply order

Files sort correctly by name, and each only depends on earlier ones.

| # | File | Purpose | Reported state |
| --- | --- | --- | --- |
| 1 | `202611050001_phase3_catalog_auth_storage` | profiles, user_roles, categories, products, product_images, product_variants, inventory_movements, store_settings; auth trigger; 5 buckets + storage policies | **Applied** (per `docs/DEPLOYMENT.md`; verify in migration history) |
| 2 | `202611110001_phase_inventory_management` | stock columns, `adjust_inventory_stock`, `get_inventory_snapshot` | Prepared, not applied |
| 3 | `202611110002_customer_management` | `admin_customer_directory`, registration analytics | Prepared, not applied |
| 4 | `202611110003_order_management` | orders, order_items, payment_records, order_status_history, order_shipments; order RPCs | Prepared, not applied. Needs #2 |
| 5 | `202611110004_admin_dashboard_analytics` | `get_admin_dashboard_analytics` | Prepared, not applied |
| 6 | `202611110005_coupons_promotions` | coupons, coupon_products, coupon_categories, coupon_redemptions; coupon RPCs | Prepared, not applied |
| 7 | `202611110006_admin_payment_summary` | `get_admin_payment_summary` | Prepared, not applied |
| 8 | `202611110007_custom_requests` | custom_requests (+ responses, notes, history), RPCs, directory view | Prepared, not applied |
| 9 | `202611110008_admin_settings` | `private_store_configuration`, `public_store_settings` view, admin settings RPCs | Prepared, not applied |
| 10 | `202611120001_customer_checkout_support` | replaces `create_customer_order` (same signature) | Undocumented; assume not applied |
| 11 | `202611120002_customer_payment_proof` | UPI details, proof submission, replaces settings RPCs | Prepared, not applied |
| 12 | `202611120003_customer_order_tracking` | tracking RPC, shipment RPC, **tightens `order_status_history` read policy** | Prepared, not applied |

"Prepared, not applied" for #2–#9 and #11–#12 comes from your `docs/DATABASE.md`. Migration #10 is not mentioned in the repo docs at all, so its state is unknown; treat it as unapplied (see finding 2).

Because migrations #2–#12 are unapplied, **the deployed database almost certainly cannot serve most of the app today** (orders, admin modules, settings, coupons). The storefront catalog and sign-in only need #1.

## 2. Objects

- **Tables (22):** categories, coupon_categories, coupon_products, coupon_redemptions, coupons, custom_request_internal_notes, custom_request_responses, custom_request_status_history, custom_requests, inventory_movements, order_items, order_shipments, order_status_history, orders, payment_records, private_store_configuration, product_images, product_variants, products, profiles, store_settings, user_roles.
- **RLS:** enabled on all 22 (verified by grep). `private_store_configuration` additionally has all privileges revoked from `public, anon, authenticated`.
- **Views (4):** `admin_customer_directory`, `admin_coupon_directory`, `admin_custom_request_directory` (all `security_invoker = true`, granted to `authenticated`) and `public_store_settings` (`security_barrier`, granted to `anon, authenticated` by design, UPI fields excluded).
- **Functions:** about 32 definitions. Every `SECURITY DEFINER` function sets `search_path` (counts match per file). No `GRANT EXECUTE … TO anon` exists on any function; customer RPCs require `authenticated`.
- **Triggers:** auth-user → profile + `customer` role; `updated_at` triggers; `products_record_inventory_change`; `orders_release_coupon_on_cancel`.
- **Buckets (5):** `product-images`, `category-images`, `homepage-banners` (public); `customization-uploads`, `payment-proofs` (private, user-folder scoped).
- **Enums:** none. Statuses are `text` with check constraints; the TypeScript union types in `src/types/database.ts` mirror them by hand.
- **Seeds:** none, apart from backfilling profiles/roles for existing auth users. No categories, products or store-settings row are seeded. Settings read falls back to neutral defaults, so a fresh database shows an empty store, which is the intended "no fake data" behaviour.

## 3. Frontend ↔ database contract

| Check | Result |
| --- | --- |
| Tables/views used by `.from()` (21) | All exist. |
| RPC names used (21) | All exist. |
| RPC argument names | All match the **latest** definition of each function (script-verified). |
| Buckets used (5) | All exist with matching public/private setting. |
| Column-level match between `types/database.ts` and the SQL | **Not exhaustively verified.** The types are hand-written (no generated types), so drift is possible. Spot-checked orders/payments/coupons rows; no mismatch seen. |
| Edge Functions | Frontend never invokes one. |

## 4. Findings

**High**
1. **Unapplied migrations.** The app targets objects that do not exist until #2–#12 are applied. Applying them to production was out of scope and was not done. Needs a staging project first.
2. **`202611120001` is missing from the docs.** `docs/DATABASE.md` documents #2–#9 and #11–#12 but not the checkout-support migration, which redefines `create_customer_order`. `create_customer_order_with_coupon` (#6) calls `create_customer_order`, so the coupon path silently depends on whatever #10 changed. Test both order paths together.

**Medium**
3. **Policy change in #12 is a behaviour change.** Customers lose direct read access to `order_status_history` (intentional, to hide internal reasons). Any customer screen that read that table directly would break. The code reads only via `get_customer_order_tracking` (verified: the only `order_status_history` read is in the admin order service), but test it.
4. **Known data exposure** (yours, in SECURITY.md): `payment_records.verification_note` / `verified_by` readable by the owning customer via the table policy. Replace with a customer-safe view before launch.
5. **No admin "reject payment" RPC.** `admin_verify_order_payment` only approves. A wrong or fraudulent proof cannot be rejected through the app, only left pending.
6. **Replaced functions rely on identical signatures** (`create_customer_order`, `admin_update_store_settings`, `get_admin_store_settings`). They are identical in the files, so `CREATE OR REPLACE` will not create overloads. Confirm after applying that `\df` shows one of each.

**Low**
7. No `supabase/config.toml`, so the CLI project is not initialised in this repo (`supabase init` is required before `db push`). Auth provider settings (email confirmation, phone OTP, redirect allow-list) therefore live only in the dashboard and are undocumented as code.
8. No seed script for categories/settings, which makes first-run setup manual.
9. No test SQL (pgTAP or scripted checks) for RLS. The RLS verification list in `DATABASE.md` is manual.
10. `products` fetch is unpaginated on the storefront (see TECHNICAL_DEBT); at larger catalog sizes it needs a range query.

## 5. Recommended verification order (staging project, never production first)

1. Create a staging Supabase project; apply #1–#12 in order with `supabase db push` after `supabase init`/`link`.
2. Create an admin; promote with the documented SQL. Create a customer.
3. Run the RLS matrix (anon / customer / admin) from `DATABASE.md`.
4. Place a COD order and a UPI order, with and without a coupon; submit proof; verify payment; confirm stock deduction, cancel, return.
5. Verify `get_customer_order_tracking` ownership isolation and https-only tracking links.
6. Generate types with `supabase gen types typescript` and diff against `types/database.ts`.
