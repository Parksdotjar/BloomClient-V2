# Sakura's Azalea protocol patch

This directory contains a narrowly patched copy of `azalea-protocol 0.16.0+mc26.1`, published by the Azalea project under the MIT license. Sakura uses it through a workspace-local `[patch.crates-io]` entry. The machine's Cargo registry source is unchanged.

## Provenance

- Published package: <https://crates.io/crates/azalea-protocol/0.16.0+mc26.1>
- Package download: <https://static.crates.io/crates/azalea-protocol/azalea-protocol-0.16.0+mc26.1.crate>
- Original archive SHA-256: `15e2203a1d672290513a9c62d4753f1004a69a6767aebb788b06b02779071156`.
- Published `.cargo_vcs_info.json` identifies upstream commit `a253702e2546a95cce68dc4a3b8b00a4c3570c1f`, directory `azalea-protocol`.
- The crate archive does not include a license text. `azalea-protocol/LICENSE` is the MIT license from that exact upstream commit's [LICENSE.md](https://github.com/azalea-rs/azalea/blob/a253702e2546a95cce68dc4a3b8b00a4c3570c1f/LICENSE.md), preserving its copyright notice.
- Cargo's installation marker and the package's standalone lockfile are omitted. Sakura's own lockfile controls the dependency graph. Original manifests, readme, packet source, examples, benchmarks and VCS metadata are preserved.

## Scope of the patch

The transport changes are confined to upstream `src/read.rs`:

1. Reject advertised wire frames larger than 8 MiB before waiting for their body. Oversized frames use a distinct fatal error instead of the existing retryable incomplete-frame error.
2. Bound pending receive data to the frame cap plus one 8 KiB read and header. Compact already-consumed prefixes before appending: repeatedly leaving an incomplete next frame must not retain the entire preceding stream.
3. Replace unbounded zlib `read_to_end` with a fixed destination of the advertised output length plus one byte. Preserve the existing 8 MiB advertised decompressed limit.
4. Require the actual output length to match, the zlib stream/checksum to finish, and all compressed input to be consumed. Reject truncated/corrupt streams and trailing compressed data.
5. Check the length and compression threshold of packets sent without compression after compression has been negotiated.
6. Surface framing/decompression failures at the raw connection boundary as fatal `InvalidData` IO errors. Azalea's client otherwise keeps the connection alive for these error variants. Socket fixtures verify immediate closure while the peer deliberately keeps its side open.

`src/packets/game/s_attack.rs` also marks the entity ID as a VarInt, matching the actual 26.1 attack packet. The upstream fixed-width encoding sent three extra bytes for small entity IDs and vanilla disconnected on a real mob attack. A byte-level regression checks small, multi-byte and negative IDs.

`src/packets/game/s_place_recipe.rs` uses the 26.1 recipe-display index (`u32` VarInt), rather than a resource-name string, alongside its VarInt container ID and Shift flag. The byte-level regression checks multi-byte IDs and an exact round trip. Actual recipe-book placement and repeated crafting also passed against the isolated official 26.1 server. This fixes the request encoding; the server still owns recipe validation, ingredients, results and remainders.

The patch does not alter packet IDs, login behavior or authentication. It addresses these particular framing/decompression, attack and recipe-placement encoding issues, **not a complete hostile-server security audit**. Registry/packet semantics, NBT parsing, world residency and application-level allocation budgets still need separate review before Sakura becomes a production client.

## Regression checks

From the `sakura` directory, with its pinned nightly toolchain and current workspace lockfile:

```powershell
cargo test --locked -p azalea-protocol --lib read::tests
cargo test --locked -p azalea-protocol --lib recipe_placement_uses_display_index_varint_not_a_resource_name
```

The added tests use the `sakura_` prefix and cover an oversized header without its body, fragmented frames, repeated partial tails, receive-buffer overflow, valid zlib, a highly compressible payload with a dishonest small size, mismatched output size, truncated/corrupt checksums, trailing data, compression thresholds and an oversized declared output. These are bounded in-memory fixtures. They do not contact or attack a real server.

When upgrading Azalea, compare this file, `src/read.rs`, `src/packets/game/s_attack.rs` and `src/packets/game/s_place_recipe.rs` against the new upstream implementation, retain equivalent regression coverage, and remove the local override only after upstream supplies equivalent behavior. Successful tests here do not establish complete Minecraft gameplay compatibility.
