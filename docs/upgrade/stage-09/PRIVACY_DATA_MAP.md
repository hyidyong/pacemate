# Stage 9 — Privacy Data Map

An **engineering** privacy audit: what personal data exists, why, who can reach
it, where it goes, and whether it can be removed. **No compliance claim is made
here** — nothing in this document asserts GDPR, PIPA, ISO or any other
certification, and none has been assessed.

"Who can read" reflects the state **after** the Stage 9 migrations.

## 1. Inventory

| Data | Location | Purpose (code) | Owner | Who can read | In logs? | Retention | Deletion path | Processor |
|---|---|---|---|---|---|---|---|---|
| Email / login handle | `profiles.identifier` | authentication (`demo-auth.service.ts:72`), SSO linking (`sso-callback.service.ts:178`) | user + tenant | self; same-tenant authenticated | No — explicitly excluded from the log allowlist (`log.ts`) | none | **none** | — |
| Display name | `profiles.name` | UI, counseling lists | user + tenant | self; same tenant | No | none | **none** | — |
| Role / tenant / department | `profiles.role`, `school_id`, `department_id` | authorization, tenant scoping | tenant | self; same tenant | `tenantId` only (opaque uuid, allowlisted) | none | **none** | — |
| Dead credential column | `profiles.password_hash` | **none — zero references in `src/` or migrations** | — | same tenant | No | none | n/a | — |
| Career goal, interests, self-declared weaknesses, free-text completed-courses transcript | `student_profiles.target_career`, `interests`, `weak_basics`, `completed_courses_text` | onboarding; AI personalization | user | **self only** (was: anon) | No | none | RLS delete policy exists; no UI calls it | **OpenAI** |
| Private study note | `student_weekly_progress.private_note` | AI input, consent-gated by `use_private_note_for_ai` | user | service role only — column grant deliberately withheld from `authenticated` (`20260714223924`) | No | none | **none** | OpenAI (consent-gated) |
| Feedback shared with professor | `student_weekly_progress.shared_feedback`, `professor_memo` | professor aggregate | user → professor | professor of the offering (column grants) | No | none | **none** | — |
| Counseling topic and professor note | `counseling_requests.topic`, `professor_note`, `location` | the counseling workflow | user + professor | the two participants (was: **anon**) | No | none | cancel is a status change, not a delete | — |
| AI tutor conversations | `chat_sessions.title` (first 80 chars of the question), `chat_messages.content` | tutor history | user | self | No | none | `deleteAiTutorSession` — hard delete | **OpenAI** |
| Questions to professors | `escalations.question`, `answer` | question workflow | user / staff | own; own professor; **same-tenant** assistant (was: any assistant) | No | none | **none** | OpenAI (as evidence) |
| Weekly progress feedback | `student_mission_progress.actual_progress_feedback` | AI calibration | user | self (was: **anon, `using (true)`**) | No | none | **none** | OpenAI |
| Community posts / comments, pseudonymous alias | `posts`, `comments` | community | user + tenant | same tenant, matching community | No | none | soft delete (`status`) | — |
| Professor contact details | `professors.email`, `phone`, `office` | directory | tenant | same tenant (was: **anon**) | No | none | **none** | — |
| Uploaded syllabus text and file | `syllabi.raw_extracted_text`, `parsed_data`; storage bucket `syllabus-files` | course material, AI grounding | tenant | same tenant (was: **anon**) | No | none | object removed only on insert rollback | OpenAI |
| Support submissions | `user_notifications.title`, `body` | operations inbox | tenant (or none, anonymous) | recipient / same-tenant role | No | none | **none** | — |
| SSO subject | not persisted raw | identity linking | user | — | Only as a 16-hex truncated hash (`sso-audit.ts`) | n/a | n/a | — |
| Security audit records | `security_events` | privileged-action history | tenant | tenant admin only | Mirrored to stdout | none defined | none (append-oriented by design) | — |

## 2. What changed for privacy this stage

Before Stage 9 an unauthenticated caller could read, in full: every profile (27
rows: name, email, role, tenant), every `student_profiles` row (career goals,
self-declared weaknesses, transcript text), every enrolment, every syllabus
including extracted text, every professor's contact details, and all counseling
availability. All of that now requires a session, and most of it requires being
in the same university.

## 3. AI / external data flow

One external processor: **OpenAI** (`api.openai.com/v1/chat/completions`,
`gpt-4o-mini`), five call sites. No user identifier is sent (no `user` field),
so nothing pseudonymous leaves — which also means there is no abuse attribution.

| Call site | What goes in the prompt | Minimised? | Timeout |
|---|---|---|---|
| `ai-tutor.actions.ts` | course name/description, syllabus text, week, the student's own feedback, **plus `interests` and `target_career`** | **No** — a syllabus-progress prediction does not need a career goal. Recorded in KI-022. | 20 s |
| `ai-tutor-rag.actions.ts` | question + course evidence only | **Yes** — the model to follow | 12 s |
| `student-course-study-guide.server.ts` | syllabus, onboarding data, weekly log; `privateNote` **only when `use_private_note_for_ai`** | Partly — the consent gate on the private note is right; `completed_courses_text` has no equivalent gate | 20 s |
| `personalized-weekly-roadmap.server.ts` | baseline plan, professor notes, **the whole onboarding row** | **No** — whole-row pass-through | **Added this stage** (20 s; it was the one unbounded call) |
| `professor-grounded-answer.server.ts` | question + professor-owned course evidence; not stored | Yes | — |

