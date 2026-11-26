# Delight Client modpack sharing

## Pack Workspace player links

Open an instance’s **Pack Workspace** and choose **Create shared pack** to review its installed files. **Publish version 1** creates a release for the signed-in Delight publisher. The final review shows the game, Fabric loader, file versions, enabled states and explicitly excluded folders. The creator can add a release note. After publication, **Copy player link** is available on that instance’s Overview.

The native client rechecks the review fingerprint before sending a manifest. The sharing service authenticates the publisher, verifies the Fabric target and exact Modrinth files and dependencies, then records the immutable first release in SQLite. Launcher-managed cosmetics carry a checksum and use Delight as their source. A local publication ID lets the client recover the same link after an interrupted request. Anyone with the player link can view the release without signing in.

The review flags active files that declare the same Fabric mod ID. **Choose version** shows the files and lets the creator confirm which one stays enabled. Delight rechecks the group against the reviewed files before changing enabled state and refreshes sharing compatibility afterward.

**Review dependencies** groups missing required mods by Modrinth source and shows the exact compatible downloads and disabled copies it can enable. An installed provider in a duplicate group still satisfies matching requirements in the warning list. Its conflict remains blocking. The dependency installer verifies the reviewed inventory and pins before staging actions, refuses replacements and duplicate active Fabric IDs, and applies an independently safe set when some other requirements cannot be resolved.

If Modrinth returns no match for an exact mod file, the creator can check **Keep local** and apply their choices. Delight matches each choice to the reviewed filename and SHA-512. The creator keeps the file in their instance, and the shared manifest contains only the deliverable files. The same check applies to first releases, updates and editor drafts. The creator’s review lists the omitted files before publishing.

The service uses the existing `BLOOM_SHARE_DATA_DIR` volume and `BLOOM_SHARE_PUBLIC_URL` base. Requests use `POST /v1/workspace-packs`, owner-scoped recovery at `GET /v1/workspace-publications/:publicationId`, latest manifest reads at `GET /v1/workspace-packs/:code`, and the HTTPS player page at `GET /share/pack/:code`. Production serves these paths under `/minecraft`. Earlier `/p/:code` links remain supported.

### Install & follow

Choose **Open in Delight** on the player page, or paste the web address in the launcher under **File → Open player link** or **New instance → Open player link**. Each entry opens the same review. It shows the pack name, creator, release note, Minecraft and Fabric versions, published files, enabled states and any folder exclusions. The download estimate covers pack files fetched from Modrinth. Minecraft and Fabric may require additional downloads.

**Install & follow** creates a separate instance and opens it in the library. Delight uses `GET /v1/workspace-packs/:code/install` for new preview and install admission, checks the release against the preview, downloads into staging and verifies each file’s SHA-512 checksum and size. A launcher-managed file must match the bundled version. The installer prepares the pinned runtime and checks admission and release freshness again before registering the instance. A failed download can be retried. If the release changes before installation, review it again.

Delight records the canonical player link, installed release and new instance ID together. A same-name local instance keeps its own files. Reopening the link offers **Open instance** or **View update**. The saved release can still open offline after a local rename.

### Publish and apply an update

The creator opens **Sharing → Changes**, reviews the difference against the last published version, chooses the update policy and publishes the next version. Required updates need a reason. The service checks the publisher and base revision again and appends an immutable release. The player URL remains stable. **Releases** shows the history. The service exposes summaries at `GET /v1/workspace-packs/:code/releases` and a specific manifest at `GET /v1/workspace-packs/:code/releases/:revision`.

The owner can select an older release in **Releases**, compare it to the current head, and choose **Restore as new release**. The review uses the usual policy and note fields and starts on Optional. `POST /v1/workspace-packs/:code/restore` revalidates the historical snapshot and its pinned sources, checks ownership and the expected head, then appends a new immutable revision. A request ID makes a retry idempotent. Optional restores retain the current minimum playable revision.

The follower opens **Sharing → Releases** to compare their installed version directly with the latest and choose **Update instance**. Play also checks for updates. An optional update offers **Play current version** or **Update & play**. A required release advances the minimum playable revision. A later optional release retains that minimum, including when the client has learned it and subsequently goes offline.

An update stages and verifies changed content before activating it in the existing game directory. Delight tracks ownership by its saved release, keeps personal files and saves in place, and preserves the instance ID and local name. Changed managed files and destination collisions identify the file that needs attention. A local journal restores an interrupted activation. The activation currently needs a filesystem that supports hard links. A followed game started by this client retains a process guard across launcher restarts. Updates become available again after the game exits.

**Repair pack files** checks the files managed by the installed release and restores missing or modified files from its verified snapshot. Altered managed files are backed up before replacement. Personal files outside the installed manifest stay in place. Delight also saves a separate copy of the instance’s worlds before activating a Minecraft version change. The update stops if that backup fails.

The web preview, desktop protocol handler and installer work together in the local development build. Community use requires a backend deployment and a client release that registers `delight://`. Isolated development profiles copy `delight://` links for their fixture service. Production invitation links use `/share/invite#<token>` so the secret stays out of HTTP request URLs. Older invitation paths remain supported.

### Collaborator access

