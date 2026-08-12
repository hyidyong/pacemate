# Stage 4 — UX Audit (Role × Route × Device)

Status: COMPLETE (2026-08-12). Combined rendered-behavior audit (production
build, live Supabase, desktop 1280×720 + mobile 375×812) and four parallel
read-only source audits (A: student flows, B: professor/assistant/admin flows,
C: mobile/responsive, D: accessibility/consistency).

Finding IDs: `R-*` = rendered-verified by the lead session; `A-* / B-* / C-* /
D-*` = source-audit findings (rendered-confirmed where noted). Severity: P0
blocks task or availability-correctness display; P1 major friction; P2
moderate; P3 polish.

## 1. Method and coverage

- Production build (`npm run build` on 3726489), `npm start`, live Supabase.
- Logged in and audited all four real roles via the QA demo login panel:
  김학생 (student), 이교수 (professor), 박조교 (assistant), 최관리자 (admin).
  Roles are the `user_role` enum — no others exist (Stage 1 matrix).
- Rendered inspection: accessibility tree, DOM geometry measurements
  (element sizes, `elementFromPoint` hit-testing, overflow arithmetic),
  interaction tests (slot selection, drawer, Escape), console monitoring
  (zero console errors across the whole session).
- Source audits: every student route; the whole professor workspace (1,669-line
  client component + calendar + report), admin; the breakpoint system; the
  shared-component inventory.

## 2. Top findings — Role × Route × Device matrix

