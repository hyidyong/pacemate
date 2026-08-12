# Stage 6 — Cross-Tenant Isolation Test Matrix

Date: 2026-08-12. Tests the tenant boundary at authoritative layers, not UI
visibility (spec §14, §15, §30). Two-tenant fixture per spec §27.

## Two-tenant fixture (spec §27)

Deterministic, in-memory (transpile-loader + fake Supabase clients, the same
harness Stage 5 used in `counseling.actions.test.mjs`). No production PII; no
live DB required for the server-boundary suite.

```
University A (school A)                University B (school B)
  Student A  (profile, role student)     Student B
  Professor A (professors row, school A)  Professor B
  Availability A (Mon 10:00–11:00)        Availability B (Mon 10:00–11:00)  ← identical wall time, different tenant
  Counseling request A (pending)          Counseling request B (pending)
  Notification A                          Notification B
  Community post A (school A)             Community post B (school B)
```

The identical wall-clock availability across A and B is deliberate: it proves
(a) a student in A can book Professor A's 10:00 slot, (b) the same student
cannot book Professor B's 10:00 slot, and (c) the two identical-time bookings
never conflict with each other (Stage 5 GiST invariant preserved under
tenancy — spec §12).

## Matrix (server boundary = enforced; DB backstop = counseling INSERT)

| # | Actor | Resource tenant | Operation | Expected | Layer under test |
|---|---|---|---|---|---|
| M-1 | Student A | A | read own counseling requests | allow | server (getStudentRequests, own student_id) |
| M-2 | Student A | A | list bookable professors | allow, only A's professors | server (getCounselingProfessors tenant scope) |
| M-3 | Student A | B | list bookable professors | professor B absent | server (X2) |
| M-4 | Student A | A | create reservation w/ Professor A | allow | server + DB WITH CHECK (X1) |
| M-5 | Student A | B | create reservation w/ Professor B | deny (SLOT_NOT_AVAILABLE) | server boundary (X1) |
| M-6 | Student A | B | create reservation w/ Professor B via crafted slotId (IDOR) | deny | server boundary — professor not in tenant availability |
| M-7 | Student A | B | direct authenticated INSERT of a B reservation (bypass UI) | deny (RLS check) | DB backstop (counseling INSERT WITH CHECK) |
| M-8 | Professor A | A | approve own-tenant pending request | allow | server (updateCounselingStatus, own professor_id) |
| M-9 | Professor A | B | approve B's request (crafted requestId, IDOR) | deny (0-row PGRST116 conflict) | server (X4 — professor_id+tenant predicate) |
| M-10 | Professor A | B | updateCounselingDetails on B's request | deny | server (X4) |
| M-11 | Assistant A | B | answer B's escalation via RPC | deny (unauthorized) | DB RPC tenant predicate (X6) |
| M-12 | Student A | A | busy feed reflects A's reservations | allow, foreign B rows inert | domain engine (D-011 preserved, X11) |
| M-13 | two students | A vs B | identical 10:00 bookings coexist | both allowed, no GiST conflict | Stage 5 invariant under tenancy (§12) |
| M-14 | Student A | A + B | same-tenant overbooking still blocked | second A booking of same slot denied | Stage 5 GiST unchanged (§12) |
| M-15 | Student A | (community) | create post | post.school_id = A from session, not client form | server (X9) |
| M-16 | admin A | A | broadcast notification | school_id = A stamped | server (X5) |
| M-17 | Student A | A | cancel own request | allow | server (D-014, own student_id) |
| M-18 | Student A | B | cancel B's request (crafted id) | deny | server (D-014 ownership already scopes) |

## Coverage layers (spec §14)

- Server action / service (primary enforced boundary): M-1…M-6, M-8…M-10,
  M-12, M-15…M-18. Deterministic fixture, RED→GREEN.
- DB / RLS path: M-7 (counseling INSERT WITH CHECK), M-11 (RPC), verified
  live where feasible via `set local role authenticated` +
  `request.jwt.claims`, else documented with the policy/RPC definition as
  evidence and marked accordingly.
- Domain engine invariants: M-12, M-13, M-14 (Stage 5 preservation).
- IDOR / direct-object (spec §15): M-6, M-9, M-10, M-18 — the ID is supplied
  directly; rejection is by tenant/ownership, not UI concealment.

## Red → Green protocol (spec §26)

For each confirmed-leak row: write the cross-tenant test against the CURRENT
code → observe RED (the leak is real, e.g. Student A CAN book Professor B) →
apply the minimal tenant enforcement → GREEN → run the same-tenant
regression (M-1, M-4, M-8, M-13, M-14, M-17) to prove legitimate operations
still work. Uses the two-tenant fixture, not queries for nonexistent ids.

## What this suite does NOT prove (honest scope — spec §31)

- The anon-role direct-PostgREST vectors on demo-era tables (AUDIT §7.5) are
  NOT closed by Stage 6 and are NOT asserted green here; they are documented
  in KNOWN_ISSUES as Stage 9. The counseling booking path IS closed at both
  the server boundary and the DB WITH CHECK; the professor status/details
  writes are closed at the server boundary (service-role client, so no RLS
  layer applies — the app predicate is the boundary).
- Unscoped professor-report reads (KI-016) and roadmap-revision reads
  (KI-017) are scoped where a one-line tenant filter is safe; anything
  requiring the Stage 9 RLS rewrite is left documented, not falsely asserted.