Pack owners manage View and Edit invites under **Sharing → Access**. Invitations can expire and can have a maximum number of successful grants. Recipients preview the invitation and sign in to accept it. Redemption checks limits and writes the account grant in one transaction. The service returns the link once and stores its token hash.

**Revoke link** stops new grants. **Remove access** removes a person’s grant and prevents them from using links issued before removal. A fresh grant retains that cutoff, including when a removed editor rejoins as a viewer. An editor can open a verified working copy independently of their followed instance. **Can publish** allows a named editor to append optional releases. Required releases and access management belong to the original owner. The backend checks the current grant again in the publication transaction.

Under **Player link**, the owner can **Pause sharing** or **Resume sharing**. Pause disables the player page, new Delight installs, and new invitation grants. Existing followers can update, existing collaborators keep their permissions, and the owner can revoke invitations while paused. Resume reopens the same links subject to their existing expiry, use and revocation rules. The manifest and release history endpoints remain available for followers.

### Draft review

Editors save a verified snapshot private to their account with `POST /v1/workspace-packs/:code/drafts`. A draft captures the manifest, base release and editor note. Submission gives the owner access to that version. Return and withdrawal restore editing. Owner publication resolves the submitted files again, then checks the exact draft version, current release and editor access inside the same SQLite transaction as the new release. The owner reviews the stored snapshot in the client. Stale working copies and submissions remain available for review against a newer release.

## Legacy Social instance sharing

Bloom Modpack Sharing creates a short code for an existing Fabric instance and imports that code through the normal verified Modrinth pack pipeline.

## User flow

The instance’s three-dot menu now opens Pack Workspace for sharing. Legacy invitations already delivered in Social retain their gift-style card, instance artwork, sender, instance name, Minecraft version, loader, Accept action and compact decline action. Capability codes stay internal.

## Group packs

Group packs add a permanent revision channel beside temporary sharing. The creator remains the permanent owner. New synced invitations are single-use and create one revocable credential for the intended recipient, whether that person receives `Can view` or `Can edit`. Owners can open `Manage access` from the Share dialog to review active people and pending invitations, change roles, revoke future access, or invalidate an unused invitation. A revoked member keeps the local instance they already downloaded but cannot retrieve future revisions. Editors can publish a conflict-checked revision but cannot transfer ownership, invite another editor, or manage access. Synced packs remain capped at ten recipients, including at most five editors.

Channels created before managed access remain in legacy mode so an update does not silently lock out existing people. The owner sees a one-time managed-access upgrade screen explaining that enabling individual credentials invalidates the older reusable member link and requires reinviting those people. Newly created channels always use managed access.

Member clients compare a tiny revision marker every 15 minutes while the sharing utility is open. Updates download directly from Modrinth, verify SHA-1 locally, and back up files before replacement. Bloom removes an older managed mod only when its current hash still matches the prior group revision, so locally changed or member-added mods are preserved.

## Manifest boundary

Bloom does not upload mod JARs. The launcher hashes each enabled JAR with SHA-1 and resolves the complete set in one request through Modrinth's bulk version-file API. Managed Bloom Cosmetics files and disabled JARs are excluded. Every verified Modrinth file is published. Unresolved local JARs are reduced to safe filenames and carried separately so the recipient sees exactly what still needs to be found manually; they do not block sharing and are never uploaded.

Sharing and installation use the same Fabric Loader resolver. A nonempty saved loader version takes priority. Older instances with a missing/blank version recover it from their own `logs/latest.log` startup identity when its Minecraft version matches; only the first 64 KiB is read, and log contents are never uploaded. If no matching startup identity exists, resolution uses the existing Fabric Meta latest-stable fallback. Sharing saves the resolved version through the existing instance configuration path, and successful loader installation remembers it too. A fresh configuration read preserves newer settings and does not replace an explicitly selected loader or a changed game/directory. Missing metadata produces a connection error rather than requiring a nonexistent loader-selection control.

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

Opening Share restores and validates the saved Bloom session through the same native helper as Social, including legacy profile activation, before loading friends. Visiting Social first is never required. Authenticated Social requests refresh and retry once after a rejected access token; refreshes are serialized and reuse a session already renewed by another request. Sign-out uses the same credential lock, so an in-flight refresh cannot restore deleted credentials. Connectivity failures remain retryable loading errors rather than being presented as a signed-out account.

The deployment installer explicitly restarts `bloom-api` after rebuilding the image; `enable --now` alone is not sufficient when an older service is already active. Repository shell scripts are locked to LF line endings so Windows packaging cannot corrupt Bash options such as `pipefail`.

## Import safety

Retrieved manifests are converted locally into a minimal `.mrpack` and passed to Bloom's existing importer. That importer rechecks paths and allowed download hosts, verifies SHA-1 after download, applies no untrusted overrides, and installs the required Minecraft and Fabric runtime. A persistent Downloads panel lists every unresolved filename until dismissed, while all verified files continue installing normally. Expired or unknown codes fail without creating an instance.

## Required regression checks

- valid code and full-link import;
- lowercase code normalization;
- unknown and expired codes;
- Fabric-only enforcement;
- missing/blank loader metadata, per-instance startup-log recovery, stable-loader fallback, and preserving explicit loader selections and newer instance settings;
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
