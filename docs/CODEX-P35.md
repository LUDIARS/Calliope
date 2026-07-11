# Calliope P3.5 — Daily Briefing

## Scope

P3.5 implements F2 from `docs/design/pm-extensions.md`. A briefing is derived on demand from the active plan, active sprints and their latest curve snapshots, pending confirmations, and the latest risk snapshot per goal. It is not persisted.

## API

- `GET /api/briefing/today` composes the current JST day by lane.
- `POST /api/briefing/today/send` publishes one payload to Nuntius topic `calliope.daily`.
- An unconfigured Nuntius connector is an explicit capability skip: the endpoint returns HTTP 200 with `notification.status=skipped` and a warning.
- A configured but failing or contract-incompatible Nuntius returns an upstream failure instead of silently succeeding.

The public send response exposes only topic and delivery count. Nuntius message recipients are validated at the boundary but are not returned or stored by Calliope.

## Daily orchestration

At 07:30 JST, the existing timer attempts rescheduling and then sends the briefing. A reschedule failure becomes a warning and does not suppress the briefing attempt. Timer ownership and shutdown remain in `src/index.ts`.

## Acceptance checks

- JST day overlap and lane grouping are deterministic.
- Expired confirmations are omitted without mutating state during a read.
- Sprint `at_risk` health and amber/red goal risks become alerts.
- Deadlines in the next seven JST days, including overdue deadlines, are included.
- Human gates are listed separately.
- Delivery uses Nuntius Bearer authentication and the topic publish contract.
- `npm run typecheck` and `npm test` pass.
