# Bloom Social System

Status: implementation in progress on the live client branch. Browser PKCE sign-in, credential-backed local vault storage, exact-name friendships, encrypted one-to-one and ten-person group text/reactions, normalized encrypted direct-message screenshots, local safety-number/QR verification, and enforced active-device identity-change review are implemented. Signed account-root device pairing, blocking/report disclosure UI, unread notifications, group screenshots, and the required external integration review remain release blockers.

Bloom Social is a small encrypted messaging surface for Minecraft friends. It is limited to friendships, direct messages, and private group chats with at most ten total members. It is not a Discord replacement and must not contain channels, public rooms, parties, presence, activity feeds, recent downloads, voice, video, or decorative community statistics.

Instance invitations are delivered through Social while the existing verified Modrinth sharing engine remains responsible for pack creation and import. Utilities keeps its code-based sharing workflow for manual use; Social hides those capability codes behind authenticated friend-only invitations.

## First-release scope

Social v1 includes:

- exact Bloom account username friend search;
- incoming and outgoing friend requests;
- one-to-one direct messages between accepted friends;
- private group chats with at most ten members and friend-only additions;
- end-to-end encrypted text and Unicode emoji;
- end-to-end encrypted emoji reactions;
- one small screenshot/image attachment per message;
- unread state, local notifications, blocking, removing friends, and reporting;
- a labeled Encryption view with a per-friend safety number and QR code.

Social v1 does not include:

- public or private channels;
- arbitrary group messages or pack rooms;
- online, away, in-game, or activity status;
- typing indicators or read receipts visible to the other person;
- voice, video, clips, GIF search, stickers, remote embeds, link previews, or arbitrary files;
- recent downloads, shared-file shelves, party invitations, or a right-hand activity rail;
- message search on the server;
- cloud recovery capable of decrypting messages.

## Page design

Add `Social` as a first-class sidebar destination between Utilities and Settings. A restrained unread dot may appear on its icon; do not add a numeric badge to the locked global sidebar.

The Social page uses only two regions inside one full-height workspace:

1. a compact direct-message rail on the left;
2. the selected conversation on the right.

Do not reserve a third column. Future pack or profile details may use a temporary drawer contained within the Social workspace, but the normal page must remain a clean two-pane layout.

### Direct-message rail

The rail begins with `Messages` and one labeled `Add friend` action. The label is required because friend discovery is not an obvious icon-only action. Beneath it is a compact local conversation filter. It filters already loaded conversations and never becomes a public username search.

Conversation rows show only:

- the Minecraft skin face;
- current Bloom account username;
- one locally decrypted single-line message preview, or `Image` for a screenshot-only message;
- the local timestamp of the newest message;
- one restrained unread dot when needed.

Do not show online dots, game status, server, version, roles, mutual friends, message counts, or fake activity. The active row uses the existing restrained accent-tinted Bloom navigation treatment. Hover changes color only and never lifts, scales, or slides the row.

The rail may contain a small Requests segment above conversations while requests exist. Incoming rows expose Accept and Decline; outgoing rows expose Cancel. Empty request space disappears rather than leaving a heading with no content.

### Conversation header

The header shows the friend's skin face and username at the left. The right side contains labeled `Encryption` and overflow actions. Encryption must not be represented by an unexplained icon.

Selecting Encryption opens a contained security drawer with:

- the friend's username;
- the verification state: `Not verified`, `Verified`, or `Key changed`;
- the shared 60-digit safety number in readable groups;
- a QR code containing the same canonical verification payload;
- `Scan code` and `Mark verified` actions;
- the date this identity was first seen or last changed.

The drawer explains in one short sentence that matching codes verify the conversation. It must not claim that an unverified conversation is unsafe, and it must not label a contact Verified until the user explicitly compares or scans the code.

The overflow menu owns Remove friend, Block, and Report. These consequential actions require the existing Bloom confirmation treatment.

### Message history

Use a calm chronological message stream rather than alternating oversized chat bubbles. Consecutive messages from the same sender within five minutes share one avatar/name header. Each visible group has enough vertical separation to scan without turning every message into a card.

