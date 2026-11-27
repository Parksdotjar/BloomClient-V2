const manifestUrl = "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json";

export const mojangTool = {
  type: "function", name: "current_java_version", strict: true,
  description: "Check Mojang for the current Minecraft Java Edition stable release, snapshot channel, or both.",
  parameters: { type: "object", additionalProperties: false, required: ["channel"],
    properties: { channel: { type: "string", enum: ["release", "snapshot", "both"] } } },
};

export async function lookupJavaVersion(channel) {
  const reply = (answer, status) => ({ answer, status, scope: "minecraft", helpIds: [], action: null });
  try {
    if (!["release", "snapshot", "both"].includes(channel)) throw Error();
    const response = await fetch(manifestUrl, { redirect: "error", signal: AbortSignal.timeout(4000) });
    if (!response.ok) throw Error();
    const { latest } = await response.json();
    if (![latest.release, latest.snapshot].every(id => typeof id === "string" && /^[\w.+-]{1,64}$/.test(id))) throw Error();
    const lines = [];
    if (channel !== "snapshot") lines.push("The current stable Minecraft Java Edition release is " + latest.release + ".");
    if (channel !== "release") lines.push(latest.snapshot === latest.release
      ? "Mojang’s snapshot channel currently points to the stable release, " + latest.release + "."
      : "The current Java Edition snapshot-channel build is " + latest.snapshot + ".");
    return reply(lines.join(" ") + "\n" + manifestUrl, "answered");
  } catch {
    return reply("I couldn’t verify the current Java Edition version with Mojang just now.", "unsupported");
  }
}
