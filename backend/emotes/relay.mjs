import { WebSocketServer, WebSocket } from 'ws';
import { randomUUID } from 'node:crypto';

const ID = /^bloom:[a-z][a-z0-9_]{0,47}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const HASH = /^[a-f0-9]{64}$/;
const normalize = id => id.replaceAll('-','').toLowerCase();

/** Ephemeral single-process relay. Authentication is supplied by the cosmetics session store. */
export function attachEmoteRelay(server, { authenticate, now = Date.now, maxConnections = 2000, sweepMs = 5000 } = {}) {
  const wss = new WebSocketServer({ noServer:true, maxPayload:16*1024, perMessageDeflate:false });
  const clients = new Set();
  const attempts = new Map();
  let sequence=0, pending=0;
  const send = (client, value) => {
    if(client.socket.readyState!==WebSocket.OPEN)return;
    if(client.socket.bufferedAmount>128*1024){client.socket.close(1013,'Slow connection');return;}
    client.socket.send(JSON.stringify(value));
  };
  const interested = (viewer, actor) => viewer!==actor && viewer.scope===actor.scope && viewer.subscriptions.has(actor.uuid);
  const broadcast = (actor, value) => { for(const viewer of clients) if(interested(viewer,actor))send(viewer,value); };
  const stop = client => {
    if(!client.active)return;
    broadcast(client,{type:'stop',uuid:client.uuid,connection:client.connection,playbackId:client.active.playbackId,sequence:++sequence});
    client.active=null;
  };
  const upgrade = async (request,socket,head) => {
    let url;
    try{url=new URL(request.url,'http://localhost');}catch{socket.destroy();return;}
    if(!['/v1/emotes/socket','/minecraft/v1/emotes/socket'].includes(url.pathname)){socket.destroy();return;}
    if(url.search || clients.size+pending>=maxConnections){socket.destroy();return;}
    const address=request.socket.remoteAddress;
    // Caddy's loopback hop is shared by all players; never treat it as one player IP.
    // Global and authenticated-account limits still apply behind that proxy.
    if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(address)){
      const budget=attempts.get(address);
      if(budget&&now()-budget.at<60000){if(++budget.count>30){socket.destroy();return;}}
      else {if(attempts.size>10000){socket.destroy();return;}attempts.set(address,{at:now(),count:1});}
    }
    pending++;
    let timer;
    try {
      const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('timeout')),5000);timer.unref();});
      const identity=await Promise.race([authenticate(request),timeout]);
      if(socket.destroyed || typeof identity?.uuid!=='string' || !(/^[a-f0-9]{32}$/i.test(identity.uuid)||UUID.test(identity.uuid)) || !Number.isFinite(identity.expiresAt) || identity.expiresAt<=now())throw new Error('invalid session');
      wss.handleUpgrade(request,socket,head,ws=>wss.emit('connection',ws,request,identity));
    } catch { if(!socket.destroyed){socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');socket.destroy();} }
    finally{clearTimeout(timer);pending--;}
  };
  server.on('upgrade',upgrade);
  wss.on('connection',(socket,request,identity)=>{
    const client={socket,uuid:normalize(identity.uuid),expiresAt:identity.expiresAt,connection:randomUUID(),scope:null,subscriptions:new Set(),active:null,window:now(),messages:0,starts:0,alive:true};
    if([...clients].filter(c=>c.uuid===client.uuid).length>=4){socket.close(1008,'Too many connections');return;}
    client.sessionKey=identity.sessionKey;client.request=request;clients.add(client);
    send(client,{type:'hello',protocol:1,uuid:client.uuid,serverTime:now(),connection:client.connection});
    socket.on('pong',()=>client.alive=true);
    socket.on('message',(bytes,binary)=>{
      try {
        if(binary||client.expiresAt<=now())throw new Error('expired');
        if(now()-client.window>=60000){client.window=now();client.messages=0;client.starts=0;}
        if(++client.messages>180)throw new Error('rate');
        const m=JSON.parse(bytes.toString());
        if(!m||typeof m!=='object')throw new Error('message');
        if(m.type==='ping'){if(!Number.isFinite(m.echo))throw new Error('ping');send(client,{type:'pong',echo:m.echo,serverTime:now()});return;}
        if(m.type==='subscribe'){
          if(typeof m.scope!=='string'||!HASH.test(m.scope)||!Array.isArray(m.players)||m.players.length>100||m.players.some(id=>typeof id!=='string'||!(/^[a-f0-9]{32}$/i.test(id)||UUID.test(id))))throw new Error('subscription');
          if(client.scope!==m.scope)stop(client);
          client.scope=m.scope;client.subscriptions=new Set(m.players.map(normalize));
          const playing=[];
          for(const actor of clients)if(interested(client,actor)&&actor.active&&actor.active.expiresAt>now())playing.push({...actor.active,uuid:actor.uuid,connection:actor.connection});
          send(client,{type:'snapshot',serverTime:now(),playing});return;
        }
        if(!client.scope)throw new Error('subscribe first');
        if(m.type==='start'){
          if(++client.starts>30){send(client,{type:'limited'});return;}
          if(typeof m.emote!=='string'||!ID.test(m.emote)||typeof m.revision!=='string'||!HASH.test(m.revision)||typeof m.playbackId!=='string'||!UUID.test(m.playbackId)||!['once','loop','hold'].includes(m.mode)||!Number.isFinite(m.duration)||m.duration<.1||m.duration>30)throw new Error('start');
          const offset=m.offset??0;
          if(!Number.isFinite(offset)||offset<0||offset>m.duration||(m.mode==='once'&&offset>=m.duration))throw new Error('offset');
          stop(client);
          for(const old of clients)if(old!==client&&old.uuid===client.uuid&&old.scope===client.scope)stop(old);
          client.active={type:'start',emote:m.emote,revision:m.revision,playbackId:m.playbackId,mode:m.mode,startedAt:now()-offset*1000,expiresAt:now()+(m.mode==='once'?(m.duration-offset)*1000:30000),sequence:++sequence};
          broadcast(client,{...client.active,uuid:client.uuid,connection:client.connection});return;
        }
        if(m.type==='stop'){if(client.active?.playbackId===m.playbackId)stop(client);return;}
        if(m.type==='renew'){if(client.active?.playbackId===m.playbackId&&client.active.mode!=='once')client.active.expiresAt=now()+30000;return;}
        throw new Error('unknown message');
      }catch{socket.close(1008,'Invalid emote message');}
    });
    socket.on('close',()=>{stop(client);clients.delete(client);});
    socket.on('error',()=>{});
  });
  let ticks=0;
  const sweep=setInterval(async()=>{
    ticks++;
    for(const [key,budget] of attempts)if(now()-budget.at>=60000)attempts.delete(key);
    for(const client of clients){
      if(client.expiresAt<=now()){stop(client);client.socket.close(1008,'Session expired');continue;}
      if(client.active&&client.active.expiresAt<=now())stop(client);
      if(ticks%6===0){
        if(!client.alive){client.socket.terminate();continue;}client.alive=false;client.socket.ping();
        // Revocations must close an already-open socket, not just reject its next reconnect.
        if(!client.rechecking){client.rechecking=true;Promise.resolve().then(()=>authenticate(client.request)).then(identity=>{
          if(!identity||normalize(identity.uuid)!==client.uuid||identity.sessionKey!==client.sessionKey||identity.expiresAt<=now())throw new Error('revoked');
        }).catch(()=>{stop(client);client.socket.close(1008,'Session expired');}).finally(()=>client.rechecking=false);}
      }
    }
  },sweepMs);sweep.unref();
  return {close(){clearInterval(sweep);server.off('upgrade',upgrade);for(const c of clients)c.socket.terminate();clients.clear();wss.close();},size:()=>clients.size};
}
