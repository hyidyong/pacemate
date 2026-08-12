# Stage 8 — Observability Design

Scope: make important flows visible to an operator without adding an APM
vendor, a metrics backend, or a tracing system that the measured evidence does
not justify. Everything here is zero-dependency and Next-native.

---

## 1. What exists today (audited, not assumed)

| Capability | State |
|---|---|
| Structured logging | **none** — 70 `console.*` calls across 28 production files, free-form strings |
| Metrics | **none** — no prom-client, no OpenTelemetry, no `@vercel/analytics` |
| Tracing | **none** |
| `instrumentation.ts` / `onRequestError` | **absent** |
| Request / correlation id | **none** |
| Error boundary | `src/app/error.tsx` only; no `global-error.tsx`. Its `console.error` is `"use client"` — it logs in the **user's browser**, not to the server |
| Security audit trail | `src/lib/sso/sso-audit.ts` — well-shaped, allowlisted, pseudonymous, but sinks to `console.info` only |
| Silent failures | ~40 bare `catch {}`; 12 page-level `.catch(() => default)` fallbacks (KI-003 family) |

### The failure that motivates this work

`src/services/counseling.actions.ts:82-84`:

```ts
try {
  availableSlots = await getAvailableCounselingSlots(tenant.tenantId);
} catch {
  return { ok: false, message: SLOT_NOT_AVAILABLE_MESSAGE };
}
```

A Supabase outage during booking is caught, **logged nowhere**, and reported to
the user with the *business-conflict* message "선택한 상담 시간을 예약할 수
없습니다" — i.e. "someone took that slot". The operator sees nothing at all;
the user is told a falsehood. This single site is the clearest argument for
both structured logging and error classification, and it is on the platform's
most correctness-critical path.

Reproduced independently during harness development: when the session client
degrades to the `anon` role, `/counseling` renders its error fallback with zero
slots and the only trace is an unstructured `Counseling page data could not be
loaded` line — indistinguishable, in aggregate, from a professor having no
availability.

---

## 2. Design principles

1. **Log-based, not agent-based.** Vercel captures stdout; structured JSON
   lines are queryable there and drainable to any sink later. No vendor.
2. **One helper, allowlisted fields.** Generalize the discipline
   `sso-audit.ts` already proves works, rather than inventing a second one.
3. **Classify, don't just record.** A booking conflict is not a fault. If logs
   cannot distinguish them, neither can an alert.
4. **Correlate cheaply.** One id, minted once per request, carried on every
   line — no distributed tracing machinery.
5. **Never log secrets or unnecessary PII** (stage brief §16).

---

## 3. Structured log event

`src/lib/observability/log.ts` — a pure function plus a thin emitter.

```
{ ts, level, event, requestId?, route?, tenantId?, profileId?,
  outcome?, category?, code?, durationMs?, detail? }
```

- `level` — `info` | `warn` | `error`
- `event` — stable machine name (`booking.conflict`, `booking.storage_failure`,
  `auth.login_denied`, `page.data_unavailable`, `sso.login_denied`)
- `outcome` — `ok` | `conflict` | `denied` | `fault`
- `category` — the error taxonomy of §5
- `code` — Postgres/PostgREST code (`23P01`, `PGRST116`, `42501`) where present

**Field allowlist enforced in code**, mirroring `sso-audit.ts:38-45`: unknown
keys are dropped rather than serialized, so a future caller cannot casually
widen the log surface.

### Safe vs forbidden fields

| Safe | Forbidden |
|---|---|
| `requestId`, `route`, `event`, `outcome`, `category`, `code`, `durationMs` | passwords, access/refresh tokens, client secrets |
| `tenantId` (`schools.id` uuid) | authorization codes, raw SSO assertions |
| `profileId` (`profiles.id` uuid — pseudonymous) | cookies, session tokens |
| `subjectHash` (already sha256-truncated) | `profiles.identifier` — **it is the email** |
| counts, durations | display names, notification bodies, raw Supabase `detail` strings (can embed row values), third-party error bodies |

Note `profiles.identifier` doubles as the login email
(`sso-callback.service.ts` links by it), so it is PII and never logged; the
profile **uuid** is the correct identifier.

---

## 4. Correlation id

Minted in `src/middleware.ts`, which already runs on every non-static request
and already rebuilds the request via `NextResponse.next({ request })` in
`src/lib/supabase/proxy.ts:16,31` — so a header can be attached with no new
machinery.

```
middleware → x-pacemate-request-id → server component / server action
           → structured log lines → (future) durable sink
```

Server code reads it via `headers()`. If Vercel's own `x-vercel-id` is
present it is reused rather than minting a second id (UNVERIFIED whether it is
exposed in this runtime — the helper prefers it when present and falls back to
`crypto.randomUUID()`).

