# CasaLoom Phase 3 — Personalised product quotations

Status: code complete, migration **created but not applied**. Apply `supabase/migrations/202611190001_personalised_quotations.sql` to staging first.

## Data model (additive)
- `custom_request_quotations` — one row per quotation version of a custom request (`quote_number` = `<request number>-Q<version>`). Status enum `quotation_status`: draft, sent, accepted, declined, expired, superseded. Holds subtotal, printing charges, discount, shipping, final total, currency (INR), customer notes, internal notes, validity, expiry, created/sent/accepted/declined timestamps, decline reason, `payment_eligible_at`.
- `custom_request_quotation_items` — itemised lines (`product`, `printing`, `additional`). `line_total_inr` is a generated column.
- No existing table, enum, policy or function is changed.

## Rules enforced in the database
- Totals are computed by `admin_save_quotation_draft`; no RPC accepts a total. A CHECK keeps `final = subtotal − discount + shipping`.
- Sent quotations are immutable (trigger) and can never be deleted; a revision is a new version. Sending a new version supersedes the previous *sent* one in the same transaction.
- Unique partial indexes: at most one draft, one sent and one accepted quotation per request.
- Customers have **no** table access. They use `get_my_quotations`, `get_my_quotation_overview` and `customer_respond_to_quotation`, which filter on `custom_requests.customer_id = auth.uid()`, never return drafts, and never return internal notes or admin ids.
- Accepting records `accepted_at` and `payment_eligible_at` only. It creates no order, no payment record, and does not change the request status.
- Expiry is lazy: RPCs persist `sent → expired`, and acceptance re-checks `valid_until` under a row lock.

## Screens
- Admin: `src/admin/CustomRequests/QuotationPanel.tsx` (inside the request dialog) + a "Quotation" column in the request list.
- Customer: `src/pages/MyRequests/QuotationSection.tsx` (request details) + a quotation badge in My requests.

## Not in this phase
Payment against an accepted quotation, order creation from a quotation, production tracking, customer e-mail/SMS notifications.
