# Calliope P4 — Calendar binding

## Scope

P4 binds Calliope to Schedula's Google Calendar implementation. Calliope never calls Google directly and stores only the opaque `primary` calendar alias and Schedula event IDs.

## Behavior

- Scheduler human-gate placement uses `GET /api/calendar/freebusy` from Schedula.
- Applied plans request calendar visualization from manual apply, low-risk reschedule, and approved high-risk reschedule paths.
- Calendar writes create a `calendar_write` confirmation by default.
- `CALLIOPE_CALENDAR_AUTO_WRITE=on` is the explicit exception that permits automatic plan-block visualization.
- Created events contain only opaque task references, time intervals, and private Calliope loop-prevention tags.
- Superseded plans reuse matching task event IDs where possible and delete remaining obsolete events.
- Partial external failures remain observable and retries reuse already persisted event IDs.

## API

- `GET /api/calendar/link`
- `PUT /api/calendar/link`
- `POST /api/calendar/sync`
- `POST /api/calendar/pull`

## Verification

- Schedula connector contracts are Zod-validated.
- Confirmation approval leaves the decision pending if Schedula fails.
- Tests cover confirmation, event tagging, event ID persistence, explicit degrade, and supersede reuse.