**User-facing exposure:** the booking success message already surfaces a
receipt fragment — `data.id.slice(0, 8)` at `counseling.actions.ts:159` — which
is a *row* id, not a request id. Stage 8 does not add a user-visible support
id; the stage brief permits one but nothing in the evidence requires it, and
adding it would change UI copy (Stage 4 charter).

---

## 5. Error classification

The taxonomy that makes alerting possible. Derived from the existing vocabulary
rather than invented:

| Category | Meaning | Alert on it? | Examples |
|---|---|---|---|
| `business_conflict` | the system worked; the answer is "no" | **No** (track the rate) | slot already taken (23P01/23505), "이미 처리된 상담 신청", cancel CAS miss (PGRST116) |
| `user_error` | invalid input or insufficient role | No | validation failures, "로그인한 학생만…" |
| `authz_denied` | authorization refusal | Rate only | SSO deny reasons, tenant mismatch |
| `system_fault` | the system failed | **Yes** | insert returned no row, Supabase unreachable, unhandled render throw |

The stage brief's rule — "slot already taken should not necessarily count as a
server fault" — is exactly this split. Today it is unrepresentable: conflicts
and faults both return `{ ok: false }` with a Korean string, and the fault case
at `counseling.actions.ts:82` is *mislabelled as a conflict*.

---

## 6. Metrics — log-derived, no backend

No metrics system is introduced. Each indicator below is a count/aggregate over
structured log events, computable in Vercel logs or any drain:

| Indicator | Source event |
|---|---|
| request count, p95 route latency | `http.request` (`durationMs`, `route`) |
| error rate (faults only) | `outcome=fault` ÷ total |
| booking success / conflict / failure | `booking.*` with `outcome` |
| auth failure rate | `auth.login_denied` |
| tenant authorization failures | `outcome=denied` with `tenantId` |
| DB latency proxy | `durationMs` on data-fetch events |
| rate-limit events | reserved — none implemented this stage |

### Suggested alert thresholds

Per the stage brief's §18 caution, thresholds are **not fabricated**. The only
baseline that exists is §2 of `SCALE_AUDIT.md` (single instance, c≤10, demo
data volume), which is not a production baseline. Recorded instead:

- **Directional, safe now:** any `system_fault` on the booking path is
  page-worthy (measured rate today: zero across all load runs); `outcome=fault`
  rate > 1% sustained is abnormal (measured today: 0%).
- **Requires production baseline before a number is set:** p95 route latency,
  booking conflict rate (a legitimately busy reservation window produces a high
  conflict rate by design), auth failure rate.

---

## 7. Tracing

**Not implemented, deliberately.** The stage brief says not to add tracing
complexity where logs and metrics suffice. The request path here is short
(middleware → RSC/action → PostgREST) and single-process; a correlation id on
structured logs reconstructs it. Distributed tracing would be justified when
services multiply — nothing in the measurements suggests that now.

---

## 8. Durable audit sink (KI-020 input)

`emitSsoAuditEvent` is the correct seam and its event shape needs no change.
What a durable sink requires, recorded as a design decision for whoever
implements it:

- A table (`identity_audit_events`) written with the admin client.
- A **fail-open** policy: an audit-insert failure must not fail a login
  (availability over completeness), with the console line retained as fallback.
  The alternative (fail-closed) is defensible for a security log but would let
  a DB hiccup lock every user out — the wrong trade for an availability-
  sensitive path.
- Making the emitter `async` ripples into `sso-callback.service.ts`.

Stage 8 does **not** create the table: no real IdP is connected (Stage 7
BLOCKED), so the durable trail would record only synthetic events, and the
KNOWN_ISSUES note assigns the outbox family to Stage 8/9 jointly. Stage 8
delivers the structured-logging foundation the sink will use, and the
unstructured `console.info` is replaced by a structured event so the migration
is a sink swap rather than a rewrite.

---

## 9. Implemented in Stage 8

1. `src/lib/observability/log.ts` — allowlisted structured event + emitter.
2. `src/middleware.ts` — request id minted and forwarded.
3. `src/instrumentation.ts` — `onRequestError` so server-side errors reach
   stdout as structured events (currently they reach only Next's default
   digest line, and `error.tsx` logs client-side).
4. Booking path — the silent `catch {}` at `counseling.actions.ts:82` gains a
   classified log and stops masquerading as a conflict.
5. Login denial — `demo-auth.service.ts` `rejectLogin` gains an
   `auth.login_denied` event (today brute force leaves no server trace).
6. `sso-audit.ts` — emits through the shared structured logger.

Explicitly **not** implemented: metrics backend, tracing, log drain
configuration (deployment-side), rewriting all 70 `console.*` sites (out of
scope churn — the helper plus the highest-value call sites establish the
pattern; the remainder is recorded in KNOWN_ISSUES).
