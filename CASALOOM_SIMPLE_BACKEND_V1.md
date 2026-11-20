# CasaLoom — simplified backend workflow (v1)

This package contains a backend-only, additive implementation for the simpler order flow requested.

## The intended flow

1. Customer selects one published product, quantity, delivery address, and optionally uploads one customization photo.
2. The backend creates a `pending` order request. It does not collect payment details yet.
3. Admin receives an in-app notification and accepts or declines the request.
4. On acceptance, admin must set an expected delivery date. The customer receives an in-app notification.
5. Only after acceptance, the customer chooses UPI or COD. Existing payment-proof/verification logic remains available for UPI.
6. Admin updates the existing order status through processing, shipped, out for delivery, and delivered. Existing tracking data remains in `order_shipments`.
7. Once delivered, the customer can submit one 1–5 star feedback entry.
8. Admin notifications, analytics, product/category CRUD, and payment dashboard remain in the existing project.

## Included changes

- `supabase/migrations/202611220001_simple_customer_order_workflow.sql`
  - Adds the optional customization photo/note, promised delivery date, and admin note to orders.
  - Makes `orders.payment_method` nullable so it can be chosen after acceptance.
  - Adds private in-app order notifications and customer feedback.
  - Adds secure RPCs to create a request, accept/decline, choose payment, and submit feedback.
  - Reuses existing `admin_update_order_status` for acceptance and stock deduction, and existing tracking/payment infrastructure.
- `src/services/simpleOrders.ts`
  - Typed frontend service functions for the new backend RPCs and notifications.
- `src/types/database.ts`
  - Adds the new fields, tables, and RPC typings.

## Important deployment notes

- This migration is additive. It does not drop existing tables, columns, functions, or historical data.
- Do not delete or re-run old migrations. Apply this new migration once, after the existing order, payment, and storage migrations.
- The migration has NOT been run against your Supabase production database. Review it and apply it in Supabase SQL Editor only after taking a database backup.
- The existing private `customization-uploads` Storage bucket and customer upload policies are reused. The photo path is checked to ensure it belongs to the signed-in customer.
- Notifications are in-app database notifications. Email, SMS, WhatsApp, and browser push are not configured by this backend patch.
- WhatsApp customization enquiries are a frontend link to your business WhatsApp number; no backend integration is required.
- Existing coupons, quotation, photo-preparation, and custom-request modules are left intact for data safety, but are outside the simplified v1 customer workflow. They can be hidden from the admin/customer UI in the frontend phase after the new flow is verified.

## Build status

The TypeScript service and type updates are included. A local production build could not be completed in this environment because dependency installation did not finish. Run `npm ci` and `npm run build` in your project folder before deploying.


## Frontend updates included in the follow-up package

- Product cards now lead to the product detail page instead of adding to a cart.
- Product details open a short order-request form with quantity, one customization photo, optional note, and delivery address.
- Customer orders page shows approval, expected delivery date, payment choice, tracking link, and post-delivery feedback.
- Customers have an in-app notifications page.
- Admin orders screen is simplified to review requests, accept/decline with a delivery date, and advance the delivery status.
- Admin navigation is reduced to Dashboard, Products, Categories, Orders, Payments, Notifications, and Settings.
- Admin screens use the CasaLoom cream, walnut, brass, and plum palette rather than blue/navy styling.
- Header cart shortcut and old custom-request shortcut have been removed from the main customer navigation. Legacy routes and modules remain in the source for data safety.

## CasaLoom Pinterest-style storefront redesign

- Reworked the homepage into a mixed romantic cottagecore / Pinterest boutique / minimal editorial layout.
- Added locally bundled WebP editorial images under `public/images/casaloom-editorial/` for the hero, editorial feature and moodboard.
- Rebuilt the storefront header and mobile navigation while preserving existing routes for Shop, categories, personalised gifts, account, orders, notifications and wishlist.
- Refreshed the footer and global Tailwind brand aliases to warm cream, blush, dusty rose, plum and muted gold; existing legacy color aliases remain available so existing pages continue to compile against the same class names.
- Updated the generated ProductArt fallback illustrations to use the warm palette.
- No Supabase schema, RPC, authentication, checkout/order, tracking, or payment service files were changed in this visual redesign.