Normal message content contains only the sender, local time, text, optional screenshot, and existing reactions. Do not print `encrypted`, delivery metadata, device identifiers, UUIDs, or protocol information beside every message.

Hovering or keyboard-focusing a delivered message reveals a stationary compact action strip with Pin and React. There is no CSS lift or scale animation. The pin is a plain white Lucide control and the header owns a matching compact pinned-messages button and drawer.

Unpinned messages, reactions, device envelopes, and encrypted screenshot blobs have one fixed 24-hour lifetime. Clients prune decrypted local records during every Social sync and the backend deletes expired ciphertext and blob files before serving new requests. Pinning sends a separate encrypted control event that contains the protected message snapshot; only its opaque per-device envelopes remain durable. Unpinning removes the local durable state and lets the ordinary 24-hour retention boundary apply again. The backend can route pin state but cannot read pinned text, attachment keys, or image contents.

Reactions appear as small rounded counters beneath the message. A person may add one of each emoji to a message and toggle it off. The encrypted reaction event references the target message identifier; the backend sees neither the chosen emoji nor the readable target contents.

Screenshot attachments render as a bounded rounded preview beneath their message. Selecting a preview opens Bloom's contained image viewer. It must never launch or execute the downloaded file.

### Composer

The composer remains pinned to the bottom of the conversation surface and contains:

- an image-attachment button;
- a multiline text field;
- an emoji button;
- a compact accent Send button.

The placeholder is `Message <username>`. Enter sends and Shift+Enter adds a line. Sending text and an image together is allowed. The Send button is disabled while the draft is empty, while image preparation is running, or while the current identity change still requires acknowledgment.

The emoji button opens a compact attached picker of Unicode emoji. It must not fetch GIFs, stickers, remote art, or third-party search results. Windows' native emoji picker remains usable inside the text field.

Dragging or pasting a supported image into the conversation enters the same attachment-review state as the attachment button. Before sending, the composer shows the image thumbnail, final encoded size, and a Remove action. The message is not sent until encryption and upload both succeed.

### Page states

- **Signed out:** open the Bloom Client website account surface with `Continue with Google` and `Continue with GitHub`. Do not show an email/password form inside the launcher.
- **No friends:** show Add friend as the only primary action. No fake contacts or suggested strangers.
- **No conversation selected:** center the Bloom message icon and `Select a message` only.
- **New friendship:** open a normal empty conversation with the composer ready. Do not add a welcome paragraph.
- **Offline:** keep decrypted local history readable, mark unsent messages Pending, and retry safely when connectivity returns.
- **Service unavailable:** retain local history and expose one Retry action without signing the Bloom or Minecraft account out.
- **Key changed:** keep old local history visible, stop new sends, and show one direct Review encryption action in the header.
- **Blocked:** hide the composer and show only the blocked state plus Unblock.

## Bloom identity and friendship

- A random immutable Bloom user ID is the permanent Social account identifier.
- The user chooses one unique Bloom account username after the first Google or GitHub sign-in. That username is the exact-search name and may change only through a rate-limited account setting.
- Google and GitHub are authentication providers, not the visible Social identity. Provider profile names, emails, and avatars never silently replace the chosen Bloom profile.
- A user may link both Google and GitHub to one Bloom account from authenticated account settings. Matching provider emails never auto-merge accounts.
- Provider identities are keyed by the provider's stable subject identifier: Google's `sub` and GitHub's immutable numeric account ID. Email addresses are contact data, never account keys.
- A verified Minecraft account is linked separately for launching, ownership checks, Minecraft username display, and the optional skin-face avatar. Changing or unlinking Minecraft does not create a new Social account, friend list, inbox, or safety number.
- Search requires the complete Bloom account username. Prefix search, suggestions, and a public user directory are omitted.
- Minecraft skins remain client-cached; Bloom does not store or proxy avatar images. A user without a linked Minecraft profile receives a local Bloom monogram rather than a provider profile photo.
- Each Bloom account has one friend list and inbox across linked providers and Minecraft profiles.
- Initial limits are 150 accepted friends, 50 pending incoming requests, and 20 outgoing requests per hour.

