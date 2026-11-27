import { invoke } from "./invoke";

export const skinKey = (id: string) => id.replaceAll("-", "").toLowerCase();
const textures = new Map<string,{expires:number, value:Promise<string>}>();
export function playerSkin(id: string): Promise<string> {
  const key = skinKey(id);
  const existing = textures.get(key);
  if (existing && existing.expires > Date.now()) return existing.value;
  const value = invoke<string>("get_minecraft_skin",{accountId:key}).catch(error => {
    if (textures.get(key)?.value === value) textures.delete(key);
    throw error;
  });
  if (textures.size >= 128) textures.delete(textures.keys().next().value!);
  textures.set(key,{value,expires:Date.now()+300_000});
  return value;
}
window.addEventListener("locker-skin-saved", event => textures.delete(skinKey((event as CustomEvent<string>).detail)));
window.addEventListener("bloom-clear-transient-caches", () => textures.clear());
