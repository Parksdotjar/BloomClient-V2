const slug = /^[a-z0-9_-]{2,64}$/i;
const version = /^\d+\.\d+(?:\.\d+)?$/;
const categories = ["adventure","worldgen","equipment","mobs","decoration","food","magic","technology","storage","transportation","optimization","utility","game-mechanics","social","management"];
export const packTool = {
  type:"function", name:"draft_modpack", strict:true,
  description:"Draft a Fabric pack. Set count to the requested total main mods (six means 6), including on revisions. For revisions keep the previous lineup except remove, using mods for requested additions. Pick relevant Modrinth categories and exclude unwanted categories. Include up to 6 priority project slugs as seeds. Discovery fills the remaining slots. Ask for missing version or loader.",
  parameters:{type:"object",additionalProperties:false,required:["name","minecraft","loader","count","categories","exclude","mods","remove"],properties:{
    name:{type:"string"},minecraft:{type:"string"},loader:{type:"string"},count:{type:"integer"},
    categories:{type:"array",items:{type:"string",enum:categories}},exclude:{type:"array",items:{type:"string",enum:categories}},
    mods:{type:"array",items:{type:"string"}},remove:{type:"array",items:{type:"string"}}
  }}
};
export function validPackContext(value) {
  return value === true || (value && typeof value === "object" && version.test(value.minecraft) && value.loader === "fabric"
    && typeof value.name === "string" && value.name.length <= 64 && Array.isArray(value.mods) && value.mods.length <= 100
    && value.mods.every(s => typeof s === "string" && slug.test(s)) && Object.keys(value).length === 4);
}
export async function draftPack(args, read = fetch, previous, question = "") {
  const reply = (answer,status="clarify") => ({answer,status,scope:"minecraft",action:null,helpIds:[]});
  if (args?.loader?.toLowerCase() !== "fabric") return reply("Delight currently installs Fabric packs. Would you like one for Fabric?");
  if (!version.test(args.minecraft)) return reply("Which Minecraft release should I build for?");
  const words = ["zero","one","two","three","four","five","six","seven","eight","nine","ten","eleven","twelve"];
  const explicit = question.toLowerCase().match(/\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)[ -]+(?:main |top-level )?mods?\b/);
  const initialCount = explicit && (Number(explicit[1]) || words.indexOf(explicit[1]));
  const target = previous?.mods ? args.count : initialCount || args.count;
  if (!Number.isInteger(target) || target < 1 || target > 100) return reply("Choose between 1 and 100 main mods. Required dependencies install separately.");
  const selected = new Map(), seen = new Set();
  const normalize = s => String(s).toLowerCase().replace(/[^a-z0-9]/g,"");
  const removed = new Set((args.remove ?? []).map(normalize));
  const excluded = new Set(["library", ...(args.exclude ?? [])]);
  const themes = (args.categories ?? []).filter(c => categories.includes(c) && !excluded.has(c));
  const options = {signal:AbortSignal.timeout(14000),redirect:"error",headers:{"User-Agent":"DelightClient/Alula (support@bloomclient.org)"}};
  async function get(path, params = {}) {
    const r = await read("https://api.modrinth.com/v2/" + path + "?" + new URLSearchParams(params), options);
    if (r.status === 404) return null;
    if (!r.ok) throw Error();
    return r.json();
  }
  const facets = [["project_type:mod"],["categories:fabric"],["versions:"+args.minecraft],["client_side:required","client_side:optional"]];
  async function search(query, extra, limit, offset=0) {
    const data = await get("search",{query,facets:JSON.stringify([...facets,...extra]),limit:String(limit),offset:String(offset),index:"relevance"});
    return data?.hits ?? [];
  }
  async function verify(info) {
    const id = info?.project_id ?? info?.id;
    if (!slug.test(id ?? "") || !slug.test(info.slug) || seen.has(id) || !info.title || info.project_type !== "mod" || info.client_side === "unsupported"
      || [info.slug,info.title,id].some(s => removed.has(normalize(s))) || info.categories?.some(c=>excluded.has(c))) return;
    seen.add(id);
    const files = await get("project/"+id+"/version",{loaders:'["fabric"]',game_versions:JSON.stringify([args.minecraft]),include_changelog:"false"});
    if (files?.some(v=>v.project_id === id && v.loaders?.includes("fabric") && v.game_versions?.includes(args.minecraft) && v.files?.some(f=>f.filename?.endsWith(".jar")))) {
      selected.set(id,{id,title:info.title.slice(0,100),slug:info.slug});
    }
  }
  async function batches(items, visit) {
    for (let i=0; i<items.length && selected.size<target;) {
      const step = Math.min(10,target-selected.size);
      await Promise.all(items.slice(i,i+step).map(visit));
      i+=step;
    }
  }
  try {
    const seeds = [...new Set([...(args.mods ?? []).slice(0,8), ...(previous?.minecraft === args.minecraft ? previous.mods : [])])];
    await batches(seeds,async name=>{
      const guess = String(name).trim().toLowerCase().replace(/[^a-z0-9_-]+/g,"-");
      let info = slug.test(guess) ? await get("project/"+guess) : null;
      if (!info) info = (await search(String(name),[],5)).find(h=>[h.title,h.slug].some(s=>normalize(s)===normalize(name)));
      await verify(info);
    });
    for (let offset=0; themes.length && selected.size<target && offset<300; offset+=100) {
      const hits = await search("",[themes.map(c=>"categories:"+c)],100,offset);
      await batches(hits,verify);
      if (hits.length<100) break;
    }
  } catch { return reply("Modrinth didn’t finish checking this lineup. Try again in a moment.","unsupported"); }
  if (selected.size !== target) return reply("I found "+selected.size+" of the "+target+" requested mods for Fabric "+args.minecraft+". Would you like to broaden the theme or try another Minecraft version?");
  return {...reply("Here are all "+target+" main mods. Ask for changes or create the instance when you’re ready.","answered"),
    pack:{name:String(args.name || "Alula pack").slice(0,64),minecraft:args.minecraft,loader:"fabric",mods:[...selected.values()]}};
}
