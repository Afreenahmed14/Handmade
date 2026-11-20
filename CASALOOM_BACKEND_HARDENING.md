# CasaLoom backend hardening — 19 November 2026

## Implemented in this source update

### Customer payment privacy
- Direct `payment_records` reads are now super-admin only.
- Customers read their own safe payment summary through `get_customer_order_payments`.
- The customer RPC returns no verification note, admin user ID, provider metadata, or proof-storage path.

### Manual UPI rejection
- Admin can reject an unverified UPI payment with a required reason.
- The order and payment status are both moved to `failed`.
- The existing customer proof-submission RPC permits failed UPI payments to be resubmitted.

### Full refund recording
- Admin can record a full refund after the money has actually been returned through the bank/UPI channel.
- The RPC requires the exact full payment amount and an external refund reference.
- Partial refunds are deliberately not supported.
- This is an audit/status record, not a payment transfer or gateway refund API.

### Payment activity audit
- `payment_operation_history` captures payment status transitions for proof submission, verification, rejection and refund.
- A database trigger writes the history row; clients cannot write or update audit rows.
- Only super admins can read the audit history.

## Migration order

Apply all migrations in chronological order to a staging Supabase project, including:

1. `202611190001_personalised_quotations.sql`
2. `202611200001_quotation_payments.sql`
3. `202611210001_payment_operations_hardening.sql`

Do not apply this migration to production until the staging checks pass.

## Manual verification checklist

- Customer A can read their own safe payment summary.
- Customer A cannot directly select `payment_records`.
- Customer A cannot read Customer B's payment summary.
- Customer cannot call admin rejection, refund or audit-history RPCs.
- Admin can reject pending and verification-pending UPI submissions.
- Rejected customer payment can be resubmitted with a new transaction reference.
- Admin can verify a valid UPI payment only after independently confirming settlement.
- Admin can record a full refund only for a verified payment, with the exact full amount and refund reference.
- Repeated/invalid refund attempts fail.
- Payment activity history records proof submission, verification, rejection and refund status changes.
- Existing normal checkout, quotation payment order creation, manual shipping entry and customer tracking still work.

## Not included / still requires configuration or later work

- No email/SMS/WhatsApp provider has been selected or configured; order notifications are not sent.
- Shipping is manual; no courier API or tracking webhook is configured.
- No payment gateway is integrated; UPI verification remains manual.
- Partial refunds are unsupported.
- The staging database migration and live RLS matrix have not been run in this environment.
- The frontend build could not be verified because dependencies are not installed and npm registry access was unavailable.
