# Service-map admin operations could overwrite or revive assignments

- Date: 2026-08-13
- Status: fixed in working tree
- Area: service-map migration and assignment integrity
- Severity: high

## Summary

The new Villa migration, catalog sync, and editors could regress current service-map administration data. Re-uploading Villa state overwrote newer domain and PC assignments, a sync racing an admin edit could restore stale assignments, and selecting multiple PCs in the group dialog retained only the last toggle. Edit dialogs also closed before an asynchronous save succeeded, preventing correction after a rejected save. Deleting a PC or group left its ID in service JSON arrays and allowed a later catalog sync to revive the deleted group. The mutation API was outside the `/service-map/admin` prefix, so the documented Cloudflare admin-prefix policy did not cover it.

## Evidence

- `src/servicemap/engine.ts` `importVillaState` accepted every upload and upserted legacy rows.
- `src/db/repositories/servicemap.ts` `deletePc` and `deleteGroup` removed only the parent row.
- `src/servicemap/sync.ts` preserves existing assignment IDs and recreated missing groups.
- `src/servicemap/roadmap.ts` omitted services with empty or dangling `groupIds` from both domains and the unassigned count.
- `src/servicemap/ui/script.ts` built every PC toggle patch from the original `pcIds`, then kept only the last patch per service.
- `src/servicemap/ui/script.ts` attached asynchronous handlers to `method="dialog"` forms without preventing their immediate default close.
- `src/servicemap/engine.ts` read assignments before the upstream request completed and later replaced the whole service row.
- `src/routes/servicemap.ts` mounted mutations at `/service-map/api/admin`, outside the documented `/service-map/admin` Cloudflare policy boundary.

## Regression Context

This is a regression risk introduced by PR #528's new admin workflow. The original pure merge and roadmap tests covered successful catalog synchronization but not destructive admin operations or repeated migration.

## Cause

Migration rows and completion were not written in one transaction, catalog sync replaced admin-owned columns from a stale snapshot, group toggles did not accumulate against one working set, dialog submission lifetime was not coordinated with asynchronous persistence, the route hierarchy did not match its authorization hierarchy, JSON-array references were not maintained transactionally with parent deletion, and unassigned accounting assumed every service referenced an existing group.

## Fix Requirements

- Reject Villa imports after the first successful import.
- Claim and complete Villa migration in the same transaction so concurrent or failed imports cannot partially apply.
- Update only catalog-owned columns during sync so concurrent assignment edits survive.
- Accumulate all group-level PC toggles before sending one patch per service.
- Keep edit dialogs open until every asynchronous save succeeds so rejected saves remain correctable.
- Keep every mutation endpoint below `/service-map/admin` so the Cloudflare administrator policy covers page and API together.
- Reject oversized admin request bodies before JSON deserialization.
- Remove deleted PC references and reassign services from a deleted group to the stable ungrouped bucket in the same transaction.
- Count services with empty or dangling group references as unassigned.
- Do not return raw upstream exception messages from the public overview.

## Verification

Registered Vitest coverage exercises repeated and concurrent import, import rollback, deletion followed by catalog sync, an assignment edit racing sync, public error redaction, and empty/dangling group accounting. Tests were not run in this Revisor review because repository-code execution is explicitly prohibited. The group editor's multi-toggle and save-failure dialog behavior still require a runtime UI exercise.

## Follow-up

Exercise the admin UI once in a runtime environment to verify token entry, Villa file selection, deletion dialogs, reassignment display, and roadmap rendering.
