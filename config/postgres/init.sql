-- Dev Postgres bootstrap. Runs once on first container start (mounted into
-- /docker-entrypoint-initdb.d by infra/dev/docker-compose.yml). Creates the
-- app's databases on the single local server; the *_DATABASE_URL vars in
-- apps/web/.env point at these.
CREATE DATABASE menu;
CREATE DATABASE core;
