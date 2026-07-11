# Calliope P5 — Dashboard and weekly retrospective

## Dashboard

The root page is a dependency-free responsive command deck. It consumes existing Calliope APIs and does not duplicate planning logic or persist UI state. It provides:

- active plan and lane schedule;
- pending confirmation approval/rejection;
- sprint and velocity views;
- What-if lane simulation and reschedule trigger;
- calendar synchronization;
- weekly retrospective review and Nuntius send.

The service token is held in `sessionStorage`; data rendering uses DOM `textContent`. Static resources are same-origin and the page sends a restrictive CSP.

## F7 weekly retrospective

`GET /api/retrospective/weekly` derives a report from existing velocity, curve snapshot, priority breakdown, and reschedule log rows. No report table is added.

Metrics:

- k-factor drift between the latest two velocity windows;
- average weekly scope-creep rate;
- current priority rows with activated aging;
- latest estimation MAPE/bias by source;
- weekly proposal/apply/reject/expiry counts.

Threshold-based recommendations identify velocity drift of at least 20%, scope creep of at least 10%, active starvation, and MAPE of at least 50%.

`POST /api/retrospective/weekly/send` publishes one aggregated payload to `calliope.weekly`. Missing Nuntius configuration returns an explicit skip warning. The timer runs every Monday at 08:00 JST and is released during shutdown.
