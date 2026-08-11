# Stage 2 — Availability Domain / Single Source of Truth — SPEC

## Goal

All parts of the application must interpret scheduling availability through the same
canonical domain rules. Timetable, counseling application, professor calendar, booking
validation, and any other availability consumer must no longer independently interpret
what "available"/"bookable" means.

## Problem statement (from Stage 1 evidence)

Stage 1 (docs/upgrade/stage-01/SLOT_DATAFLOW.md, SLOT_BUG_REPRODUCTION.md) established:

1. Two independent availability engines exist:
   - `buildAvailableCounselingSlots` (src/lib/counseling-slots.ts) — canonical, tested,
     Asia/Seoul-correct. Drives the student counseling page and the authoritative
     booking re-validation in `createCounselingRequest`.
   - `calculateRecommendedAvailability` (src/lib/calendar-utils.ts) — duplicate engine
     for the professor calendar. Stage 1 fixed two of its divergences (pending-request
     busy filter, inactive-row overlap blackout) but the remaining divergences are
     structural:
     - (R3) hard-coded Mon–Fri 09:00–18:00 30-min grid that labels ALL free time
       "상담 가능 / 상담 예약이 가능한 시간입니다" even when the professor has declared no
       `professor_availability` windows — students see 0 bookable slots while the
       professor sees ~85 "상담 가능" chunks (reproduced live in Stage 1);
     - (R4) browser-local timezone (`Date.getDay/getHours`) instead of Asia/Seoul.
2. Additional divergent time/policy logic exists in `src/lib/scheduling-policy.ts`
   (browser/server-local Date helpers) and `today-timetable-widget.tsx`.

## In scope

- Define the canonical availability vocabulary (slot identity, available, bookable,
  visible, blocked) and reservation-status semantics from repository evidence.
- Extract/establish one canonical availability domain that both the student flow and
  the professor calendar consume.
- Distinguish "declared bookable time" (student-facing truth) from "undeclared free
  time" (professor-facing scheduling aid) as two explicit domain concepts instead of
  conflating both into "상담 가능".
- Keep the authoritative booking path (`createCounselingRequest` re-validation + DB
  exclusion constraint) on the same canonical semantics.
- Normalize scheduling time handling to Asia/Seoul at one explicit boundary.
- Characterization + contract tests; cross-consumer semantic regression test.

## Out of scope (deferred)

- Stage 3 performance work (query dedup/caching beyond direct canonicalization fallout).
- Stage 4 UI/UX redesign (presentation polish of the calendar beyond the minimum
  label/semantic correction required for correctness).
- Stage 5 concurrency/transaction architecture (the existing GiST exclusion constraint
  remains the race guard).
- Stage 6/7 multi-tenancy, SSO.
- RLS policy redesign (KI-006/KI-007/KI-011 DB-layer work) unless a Stage 2 change
  cannot be made safely without it.

## Success criteria (exit gate summary)

- One canonical availability domain; professor calendar and student flow consume it.
- Given the same inputs, student-side bookable slots == professor-side
  "student-bookable" times == booking-eligibility semantics (automated regression test
  on slot identities, not counts).
- Undeclared free time is no longer labeled as student-bookable.
- Scheduling code paths use Asia/Seoul semantics regardless of browser/server timezone.
- Existing UI layout/interaction preserved; no API contract breaks.
- Full validation evidence recorded (tests, typecheck, lint, build, rendered QA).
