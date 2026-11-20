# CasaLoom Phase 4 — Accepted quotation payments

## Implementation

Phase 4 converts an accepted personalised quotation into a standard CasaLoom UPI order, then reuses the existing customer payment-proof and admin verification workflow.

### Customer flow
1. Customer accepts a sent quotation in My Requests.
2. The accepted quotation displays a **Pay** action for the exact server-calculated total.
3. The `customer_create_quotation_payment_order` RPC validates the signed-in customer owns the request and that the quotation is accepted and payment-eligible.
4. The RPC creates one order, snapshots the quotation line items, and creates one pending UPI payment record for the exact quotation total.
5. The customer is sent to the existing `/payment/:orderId` page. Existing UPI instructions, transaction reference, private proof upload, and payment-status display are reused.
6. Admins verify or reject the payment using the existing Payments / Orders workflow. Customer-submitted proof never marks an order as paid.

### Database changes
- Add nullable `orders.quotation_id` referencing `custom_request_quotations(id)`.
- Add a partial unique index so one quotation can create at most one order.
- Add `customer_create_quotation_payment_order(uuid)` as an authenticated SECURITY DEFINER RPC.
- The RPC locks the customer's request and quotation, checks accepted status, requires a complete profile delivery address, uses the database quotation totals, creates order items from quotation items, and creates a pending UPI payment record.
- Repeated calls return the existing order ID rather than creating duplicate orders or payment records.

### Security / compatibility
- No client-supplied amount, payment status, order total, or address is trusted by the RPC.
- Only the owning customer can create the order from their accepted quotation.
- Declined, expired, superseded, draft, or sent quotations cannot be paid.
- Existing checkout RPCs, order payment proof RPCs, payment verification RPCs, and admin payment screens are unchanged.
- COD is not enabled for personalised quotations.
- Creating the order does not start production or advance the custom request status. Production tracking remains Phase 5.

## Migration status

`supabase/migrations/202611200001_quotation_payments.sql` is created but **not applied**. Apply Phase 3 migration `202611190001_personalised_quotations.sql` first, then this Phase 4 migration, in staging. Verify the full flow before production.

## Customer prerequisite

The customer must have a complete profile: full name, mobile number, address line 1, city, state, and postal code. If these are missing, the RPC returns a validation message and does not create an order.

## Verification still required

- Apply both migrations to a staging Supabase project.
- Test accepted quotation → Pay → exact UPI amount → proof submission → admin verification.
- Test repeat-click / concurrent RPC calls create only one order and one payment record.
- Test foreign customer, non-accepted quote, and incomplete profile are rejected.
- Test standard product checkout and its payment flow remain unaffected.

The local build was not run successfully in this environment because npm could not reach `registry.npmjs.org` (`EAI_AGAIN`) while installing dependencies. No claim of a passing build is made.