Removing a friend prevents new messages but does not silently delete either person's local history. Blocking removes the friendship, rejects pending requests, suppresses the conversation, and prevents new requests or message envelopes in either direction.

## End-to-end encryption

Bloom must not invent a new cryptographic protocol or present ordinary TLS as end-to-end encryption. Production messaging requires a maintained, independently reviewed protocol implementation with a license compatible with Bloom. The selected implementation and version must be recorded before code is merged, and an external security review is required before Bloom describes Social as secure in public release notes.

The selected implementation is `vodozemac` 0.11.x under Apache-2.0. Bloom uses its audited Olm one-to-one asynchronous prekey handshake and double ratchet through the crate's high-level API. Account and session pickles remain encrypted locally, with the surrounding Social vault encrypted separately and its random key held by Windows Credential Manager. This selection covers the cryptographic primitive implementation only: Bloom's protocol integration still requires the external review and two-account acceptance defined below before a public release may describe Social as secure.

### Device and account identity

Each Bloom user ID owns a long-term Bloom encryption identity. Each launcher installation owns a separate signed device identity.

- The first device creates the account identity locally.
- Additional devices are paired by scanning a QR code from an already trusted device.
- The existing device signs the new device key; the server cannot add a trusted device itself.
- If no trusted device remains, the user resets the Bloom identity. Friends see `Key changed` and must acknowledge or reverify before sending.
- There is no server-held recovery key and no password-derived private key.

Private identity, device, session, and attachment keys are never stored in plaintext. A random local database key is stored through Windows Credential Manager, and the encrypted Social database contains the private key material and decrypted local history. Signing out locks the local database; removing an account requires an explicit choice before deleting its local history and keys.

### Session establishment and message keys

Use an asynchronous reviewed prekey handshake followed by a Double Ratchet-compatible session:

- one signed identity key per account;
- one signed device key per installation;
- a rotating signed prekey per device;
- a bounded supply of one-time prekeys replenished by the client;
- a fresh message key for every message or reaction;
- forward secrecy and post-compromise key recovery through ratchet advancement;
- skipped-message keys bounded and expired to prevent unbounded storage attacks.
- outbound sessions are reused only while the authenticated recipient device ID remains bound to the same Curve25519 identity; a changed or revoked identity discards the cached session and requires a fresh prekey handshake, and identity rotation atomically removes every unclaimed prekey belonging to the old identity before replacement keys are accepted;
- an undecryptable legacy envelope cannot permanently stall delivery of later valid prekey messages, but ciphertext addressed to a discarded private identity remains intentionally unrecoverable.

The authenticated associated data binds the protocol version, conversation identifier, sender and recipient UUIDs, sender and recipient device identifiers, message type, and client-generated idempotency identifier. A valid ciphertext cannot be moved into another conversation or represented as another event type.

Every recipient device receives its own encrypted envelope. The backend stores opaque envelopes and delivery sequence numbers only. A compromised or malicious backend must not be able to derive message text, emoji, reaction value, image key, or safety number secrets.

### Safety number and QR code

The per-friend code is a verification fingerprint, never an encryption password. Both friends calculate the same canonical value locally from:

- the protocol version;
- both immutable Bloom user IDs in canonical order;
- both long-term public identity keys in the same order.

The result is rendered as 60 decimal digits in twelve groups of five and as a QR payload containing the same versioned data. The raw private keys never enter the code or QR image. Codes are compared in person, over a trusted call, or by scanning the other person's screen. They are never submitted to the Bloom backend as proof.

Verification state is local to each device. Any identity-key reset clears Verified, changes the safety number, pauses sending, and creates a prominent local security event.

### Encrypted reactions

A reaction is a normal encrypted event containing the target message identifier, emoji, and add/remove operation. The backend routes it like a message and cannot aggregate readable emoji counts. Clients deterministically fold valid reaction events into the displayed counters.