The two over-broad payloads are recorded rather than changed: narrowing them
alters what the model is given and therefore what students see, which is a
product-behaviour change outside a security stage's charter. The consent
mechanism to extend already exists in the same file.

`OPENAI_API_KEY` cannot leak client-side: every call site is `"use server"` or
`import "server-only"`, and `next.config.mjs` declares no `env` block.

## 4. Logging

`src/lib/observability/log.ts` enforces a 10-field allowlist at runtime
(unknown keys are dropped, not just type-errored), and `profiles.identifier` is
explicitly excluded. That allowlist governs the structured emitter.

**It does not govern the ~110 raw `console.*` sites.** Several of those log a
whole `PostgrestError` from queries over the most sensitive tables in the
schema, and a Postgres `detail`/`hint` can embed row values. The worst
offenders are named in KI-022 with file:line. One was fixed this stage
(`admin-notifications.actions.ts`, which now records a classified event with the
error *code* instead of the object). The rest are a mechanical substitution
against an existing helper and are recorded, not silently carried.

Verified absent from every log site: passwords, access/refresh tokens,
service-role keys, authorization codes, raw SSO assertions.

## 5. Erasure, retention, export

- The only user-invocable deletion of personal content in the entire
  application is `deleteAiTutorSession`.
- There is **no account deletion, no data export, and no retention job**
  anywhere in the repository.
- Counseling cancellation is a status transition; community deletion is soft.

This is recorded as **KI-022 (P1)**. It was not built in Stage 9 because a
correct erasure path requires auditing cascade behaviour across ~20 FK
relationships (`schema.sql` mixes `on delete cascade` and `on delete set null`)
plus the storage bucket, and doing that safely needs a non-production database
to rehearse against — which does not exist (D-3).

## 6. Client-side retention

| Key | Contents | Profile-keyed? | Cleared on logout? |
|---|---|---|---|
| `pacemate_student_todos` / `_todo_done` | student-authored to-dos | **No** | **No** |
| `pacemate.dismissed-course-notices.v1` | dismissed notice ids (reveals enrolment) | **No** | **No** |
| `pacemate-community-draft-<profileId>` | unsent post title + body | Yes | No (cleared on submit) |
| zustand `cachedSessions` | AI question titles | n/a | No (memory-only; survives the client-side logout navigation) |

On a shared lab machine the first three bleed between accounts. Recorded in
KI-022 (carried from KI-019); the fix is a `clearClientState()` on logout plus
namespacing, which is a UI change.

## 7. Secrets

Working tree and full git history were searched (`git log --all -S`,
`git log --all --full-history -- .env.local`, and a regex sweep for
`sk-`, `eyJ`, `sb_secret`, `service_role`).

- `.env.local` was **never committed**. `git ls-files` shows only
  `.env.local.example`.
- The only key-shaped literal in the repo is the Supabase **publishable** key in
  `.env.local.example` — an intentionally public client identifier, **not a
  secret**, and correctly not treated as one.
- The two test fixtures matching `eyJhbGciOi...` are negative assertions proving
  tokens are dropped from logs.

**No secret was found in git history. No rotation is required by anything in
this sweep.**

One credential exposure *was* real and is fixed: `src/config/demo-users.json`
(four plaintext passwords including `admin1@pacemate.edu`) was imported by a
`"use client"` component and was verifiably present in the built client bundle.
It is now behind `import "server-only"` and an environment gate, and its absence
from `.next/static/**` is verified. **Those four passwords should still be
rotated** — they belong to live Supabase Auth users and were publicly readable
for as long as the site was deployed. That is an operator action; the procedure
is in RECOVERY_RUNBOOK.md §3.4.

## 8. Dependency risk

`npm audit`: 6 high, 0 critical.

| Package | Classification |
|---|---|
| `next` 15.5.20 → 15.5.21 | **Requires upgrade, patch level.** GHSA-955p (unauthenticated disclosure of internal Server Function endpoints) is directly relevant to an app that authorizes at the action boundary. The SSRF and image advisories are **not applicable** (no custom server, no rewrites, no `images` config). Not bumped in this stage: a framework upgrade during an RLS overhaul makes a regression un-attributable. Recorded in KI-022 as the first Stage 10 action. |
| `postcss`, `sharp`, `nanoid` | transitive, non-reachable (build-time only / remote image optimization disabled / no attacker-controlled `size`) — defer |
| `js-yaml`, `brace-expansion` | dev-only — defer |
| `pdf-parse@1.1.1` | **Not flagged by `npm audit`, and the highest real risk.** Unmaintained since 2021; it *vendors* pdf.js `v1.10.100` (2018), which predates CVE-2024-4367. Professor-uploaded PDFs are parsed in a process holding the service-role key, with no page cap and no timeout. Recorded in KI-022 with a two-line mitigation (`{ max: 40 }` + a race timeout) that does not require a dependency change. |
