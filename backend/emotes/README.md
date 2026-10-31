# Emote relay

`server.mjs` attaches the protocol-1 WebSocket relay to the existing HTTP(S) server. Paths are `/v1/emotes/socket` and `/minecraft/v1/emotes/socket`. Production uses the existing public HTTPS API base and WSS. The Dockerfile includes this directory.

Authentication reuses `Authorization: Bearer bcs_…` cosmetics sessions. The server resolves the UUID from the session store; payload UUIDs are never identity proof. Sessions expire and are checked again for revocation every 30 seconds. Tokens never appear in URLs or protocol messages.

The server keeps ephemeral state in one process: observed-player subscriptions, scoped starts/stops, late-join snapshots, monotonic event sequence numbers, and 30-second loop/hold leases renewed by clients every ten seconds. Starts include a bounded phase offset for reconnection. State disappears on restart; no database migration is needed.

Limits: 2,000 open/pending connections, four connections per verified account, 100 observed UUIDs, 16 KiB frames, 180 messages and 30 starts per minute per connection, bounded output buffering. Direct-client handshake attempts are limited by address; the shared loopback reverse proxy is excluded from that address limit. Authentication and global/account limits still apply behind Caddy. Do not trust arbitrary forwarded-address headers.

Scope is a hash of the server address and dimension. It is a routing hint, not server-membership proof. Players using different aliases for the same server will not share emotes until they use the same address. Only loaded, matching verified UUIDs are animated. Offline/spoofed identities fall back to local playback.

## Local tests

Run `npm test --prefix backend` from the repository root. Relay tests use actual WebSocket clients and test identity, scope, late snapshots, reconnect phase, stale stops, leases, revocation, and invalid messages. The cosmetics tests cover real session storage.

For two development Minecraft clients:

```powershell
node backend/emotes/dev-relay.mjs
```

In separate terminals, from the repository root:

```powershell
.\benchmark-mod\gradlew.bat -p bloom-cosmetics-mod :1.21.11:runClient -PemoteTestPlayer=BloomTestA
.\benchmark-mod\gradlew.bat -p bloom-cosmetics-mod :1.21.11:runClient -PemoteTestPlayer=BloomTestB
```

Use a disposable world opened to LAN and connect B using `127.0.0.1:<port>`. The relay binds only `127.0.0.1:19191`; its two hard-coded credentials are test identities, not production credentials. Profiles use separate `run-BloomTestA/B` folders. The endpoint override is disabled unless Fabric reports a development environment and only accepts a literal HTTP loopback address. Do not use these profiles for normal play.

## Deployment checklist

Deployment is a separately authorized operation. No backend or release has been published by adding this implementation.

1. Stage the tested backend source and lockfile on the existing VPS, following [the current deployment guide](../CAPES_VPS_DEPLOYMENT.md). Keep the previous image for rollback and keep persistent databases outside the image.
2. Run `npm ci --omit=dev` and `npm test`; build the updated Docker image. The local Windows workspace currently has no Docker executable, so container build verification must run on a Docker-capable host.
3. Keep one API process/replica. Multiple replicas require shared relay state or deliberate routing and are not supported by this implementation.
4. The existing Caddy `reverse_proxy` passes WebSocket upgrades. Preserve `/minecraft/v1/emotes/socket`, Authorization, TLS, and idle connections through any additional proxy; heartbeat traffic runs every 30 seconds.
5. Restart only the API service. Verify health, `capabilities.emotes: true`, and `emoteProtocol: 1`. An unauthenticated socket must receive HTTP 401, not an upgrade.
6. Test two real signed-in Minecraft accounts on the same server: Wave, late-join Sit, movement cancellation, and reconnect. Confirm ordinary clients still see normal player motion and old cape/badge endpoints work.
7. Release the rebuilt client/mod only after those checks. Client release versioning, tags, signing, publication, and backend deployment each retain their repository authorization requirements.

Rollback restores the preceding API image. Older backend versions lack this relay, so local emotes continue but remote emotes become unavailable. Capes, accounts, and stored content remain in their existing databases.
