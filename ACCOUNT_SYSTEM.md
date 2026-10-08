# Bloom account system

Bloom accounts are stable application identities authenticated through Google or GitHub. Bloom does not store account passwords and does not use email addresses or provider usernames as immutable identity keys.

## Runtime boundary

- The existing Node service owns `/api/auth/*` and `/v1/account/*`.
- Better Auth implements OAuth Authorization Code + PKCE, CSRF/state verification, provider callback validation, session cookies, account linking, and session revocation.
- SQLite at `BLOOM_AUTH_DATA_DIR/accounts.sqlite` stores users, sessions, provider identities, and short-lived OAuth verification state. It runs in WAL mode with foreign keys and a busy timeout.
- OAuth token material is encrypted before database storage.
- The public website proxies account routes to the API so the session remains a first-party cookie on the website origin.

## Identity and linking rules

- Google and GitHub provider subject IDs identify external accounts.
- Matching email addresses never silently merge Bloom accounts.
- A second provider can be connected only from an authenticated Bloom dashboard.
- Different verified provider emails may be explicitly linked because provider ownership is proven during that authenticated flow.
- The final linked provider cannot be removed.
- Up to five distinct Bloom accounts can be retained on one device through Better Auth's multi-session plugin. Adding an account starts a fresh provider chooser without destroying the current account; the dashboard can then switch the signed first-party session between those saved identities or sign out only the active one.

## Session policy

- Sessions expire after 30 days and rotate daily.
- Production cookies are `Secure`, `HttpOnly`, `SameSite=Lax`, scoped to `/`, and use the Bloom prefix.
- Account mutation routes retain Better Auth's origin and CSRF checks.
- Production authentication endpoints are rate-limited by Cloudflare's sanitized `cf-connecting-ip` header.
- A user can revoke all other sessions or permanently delete their account from the dashboard.

## Production requirements

- Set `BLOOM_SITE_URL`, a high-entropy `BLOOM_AUTH_SECRET`, and both providers' client ID/secret pairs in the private VPS environment file.
- Register exact callback URLs from the website deployment guide.
- Keep the origin inaccessible except through the configured Caddy/Cloudflare path so client-IP headers cannot be spoofed.
- Back up the complete account SQLite database state off-host every day.
- Never log callback bodies, authorization codes, provider tokens, cookies, secrets, or `.env` contents.

The account system is deliberately separate from Microsoft/Minecraft authentication. Linking a website identity never sends Microsoft access or refresh tokens to this service.
