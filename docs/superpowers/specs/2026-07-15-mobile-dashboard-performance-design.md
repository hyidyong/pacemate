# Mobile Dashboard Performance Design

## Goal

Reduce the student dashboard's mobile first-load delay without changing its visible features, authentication behavior, or route structure.

## Observed Bottlenecks

- The hero carousel mounts four remote PNG files on first render, downloading about 4.2 MB before the user asks to view the other slides.
- `DashboardPage` and `AppShell` independently resolve the same profile and notification data.
- Student dashboard data includes independent Supabase reads that are currently sequenced, plus one progress lookup per course.

## Design

1. Keep the hero carousel controls and automatic advance, but only give an image source to the active slide and its immediate neighbor. The active slide is eagerly fetched; the neighbor is prepared for the next transition. Other slides remain placeholders until requested.
2. Let `DashboardPage` resolve the authenticated profile, notification list, and unread count once, then pass those values to `AppShell`. The notification strip reuses the same list.
3. Start independent student reads together after profile resolution. Replace per-course progress requests with one `in()` query keyed by the current course/week pairs, then map the returned rows in memory.
4. Preserve existing failures and UI fallbacks. Do not touch authentication, Supabase configuration, routes, or other pages.

## Verification

- Source-level regression tests cover deferred carousel sources, shared shell data, parallel dashboard fetch setup, and batched progress lookup.
- The existing hero interaction test remains green.
- `npm run typecheck`, focused Node tests, and `npm run build` must pass.
- Browser checks confirm hero navigation and the student dashboard render at a mobile viewport.
