# Service-map import failed on synced codes and exposed the ledger cross-origin

- Date: 2026-08-23
- Status: fixed in working tree
- Area: service-map migration, anonymous read surface, upstream sync
- Severity: high

## Summary

The migrated service map could not complete its one-shot Villa import on any
installation where Excubitor was configured, and its read/mutate surface was
reachable from any site the operator had open in their browser. Four further
defects made the anonymous surface leak ports, hammer a downed upstream, and
report a successful sync for a catalog it had actually failed to understand.

## Evidence

- `src/db/repositories/servicemap.ts` `applyVillaImport` upserted with
  `onConflictDoUpdate({ target: serviceMapService.id })`, but the table also
  carries `uq_service_map_service_code`. Catalog sync writes `id = 'svc-<code>'`
  while Villa legacy IDs have no prefix (`src/servicemap/sync.ts` reconciles by
  code precisely for that reason). Opening `/service-map/admin` runs the lazy
  sync before any import is possible, so the documented "import then sync" order
  is unreachable: importing `{id:'a', code:'a'}` after `svc-a` exists missed the
  id conflict target, violated the code index, rolled the migration back, and
  returned 500.
- `src/app.ts` applied `cors({ origin: '*' })` with POST/PATCH/DELETE and
  `authorization` to every path, including `/service-map/admin/api/*`, which is
  fail-open when `CALLIOPE_SERVICEMAP_ADMIN_TOKEN` is unset (`.env.example`
  ships it empty). The design accepts "origin reachable ⇒ CF Access bypassed",
  but not that any third-party page could read the port/PC ledger and mutate it.
- `src/servicemap/engine.ts` `sync` advanced `lastSyncAt` only on success and had
  no in-flight sharing, so while Excubitor was down every anonymous
  `/service-map/public/api/overview` request started another upstream fetch.
- `src/servicemap/engine.ts` dropped `port`/`pcIds` from the public projection but
  passed `description` through verbatim, and the importer's own
  `/port:\s*(\d+)/` parser shows Villa descriptions carry port text —
  contradicting `spec/data-schema.md`.
- `src/clients/contracts.ts` gave `services` a `.default([])`, so a renamed
  upstream field parsed as zero services, marked every row `inCatalog=false`,
  and still reported `sync.state='synced'`.

## Cause

The import path reconciled on a different key than the sync path that runs before
it; a process-wide CORS policy predating this surface was not narrowed when an
unauthenticated mutating surface was added under it; failure was not recorded as
a reason to wait; sanitization covered structured fields but not free text; and
an optional-with-default schema turned a contract break into silent data loss.

## Fix Requirements

- Reconcile Villa imports on the unique `code`, not the row id, inside the same
  transaction, so a legacy ID never collides with an already synced row.
- Exclude `/service-map` from the wildcard CORS policy; leave other paths as-is.
- Share one in-flight lazy sync across concurrent readers and reuse a failed
  outcome for a cooldown window instead of re-hitting a downed upstream.
- Redact port notation from `description` in the anonymous projection while the
  authenticated views keep the original text.
- Fail loudly when the Excubitor response has no `services` array.

## Verification

Registered Vitest coverage exercises import after catalog sync, shared/cooled
lazy sync, description redaction versus the authenticated view, CORS absence on
`/service-map` with `/health` unchanged, and the upstream shape mismatch. Tests
were not run in this Revisor review because repository-code execution is
explicitly prohibited.

## Follow-up

The admin UI still needs one runtime pass (token entry, Villa file selection,
group multi-toggle save, deletion dialogs) — unchanged from
[2026-08-13](2026-08-13-service-map-admin-integrity.md).
