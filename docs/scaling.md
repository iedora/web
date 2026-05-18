# Scaling — what to do when one homelab box isn't enough

**TL;DR.** A single homelab box on Starlink is fine until you hit either ~100 concurrent users or your first sustained outage. Then migrate the whole stack to the cheapest Hetzner VPS (€4/mo · €48/yr) — same `just menu::deploy`, just a different `ONPREM_HOST`. Don't add a second box for redundancy until you have paying customers who care, and even then prefer two Hetzner boxes over a hybrid homelab+VPS pair — the latency budget on Starlink CGNAT (40–150 ms per DB round-trip via Tailscale) eats your page render time faster than the €48/yr saves you. The one zero-cost thing worth doing today: install Tailscale on the homelab so future east-west joins are two lines, not a one-hour networking project.

See [`deploy.md`](./deploy.md) for the current single-host flow this builds on.

---

## 1. Current — single homelab box

Stack as deployed today: one Ubuntu box, Kamal 2, Cloudflare Tunnel outbound, four containers (`app`, `postgres`, `cloudflared`, `backups`) on the same Docker network. Image uploads + backups both live in Cloudflare R2 (zero egress, served from the edge), not on the box. No inbound ports open. See [`deploy.md`](./deploy.md).

**Natural ceiling.** Three independent limits, whichever bites first:

