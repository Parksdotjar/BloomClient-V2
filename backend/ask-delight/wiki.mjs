export const wikiTool = {
  type: "function", name: "read_minecraft_wiki", strict: true,
  description: "Check the Minecraft Wiki for precise vanilla gameplay facts such as numeric ranges, edition differences, or a requested source. Answer familiar questions directly.",
  parameters: {type:"object",additionalProperties:false,required:["topic","terms"],properties:{
    topic:{type:"string",description:"Short article search, e.g. Ore distribution"},
    terms:{type:"string",description:"Important mechanics or section terms"}
  }}
};
const cache = new Map();
export async function readWiki({topic,terms}, read = fetch) {
  if (typeof topic !== "string" || !topic.trim() || topic.length > 120 || typeof terms !== "string" || terms.length > 180) throw Error("invalid wiki search");
  const key = [topic.trim(),terms.trim()].join(" ").toLowerCase();
  const cached = cache.get(key);
  if (cached && cached.until > Date.now()) return cached.result;
  const signal = AbortSignal.timeout(6000);
  async function api(params) {
    const response = await read("https://minecraft.wiki/api.php?" + new URLSearchParams({...params,format:"json",formatversion:"2"}),{
      redirect:"error",signal,headers:{"User-Agent":"DelightClient/Alula (support@bloomclient.org)"}
    });
    if (!response.ok) throw Error("wiki unavailable");
    return response.json();
  }
  const search = await api({action:"query",list:"search",srnamespace:"0",srlimit:"1",srsearch:topic,srprop:""});
  const hit = search.query?.search?.[0];
  if (hit?.ns !== 0 || !hit.title) throw Error("no wiki article");
  const params = {action:"parse",pageid:String(hit.pageid)};
  const outline = await api({...params,prop:"sections"});
  const tokens = new Set(key.match(/[a-z0-9]{3,}/g) ?? []);
  const sections = (outline.parse?.sections ?? []).map(s=>({...s,score:
    (s.line.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []).filter(word=>tokens.has(word)).length
  })).sort((a,b)=>b.score-a.score);
  const section = sections[0]?.score ? sections[0].index : "0";
  const article = await api({...params,prop:"text",section});
  const html = article.parse?.text;
  if (!html) throw Error("empty wiki section");
  const excerpt = html.replace(/<(style|script)\b[^>]*>[\s\S]*?<\/\1>/gi,"").replace(/<\/(?:th|td)>/gi," | ")
    .replace(/<\/(?:tr|p|h[1-6])>/gi,"\n").replace(/<[^>]+>/g," ").replace(/&#(\d+);/g,(_,n)=>String.fromCharCode(Number(n)))
    .replace(/&nbsp;/g," ").replace(/&amp;/g,"&").replace(/[ \t]+/g," ").replace(/\n\s*\n/g,"\n").trim().slice(0,3600);
  if (!excerpt) throw Error("empty wiki section");
  const result = {excerpt:hit.title+"\n"+excerpt,url:"https://minecraft.wiki/w/"+encodeURIComponent(hit.title.replaceAll(" ","_"))};
  if (cache.size >= 128) cache.delete(cache.keys().next().value);
  cache.set(key,{result,until:Date.now()+3600000});
  return result;
}