### Encrypted screenshot attachments

Social v1 accepts one image per message:

- PNG, JPEG, or WebP input only;
- maximum decoded dimensions of 4096 by 4096;
- maximum final encoded size of 8 MiB;
- no animated image, SVG, archive, document, executable, or arbitrary binary upload.

The sender decodes and re-encodes the image locally before encryption. This strips unsupported payloads and metadata, normalizes orientation, and rejects corrupt or oversized input. A fresh random 256-bit content key encrypts the normalized bytes with reviewed authenticated encryption. The uploaded blob uses an opaque random identifier and contains ciphertext only.

The encrypted message descriptor contains the content key, MIME type, dimensions, byte size, ciphertext hash, and blob identifier. The descriptor is protected by the direct-message ratchet. Recipients authenticate and decrypt the descriptor, download the ciphertext, verify its hash, decrypt it, decode it as an image, and display it inside Bloom's image viewer.

The backend enforces ciphertext byte limits, per-user upload quotas, rate limits, authentication, and expiry but cannot inspect image content. Early deployments may use the existing private persistent volume. Object storage can replace that implementation without changing message semantics.

Encrypted blobs expire 24 hours after upload. Pinning their message extends the encrypted blob while the pin exists; unpinning restores the original 24-hour boundary and old blobs become eligible for immediate cleanup. A report action may explicitly include selected decrypted message and image content; nothing is disclosed for moderation without that user action.

### Metadata boundaries

End-to-end encryption does not hide all metadata. The backend can know account UUIDs, registered device identifiers, friendship edges, conversation identifiers, envelope sender and recipient devices, delivery sequence, timestamps, ciphertext sizes, and encrypted-blob sizes. Bloom must disclose this plainly in its privacy information.

## Bloom authentication

The launcher opens the operating system browser to the Bloom Client website's account page. That page creates or opens a Bloom account through Google or GitHub only. Bloom does not collect, transmit, or store provider passwords.

Use Authorization Code with PKCE, an unpredictable `state`, and the system browser:

1. The launcher creates a fresh high-entropy verifier, S256 challenge, state, and local attempt identifier.
2. It opens the Bloom authentication endpoint in the system browser and identifies Google or GitHub as the chosen provider.
3. The Bloom backend performs the provider authorization and validates the exact callback, state, issuer where applicable, audience, expiry, and nonce where applicable.
4. Google identity uses the validated OpenID Connect `sub`. GitHub identity is revalidated through GitHub and uses the returned immutable numeric user ID.
5. The backend returns a short-lived, single-use Bloom authorization code to Bloom. Bloom exchanges it with the original PKCE verifier.
6. Bloom receives a short-lived Bloom access token and rotating refresh token. Only token hashes and rotation state are stored server-side; local tokens use Windows Credential Manager.

The native launcher contains no provider client secret. Provider access tokens are discarded after the minimum identity claims are validated because Social does not need continuing Google or GitHub API access. Request only identity scopes; never request repositories, organizations, contacts, Drive, email sending, or unrelated account permissions.

Linking a second provider requires an active Bloom session, recent reauthentication, and explicit confirmation that the provider will join the current account. Signing into an unlinked provider creates a separate account rather than guessing based on email. Account merging is a separate confirmed recovery process and must resolve encryption identities and friendships before changing data.

OAuth recovery restores access to the Bloom account but does not restore E2EE private keys. A new device is paired from an existing trusted device. If none remains, the user resets the encryption identity, and every friend receives a Key changed state with a new safety number.

Minecraft sign-in remains a separate link flow for game ownership and launching. Microsoft/Minecraft access and refresh tokens are never sent to the Social backend or used as Bloom session credentials. Authentication routes suppress provider codes, tokens, headers, PKCE verifiers, and callback bodies from logs.

## Backend data model

Use a separate `social.sqlite` database in the existing private persistent backend volume. Keep it separate from `shares.sqlite` so Social can be migrated or rolled back independently.