| # | Role | Route/Flow | Primary task | Desktop issue | Mobile issue | Sev | Proposed improvement |
|---|------|-----------|--------------|---------------|--------------|-----|----------------------|
| R-1 (=C-8, A-21) | student | /mypage timetable | manage courses | delete affordance hover-only, unlabeled 26px button | **center-tap on a course cell hits an invisible full-cell delete overlay → instant unconfirmed removal** (elementFromPoint-proven); no delete path visible on touch | **P0** | visible touch affordance + confirmation; keyboard/focus support |
| B-1 | professor | ?tab=counseling | approve/reject requests | **`runAction` ignores `result.ok`: failures render as green success and the request card disappears from the queue** | same | **P0** | branch on ok; failure toast; only mutate list on success |
| A-2 | student | /counseling | book a slot | **global 48-slot cap is applied across ALL professors before per-professor filtering → a professor with real availability can render "no slots"** | same | **P0** | cap per professor (RED test first — availability display correctness) |
| A-3 (=KI-004) | student | /counseling | pick a date | month grid derived from first slot, **no month paging; slots past the 42-cell grid are silently unreachable** (rendered-confirmed: 42 cells, 0 nav controls) | same | **P0** | derive months from slot range + prev/next controls |
| A-1 | student | /community | read answers | **comments can be written and counted but are never rendered anywhere; `getPostComments` is never called** — Q&A is write-only | same | **P0** | fetch + render comment list for the selected post |
| C-3 | student | mobile drawer | navigate | — | drawer's 고객센터/마이페이지 CTAs render **under** the z-50 bottom nav (drawer z-40) | P1 | z/padding fix |
| C-1 (=A-31) | student | /community | reach community | — | **커뮤니티 unreachable on mobile**: not in bottom nav, not in drawer (rendered-confirmed) | P1 | add to mobile menu routes |
| C-2 | student | /roadmap | navigate away | — | on /roadmap the drawer **replaces** the site menu with roadmap anchors → 과목/상담/후기 unreachable | P1 | append, don't replace |
| C-7 | student | /mypage timetable | read timetable | — | 7 day columns × **39px** at 375px (32px at 320px), 11px break-all text ≈ 2 glyphs/line; no horizontal scroll (overflow-hidden) | P1 | overflow-x-auto + min-width grid |
| C-9 (=B-14) | professor | ?tab=schedule calendar | manage week | 82 identical "상담 미개방" text blocks (visual noise) | grid hard-coded `50px repeat(5,1fr)`: **36px day columns, 31×50px slot buttons** with 2 lines of clipped text (rendered-measured) | P1 | overflow-x-auto + min-width; reduce label noise |
| B-24 | professor/assistant | /professor | identity | **silent impersonation**: 이교수 login renders 김재두's workspace (first-professor fallback) — rendered-confirmed; the student's real pending request (to 박성은) is unreachable by any professor login | same | P1 | defer root fix (Stage 6/9 identity linkage) — record KI; UI must not silently claim another identity |
| B-5 | professor | ?tab=counseling | see queue | pending queue + log share one **12-row oldest-first window across all statuses** → new pending requests can be invisible | same | P1 | defer query change to KI (Stage 5/8); note in UI |
| C-24 | all | dialogs | any dialog task | no max-height: tall dialogs clip top+bottom symmetrically, unreachable | worse with soft keyboard (visual viewport ~400px) | P1 | DialogContent max-h + overflow-y-auto |
| C-28 | all | app-wide | notched devices | — | `viewport-fit=cover` never set → **all 11 `env(safe-area-inset-*)` rules resolve to 0** | P1 | set viewportFit in layout viewport export |
| C-13 | student | /courses dialog | add course times | — | unprefixed 5-col grid with two `input[type=time]` overflows a 320px dialog (sibling component has the `sm:` prefix) | P1 | add `sm:` prefix |
| A-4 | student | /ask | read professor answers | **no inbound link anywhere** to the only page showing answers | same | P1 | add nav/success-state link |
| A-5 | student | /roadmap/[courseId] | per-course roadmap | detail page orphaned (only linked from an unmounted component) | same | P1 | link offerings → detail |
| A-8/A-9 | student | /onboarding | complete setup | error shows literal `required` / raw Postgres text; full form state wiped; no pending state (double-submit open) | same | P1 | message map + pending state |
| A-15 (=D-10) | student | /courses | register/favorite | `window.alert()` feedback; card never refreshes → invites double registration | same | P1 | inline feedback + router.refresh() |
| A-13/A-14 | student | /ask, /reviews | submit | list never refreshes after submit (looks like it failed); /ask toast never dismisses (covers bottom nav) | same | P1 | router.refresh() + timeout |
| KI-004 | student | /counseling | after booking | slot list/requests stale (no router.refresh) — booking looks unconfirmed until navigation | same | P1 | refresh after success + clear selection |
| A-6/A-7 | student | /mypage | feedback | feedback banner only renders in 시간표 section (invisible from 찜/투두 tabs); 9 English error strings in Korean UI | same | P1 | hoist banner; translate |
| D-14 (=A-17,C-18) | student | /dashboard | first screen | carousel auto-advances every 2.5s, no pause, no reduced-motion; 10×10px dots (KI-009) | same + moving 10px targets | P1 | pause control + reduced-motion + bigger targets |
| B-13 | professor | calendar | trust | **fake button**: 샘플 시간표 불러오기 alerts "loaded" and does nothing | same | P1 | delete it |
| B-2 | professor | reject flow | suggest time | field labeled "(선택)" is server-required; free-text format silently dropped on parse failure | same | P1 | datetime-local + required + honest label |
| B-18 | assistant | /professor | navigate | — | **assistant has no workspace navigation on mobile** (operator nav only — rendered-confirmed) | P1 | treat assistant as professor for shell chrome |
| B-32 | professor | ?tab=report | act on data | rows labeled 담당 강의 1 / 강의 1 / 학생 1..5 — **no course or student identifiers** (rendered-confirmed); also unscoped to professor (KI-016) | same | P1 | use real names present in payload; scoping stays KI-016 |
| D-1 | all | 4 routes | screen-reader nav | nested `<main>` landmarks (community, reviews, lounge, weekly-plan-preview) | same | P1 | main→div/section + extend guard test |
| D-2/D-3 | all | 10+ controls | icon buttons | unnamed icon-only buttons (chat send, week nav, closes); chat session delete is a span-in-button, hover-only | keyboard/SR-inaccessible; touch-invisible | P1 | aria-labels; real button |
| D-11 | all | inputs | keyboard | focus outline removed with no replacement (2 globals.css rules, chat fields); `.button` has no :focus-visible/:disabled styles | same | P1 | restore focus-visible; add disabled style |
| D-6 | student | /counseling search | find professor | professor-search input has empty accessible name (icon-only label) | same | P1 | aria-label (pattern exists) |
| A-29 (=D-5) | student | dashboard notification modal | read/confirm | backdrop `bg-black` fully opaque; promises "시간표에 추가" but only navigates; no dialog role/Escape | same | P1 | translucent backdrop; honest copy; dialog semantics |
| KI-003 | student | 6 routes | trust empty states | fetch failures render as empty data (counseling/mypage/roadmap/chatbot/notices/dashboard); 4 other routes crash to global error.tsx | same | P1 | shared inline error state w/ retry on the .catch sites |
| KI-016 | all | all routes | perceive loading | zero loading.tsx anywhere — every nav blocks on full SSR with frozen previous page (268–852ms measured) | same | P1 | loading.tsx skeletons for top routes |
| A-10 (=C-39,D-16) | student | /chatbot | send message | — | course select `hidden md:block` while send button requires it → mobile students locked to first course; dead send with no explanation | P1 | show compact selector on mobile |
| C-26 | student | notification menu | read | — | fixed `w-80` dropdown: 13px clipped at 375px, 68px at 320px (overflow-x: clip = unreachable) | P1 | clamp width |
| B-35/B-36 | professor | weekly-plan-preview | review 15 weeks | per-week 저장 saves nothing (local only); 취소 resets ALL weeks; final approval unconfirmed, no pending state | same | P1 | scope cancel to one week; confirm approval |
| B-42/B-43 | admin | /admin | approve/reject | zero feedback on any approval action (void returns); 반려 unconfirmed, can't carry a reason | same | P1 | return {ok,message} + render |
| C-17/C-19/C-11 (=KI-009) | student | dashboard | touch | — | 10×10 dots, 24×24 공지 닫기, ~20px 마이페이지에서 관리 links | P2 | expand hit areas |
| C-20 | all | dialogs | close | 16×16px close target on every Radix dialog | same | P2 | p-2 -m-2 in one shared file |
| C-33/C-34 | all | app chrome | — | — | double bottom padding (~166px dead space) below 620px; site footer (약관/사업자 정보) `display:none !important` on mobile | P2 | consolidate padding; restore footer |
| D-12 | student | counseling/mypage tabs | — | tablist without tab roles (counseling); aria-label on role-less div | same | P2 | copy dashboard tabs pattern |
| B-12 | professor | calendar legend | read states | 상담 불가 (blackout) missing from legend; swatch colors ≠ block colors | same | P2 | complete legend, reuse block classes |
| D-2.6 | all | messages | trust feedback | failures render in success-green (.mypage-message/.support-result shared color) | same | P2 | tone by result.ok |
| C-37 | student | forms | focus fields | — | inputs at 14–15px trigger iOS auto-zoom (+clip = stuck panned) | P2 | text-base on mobile |
| A-27 | student | /roadmap | weekly view | 15 hardcoded week tabs render "불러오지 못했습니다" errors for normal missing weeks | same | P2 | honest empty copy |
| B-46 | admin | broadcast | send to all | no confirm, no recipient preview, fields keep values after send (re-send risk); dedupe block shown as success | same | P2 | confirm + clear |
| C-16/C-38/C-40 | — | CSS | — | undefined `hide-scrollbar`/`scrollbar-hide` classes; dead @media(380px) block; **corrupted selector `}fessor-admin-clear p`** disables an overflow-wrap rule | same | P2/P3 | fix/delete |

