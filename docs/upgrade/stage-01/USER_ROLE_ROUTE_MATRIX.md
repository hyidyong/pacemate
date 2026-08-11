# Stage 1 — User Role / Route Matrix (from code, 2026-08-11)

Roles come from the `user_role` enum (`supabase/schema.sql:3-11`) stored in `profiles.role`:
`student | professor | assistant | admin`. No other roles exist. Role checks: `src/services/role-guard.service.ts` (page redirects) + per-action checks inside server actions. `assistant` (조교) mostly shares professor surfaces (e.g. FAQ answers get "[조교 답변]" prefix, professor.actions.ts:178-179).

| Role | Route | Permission | Primary action | Mobile importance | Notes |
|---|---|---|---|---|---|
| (anon) | `/` | public | landing → login | Medium | |
| (anon) | `/login` | public; authed users redirected by role | demo/password login | High | `login/page.tsx:36-38` getRoleHomePath |
| student | `/dashboard` | redirectNonStudent | today's timetable, todos, counseling status, notices | High (bottom-nav tab) | error/empty conflation on cards |
| student | `/onboarding` | student | initial profile/curriculum setup | High | two department variants |
| student | `/mypage` | redirectNonStudent (`mypage/page.tsx:15`) | manage timetable (add/remove courses, custom slots, favorites, todos) | High (bottom-nav tab) | optimistic UI + conflict warnings |
| student | `/roadmap`, `/roadmap/[courseId]` | student | weekly study roadmap review | High (bottom-nav tab) | |
| student | `/courses`, `/courses/[id]` | student | browse, favorite, register courses | Medium (hamburger only on mobile) | shares addCourseToSchedule with mypage |
| student | `/counseling` | redirectNonStudent (`counseling/page.tsx:11`) | view available slots, request counseling, re-book suggested time | Medium (hamburger only on mobile) | slot list capped at 48; no cancel action |
| student | `/chatbot` | student | AI tutor chat | High (bottom-nav tab) | Zustand session cache |
| student | `/community`, `/reviews`, `/ask`, `/notices`, `/support` | student | boards/forms | Medium | |
| student | `/notifications`, `/notifications/settings` | authed | read notifications, prefs | Medium | realtime INSERT subscription |
| professor | `/professor` (tabs via `?tab=&sub=`) | professor/assistant | calendar (availability/blackouts), counseling requests approve/reject+suggest, questions, weekly plans | High (dedicated mobile bottom nav) | calendar uses duplicate availability engine |
| professor | `/professor/lounge`, `/professor/mypage`, `/professor/weekly-plan-preview` | professor | community/profile/plan preview | Medium | |
| assistant | `/professor` (subset) | assistant | answer FAQs/questions | Low | |
| admin | `/admin` | role check in action (`profile.role !== "admin"`) | broadcast notifications to student/professor groups | Low | service-role client |

## Mobile navigation gaps (baseline fact, not a Stage 1 fix)

Student mobile bottom nav = `/dashboard, /roadmap, /chatbot, /mypage` only (`mobile-bottom-nav.tsx:7-12`).
`/counseling`, `/courses`, `/community` are hamburger-only on mobile — relevant to Stage 4.
