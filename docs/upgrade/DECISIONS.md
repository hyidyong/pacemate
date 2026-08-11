# Architectural Decisions

## D-001 — Repository as persistent project memory

Status: Accepted

Future Claude sessions must reconstruct project state from:

- Git
- source code
- tests
- `CLAUDE.md`
- `docs/upgrade/*`

Conversational memory is not authoritative.

## D-002 — Incremental upgrade

Status: Accepted

The existing system will be improved incrementally.
Existing functionality and UI/UX must remain intact unless a stage explicitly authorizes change or a confirmed bug requires it.

## D-003 — Evidence-based completion

Status: Accepted

No bug fix, performance improvement, or QA claim may be considered complete without current verification evidence.
