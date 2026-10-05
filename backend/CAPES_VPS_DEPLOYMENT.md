# Cape API: single-node VPS deployment

## Confirmed deployment, October 3, 2026

The running catalog and cape API are on the owner-controlled Ubuntu 24.04 VPS at
`83.147.217.229`, not the suspended Pterodactyl origin or the historical
Mac/Supabase deployment. The source lives at `/opt/bloom-api`; a systemd service
runs the restricted `bloom-minecraft-api:local` Docker image on loopback port
8110. Caddy terminates public TLS on standard ports 80/443.

Cloudflare `api.north.bloomclient.org` is proxied to `83.147.217.229`. Its legacy
Origin Rule now rewrites the destination port to 443 rather than the retired
port 25604. Caddy owns the Let's Encrypt origin certificate. The public
`/minecraft/health` and `/minecraft/v1/capabilities` routes return 200 with
`cosmetics:true`; the initial cape catalog is intentionally empty.

## Storage

`SqliteCosmeticsStore` implements the same cape API as the Supabase adapter.
Metadata and PNG blobs are private in one SQLite database, outside the API code
directory, using WAL and synchronous FULL transactions. Database size is capped
at 524288 pages (2 GiB at the standard 4 KiB page size), excluding transient WAL
and backup space. Provisioning uses a 0700 data directory and 0600 database on
Linux. There is no public file server or exposed database port.

Draft metadata and image bytes commit atomically. Publication changes one
revision pointer transactionally. Prior revisions remain available for rollback.
Opaque asset links expire after five minutes; their token hashes, not plaintext
tokens, are stored in the database. Unpublish/revision updates invalidate old
asset links immediately. Expired leases and sessions are pruned on issuance.

Persistent storage is mounted at `/var/lib/bloom/capes`. It is owned by the
unprivileged container user and remains outside the image/source directory. Run
`node --test cosmetics/*.test.mjs` against staged source; tests create and remove
only temporary test databases.

## Activation configuration

After acceptance, supply these through the API service's environment:

- `BLOOM_COSMETICS_ENABLED=true`
- `BLOOM_CAPE_STORAGE=sqlite`
- `BLOOM_CAPE_DATA_DIR=/var/lib/bloom/capes`
- `BLOOM_CAPE_PUBLIC_URL=https://api.north.bloomclient.org/minecraft`
- `BLOOM_CAPE_OWNER_UUIDS`: owner-confirmed, verified Minecraft UUID, compact form.
- `BLOOM_CAPE_STUDIO_PASSWORD_HASH`: a 16-byte hex salt, a colon, and a
  32-byte hex scrypt result. Generate and enter it privately on the VPS; never
  commit the password or hash to this repository.

No Supabase credentials or signing key are needed for this storage mode. Studio
exchanges the private password for a revocable in-memory bearer session; it does
not send or embed a Minecraft UUID as proof of ownership. A restart invalidates
all Studio sessions and requires the password again.
Run `node cosmetics/preflight.mjs` under the same service configuration before
activation. Readiness failure disables capes while preserving catalog service.
Readiness is not equivalent to full acceptance or proof of asset rendering.

## Deployment and rollback

`install-ubuntu-vps.sh` is the reproducible first-install baseline. For updates,
stage new source separately, run backend tests, build a new Docker image, and keep
the previous image tag until public health checks pass. Restart with
`systemctl restart bloom-api`; reload proxy changes with `systemctl reload caddy`.
Never place database files under `/opt/bloom-api` or an image layer.

Back up SQLite using SQLite's online backup facility (or stop all writers and
back up the database plus WAL together); do not copy a live main DB alone.
Reverting code must not delete the database or cape revisions. This deployment
does not change launcher versions, publish releases, or activate client builds.

## Remaining acceptance gates

Real password-authenticated static/animated publishing; two-account Fabric
1.21.11 observation; revision/unpublish updates without restart; badge teams,
sneaking and compatibility; managed-install crash recovery; runtime resource
budgets. Public cosmetics discovery is enabled for integration testing, but do
not ship a production client update until these pass. The deployed Node 22 image
supplies the required `node:sqlite` runtime; the Supabase deployment uses its
separate migration.
