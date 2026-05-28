# Caddy + Cloudflare DNS-01 plugin (não vem na imagem oficial).
# Caddyfile copiado para a imagem (evita bind mount issues quando o
# `docker compose` corre via DOCKER_HOST=ssh:// remoto).
FROM caddy:2.11-builder AS builder
RUN xcaddy build --with github.com/caddy-dns/cloudflare

FROM caddy:2.11
COPY --from=builder /usr/bin/caddy /usr/bin/caddy
COPY Caddyfile /etc/caddy/Caddyfile
