// Local test identities only. This harness never listens on a public interface.
import http from 'node:http';
import { createHash } from 'node:crypto';
import { attachEmoteRelay } from './relay.mjs';
const identities=new Map(['A','B'].map(letter=>{
  const bytes=createHash('md5').update(`OfflinePlayer:BloomTest${letter}`).digest();
  bytes[6]=(bytes[6]&15)|48;bytes[8]=(bytes[8]&63)|128;
  return [`Bearer bcs_${letter.toLowerCase().repeat(43)}`,bytes.toString('hex')];
}));
const server=http.createServer((req,res)=>{res.writeHead(404);res.end();});
const relay=attachEmoteRelay(server,{authenticate:async request=>{
  const uuid=identities.get(request.headers.authorization);
  if(!uuid)throw new Error('Unknown local test identity');
  return {uuid,sessionKey:uuid,expiresAt:Date.now()+3600000};
}});
server.listen(19191,'127.0.0.1',()=>console.log('Emote test relay listening on loopback port 19191; only BloomTestA/B are accepted.'));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{relay.close();server.close();});
