# Supabase Security

- Browser code uses only `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` (or a legacy anon key). The client rejects service-role/secret keys and malformed publishable keys.
- `.env` and `.env.local` are ignored by Git. Never place `SUPABASE_SERVICE_ROLE_KEY` or `sb_secret_*` in a `VITE_` variable.
- RLS is enabled for every application table. Authorization decisions are made by PostgreSQL policies using `public.has_role`; UI role checks are only for presentation.
- User registration always creates a `customer` role. Role assignment is not exposed through the client. Promote administrators only from a trusted SQL Editor session.
- Public image buckets contain non-sensitive product/category/banner images. Customization uploads and payment proofs are private and scoped to a user's UID folder. Issue short-lived signed URLs only when a file needs to be viewed.
- Payment proofs: the browser uploads to the signed-in customer's own folder of the private `payment-proofs` bucket and the database function `customer_submit_payment_proof` re-checks ownership, path format and existence before recording it. A submission only moves a payment to `verification_pending`; a screenshot or reference is never proof of payment, and only a super admin can mark a payment paid through `admin_verify_order_payment`. Proof files are viewed only through two-minute signed URLs.
- UPI payee details (UPI ID, payee name, QR image) are written by super admins only and are not part of the anonymous `public_store_settings` view. The QR image itself sits in a public bucket, so publish only a QR code that is meant to be seen.
- Order tracking: customers read their orders through row-level security plus `get_customer_order_tracking`, which returns status and time only. Internal status-change reasons are admin-only (`order_status_history` is readable by super admins only after `202611120003`). Tracking links are accepted only as `https://` URLs (checked by the database and again before any link is rendered) and open with `rel="noopener noreferrer"`.
- Payment record access: migration `202611210001_payment_operations_hardening.sql` removes customer direct-read access to `payment_records`; only super admins can query the table directly. Customers use `get_customer_order_payments(order_id)`, which verifies order ownership and returns only payment ID, method, status, amount, transaction reference, verified timestamp and creation timestamp. Internal verification notes, admin IDs, provider identifiers and proof paths are not returned.
- Payment operations: UPI rejection, manual verification and full refund status changes are captured in `payment_operation_history` by a database trigger. Only super admins can read the audit history. Refund RPCs record an already-completed bank/UPI refund; they do not transfer funds. Partial refunds are not supported.
- Do not add a service-role key to Edge Function source or frontend code. If a later privileged workflow requires one, keep it in Supabase Function secrets.

Before production, review the project Auth redirect allowlist, email confirmation policy, database backups, rate limits, and bucket file-size/MIME limits.

## Dependency advisories (Phase 7)

`npm audit` reports findings in the development toolchain (`vite`, `esbuild`: dev server only, not in the built site) and `react-router` (fix requires v7). See `docs/DECISIONS.md` for why they were left and the mitigations. `zod` (high) was removed because nothing used it.

## Error handling

A top-level React error boundary shows a recovery page instead of a blank screen for rendering errors. It does not catch the start-up error for a missing or invalid Supabase `.env`; the deployment check is to open the built site once after deploying.

## Admin photo preparation (Phase 2B)

- Admin preparation data is stored only in `custom_request_photo_preparations` (super admin RLS, no customer policy) and never in `custom_requests.preferences`, which customers can read. The customer "My requests" queries do not touch the table.
- Only `super_admin` can reach the screen (route guard), see the data (RLS) and write it (RPC role check). The UI also checks the role before rendering the panel.
- Images stay in the private `customization-uploads` bucket. The app never builds public URLs; previews expire after 2 minutes and downloads after 1 minute, and are created on demand.
- `photo_design` is customer-supplied JSON and is treated as untrusted: a path is used only if it is one of the request's own attachments.
- Prepared files get a new random path under the admin's folder with `upsert` off, so originals and customer-edited files cannot be overwritten. The editor always starts from the original, never from a re-encoded copy.
- Uploads are validated for type (JPEG, PNG, WebP), size (10 MB) and file signature before upload, and the RPC re-validates the path and that the object exists.
- Deployment check after applying the migration: confirm a customer account gets zero rows from `custom_request_photo_preparations` and cannot call the two RPCs, and that a customer cannot create a signed URL for an object under another user's folder.