Full finding registers (verbatim agent reports with file:line evidence) are
preserved in the four audit transcripts; the implementation plan references
IDs from this table. Additional P2/P3 findings not implemented in Stage 4 are
recorded in KNOWN_ISSUES.md (KI-017).

## 3. Timetable deep-dive (student /mypage + dashboard widget)

Rendered facts (375×812):
- Grid is the desktop layout shrunk: `clamp(1.85rem,8vw,2.75rem) repeat(7,1fr)`
  inside `overflow-hidden` → 39px/day at 375px, 31.8px at 320px. Course names
  render at 11px `break-all line-clamp-2` ≈ 2 glyphs/line; classroom at 9px.
- Delete: hover-only overlay (`opacity-0 group-hover:opacity-100`) covering
  the entire cell; the Trash2 button is 26×26px, `title` only, no aria-label,
  no focus-within reveal. **elementFromPoint at cell center returns the
  invisible delete button** → touch users delete courses accidentally;
  keyboard users focus an invisible control; there is NO other way to remove
  a scheduled course on mobile.
- `handleRemove` fires `removeCourseFromSchedule` with no confirmation
  (my-page-planner.tsx:387-417).
- Weekend columns always render (days array fixed 월–일) even when empty.
- Desktop is generally sound: readable blocks, pastel color coding, conflict
  warnings in the add-course form ("이 시간에 민법사례연습 과목이 있어요"),
  registered-state badges in the course search list.
- States: no loading state (page blocks on SSR); timetable-empty renders the
  bare grid (acceptable); fetch failure = empty timetable (KI-003) —
  indistinguishable from "no courses".
- Dashboard 오늘의 시간표 widget: sound structure; "마이페이지에서 관리" link
  ~20px tall (KI-009); brief hydration flash of a bare 요일 label (A-40).

