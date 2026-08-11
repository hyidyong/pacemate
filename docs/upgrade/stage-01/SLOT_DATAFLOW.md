# Stage 1 — Availability/Slot Data Flow (verified 2026-08-11)

"Remaining slots" in PaceMate = computed free counseling time slots. **No numeric capacity/seat-count column exists anywhere** — there is no enrollment-capacity semantic.

## A. Student counseling flow (canonical engine)

```text
DB: professor_availability (active windows + is_active=false blackouts)
    professor_teaching_slots
    professor_admin_tasks (incl. __BLACKOUT__YYYY-MM-DD rows)
    counseling_requests WHERE status IN ('pending','approved')   ← busy filter (counseling.service.ts:248)
↓
src/services/counseling.service.ts
    getCounselingPageData :40-62 / getAvailableCounselingSlots :64-74 / buildSlots :257-301
↓
src/lib/counseling-slots.ts  buildAvailableCounselingSlots :74-167  (PURE, tested)
    - expands active availability into slot_minutes chunks, days +1..+14
    - weekdays only (:93); bookings capped at 18:00 (STUDENT_BOOKING_END_HOUR, :2, :98-101)
    - subtracts teaching (:112-117), admin/blackout-date (:118-129),
      busy requests pending+approved (:130-134), inactive-availability overlap (:135-140)
    - timezone: Asia/Seoul explicit, two-pass Intl wall-clock→instant (:205-247)
    - dedupe via slot id JSON.stringify([professorId,start,end]) (:45-49); cap 48 (:166)
↓
src/app/counseling/page.tsx (RSC, force-dynamic) → props
↓
src/components/counseling/counseling-workspace.tsx (client)
    - sortedSlots filter by professor :150-156
    - buildCalendarDays :88-119 (month grid derived from FIRST slot's month :93)
    - per-day remaining count = day.slots.length rendered "{n}개" :346,361; day disabled when 0 :355
↓
Booking: counseling.actions.ts createCounselingRequest
    - re-validates against freshly recomputed slots :31-41
    - insert status='pending' :44-56
    - DB race guard: GiST exclusion constraint counseling_requests_no_active_overlap
      (professor_id =, tstzrange(requested_start,requested_end,'[)') &&) WHERE status IN ('pending','approved')
      — migration 20260713040000:48-56 + partial unique index (schema.sql:359-361)
    - revalidatePath('/counseling','/professor'); client does NOT router.refresh() → stale panel until nav
```

## B. Professor calendar (DUPLICATE engine — diverges)

```text
DB: same tables, but counseling_requests loaded per-professor without status filter
    (professor.service.ts:275-298, service-role client, limit 12)
↓
src/components/professor/professor-calendar.tsx :185-191 (client)
↓
src/lib/calendar-utils.ts  calculateRecommendedAvailability :27-157  (PURE, UNTESTED before Stage 1)
    - base free window HARD-CODED Mon–Fri 09:00–18:00, fixed 30-min chunks (:34-36,:126)
      — ignores professor_availability windows and slot_minutes
    - busy: teaching + admin tasks + counseling requests WHERE status === 'approved' ONLY (:77)
      — pending requests still shown as free ("상담 가능")
    - busy time = suggested_start/end || requested_start/end (:78-79)
    - blackout: existingAvailability.find(day match && start_time.startsWith(chunkStart)) (:133-134)
      — an inactive 10:00–11:00 row only marks the 10:00–10:30 chunk as 상담 불가
    - timezone: browser-local Date methods (:78-85) — correct only in KST browsers
↓
Rendered as type "recommended": title "상담 가능"/"상담 불가",
details "상담 예약이 가능한 시간입니다" (professor-calendar.tsx:193-208)
```

## C. Student timetable flow (unified in commits 72beab8/40bd63e)

```text
DB: student_courses (+legacy schedule_day/start_time/end_time columns)
    student_course_schedule_slots / student_custom_courses / student_custom_course_schedule_slots
    course_schedules (syllabus-parsed) / professor_teaching_slots
↓
src/services/student-timetable.service.ts
    resolveStudentCourseSchedule :16-56 — precedence course_schedules → professor_teaching_slots → manual
    writeStudentCourseScheduleSlots :58-78 — atomic via plpgsql RPC replace_student_course_schedule_slots
    getExistingScheduleEntries :102-165
↓
src/services/student-timetable.rules.ts (PURE, tested)
    slotsOverlap / findScheduleConflicts :98-123 — half-open intervals on "HH:MM"
↓
src/lib/student-timetable.ts (PURE, tested)
    toTimetableDisplayItems :50-85 — one item per slot; legacy single-slot fallback :56-64;
    drops missing/inverted times :70; HH:MM via slice(0,5) :42-44
↓
mypage: my-page-planner.tsx — course badge = scheduledCourseIds.size :215/:654; 1px-per-minute grid :468-477
dashboard: today-timetable-widget.tsx — weekday resolved post-hydration, browser-local :16-24
Mutations: student-community.actions.ts addCourseToSchedule :144-307 (shared by /courses and mypage)
    → revalidatePath + router.refresh(); optimistic local rows with rollback (my-page-planner.tsx:253-289)
```

## Boundary comparison (engine A vs engine B, same DB state)

| Aspect | Student engine (A) | Professor calendar engine (B) |
|---|---|---|
| Base availability | Declared active windows, slot_minutes granularity | Hard-coded 09–18 Mon–Fri, 30-min chunks |
| Busy requests | pending + approved | approved only |
| Busy time fields | requested_start/end | suggested ?? requested |
| Blackout semantics | interval overlap | chunk-start prefix match |
| Timezone | Asia/Seoul explicit | browser-local |
| Horizon | +1..+14 days, cap 48 | displayed week |

Divergences 2 and 4 are correctness defects under any reading (see SLOT_BUG_REPRODUCTION.md).
Divergences 1, 3, 5 are candidates for Stage 2 unification (single source of truth).