| Limit | Threshold | Why |
|---|---|---|
| Concurrent users | ~50–100 simultaneous public-menu viewers | Node single-process + Postgres on same CPU. Public menu is `unstable_cache`'d per slug (hard rule #12), so steady-state load is mostly the `/api/track/[slug]` beacon — image fetches go direct to R2's edge, not through the box. |
| Upstream bandwidth | ~10 Mbps real-world on Starlink residential ([plans](https://www.starlink.com/business/plans)) | Symmetric-ish on paper, but residential tier is best-effort and uplink dips hardest under contention. A page with 6 dish photos at 200 KB each = 1.2 MB; ~8 concurrent first-paint loads saturates uplink. |
| Reliability | ~99.0–99.5% / month realistic | Residential ISP + consumer-grade power. Starlink itself publishes no SLA for residential ([Starlink terms](https://www.starlink.com/legal/documents/DOC-1134-89405-69)). One thunderstorm = one outage. |

**When to upgrade.** First of these to be true:
- A real (paying) customer complains about an outage you can't explain.
- The admin upload flow becomes painful (presigned PUTs go to R2 directly, but Server Actions still round-trip through the box).
- You start serving customers outside Western Europe and the Cloudflare edge can't hide the round-trip to your box anymore.

Until then: stay here. It's free.

**When this makes sense.** Always, as the starting point. Pre-revenue + EU + low traffic = this is the right answer.

---

## 2. Vertical — bigger homelab box

Buy more box, same address. Cheapest scaling motion.

**What it fixes.** CPU-bound rendering, Postgres memory pressure. A modern N100 mini-PC (€150–250 one-off) or a used Xeon E-2278G tower off eBay (€200–400) gets you ~4× the current single-box throughput.

**What it does NOT fix:**
- Starlink uplink cap (~10 Mbps) — still the ceiling for outbound bandwidth.
- Starlink CGNAT — no inbound IP, you still go out via Cloudflare Tunnel (which is fine, but means you can't ever expose a non-HTTP service to the public internet directly).
- Single power circuit, single ISP, single physical location. One thunderstorm still = one outage.

**Cost.** €150–400 one-off, amortized = €30–80/yr if the box lasts five years. Cheaper per year than Hetzner (€48/yr) *if* you already trust your power + ISP, *if* you don't value off-site location, and *if* the box doesn't die in year two.

**When this makes sense.** You're hitting CPU/memory limits on the current box but bandwidth and uptime are still fine, and you genuinely enjoy homelab tinkering. Otherwise, skip straight to scenario 3 — the marginal cost over a used minipc is small and the operational simplicity is worth it.

---

## 3. Migration — move entirely to a Hetzner VPS

Single command-flow change. Same `just menu::deploy`, different IP.

**Box.** Hetzner Cloud CX22 (x86, 2 vCPU, 4 GB, 40 GB SSD) is **€4.51/mo · €54.12/yr** as of May 2026; CAX11 (Ampere ARM, 2 vCPU, 4 GB) is **€3.79/mo · €45.48/yr** ([Hetzner Cloud pricing](https://www.hetzner.com/cloud)). ARM is the cheapest viable tier; both run the same Docker image fine (the `Dockerfile` builds for `linux/amd64` today, swap to `arm64` for CAX11 — one line in `builder.arch`).

**Cutover steps** (~30 min wall-clock):

```bash
# 1. Provision Hetzner box, paste ~/.ssh/id_ed25519.pub during creation.
# 2. ssh root@<new-ip> 'whoami'  → "root" instantly. No host-init needed.

# 3. On the OLD box: dump postgres. Assets live in R2 already — no migration needed.
ssh root@$OLD_HOST 'docker exec infra-postgres pg_dump -U postgres menu | gzip' > db.sql.gz

# 4. Edit products/menu/infra/.env: ONPREM_HOST=<new-ip>
# 5. just menu::deploy   → tofu re-points the tunnel ingress, kamal boots fresh stack on new box.

# 6. Restore data on the new box.
gunzip < db.sql.gz | ssh root@$NEW_HOST 'docker exec -i infra-postgres psql -U postgres menu'

# 7. Hit https://$PUBLIC_HOSTNAME/up — should be {"ok":true,"db":"ok"}.
```

DNS doesn't change — the Cloudflare Tunnel ingress is rewritten by `tofu apply`, the user-facing hostname stays put, no TTL wait.

**What you gain.** 99.9%+ uptime ([Hetzner SLA](https://www.hetzner.com/legal/cloud)), gigabit symmetric, real EU datacenter latency (Falkenstein/Helsinki/Nuremberg = 20–40 ms to most EU users), nightly snapshots for €1/mo extra.

**What you lose.** €48/yr. That's it.

**When this makes sense.**
- First paying customer, especially if they're not in your physical region.
- You're spending more than ~1 hr/quarter on homelab reliability issues — the VPS cost is cheaper than your time.
- Latency-sensitive users in a specific EU region (pick the matching Hetzner location).

This is the recommended next step. Do not skip it to chase multi-host.

---

## 4. Multi-host shared-DB — Tailscale east-west

Two web boxes, one DB. The DHH-endorsed pattern ([X post](https://x.com/dhh/status/1919681760532586706)): join all hosts to a Tailscale tailnet, address the DB by its tailnet IP, let WireGuard handle the encrypted east-west link.

```yaml
# products/menu/infra/kamal/config/deploy.yml — multi-host snippet
servers:
  web:
    hosts:
      - <%= ENV.fetch("WEB_HOST_1") %>     # e.g. Hetzner Falkenstein
      - <%= ENV.fetch("WEB_HOST_2") %>     # e.g. Hetzner Helsinki, or homelab

accessories:
  postgres:
    image: postgres:18-alpine
    host: <%= ENV.fetch("DB_HOST") %>       # one box, addressed by tailnet IP
    # e.g. DB_HOST=100.64.10.5  (MagicDNS: db.tail-xxxx.ts.net also works)
```

App containers reach Postgres over the tailnet (`DATABASE_URL=postgres://...@100.64.10.5:5432/menu`). Kamal-proxy on each web host load-balances locally; Cloudflare Tunnel ingress points to the kamal-proxy on either box (or both via two `cloudflared` accessories). R2 assets + backups stay on Cloudflare, accessed identically from each web host.

**Latency reality.** Tailscale picks the lowest-latency path it can:
- **Direct WireGuard** EU↔EU: typically 15–40 ms. Possible when at least one peer has a public IP (any Hetzner box does). Per DB round-trip.
- **DERP-relayed** (Frankfurt/Paris/Amsterdam relays — see [Tailscale DERP map](https://tailscale.com/kb/1232/derp-servers)): 40–150 ms. This is what you get when **both** peers are CGNAT'd — which is exactly the Starlink homelab case. Starlink CGNAT means the homelab cannot do direct WireGuard with another CGNAT peer; with a Hetzner peer it usually can (Hetzner side has a public IP), so direct is achievable.

**Performance budget.** Public menu page renders ~5–20 DB queries (snapshot loader + i18n fanout). At 30 ms direct east-west that's 150–600 ms of pure RTT in the render path. At 100 ms DERP-relayed, you're at 500–2000 ms — visibly slow. The `unstable_cache` snapshot mostly hides this on the public menu, but the admin builder isn't cached and *will* feel sluggish.

Realistic page-render budgets:
- Both boxes in same Hetzner region: 200–400 ms total. Fine.
- Hetzner + homelab over direct WireGuard: 300–600 ms. Acceptable.
- Hetzner + homelab over DERP relay: 500–1500 ms. Don't.

**Cost.** Tailscale Free tier covers up to 100 devices and 3 users ([Tailscale pricing](https://tailscale.com/pricing)) — well above what you'd ever hit here. Adding one Hetzner CX22 = **€4.51/mo · €54.12/yr**. So multi-host = €48/yr more than scenario 3, for redundancy.

**What you gain.** One box can die without taking the app down (assuming DB box is the survivor; otherwise you're degraded). Lets you roll deploys without a blip.

**What you give up.** The latency penalty above. Operational complexity: now you have two boxes to patch, two `docker logs` to grep, and a tailnet to keep healthy. A failed DB box still means downtime — shared-DB is **not** HA for Postgres.

**Not Cloudflare Tunnel TCP for east-west.** CF Tunnel works for app↔Postgres in theory, but routes through the Cloudflare edge — adds 30–80 ms per hop on top of geographic latency, doesn't do MagicDNS, and isn't the maintained Kamal idiom. Tailscale is what DHH and the Kamal community use; stick with it.

**Not Docker Swarm overlay.** Kamal explicitly rejects Swarm — [`Kamal Handbook`](https://kamal-deploy.org/docs/) is built around a flat "containers on hosts" model, no orchestrator overlay. Don't fight it.

### Kamal config changes that come with N>1

Three concrete diffs land the moment you go past one host or one replica. Skipping them in advance is fine — none matter on a single box — but bake them in the day you add a second.

**1. Throttle the rolling deploy.** Without `boot.limit`, Kamal rolls every host in parallel (SSHKit threads); a bad image takes the whole fleet at once. Pin one-at-a-time with a short settle window so kamal-proxy can drain:

```yaml
servers:
  web:
    hosts: [...]
    boot:
      limit: 1
      wait: 10
```

**2. Move migrations to a pre-deploy hook with `--primary`.** Today `scripts/migrate.mjs` runs in `servers.web.cmd` and is safe under N replicas because of its `pg_advisory_lock` ([rule 2 in genkan's hard rules](../AGENTS.md) and menu's `migrate.mjs`). At N>1 it's still safe but wasteful — every replica boots, every replica grabs the lock, only one wins. Replace with a `.kamal/hooks/pre-deploy` script that runs exactly once against the freshly-built image:

```bash
#!/usr/bin/env bash
# .kamal/hooks/pre-deploy
set -euo pipefail
kamal app exec --primary --version="$KAMAL_VERSION" "node scripts/migrate.mjs"
```

And drop the migrate from `cmd:` (just `node server.js`). `--version=$KAMAL_VERSION` is load-bearing — without it Kamal would run the migration against the *current* image, before the new code is rolled. Pinned by `basecamp/kamal#526`.

**3. Per-host cloudflared accessory, same tunnel token.** Cloudflare Tunnel connectors are inherently HA: same token on N connectors = N registered connections, CF load-balances across them automatically. No LB on your side. The single-host snippet:

```yaml
accessories:
  cloudflared:
    host: <%= ENV.fetch("ONPREM_HOST") %>
```

becomes:

```yaml
accessories:
  cloudflared:
    hosts:
      - <%= ENV.fetch("WEB_HOST_1") %>
      - <%= ENV.fetch("WEB_HOST_2") %>
```

`TUNNEL_TOKEN` is unchanged — Tofu still mints exactly one tunnel. Each connector picks up the same secret and registers independently. If one host dies, CF stops routing to its connector within ~30s; existing connections drop, new ones land on the survivor.

These three together are what makes Kamal "scale to N hosts" actually mean zero-downtime rolling deploys with surviving-host failover, not just "two boxes running the same image".

**When this makes sense.**
- You have paying customers who notice an outage within minutes.
- You're willing to spend €48/yr extra AND accept the per-page latency penalty above.
- You're deploying on a rhythm fast enough that zero-downtime matters.

If you're not yet at all three: don't.

---

## 5. Multi-region with separate DBs

Postgres logical replication ([docs](https://www.postgresql.org/docs/current/logical-replication.html)) or write-region routing (one primary, read replicas in other regions). The complexity cliff: now you're reasoning about replication lag, conflict resolution if you ever go multi-primary, and cache invalidation across regions.

**Cost floor.** 2× Hetzner CX22 = **€9/mo · €108/yr**, plus the engineering cost of getting replication right (non-trivial).

**When this makes sense.** Several thousand active tenants, real geographic spread (US + EU + APAC), and a specific reason the single-region latency from scenario 3 isn't good enough. Not pre-revenue. Probably not even at €10k MRR. Reassess when you have enough customers to notice region-specific p95 latencies in your metrics.

---

## 6. Recommended preparation today (zero cost)

Install Tailscale as a host service on the homelab. Takes 2 minutes, costs nothing, makes scenario 4 a 2-line change later instead of a networking project. **Also unlocks CI deploys** (the GitHub Actions runner joins the tailnet via `tailscale/github-action@v4` and reaches the homelab over MagicDNS — see `docs/deploy.md` § Network reachability).

```bash
# On the homelab box, as root:
curl -fsSL https://tailscale.com/install.sh | sh
tailscale up --hostname=iedora-homelab
# Authenticate via the printed URL (one-time, your Tailscale account).

# Note the MagicDNS hostname Tailscale assigns (e.g. iedora-homelab.tail-xxxx.ts.net).
# Local `just <product>::deploy` keeps using the LAN IP in products/<product>/infra/.env
# (fast, no detour); the CI runner uses the tailnet MagicDNS name via the
# `ONPREM_HOST` GitHub Variable.
```

**`--ssh` is optional and orthogonal to reachability.** Adding `--ssh` to `tailscale up` enables [Tailscale SSH](https://tailscale.com/kb/1193/tailscale-ssh) — `tailscaled` claims port 22 on the tailnet IP and authenticates connections using tailnet identity instead of `authorized_keys`. Useful if you want to retire SSH keys for interactive admin access. **Not required** for either Kamal deploys or the CI runner; standard OpenSSH continues to work whether the flag is set or not. Default to off; flip on later if you want the centralized auth model.

Why on the host, not in a container: Tailscale-as-container forces you to share its netns or run sidecars per accessory. Host-level means every container's outbound traffic can reach the tailnet via the host's routing table, no Kamal config changes today.

No `products/menu/infra/kamal/config/deploy.yml` change required now. When you eventually add a second box, the diff is exactly:

```yaml
servers:
  web:
    hosts:
-     - <%= ENV.fetch("ONPREM_HOST") %>
+     - <%= ENV.fetch("ONPREM_HOST") %>     # tailnet IP or MagicDNS
+     - <%= ENV.fetch("VPS_HOST") %>        # tailnet IP or MagicDNS
```

That's the entire "prep for multi-host" investment. Do it next time you SSH to the box for something else.

---

## 7. External uptime monitoring (zero cost, off-box)

Every product exposes a `/up` endpoint (`HEALTHCHECK` in each Dockerfile, also reachable publicly):

| Product | URL |
|---|---|
| Menu   | `https://menu.iedora.com/up`   |
| Genkan | `https://genkan.iedora.com/up` |
| House  | `https://iedora.com/`          |

Wire an external monitor to ping these every 1–5 min and notify on failure. The check must run **off the homelab** — a self-hosted monitor going down with the host it monitors helps nobody.

**Recommended: [Better Stack](https://betterstack.com/) (free tier — 10 monitors, 3 min cadence, e-mail/Slack/SMS).** Setup is three fields per product (URL, expected status `200`, notification channel) on their UI. No code or repo change.

**Alternatives:**

- **UptimeRobot** — free, 5 min cadence, simpler UI. Fine if you don't need Better Stack's status page.
- **Cloudflare Health Checks** — already paying for Cloudflare; checks origin from multiple PoPs. Sits at the bottom of the Cloudflare dashboard under Traffic → Health Checks. Requires Pro plan for most useful features.

**Don't self-host the monitor.** Uptime Kuma on the same box that runs the app is theatre — when the box dies, so does the alarm.

When you eventually want metrics + traces (not just uptime), the upgrade is Grafana Cloud free tier + the Node OpenTelemetry SDK in each Next app. That's a bigger lift and explicitly out of scope until paying users exist.

---

## Comparison

| Scenario | Added cost/yr | Added latency/page | Added complexity | Best fit |
|---|---|---|---|---|
| 1. Single homelab | €0 | 0 (baseline) | None | Today. Pre-revenue, EU-local, ≤100 concurrent. |
| 2. Bigger homelab | €30–80 (amortized) | 0 | Low | CPU-bound but uplink+power still fine. Skip if undecided. |
| 3. Migrate to Hetzner | €48 | -10 to -50 ms (faster) | None — same `just menu::deploy` | First paying customer, or any reliability complaint. **Default next step.** |
| 4. Multi-host shared-DB (Tailscale) | €48 (one extra Hetzner) | +30 to +150 ms (east-west DB) | Medium — two hosts, tailnet, partial HA only | Paying users + zero-downtime deploys mandatory. Both boxes in same Hetzner region. |
| 5. Multi-region separate DBs | €108+ | depends — usually -50 to -150 ms for far users | High — replication, conflicts, cache invalidation | Thousands of tenants, real geographic spread. Not soon. |