## 4. Counseling deep-dive (student /counseling + professor ?tab=counseling)

Student booking (rendered, desktop + 375px):
- Two modes (과목별 예약 / 교수별 검색) — tablist without tab roles (D-12).
- Step model is clear (1단계 → 2단계); professor profile card is good.
- 담보물권법 shows "2명 담당" but course mode auto-selects professors[0] with
  no way to choose the second professor (KI-004; courseProfessors fetched but
  never rendered).
- Calendar: 42 date buttons, exactly 4 enabled (within the 14-day booking
  horizon), **no month navigation** (rendered-confirmed). Slots that fall in
  the next month when the horizon straddles month-end are unreachable (A-3).
  Date buttons' accessible names concatenate day+count ("17" + "2개" →
  "172개") — screen readers announce nonsense.
- The month is captioned "박성은 교수님의 가능한 날짜만 선택할 수 있어요" —
  good disabled-state explanation.
- Slot buttons: 329×76px on mobile (excellent), aria-pressed selection state
  (good), submit enables on selection. But: no hint why submit is disabled
  before selection (dead guard string in code); success message renders at the
  very bottom of the page (below 내 상담 요청) — off-screen after booking;
  selected slot is not cleared after success; **no router.refresh() → slot
  list and request panel stay stale after booking** (KI-004).
- 상담 내용 input properly labeled but reads as required while server
  substitutes "학업 상담" (unlabeled optional).
- 내 상담 요청 panel: renders status pill (승인 대기) — but a pending request
  for a PAST time (7/13, today 8/12) still shows as 승인 대기 with no student
  cancel action and no staleness indication.
- Availability correctness display: `.slice(0,48)` in counseling-slots.ts:118
  caps the merged multi-professor slot list BEFORE the per-professor filter
  (A-2) — with enough earlier slots from professor X, professor Y's real
  availability renders as the empty state. This is an availability-display
  correctness bug; Stage 2 semantics (what is bookable) are unaffected, but
  what students SEE diverges from the canonical set.

Professor management (rendered + source):
- **B-1**: `runAction` renders every result as success (green ✓ toast) and
  removes the card from the pending queue even when `ok:false`. Assistants
  hitting role-gated actions (B-17) see green success for a refusal.
- Reject flow: "(선택)" field actually required server-side (B-2); suggested
  end hard-coded start+30min ignoring slot_minutes (B-3 = KI-015); approve
  hard-codes a canned note sent as the student notification (B-4).
- Queue/log: single 12-row oldest-first window shared by both views (B-5);
  notification-driven deep links can land on a list not containing the target.
- Home entry points driven by unread counts — disappear once read while work
  remains (B-6).
- Calendar: no way to declare availability from the calendar itself (B-10);
  dialog header shows a rounded-hour range while actions apply the true 30-min
  chunk (B-11); legend missing 상담 불가 + swatch drift (B-12); fake sample
  button (B-13); week nav buttons unnamed; grid cells are clickable divs
  (keyboard-dead, D-4); 82 identical "상담 미개방" text blocks (noise).
- Mobile: 36px day columns, 31×50px blocks — unusable (C-9/B-14,
  rendered-measured).
- Identity: 이교수 → 김재두 fallback rendered-confirmed (B-24). The demo
  student's actual pending request (to 박성은) is only reachable via the
  assistant 박조교 (who maps to 박성은).

## 5. Loading / empty / error states

- **Zero `loading.tsx` in the repo**; all routes `force-dynamic`. Every
  navigation blocks on full SSR with the previous page frozen (Stage 3
  measured 268–852ms client-nav). No pixel of feedback between click and
  full page.
- Two incompatible error philosophies: 6 student routes swallow failures into
  empty states (`.catch(() => defaults)` — KI-003: counseling, mypage,
  roadmap, chatbot, notices, dashboard cards + app-shell), while /community,
  /reviews, /courses, /notifications throw to the single global error.tsx.
  /courses/[id] converts fetch failure into notFound() (A-19).
- Empty states: 5 distinct visual patterns (18× .community-empty is the
  de-facto standard; plus 4 ad-hoc); only ~3 offer a next action.
- Loading indicators: 6 patterns (button-label swap dominant; two different
  spinner icons; dots; italic bubble; empty-state box reused as loader; null
  Suspense fallback). No skeletons anywhere.
