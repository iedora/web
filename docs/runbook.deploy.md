# Runbook — deploy

Deploy is owned by the **`iedora-infra`** platform (Docker Swarm +
Ansible + OpenTofu), not this repo. This repo only ships images.

- **UI image** — CI builds `apps/web/Dockerfile` and pushes
  `ghcr.io/iedora/web` on every push to `main`. It serves the two
  public hostnames (menu / apex) and holds NO secrets, NO
  database client and NO migrations.
- **Backend images** — CI builds the Go services from
  `services/Dockerfile` (one binary per service: auth, audit, billing,
  menu, admin). Each service migrates its own database via the
  `<svc> migrate` one-shot before serving. Swarm wiring lives in
  `services/deploy/stack.yml` (+ SOPS secrets under
  `services/deploy/secrets/`).
- **Runtime config** — the UI container needs `AUTH_URL` / `MENU_URL`
  (swarm-internal DNS, e.g. `http://auth:8080` / `http://menu:8084`)
  and the `NEXT_PUBLIC_*` product URLs baked at build time. Everything
  else (DB URLs, JWT keys, S3 creds) belongs to the Go services'
  env files in `iedora-infra`.
- **Object storage (R2)** — managed by `iedora-infra` (tofu).

> Historical: this app previously deployed via Coolify and, before the
> Go backend, carried better-auth + Drizzle migrations in the UI image.
> Both are retired; the prior runbooks are in git history.
