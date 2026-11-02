-- Setup roles and database for shard 0
CREATE ROLE rota_owner WITH LOGIN PASSWORD 'rota_owner_secret' CREATEDB CREATEROLE;
CREATE ROLE rota_app WITH LOGIN PASSWORD 'rota_app_secret';
CREATE ROLE replicator WITH REPLICATION LOGIN PASSWORD 'postgres_root_secret';

-- Grant permissions to rota_owner
ALTER DATABASE rota_s0 OWNER TO rota_owner;
GRANT ALL PRIVILEGES ON DATABASE rota_s0 TO rota_owner;

\connect rota_s0;

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS btree_gist;

GRANT ALL ON SCHEMA public TO rota_owner;
GRANT USAGE ON SCHEMA public TO rota_app;
ALTER DEFAULT PRIVILEGES FOR ROLE rota_owner IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO rota_app;
ALTER DEFAULT PRIVILEGES FOR ROLE rota_owner IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO rota_app;

