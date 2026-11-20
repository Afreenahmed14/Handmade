# EXISTING_FEATURES.md

**Classification key** — 1 Implemented · 2 Partially implemented · 3 Not implemented · 4 Broken · 5 Requires live integration testing.

"Implemented" means: the code is complete for its stated purpose, compiles, and is wired to database objects that exist in the migrations. Because no live Supabase project was available, **every feature that talks to the backend also carries flag 5**. Nothing was found to be class 4 (Broken) by static analysis and build; two *suspected* runtime risks are listed at the end.

## Customer storefront

| Feature | Class | Evidence / notes |
| --- | --- | --- |
| Home page (hero, categories, featured, more pieces) | 1 + 5 | Reads live catalog. Hero/brand copy is static. |
| Home: "Customer reviews" block | 2 | Three hard-coded quotes labelled "Sample review". Placeholder content, not data. |
| Home: "Join the mailing list" form | 3 | `onSubmit` only calls `preventDefault()`. Nothing is stored or sent. |
| Home: "Made for your room" banner | 2 | Button goes to `/shop`; the customisation flow it advertises does not exist yet. |
| Shop all with category dropdown | 2 + 5 | Category filter works. No search, sort, price, material or colour filters. |
| Header search icon | 2 | Links to `/shop`; there is no search. |
| Category page | 1 + 5 | Matches products by category **name**, not id (see TECHNICAL_DEBT). |
| Product details | 1 + 5 | Price/discount, stock label, add to cart, wishlist, out-of-stock handling. No gallery (primary image only), no variants UI, no "Customise" action despite `customizable` being mapped. |
| Header / footer nav driven by settings | 1 + 5 | Store name, logo, shipping announcement, contact details from settings. Main nav category links are hard-coded (Lighting, Wall Decor, Paintings, Furniture). |
| Maintenance mode | 1 + 5 | Customer storefront closed, admins bypass, login stays open. |

## Cart, wishlist, checkout

| Feature | Class | Evidence / notes |
| --- | --- | --- |
| Cart (guest + per-customer, merge on sign-in) | 1 + 5 | `shopStore.ts`; stock clamping; unavailable/adjusted line handling; cart totals and free-shipping rule. |
| Wishlist (move to cart, remove) | 1 + 5 | **Browser-local only** (not stored in the database), so it does not follow a customer across devices. Not a defect by itself; a product decision. |
| Checkout (address, COD / UPI, note, totals) | 1 + 5 | Idempotency key per attempt; region validation from settings; calls `create_customer_order` or `…_with_coupon`. Depends on migration `…120001`, which the repo docs do not mention (assume unapplied). |
| Coupon apply / revalidate at checkout | 1 + 5 | `validate_customer_coupon` RPC; re-validated when the cart changes. |
| Order success page | 1 + 5 | |
| Saved address from profile | 1 + 5 | `getCheckoutProfile` / `saveCheckoutProfile`. |

## Payments

| Feature | Class | Evidence / notes |
| --- | --- | --- |
| UPI pay-after-order panel (UPI ID/QR, reference, proof upload) | 1 + 5 | Private `payment-proofs` bucket; submit never marks "paid". |
| Admin payment verification (approve) | 1 + 5 | `admin_verify_order_payment`. |
| Admin payment **rejection** / mark failed | 3 | No RPC and no UI action. `failed` exists as a status and a filter only. The empty `reject-upi-payment` function folder suggests this was planned. |
| Refunds | 3 | `refunded` status is displayed; there is no refund action or integration. |
| Online payment gateway | 3 | Out of scope so far (UPI manual verification + COD only). |

## Customer account and orders

| Feature | Class | Evidence / notes |
| --- | --- | --- |
| Register (email + password, confirmation, resend) | 1 + 5 | Needs Auth email settings and redirect allow-list. |
| Login (email) | 1 + 5 | |
| Phone OTP login / verify | 1 + 5 | Code complete; **will not work until an SMS provider is configured** in Supabase Auth. |
| Forgot / reset password | 3 | No page, no service function. |
| Profile (name, mobile, address) | 1 + 5 | Direct `profiles` update under RLS. No email change, no password change, no delete account. |
| My Orders (list, filter, pagination) | 1 + 5 | Explicit column lists, so internal fields are never requested. |
| Order details | 1 + 5 | |
| Order tracking (`/track`, `/track/:ref`) | 1 + 5 | Customer-safe RPC; https-only tracking links. |
| Customer custom request (customise a product) | 3 | DB table, RPC (`create_customer_custom_request`), service function and private upload helper all exist; **no customer page uses them** (`/customize/:slug` is a stub). |
| Customer cancel order / request return | 3 | No customer-side action. |
| Transactional email/SMS (order placed, shipped, etc.) | 3 | `send-order-notification` function folder is empty. |
| Product reviews | 3 | No table, no UI (Home shows sample text). |

## Admin (all behind `super_admin`)

| Module | Class | Notes |
| --- | --- | --- |
| Dashboard (KPIs, charts from analytics RPCs) | 1 + 5 | `get_admin_dashboard_analytics`, `get_order_dashboard_summary`, registration analytics. |
| Products (CRUD, images, publish, featured, customizable) | 1 + 5 | |
| Categories (CRUD, image) | 1 + 5 | |
| Inventory (snapshot, adjust, movements) | 1 + 5 | Atomic via `adjust_inventory_stock`. |
| Customers directory | 1 + 5 | |
| Orders (list, detail, status transitions, returns) | 1 + 5 | Transition rules enforced in the database. |
| Shipment panel (carrier, tracking no., link) | 1 + 5 | `admin_update_order_shipment`. Manual entry only; the carrier webhook function is empty. |
| Payments | 1 + 5 | See Payments above for what is missing. |
| Coupons | 1 + 5 | |
| Custom requests (status, notes, responses) | 1 + 5 | Customer-facing creation side is missing (above). |
| Settings (store, shipping, regions, COD/UPI, maintenance, logo, UPI details) | 1 + 5 | |
| Staff role | 3 | Role exists in the enum; staff get no access anywhere by design. |
| Admin user management | 3 | Intentional (admins are promoted via SQL). |

## Platform

| Feature | Class | Notes |
| --- | --- | --- |
| Edge Functions (7) | 3 | All empty folders: `approve-upi-payment`, `create-order`, `create-shipment`, `reject-upi-payment`, `send-order-notification`, `tracking-webhook`, `verify-order-stock`. **No frontend code calls any function**, and the database RPCs cover create-order, stock and approval already, so these may be redundant for the current design. Decide per function (see roadmap). |
| Automated tests | 3 | None. |
| SEO / meta / favicon / sitemap | 3 | `index.html` has a title only; `public/` is empty. |
| SPA fallback for hosting | 3 | README says to add one for Hostinger; no `.htaccess` is in `public/`. |

## Suspected runtime risks (static analysis, need a browser to confirm)

1. **Auth re-check may unmount protected pages.** `AuthContext.resolveRole` sets `loading = true` on *every* auth event, and `ProtectedRoute` renders "Checking your account…" while loading. If Supabase emits `SIGNED_IN`/`TOKEN_REFRESHED` when a tab regains focus or a token refreshes, a customer in the middle of checkout could see the form unmount and lose local state. Confirm in testing; fix is small (only show the loading state when the user id changes).
2. **Role lookup failure fails closed.** If the `user_roles` read errors, role becomes `null` and an admin is shown "Access unavailable". Safe, but confusing; worth a clearer message.