- Success feedback: alert() (courses), invisible banners (mypage non-timetable
  tabs, community reactions), never-dismissing toast over the bottom nav
  (/ask), bottom-of-page message (/counseling), stale lists after success
  (/reviews, /ask, /counseling), full page reload (weekly missions).

## 6. Accessibility findings (WCAG-oriented; NOT a full WCAG audit)

Verified issues: nested `<main>` ×4 (D-1); ~10 unnamed icon buttons incl. the
chat send button (D-2); span-in-button hover-only chat-session delete (D-3);
~60 keyboard-unreachable clickable-div calendar cells (D-4); 5 hand-rolled
modals with no focus management/Escape/scroll-lock incl. both nav drawers
(D-5/C-4, Escape rendered-tested: does not close); unlabeled form controls on
core flows (D-6); **zero aria-invalid/aria-describedby app-wide** (D-7);
professor toast + realtime toast + chat transcripts have no live regions
(D-8); focus outline removed with no replacement on search fields and chat
inputs; `.button` has no :focus-visible or :disabled styling (D-11, D-16);
2.5s auto-carousel with no pause and reduced-motion not honored (D-14);
counseling date buttons announce concatenated garbage ("172개"); tablist
without tabs (D-12); no skip link (D-17); student dashboard has no h1 (D-18).
Positive: all images have alt (D-15); dashboard tabs are a correct
tablist/tabpanel reference implementation; Radix dialogs used in 3 places are
sound.

UNVERIFIED: color-contrast ratios (not measured this stage), full
screen-reader walkthrough, focus-order audit beyond the flows above.

## 7. Consistency findings

- ui/ primitives vs reality: `Badge`, `Select`(Radix), `Popover` are **dead**
  (0 imports) while 38 raw `<select>`, ≥5 badge implementations and 2
  hand-rolled dropdowns exist; `Input`/`Label` near-dead (1 import);
  19 occurrences of the raw class string `"button button-default button-md"`
  across 8 files instead of `<Button>`.
- 5 button systems; primary color drifts across green/emerald-600/
  emerald-800/blue-600/rose-500/sky-600; destructive variant defined but
  effectively unused (and overridden where used); cancel/confirm order flips
  between dialogs.
- Counseling status vocabulary: two duplicated label maps (student/professor);
  the same reject event is 거절 / 시간 조정 / 반려 in three surfaces; admin
  renders raw English enum values; cancelled falls into the red "rejected"
  style branch.
- 9+ date/time formatting implementations, 2 of which use browser-local time
  (drift outside KST); canonical helpers exist in counseling-slots.ts but are
  imported by only 2 components.
- Breakpoint schism: Tailwind surfaces break at 640/768/1024 while
  globals.css surfaces break at 620/700/900; nav switches at 768 but body
  padding at 900 (dead space 768–900; double padding <620 = ~166px).

## 8. Responsive breakpoint findings

See C-findings in matrix. Systemic items: `html/body { overflow-x: clip }`
turns every overflow bug into silently unreachable content (C-12);
`viewport-fit=cover` missing nullifies all 11 safe-area rules (C-28); dialog
max-height missing (C-24); notification dropdown fixed w-80 clips off-screen
(C-26); site footer with 약관/사업자 정보 links `display:none !important` on
mobile with no alternative route (C-34); three bottom navs with two heights
(64/64/60); z-index inversions (drawer 40 < nav 50; community FAB 55 > dialog
50); undefined utility classes (`pb-safe`, `hide-scrollbar`,
`scrollbar-hide`); corrupted selector at globals.css:2902-2907 (C-40); dead
@media 380px block (C-38). 320px worst cases: mypage day columns 31.8px,
professor calendar 30.8px, register-course dialog time inputs 56px (UA min
~85px → blowout), notification panel 68px off-screen.

## 9. Cross-role information-architecture notes

- Student first-screen: auto-advancing decorative carousel occupies the top of
  /dashboard, pushing 오늘의 시간표/To-do down; carousel slides carry no
  actionable content.
- Professor home: entry-point boxes keyed to unread notifications rather than
  outstanding work (B-6); desktop dropdown menu has 15 items resolving to 8
  destinations with several mislabeled (B-20).
- Duplicated: dashboard notices region renders the same notice twice on the
  '전체' tab (hero strip + 공지사항 card); two identical tablists in the DOM
  (desktop + mobile variants, both exposed to AT).
- Terminology: 고객센터 vs 문의하기 for /support; 시간표로 돌아가기 links to
  /roadmap (A-41); header menu "상담 일지 작성" opens a read-only log (B-9).
