# CasaLoom backend status

The source includes the original Supabase migration set plus personalised quotation payment and payment hardening migrations. See `CASALOOM_BACKEND_RECOVERY_AND_RELEASE.md` for the exact migration order, production safety rules and staging acceptance checklist.

**Do not infer that the live database is complete from the presence of SQL files.** The current reported Supabase database is missing order-management tables, and the screenshots identify the selected project as PRODUCTION. Create/use staging, back up production, run `supabase/verification/backend_preflight.sql`, then apply/reconcile migrations in order.

Payment and shipping defaults for the first release:
- UPI with manual admin verification.
- Shipping entered and tracked manually by an admin.
- No gateway, courier API, or automatic notification provider is configured.

The latest source migration set includes:
- `202611200001_quotation_payments.sql`
- `202611210001_payment_operations_hardening.sql`

These must follow the order-management and quotation schema migrations. They are source files only until applied and verified on staging.