```text
social_users
  id TEXT PRIMARY KEY
  username TEXT NOT NULL
  username_lower TEXT NOT NULL UNIQUE
  display_name TEXT
  identity_key BLOB NOT NULL
  identity_generation INTEGER NOT NULL
  created_at INTEGER NOT NULL
  updated_at INTEGER NOT NULL

social_provider_identities
  provider TEXT NOT NULL
  provider_subject TEXT NOT NULL
  user_id TEXT NOT NULL
  created_at INTEGER NOT NULL
  last_used_at INTEGER NOT NULL
  PRIMARY KEY(provider, provider_subject)

social_minecraft_links
  minecraft_uuid TEXT PRIMARY KEY
  user_id TEXT NOT NULL
  minecraft_username TEXT NOT NULL
  verified_at INTEGER NOT NULL
  updated_at INTEGER NOT NULL

social_devices
  id TEXT PRIMARY KEY
  user_id TEXT NOT NULL
  device_key BLOB NOT NULL
  device_signature BLOB NOT NULL
  signed_prekey BLOB NOT NULL
  signed_prekey_signature BLOB NOT NULL
  created_at INTEGER NOT NULL
  last_seen_at INTEGER NOT NULL
  revoked_at INTEGER

social_one_time_prekeys
  device_id TEXT NOT NULL
  key_id INTEGER NOT NULL
  public_key BLOB NOT NULL
  claimed_at INTEGER
  PRIMARY KEY(device_id, key_id)

social_sessions
  token_hash TEXT PRIMARY KEY
  user_id TEXT NOT NULL
  device_id TEXT NOT NULL
  created_at INTEGER NOT NULL
  last_used_at INTEGER NOT NULL
  expires_at INTEGER NOT NULL

social_friendships
  user_low TEXT NOT NULL
  user_high TEXT NOT NULL
  status TEXT NOT NULL
  requested_by TEXT NOT NULL
  created_at INTEGER NOT NULL
  updated_at INTEGER NOT NULL
  PRIMARY KEY(user_low, user_high)

social_blocks
  blocker_id TEXT NOT NULL
  blocked_id TEXT NOT NULL
  created_at INTEGER NOT NULL
  PRIMARY KEY(blocker_id, blocked_id)

social_conversations
  id TEXT PRIMARY KEY
  user_low TEXT NOT NULL
  user_high TEXT NOT NULL
  created_at INTEGER NOT NULL
  updated_at INTEGER NOT NULL
  UNIQUE(user_low, user_high)

social_envelopes
  sequence INTEGER PRIMARY KEY AUTOINCREMENT
  conversation_id TEXT NOT NULL
  sender_id TEXT NOT NULL
  sender_device_id TEXT NOT NULL
  recipient_id TEXT NOT NULL
  recipient_device_id TEXT NOT NULL
  client_nonce TEXT NOT NULL
  event_kind TEXT NOT NULL
  header BLOB NOT NULL
  ciphertext BLOB NOT NULL
  created_at INTEGER NOT NULL
  UNIQUE(sender_device_id, client_nonce, recipient_device_id)

social_read_cursors
  conversation_id TEXT NOT NULL
  user_id TEXT NOT NULL
  last_read_sequence INTEGER NOT NULL
  PRIMARY KEY(conversation_id, user_id)

social_blobs
  id TEXT PRIMARY KEY
  owner_id TEXT NOT NULL
  ciphertext_size INTEGER NOT NULL
  ciphertext_hash BLOB NOT NULL
  created_at INTEGER NOT NULL
  expires_at INTEGER NOT NULL
```

The backend never receives a plaintext message body, emoji, reaction, attachment key, original filename, image dimensions, image MIME type, or decrypted thumbnail. `event_kind` is limited to routing classes such as message, reaction, edit, pin, and security event; it contains no readable content. Reply targets, edit targets, and per-person reaction operations live only inside the encrypted payload. A reaction is reduced by `(message, emoji, sender)` so one participant can never remove another participant's reaction.

Required indexes cover username lookup, each user's friendships, each recipient device's envelope sequence, conversation update time, unread cursors, and blob expiry. Enable foreign keys, WAL mode, bounded transactions, request-size limits, and periodic cleanup.

