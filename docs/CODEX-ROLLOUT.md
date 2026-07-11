# Calliope rollout closure

## Completed cross-repository work

- Excubitor owns port `8891` and can health-check and launch Calliope (LUDIARS/Excubitor#72).
- Schedula owns Google OAuth tokens and implements free/busy, incremental pull, and idempotent event write-back (LUDIARS/Schedula#11).
- Memoria forwards task classification and creator metadata to the existing Actio task API (LUDIARS/Memoria#252).

## Authentication boundary

The connector variables `ACTIO_TOKEN`, `SCHEDULA_TOKEN`, and `MEMORIA_TOKEN` accept Bearer values understood by each upstream. They are not Cernere project credentials.

Cernere has two distinct contracts:

1. Project credentials issue a one-hour token for a service to connect to Cernere's `/ws/project` endpoint.
2. User-to-project PASETO tokens authorize one user at one leaf service, expire after 15 minutes, and must remain memory-only.

Neither contract is a durable cross-service API token suitable for Calliope's unattended daily and weekly jobs. Persisting a short-lived user token in `.env` or a secret store would violate Cernere's boundary. Production rollout therefore requires an explicit user/delegation model before credentials are provisioned; this is an external product/security decision rather than unfinished Calliope code.

## Verification boundary

All repository typechecks, unit/integration suites, and CI checks pass. A live multi-service smoke test additionally requires Docker, Infisical configuration, and operator credentials. On the audited workstation, Docker was stopped and Schedula correctly refused to start without Infisical, so no credentials were fabricated and no authentication fallback was introduced.
