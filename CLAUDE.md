# University Platform Upgrade

This is an existing university timetable and counseling-reservation application being upgraded incrementally to production-grade quality.

## Core invariants

* Preserve existing functionality unless a confirmed bug requires a change.
* Preserve existing UI/UX unless a stage explicitly authorizes UX changes.
* Do not perform unrelated refactoring.
* Do not replace architecture/framework/library without explicit justification.
* Use Red → Green → Refactor for bug fixes and behavior changes.
* Never claim success without fresh verification evidence.
* Prefer root-cause fixes over UI-level patches.
* Treat scheduling availability as correctness-critical data.
* Do not introduce unnecessary dependencies; justify any new package (need, alternatives, bundle impact, maintenance, accessibility).
* Repository state, Git history, tests, and project documentation are more authoritative than conversational memory.

## Stage Workflow

For every University Platform Upgrade stage:

1. Reconstruct state from repository evidence.
2. Work only on `upgrade/stage-N`.
3. Do not work directly on `main`.
4. Read `CURRENT_STAGE.md`, the previous HANDOFF, relevant decisions, known issues, tests, and recent Git history.
5. Preserve completed work and do not repeat verified investigation unnecessarily.
6. Use Red → Green → Refactor for correctness changes.
7. Do not claim completion without fresh verification evidence.
8. Update `CURRENT_STAGE.md` and the current stage `HANDOFF.md`.
9. Record meaningful architectural decisions in `DECISIONS.md`.
10. Record out-of-scope issues in `KNOWN_ISSUES.md`.
11. Run applicable tests/typecheck/lint/build before completion.
12. Commit meaningful changes.
13. Push the stage branch.
14. Create or update a Pull Request.
15. STOP.

Never merge the PR automatically.
Never begin the next stage automatically.
The user performs external review and approves the merge.
Repository state, Git history, tests, and project documentation are the source of truth.
Conversational memory is not authoritative.

## Project workflow

This project is executed in 10 sequential stages.

Persistent project documents live under:

```text
docs/upgrade/
```

Important files:

```text
docs/upgrade/MASTER_PLAN.md
docs/upgrade/CURRENT_STAGE.md
docs/upgrade/DECISIONS.md
docs/upgrade/KNOWN_ISSUES.md
```

Each completed stage should have a handoff document.

## Session startup protocol

At the beginning of future sessions:

1. Read `CLAUDE.md`.
2. Read `docs/upgrade/CURRENT_STAGE.md`.
3. Read the SPEC for the current stage if one exists.
4. Read the previous stage HANDOFF if one exists.
5. Inspect Git status and recent relevant commits.
6. Inspect relevant tests.
7. Reconstruct the current state from repository evidence.
8. Do not assume previous conversational context exists.

Only read the entire `MASTER_PLAN.md` when roadmap-level context is required.

## Session completion protocol

Before ending a stage or major work session:

1. Update the current stage HANDOFF.
2. Record completed work.
3. Record files changed.
4. Record tests executed and actual results.
5. Record unresolved issues.
6. Record architectural decisions.
7. Record exact next action.
8. Update `CURRENT_STAGE.md`.
9. Ensure documentation matches actual repository state.

Never rely on conversational memory as the canonical project state.
The repository is the source of truth.