## Network and backend cost

Use authenticated long-poll change hints while Social is open. Each client holds one bounded request with an opaque durable cursor; a message, relationship, group, invite, profile, or device-identity mutation wakes the affected account immediately. Message-only hints fetch and decrypt only envelopes after the device's existing delivery cursors. Metadata hints reconcile the complete authoritative Social snapshot.

The cursor is derived from durable database state rather than an in-memory counter, so process restarts and missed wake-ups are recoverable. Each long poll ends after fifteen seconds and rechecks the durable cursor. Network failures use exponential fallback reconciliation from two to thirty seconds, and a five-minute full reconciliation repairs unanticipated drift. Signed-out clients stop watching. Account changes cancel the prior watcher logically, and stale results are rejected by the existing request/mutation ordering guards.

Every envelope read uses a delivery cursor, returns only new device envelopes, and supports compact empty responses. Local history loads from the encrypted client vault; the backend is a bounded delivery queue, not the readable source of truth.

Text and reaction envelopes are small. A one-to-one message is encrypted once per active recipient device plus the sender's other devices. Screenshot ciphertext is uploaded once and referenced by the encrypted descriptors. Backend cost is therefore dominated by optional screenshot storage rather than message encryption.

Initial controls:

- 2,000 Unicode characters per text message;
- one 8 MiB image per message;
- 30 messages per minute per account with short bursts allowed;
- 20 image uploads per hour per account;
- bounded active devices per account;
- expired prekey, envelope, session, and blob cleanup;
- configurable per-user encrypted-blob quota.

## API outline

```text
GET    /v1/auth/google/start
GET    /v1/auth/google/callback
GET    /v1/auth/github/start
GET    /v1/auth/github/callback
POST   /v1/auth/exchange
POST   /v1/auth/refresh
POST   /v1/auth/providers/link
DELETE /v1/auth/providers/:provider
POST   /v1/social/minecraft/link
DELETE /v1/social/minecraft/link
GET    /v1/social/me
GET    /v1/social/users/exact?username=

POST   /v1/social/devices
GET    /v1/social/devices
POST   /v1/social/devices/pair
DELETE /v1/social/devices/:deviceId
PUT    /v1/social/devices/:deviceId/prekeys
GET    /v1/social/users/:uuid/prekey-bundle

GET    /v1/social/friends
POST   /v1/social/friend-requests
GET    /v1/social/friend-requests
POST   /v1/social/friend-requests/:uuid/accept
DELETE /v1/social/friend-requests/:uuid
DELETE /v1/social/friends/:uuid
PUT    /v1/social/blocks/:uuid
DELETE /v1/social/blocks/:uuid

GET    /v1/social/conversations?updatedAfter=
GET    /v1/social/changes?after=&waitMs=
GET    /v1/social/envelopes?after=&limit=
POST   /v1/social/envelopes
PUT    /v1/social/conversations/:id/read

POST   /v1/social/blobs
PUT    /v1/social/blobs/:id
GET    /v1/social/blobs/:id
DELETE /v1/social/blobs/:id
```

The envelope endpoint accepts one atomic batch containing every intended recipient-device envelope. Idempotency keys make a retry return the original result rather than duplicate the message. Errors use stable identifiers and never include tokens, key material, ciphertext, or decrypted content in logs.

## Notifications

Bloom may raise a local operating-system notification after decrypting a new direct message. Notification previews default to sender name plus `New message`; readable text or image previews require an explicit local preference. The backend cannot construct readable push previews.

Unread state uses a per-conversation local cursor synchronized as an opaque delivery sequence. The other person never sees read receipts in v1.

## Abuse and reporting

- Exact-name discovery only.
- Friend-only direct messages.
- Per-account, per-device, and per-address rate limits.
- Block enforcement on reads and writes.
- No server-side URL fetching or remote previews.
- Strict ciphertext and image quotas.
- No arbitrary uploaded file types.
- Constant-shape lookup failures where practical.

