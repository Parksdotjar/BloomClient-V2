## Improvements

- Cape loading now recovers automatically from interrupted or stalled texture downloads.
- Added occasional, privacy-safe cape connection warnings to Minecraft's log to make missing capes easier to diagnose.
- Tightened cape downloads: response-size limits apply while downloading, and texture requests cannot redirect away from the trusted asset endpoint.

## Fixes

- Fixed failed cape loads getting stuck in the cache instead of retrying.
- Fixed downloads that could wait indefinitely after receiving response headers, leaving a cape invisible for the rest of the game session.

Restart Minecraft through Bloom after updating to load the updated cosmetics renderer.
