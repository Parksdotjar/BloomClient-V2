# Bloom Minecraft API foundation

This directory contains the small public API boundary used by Bloom Client. It exposes health and capability discovery, the Fabric-only Modrinth catalog adapter, cosmetics, and expiring Modrinth-backed pack-share codes. CurseForge remains disabled until a server-side API key and rate-limit policy are available.

The live API is now confirmed on the Pterodactyl VPS. See
[`CAPES_VPS_DEPLOYMENT.md`](CAPES_VPS_DEPLOYMENT.md) for its private SQLite cape
storage and deployment/rollback procedure. The Mac/Supabase instructions below
are historical and are not the current deployment target. Never use DEFYND
credentials or expose database/admin interfaces.

Public endpoint: `https://api.north.bloomclient.org/minecraft`

Current routes:

- `GET /health`
- `POST /v1/packs`
- `GET /v1/packs/{code}`

Pack sharing stores manifests—not mod binaries—in `shares.sqlite` beneath `BLOOM_SHARE_DATA_DIR`. Production must mount that directory persistently and set `BLOOM_SHARE_PUBLIC_URL` to the public `/minecraft` base. See [`../MODPACK_SHARING.md`](../MODPACK_SHARING.md).

Revisioned group packs use the same database and public boundary. `POST /v1/pack-channels` creates a stable owner-controlled channel; `GET` reads its current revision; authenticated `PUT` publishes a conflict-checked revision. Owners can create single-use editor invitations, and redemption grants one of five editor seats without transferring ownership. Capability tokens are stored only as SHA-256 hashes by the backend; launcher copies live in Windows Credential Manager.
- `GET /v1/capabilities`
- `GET /v1/catalog/search?query=&gameVersion=1.21.1&loader=fabric&offset=0` (50 results per page; `total` reports the complete matching catalog count)
- `GET /v1/catalog/modrinth/:projectId/install?gameVersion=1.21.1`

The catalog normalizes Modrinth results, caches provider responses briefly, resolves an exact Fabric/game-version file, and includes required Modrinth dependencies in its install plan. CurseForge and remote modpack capability flags remain `false`.

Historical Supabase deployment (not the current VPS):

```sh
sudo docker compose --env-file .env -p minecraft-supabase \
  -f docker-compose.yml -f compose.backend.yml up -d --build minecraft-api
```
