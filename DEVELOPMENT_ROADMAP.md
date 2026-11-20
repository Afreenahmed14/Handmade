# DEVELOPMENT_ROADMAP.md

Principle: the code base is largely feature-complete for the core shop and admin. The biggest risk is not missing code; it is that **none of it has run against a real database**. The roadmap therefore proves what exists before adding more. Phase numbering below is a proposal; rename freely.

## Phase 0 — Audit and restoration — **complete**

Result: installs, type-checks, builds and starts with zero changes. Six audit documents produced. No blockers in the toolchain.

## Phase 1 — Staging backend and live verification (recommended next)

Goal: turn "compiles" into "works".
Tasks: A1–A6, B1–B7. Exit criteria: a customer can browse real products, check out by COD and by UPI, be verified by an admin, and track the order on staging; RLS matrix passes; generated types match.
Why first: every later feature depends on knowing the 12 existing migrations actually apply cleanly and that checkout works end to end. Defects found here are cheaper now than after more code sits on top.

## Phase 2 — Close functional gaps in the buying journey

Tasks: C1 (custom requests), C2 (search and filters), C3 (password reset), C5 (gallery), D1 (payment rejection), E4, plus C4 once the product decision is made.
Each as one module with its own build check and report, matching how the project has been developed so far. New SQL stays additive and unapplied until staging verification.

## Phase 3 — Operations and communication

Tasks: D2, D3, D4, D5, C6, C7.
Notifications are the main item: decide the channel(s), then build the minimum Edge Functions required (secrets in Function secrets only).

## Phase 4 — Hardening and release

Tasks: E1–E3, E5–E9, accessibility and mobile polish, performance (pagination, image sizing), SEO, backups and rate-limit review, production project setup and cut-over.

## Dependency map

```
A (staging) ──► B (live tests) ──► C/D (new features, tested as built)
                         └──────► E (quality; can start in parallel with A)
```
E-items that need no backend (E2, E5, E6, E8) can be done at any time without conflict.

## Decisions needed from you

1. Phone OTP: keep (needs an SMS provider) or hide the tab for launch?
2. Sample reviews and mailing list on Home: remove, or build real features?
3. Notifications: which channel (email, SMS, WhatsApp)?
4. Which of the seven Edge Function folders do you actually want?
5. Should the wishlist stay browser-local, or be stored per customer in the database?
