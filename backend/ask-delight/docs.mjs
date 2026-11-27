const fabric = "https://docs.fabricmc.net/players/troubleshooting/";
const paper = "https://docs.papermc.io/paper/";
const pages = {
  fabric_crashes: fabric + "crash-reports",
  fabric_dependencies: fabric + "dependency-overrides",
  fabric_logs: fabric + "uploading-logs",
  paper_plugins: paper + "adding-plugins/",
  paper_commands: paper + "reference/commands/",
  paper_profiling: paper + "profiling/",
};

export const docsTool = {
  type: "function", name: "read_server_docs", strict: true,
  description: "Consult official Fabric troubleshooting or Paper server documentation when diagnosis or command details need checking. Choose a topic and relevant search terms.",
  parameters: { type: "object", additionalProperties: false, required: ["topic", "terms"],
    properties: { topic: { type: "string", enum: Object.keys(pages) }, terms: { type: "string" } } },
};

const cache = new Map();

export async function readDocs({ topic, terms } = {}) {
  if (!Object.hasOwn(pages, topic)) throw Error("Unknown documentation page");
  const url = pages[topic];
  let page = cache.get(topic);
  if (!page || page.expires <= Date.now()) {
    const source = url.startsWith(paper) ? url + "index.md" : url.replace("https://docs.fabricmc.net/", "https://raw.githubusercontent.com/FabricMC/fabric-docs/main/") + ".md";
    const response = await fetch(source, { redirect: "error", signal: AbortSignal.timeout(3000) });
    if (!response.ok) throw Error("Documentation unavailable");
    const markdown = (await response.text()).replace(/^---[\s\S]*?---\s*/, "").trim();
    if (!markdown || markdown.startsWith("<!DOCTYPE")) throw Error("No documentation");
    page = { paragraphs: markdown.split(/\n\s*\n/), expires: Date.now() + 3600_000 };
    cache.set(topic, page);
  }
  const words = [...new Set(String(terms).toLowerCase().match(/[a-z0-9_-]{3,}/g) ?? [])].slice(0, 16);
  const ranked = page.paragraphs.map((text, index) => ({ text, index, score: words.filter(w => text.toLowerCase().includes(w)).length }))
    .filter(p => p.text.length > 45 && !p.text.startsWith("!["))
    .sort((a, b) => b.score - a.score || a.index - b.index).slice(0, 4).sort((a, b) => a.index - b.index);
  const excerpt = ranked.map(p => p.text.slice(0, 600)).join("\n").slice(0, 1600);
  if (!excerpt) throw Error("No documentation");
  return { url, excerpt };
}
