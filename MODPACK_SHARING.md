# Bloom Modpack Sharing

Bloom Modpack Sharing creates a short code for an existing Fabric instance and imports that code through the normal verified Modrinth pack pipeline.

## User flow

Modpack Sharing does not appear in Utilities. Sharing starts from `Share instance` in an instance's three-dot menu and uses a compact three-step flow: choose a standalone copy or a synced pack, choose accepted Social friends, then optionally add a short message and send. The recipient receives a gift-style card inside the matching direct conversation, using the shared instance artwork, sender, instance name, Minecraft version, loader, an Accept action, and a compact X decline action. Pack invitations do not appear as administrative Inbox rows. Capability codes remain internal and are never shown in this Social flow.

## Group packs

Group packs add a permanent revision channel beside temporary sharing. The creator remains the permanent owner. New synced invitations are single-use and create one revocable credential for the intended recipient, whether that person receives `Can view` or `Can edit`. Owners can open `Manage access` from the Share dialog to review active people and pending invitations, change roles, revoke future access, or invalidate an unused invitation. A revoked member keeps the local instance they already downloaded but cannot retrieve future revisions. Editors can publish a conflict-checked revision but cannot transfer ownership, invite another editor, or manage access. Synced packs remain capped at ten recipients, including at most five editors.

Channels created before managed access remain in legacy mode so an update does not silently lock out existing people. The owner sees a one-time managed-access upgrade screen explaining that enabling individual credentials invalidates the older reusable member link and requires reinviting those people. Newly created channels always use managed access.

Member clients compare a tiny revision marker every 15 minutes while the sharing utility is open. Updates download directly from Modrinth, verify SHA-1 locally, and back up files before replacement. Bloom removes an older managed mod only when its current hash still matches the prior group revision, so locally changed or member-added mods are preserved.

## Manifest boundary

Bloom does not upload mod JARs. The launcher hashes each enabled JAR with SHA-1 and resolves the complete set in one request through Modrinth's bulk version-file API. Managed Bloom Cosmetics files and disabled JARs are excluded. Every verified Modrinth file is published. Unresolved local JARs are reduced to safe filenames and carried separately so the recipient sees exactly what still needs to be found manually; they do not block sharing and are never uploaded.

Version 1 manifests contain:

- instance name;
- Minecraft version;
- Fabric Loader version;
- safe `mods/*.jar` paths;
- one `cdn.modrinth.com` download URL per file;
- the matching SHA-1 checksum.
- filename-only entries for unresolved local mods.

Java paths, JVM arguments, memory settings, accounts, servers, options, configs, saves, screenshots, logs, resource packs, shader packs, and local files are never uploaded.

## Backend

The existing `https://api.north.bloomclient.org/minecraft` Cloudflare route hosts:

- `POST /v1/packs` to create a share;
- `GET /v1/packs/{code}` to retrieve it.

Codes use an ambiguity-free eight-character alphabet and expire after 30 days. Creation is limited per source address. Request bodies are capped at 256 KiB, manifests at 500 files, paths are restricted to safe JAR names, and downloads must use HTTPS from `cdn.modrinth.com`.

Production stores shares in `shares.sqlite` beneath `BLOOM_SHARE_DATA_DIR`. The VPS installer places that database in the existing private persistent backend volume and sets `BLOOM_SHARE_PUBLIC_URL`; local development uses an in-memory store.

Social delivery records live separately in `social.sqlite`. Creating invitations is transactional, friend-scoped, rate-limited, and idempotent per sender/request/recipient. A recipient must claim an invitation before Bloom reveals its internal capability code to the native client. Claims have a short lease, failed imports release the lease for retry, and only a completed local import marks the invitation accepted. Pending invitations may be declined, revoked, or expired without exposing the code through list responses.

The deployment installer explicitly restarts `bloom-api` after rebuilding the image; `enable --now` alone is not sufficient when an older service is already active. Repository shell scripts are locked to LF line endings so Windows packaging cannot corrupt Bash options such as `pipefail`.

## Import safety

Retrieved manifests are converted locally into a minimal `.mrpack` and passed to Bloom's existing importer. That importer rechecks paths and allowed download hosts, verifies SHA-1 after download, applies no untrusted overrides, and installs the required Minecraft and Fabric runtime. A persistent Downloads panel lists every unresolved filename until dismissed, while all verified files continue installing normally. Expired or unknown codes fail without creating an instance.

## Required regression checks

- valid code and full-link import;
- lowercase code normalization;
- unknown and expired codes;
- Fabric-only enforcement;
- empty, disabled-only, and Bloom-Cosmetics-only mod folders;
- mixed Modrinth and non-Modrinth JARs;
- filename-only shares when no JAR resolves through Modrinth;
- duplicate filenames and unsafe paths;
- untrusted download domains;
- checksum mismatch;
- code collision retry;
- request size, manifest size, file count, expiry, and rate limits;
- interrupted import and existing same-name instance suffixing.
- duplicate send retries and partially delivered recipient batches;
- non-friend recipients, duplicate recipients, expired invitations, and concurrent claims;
- failed imports releasing claims without losing the invitation;
- copy, synced-member, and single-use synced-editor acceptance.
- owner-only access listing, role changes, member revocation, pending-invite invalidation, and revoked-token rejection;
- legacy channel migration without automatic access cutoff, followed by explicit managed-access enablement.
