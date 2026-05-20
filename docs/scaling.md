# Scaling — what to do when one VPS isn't enough

**TL;DR.** A single Hetzner CPX22 (€5/mo, EU datacenter, public IPv4) handles ~100 concurrent users + 99.9% uptime. Don't add a second box for redundancy until paying customers care — prefer vertical scaling first (CAX21 / CPX31), then multi-host shared-DB once HA actually matters.

See [`deploy.md`](./deploy.md) for the current single-host flow.

---

## 1. Current — single Hetzner VPS

One CPX22 in Falkenstein. Every container declared in `infra/tofu/containers.tf`: `infra-postgres`, `infra-backups`, `infra-openobserve`, `infra-zitadel` + login, `infra-caddy`, `menu_web`. Caddy terminates TLS on port 443. Image uploads + backups live in R2 (zero egress, served from CF edge), not on the box.

**Natural ceiling.** Whichever bites first:

| Limit | Threshold | Why |
|---|---|---|
| Concurrent users | ~100 simultaneous public-menu viewers | Node single-process + Postgres on same CPU. Public menu is `unstable_cache`'d per slug, so steady-state load is mostly `/api/track/[slug]` beacon — images go direct to R2 edge |
| Memory pressure | ~80% of 4 GB used | Zitadel + login (~150 MB) + Postgres + menu_web + openobserve + caddy. Headroom shrinks as data grows |
| Reliability | 99.9% / month ([Hetzner SLA](https://www.hetzner.com/legal/cloud)) | Single AZ, single disk. Fine for pre-revenue + early customers |

**When to upgrade.** First of these to be true:
- A paying customer complains about an outage you can't explain.
- p95 latency on the admin builder degrades (Postgres CPU-bound under user load).
- The next product lands and the 4 GB RAM ceiling bites.

---

## 2. Vertical — bigger Hetzner box

Same Tofu, bigger `server_type`. Cheapest scaling motion.

| Tier | Spec | Cost/mo | When |
|---|---|---|---|
| CPX22 | 2 vCPU x86 / 4 GB / 80 GB | €5 | Today |
| CAX21 | 4 vCPU ARM / 8 GB / 80 GB | €7 | ARM-friendly workload; cheap throughput boost |
| CPX31 | 4 vCPU x86 / 8 GB / 160 GB | €10 | Memory pressure or admin builder feels sluggish |
| CPX41 | 8 vCPU x86 / 16 GB / 240 GB | €19 | Multiple products live; Postgres CPU-bound |

Edit `hcloud_server.iedora.server_type` in `infra/tofu/hetzner.tf`. `tofu apply` recreates with the new size — Hetzner takes ~2 min, brief downtime. Data dir survives (separate `hcloud_volume`).

**What it fixes:** CPU-bound rendering, Postgres memory pressure.

**What it doesn't fix:** Single-AZ availability — a Hetzner regional incident still = downtime.

---

## 3. Multi-host shared-DB

Two web boxes, one DB. Caddy on each web host; Cloudflare DNS round-robins or fronts a CF load balancer (€5/mo).

```
       Cloudflare DNS (A records → both web boxes)
              ├──────────────────┐
              ▼                  ▼
         Hetzner-1          Hetzner-2
         menu_web           menu_web
         caddy              caddy
              │                  │
              └────── Postgres ──┘
                  (on Hetzner-1, accessed
                   via private network)
```

**Hetzner private networks (Tofu-managed):** `hcloud_network` + `hcloud_network_subnet` + `hcloud_server_network`. ~10 ms intra-DC latency, no public traffic.

**Postgres still single-host.** A failed DB box = downtime. Shared-DB is NOT HA for Postgres — see scenario 4 for that.

**Cost.** 2× CPX22 = €10/mo. Or CPX22 (web) + CPX31 (DB) = €15/mo.

**What you gain.** Roll deploys without a blip (one box at a time). Survives one web box dying.

**What you give up.** Operational complexity — two boxes to patch, two `docker logs` to grep. A failed DB box is still downtime.

For controlled rollouts, deploy one host's container at a time:

```bash
INFRA_MENU_IMAGE_TAG=<new-sha> tofu apply -target='docker_container.menu_web["a"]'
# verify, then:
tofu apply -target='docker_container.menu_web["b"]'
```

Shape: introduce a `web_hosts` variable + `for_each` over it on `docker_container.menu_web` (each instance pinned to a different `host =` daemon). Migrations move into a one-shot `docker_container.menu_migrate` (image-pinned, `must_run = false`, `start = false`) triggered before the rolling app apply — every replica still has `pg_advisory_lock` so it's safe, just wasteful.

---

## 4. Postgres HA

Logical replication ([docs](https://www.postgresql.org/docs/current/logical-replication.html)) or a managed Postgres (Neon, Supabase). The complexity cliff: replication lag, conflict resolution, cache invalidation.

**Cost floor.** 2× CPX31 (web + primary + replica) = €30/mo plus engineering. Or managed Postgres = €20-50/mo for small tiers.

**When this makes sense.** Several thousand active tenants AND a real customer noticing region-specific p95. Not pre-revenue.

---

## 5. Multi-region

When a single EU region's latency to non-EU users hurts. Logical replication across regions + write-region routing.

**When.** Real geographic spread (US + EU + APAC), several thousand tenants, specific latency complaints. Reassess when metrics show it.

---

## 6. External uptime monitoring (today, zero cost)

Every product exposes `/up`. [Better Stack](https://betterstack.com/) free tier: 10 monitors at 3-min cadence; alerts to email.

| Product | URL | Cadence |
|---|---|---|
| Menu | `https://menu.iedora.com/up` | 3 min |
| Auth (Zitadel) | `https://auth.iedora.com/debug/healthz` | 3 min |
| House | `https://iedora.com/` | 3 min |

**Why off-box matters.** A self-hosted monitor on the same VPS dies with the host. Better Stack / UptimeRobot / CF Health Checks all run from someone else's PoP.

---

## Comparison

| Scenario | Cost/yr | Added complexity | Best fit |
|---|---|---|---|
| 1. Single CPX22 | €60 | None | Today. Pre-revenue, <100 concurrent |
| 2. Bigger Hetzner | €90-230 | None — same `just infra::deploy` | CPU/memory pressure but uptime still fine |
| 3. Multi-host shared-DB | €120-180 | Medium — two hosts, private network, partial HA only | Paying users + zero-downtime deploys mandatory |
| 4. Postgres HA | €360+ | High — replication, failover, conflict handling | Thousands of tenants, real downtime intolerance |
| 5. Multi-region | €600+ | Very high | Real geographic spread |
