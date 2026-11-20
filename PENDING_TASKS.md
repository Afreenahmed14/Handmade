# PENDING_TASKS.md

This list reflects source implementation status, not live Supabase verification. A feature is not production-ready until its migrations, RLS and end-to-end workflow pass on staging.

## A. Backend bring-up and verification

| ID | Task | Status |
|---|---|---|
| A1 | Create staging Supabase project and link repo | Pending |
| A2 | Apply migrations in documented order; reconcile manually applied migrations | Pending |
| A3 | Configure staging `.env.local` and promote a staging super admin | Pending |
| A4 | Verify Auth redirect URLs and email settings | Pending |
| A5 | Run customer/admin RLS and Storage policy matrix | Pending |
| A6 | Regenerate Supabase TypeScript database types from verified schema | Pending |
| A7 | Run inventory, checkout, quotation, payment and shipment acceptance checks | Pending |

## B. Implemented in source; staging verification required

- Standard customer order creation with server-side pricing and shipping settings.
- Order status history and admin status transitions.
- Inventory stock adjustment, order deduction, cancellation restoration and return receipt RPCs.
- UPI proof submission and manual admin verification.
- Customer order tracking and admin-managed shipment records.
- Coupons and promotions.
- Custom requests, personalised product/photo preparation, and quotation drafting/acceptance.
- Accepted quotation to one UPI payment order.
- Customer-safe payment summary, admin payment rejection, full-refund recording and payment-operation history.

## C. Remaining backend work

| ID | Task | Notes |
|---|---|---|
| C1 | Customer cancellation request workflow | Add owner-checked RPC, eligibility rules, admin decision and audit history. |
| C2 | Customer return request workflow | Add request table/RPC, per-item quantities, admin decision, and prevent stock receipt until goods are physically received. |
| C3 | Notification delivery | Select email provider and implement server-side notifications; keep provider secrets in Supabase Function secrets. |
| C4 | Password reset and account lifecycle verification | Confirm redirect allow-list and reset page. |
| C5 | Payment proof Storage security | Verify private bucket, object ownership, signed URL access and retention. |
| C6 | Refund workflow polish | Add refund audit UI; current RPC records full external refund only and does not move funds. |
| C7 | Rate limits / abuse controls | Review OTP, custom requests, quote acceptance and proof submissions. |

## D. Frontend and release quality

- Add automated tests for checkout pricing, coupon boundaries, quotation totals and order status transitions.
- Add error boundary and chunk-load recovery.
- Resolve remaining mock data/no-op forms and category navigation issues.
- Verify mobile checkout and account flows.
- Run `npm ci`, `npm run build`, dependency audit and staging end-to-end tests.
- Confirm SEO metadata, SPA fallback, favicon, robots and sitemap.
- Produce release archives without `.env`, `node_modules`, `dist`, or build cache.