Because the backend cannot read encrypted messages, a report must be an explicit client action. The report view shows exactly which selected messages, reactions, and images will be disclosed. The client packages their decrypted content, cryptographic message identifiers, sender identity, and relevant signatures for the moderation contact. It never silently uploads surrounding history.

## Instance invitations

An instance card's three-dot menu opens a three-step native flow: choose copy or synced sharing, choose up to ten accepted friends, then optionally add a short personal message and send. Synced editor invitations retain the pack engine's five-editor limit. The normal UI never displays codes, raw manifests, mod counts, excluded-file lists, permission internals, or backend state.

The backend stores only the invitation lifecycle and the existing pack capability code. Listing an invitation never returns that code. A recipient obtains it only through an authenticated, single-recipient claim with a short lease; the client marks the invitation accepted only after the native pack import succeeds and releases the claim after a failed import. Creation is transactional and idempotent so retries cannot duplicate invitation cards or optional encrypted notes. States are `pending`, `installing`, `accepted`, `declined`, `revoked`, and `expired`.

Invitation cards appear only in the corresponding direct-message chronology without creating a fake text message or an administrative Inbox entry. The direct-message row previews the latest invitation so recipients can find it even without an accompanying note. The card carries normalized instance artwork, one invitation sentence, Minecraft version and loader, a labeled Accept action, and a compact X decline action. Pack roles and revisions remain separate from group-chat membership; no group-chat content, account data, worlds, saves, logs, servers, screenshots, Java settings, or personal files enter a share.

## Implementation order

1. Select and document the audited, license-compatible protocol implementation; complete a threat model and test vectors.
2. Add authenticated Social sessions, device registration, exact-user lookup, friend requests, blocks, and backend tests.
3. Add local encrypted storage, device pairing/reset, prekey management, ratcheted direct-message envelopes, safety numbers, and key-change tests.
4. Add cursor delivery, idempotent sending, unread cursors, offline queueing, adaptive polling, and multi-device tests.
5. Add the two-pane Social UI with real signed-in, empty, offline, key-change, blocked, loading, and failure states.
6. Add encrypted reactions and the Unicode emoji picker.
7. Add local image normalization, encrypted blob upload/download, quotas, expiry, image viewer, and report disclosure.
8. Complete external security review and two-account acceptance before enabling Social in a production release.
9. Deliver authenticated friend-only instance invitations on top of the existing verified pack pipeline, with hidden capabilities, idempotent creation, leased acceptance, and failure-safe retry.

## Acceptance requirements

- Google and GitHub can each create or access a Bloom account through system-browser Authorization Code with PKCE without exposing a provider secret in the launcher.
- Linking Google and GitHub from account settings preserves one Bloom identity; matching emails never merge two accounts automatically.
- A Bloom account can link, replace, or unlink a Minecraft profile without changing its friends, inbox, encryption identity, or safety numbers.
- Two Bloom accounts can find, request, accept, message, react, block, remove, and report.
- The backend cannot decrypt captured message, reaction, or screenshot records.
- Every message uses a fresh ratcheted message key and each recipient device receives only its own envelope.
- Replaying, reordering, duplicating, moving, or changing the type of an envelope is detected or handled safely.
- A send retry creates one visible message.
- A revoked device cannot fetch new envelopes or publish accepted messages.
- Both friends independently calculate the same safety number, and replacing an identity changes it.
- Identity changes clear local verification, pause sending, and require acknowledgment.
- Pairing a device requires approval from an existing trusted device; a server cannot silently add one.
- Offline messages retain order and send once after reconnecting without duplication.
- Image bytes are normalized before encryption, stay within limits, and never execute or open externally.
- Reactions converge to the same visible state after retries and out-of-order delivery.
- Blocking prevents new requests, messages, envelopes, attachments, and notification previews in both directions.
- Social remains a two-pane messaging interface with private group chats and no public channels, online status, activity feed, or filler panels.
- Windows reduced-motion, animation-disabled, and Ultra Performance settings do not introduce movement or break any control.
