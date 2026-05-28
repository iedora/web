-- Postgres init — corre uma vez quando o volume está vazio.
-- One database per iedora product; cada produto corre as suas
-- migrations (drizzle-kit) contra a sua DB.

CREATE DATABASE menu;
CREATE DATABASE core;
CREATE DATABASE imopush;
