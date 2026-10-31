Bloom Cosmetics emote runtime dependencies

Player Animation Library (PAL): https://github.com/PlayerAnimationLibrary/PlayerAnimationLibrary
Pinned versions: 1.1.10+mc.1.21.11 and 1.2.8+mc.26.1/26.2/26.3.
MIT: PAL-MIT.txt. PAL also contains MIT-licensed portions from KosmX's
PlayerAnimator and GeckoLib; their notices are preserved in the adjacent files.

MochaFloats: https://github.com/PlayerAnimationLibrary/mochafloats
MIT: MochaFloats-MIT.txt. Bundled upstream by PAL (4.1.5 on 1.21.11;
modern PAL bundles its compatible runtime modules).

Javassist 3.30.2-GA: https://github.com/jboss-javassist/javassist
Bundled upstream by PAL on 1.21.11. Distributed here under its Apache 2.0
option; Apache-2.0.txt and the upstream Javassist-License.html are included.

Fabric API: https://github.com/FabricMC/fabric
Apache 2.0. Exact per-Minecraft pins are in build.gradle. Its upstream nested
JARs retain their own notices; Apache-2.0.txt is also included here.

Upstream libraries remain under their respective licenses. Bloom's original
animation data, mannequin sources and emote implementation do not contain
commercial emote assets or the GPL Emotecraft product/template.
