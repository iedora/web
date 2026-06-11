/**
 * Go backend base URLs, server-side only (the browser never calls the
 * Go services directly — everything goes through Next server code).
 *
 * Dev defaults match `services/docker-compose.yml`; prod points at the
 * swarm-internal DNS names (e.g. `http://auth:8080`).
 */
export const AUTH_URL = process.env.AUTH_URL ?? 'http://localhost:8080'
export const MENU_URL = process.env.MENU_URL ?? 'http://localhost:8084'
