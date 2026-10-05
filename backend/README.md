# Bloom Minecraft API foundation

This directory contains the small public API boundary used by Bloom Client. It exposes health and capability discovery plus the Fabric-only Modrinth catalog adapter. CurseForge remains disabled until a server-side API key and rate-limit policy are available.

The live API is now confirmed on the Pterodactyl VPS. See
[`CAPES_VPS_DEPLOYMENT.md`](CAPES_VPS_DEPLOYMENT.md) for its private SQLite cape
storage and deployment/rollback procedure. The Mac/Supabase instructions below
are historical and are not the current deployment target. Never use DEFYND
credentials or expose database/admin interfaces.

Public endpoint: `https://api.north.bloomclient.org/minecraft`

Current routes:

- `GET /health`
- `GET /v1/capabilities`
- `GET /v1/catalog/search?query=&gameVersion=1.21.1&loader=fabric&offset=0`
- `GET /v1/catalog/modrinth/:projectId/install?gameVersion=1.21.1`

The catalog normalizes Modrinth results, caches provider responses briefly, resolves an exact Fabric/game-version file, and includes required Modrinth dependencies in its install plan. CurseForge and remote modpack capability flags remain `false`.

Historical Supabase deployment (not the current VPS):

```sh
sudo docker compose --env-file .env -p minecraft-supabase \
  -f docker-compose.yml -f compose.backend.yml up -d --build minecraft-api
```
