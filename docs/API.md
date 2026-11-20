# Supabase Service Layer

There is no separate Node/Express server. Browser operations use the single typed client in `src/lib/supabase.ts`; access is bounded by Supabase Auth and PostgreSQL RLS.

- `src/services/catalog.ts`: fetch active categories and published products, read a product by slug, and provide product/category create, update, and delete operations for the admin screens.
- `src/services/storage.ts`: upload product/category images, set the product primary image, and create short-lived signed URLs for private objects.
- `src/services/auth.ts`: email registration/login, phone OTP request/verification, and logout.
- `src/services/orders.ts`: order directory, detail and dashboard queries; customer order creation; and RPC wrappers for status transitions, payment verification and inspected return receipts.
- `src/services/paymentProof.ts`: customer UPI payment details, transaction-reference and proof-file validation, private proof upload, submission through `customer_submit_payment_proof`, and short-lived signed proof URLs.
- `public.get_customer_upi_payment_details` and `public.customer_submit_payment_proof`: customer-side payment read and submission paths. Submitting never marks a payment as paid.
- `src/services/customerOrders.ts`: the customer's order list (filter and pagination), order detail by id or order number, and tracking. It lists columns explicitly, so internal fields (idempotency key, admin verification notes, status reasons) are never requested, and it validates the shape of the tracking JSON instead of trusting it. `getOrderDetail` in `orders.ts` remains the admin-shaped read.
- `src/services/orders.ts` also exports `updateOrderShipment` (with `validateShipmentInput`, which mirrors the database rules) for admin shipment management.
- `public.get_customer_order_tracking` and `public.admin_update_order_shipment`: the customer-safe tracking read and the only write path for carrier, tracking number and tracking link. Saving shipment details never changes the order status.
- `public.admin_update_order_status`, `public.admin_verify_order_payment`, and `public.admin_receive_order_return`: privileged database-side write paths; clients do not update order, payment, history or stock rows directly.

CRUD methods intentionally surface Supabase errors. There is no mock data anywhere in the application; a failed backend request shows an error. Image tables keep public URLs; private buckets are not exposed with public URLs.
- `src/services/customRequests.ts` (customer side, Phase 5A): customization form validation, reference-image validation (type, size, file signature), private upload to `customization-uploads/<user id>/...` through `uploadPrivateFile`, submission through the existing `create_customer_custom_request` RPC, and the customer-readable `request_number` lookup. `/customize/:slug` (`src/pages/Customize/Customize.tsx`) is the customer page; it is protected and only open for published products marked customizable.
- `src/services/customRequests.ts` (customer read side, Phase 5B): `getMyCustomRequests`, `getMyCustomRequestDetail` and `getMyAttachmentLinks` power `/my-requests` and `/my-requests/:requestId`. They are read-only, list columns explicitly, filter by the signed-in customer on top of RLS, and never query `custom_request_internal_notes` or `custom_request_status_history` (admin-only, they hold internal notes and status reasons).
- `src/services/productSearch.ts` (Phase 6): pure search/filter/sort over the loaded storefront catalog, plus URL query-parameter parsing (`q`, `category`, `min`, `max`, `stock`, `custom`, `sort`). `useCatalog` shares one cached catalog load (60 s) between Home, Shop and Category pages. Only published products and active categories are ever loaded.
- `src/utils/currency.ts` (Phase 7): `formatINR`, previously exported from a mock-data module. `useActiveCategories` (in `src/hooks/useCatalog.ts`) supplies the Header's category links from the same cached `getCategories()` call.
- Customer pages read orders only through `src/services/customerOrders.ts` (explicit columns). `getOrderDetail` in `orders.ts` is admin-only; the order-confirmation page was moved off it in Phase 7.

## Admin photo preparation (Phase 2B)

- `src/services/photoPreparation.ts` (admin only): reads `custom_request_photo_preparations` (degrades to a notice when the table does not exist yet), batches short-lived preview URLs (2 minutes), creates one-minute download URLs, loads an original through the admin's own session and validates it (type, size, file signature), and saves a prepared photo: upload as a new private file, then `admin_save_photo_preparation`. If the server rejects the record the new upload is removed; if the outcome is unknown it is kept.
- `src/utils/photoDesign.ts` (pure): parses `preferences.photo_design` defensively. A path is only used when it is also in the request's `attachment_paths`. Derives the photo status and rebuilds editor state from saved metadata.
- `src/admin/CustomRequests/PhotoPreparationPanel.tsx`: the workspace inside the request detail dialog. It reuses `PhotoEditor` (new optional `copy` prop for wording only; defaults are the customer text).
- `src/services/storage.ts`: added `createPrivateUploadUrls`, `createPrivateDownloadUrl`, `downloadPrivateFile`, `uploadAdminPreparedFile`. Existing functions are unchanged.


## Payment operations hardening (migration 202611210001)

- Customer payment history is read through `get_customer_order_payments(order_id)`, which checks ownership and returns only customer-safe fields. Direct `payment_records` reads are restricted to super admins; this closes the previous `verification_note` / `verified_by` exposure.
- `admin_reject_order_payment(payment_id, reason)` marks an unverified UPI submission failed and synchronises the order payment status. Failed UPI payments may be resubmitted through the existing customer proof RPC.
- `admin_record_payment_refund(payment_id, amount, external_reference, note)` records a full refund only for a previously verified payment. Partial refunds are intentionally unsupported. The operator must send the refund through the bank/UPI channel first; this RPC records the completed action and does not move money.
- `payment_operation_history` is an append-only audit trail populated by a trigger for proof submission, verification, rejection and refund status changes. Only super admins can read it through `get_admin_payment_operation_history`.
- UPI verification remains manual. Shipping/tracking remains manually entered by an administrator; no provider credentials or carrier webhooks are configured.
