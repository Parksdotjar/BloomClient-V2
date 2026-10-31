import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { attachEmoteRelay } from './relay.mjs';
const ids=['11111111111141118111111111111111','22222222222242228222222222222222','33333333333343338333333333333333'];
const scope='a'.repeat(64), revision='b'.repeat(64),playbackId='12345678-1234-4123-8123-123456789012';
async function setup(t){
 let now=100000;const revoked=new Set();const server=http.createServer();
 const relay=attachEmoteRelay(server,{now:()=>now,sweepMs:10,authenticate:async request=>{
  const n=Number(request.headers.authorization?.replace('Bearer ',''));
  if(!Number.isInteger(n)||n<0||n>2||revoked.has(n))throw new Error('unauthorized');
  return {uuid:ids[n],sessionKey:`session${n}`,expiresAt:200000};
 }});
 server.listen(0,'127.0.0.1');await once(server,'listening');
 const address=`ws://127.0.0.1:${server.address().port}/v1/emotes/socket`;
 t.after(()=>{relay.close();server.close();});
 async function connect(n){
  const messages=[];const ws=new WebSocket(address,{headers:{Authorization:`Bearer ${n}`}});
  ws.on('message',bytes=>messages.push(JSON.parse(bytes)));
  await once(ws,'open');
  const wait=async predicate=>{for(let i=0;i<100;i++){const index=messages.findIndex(predicate);if(index>=0)return messages.splice(index,1)[0];await new Promise(r=>setTimeout(r,5));}throw new Error('Expected event not received');};
  await wait(m=>m.type==='hello');
  return {ws,messages,wait,send:m=>ws.send(JSON.stringify(m))};
 }
 return {connect,advance:ms=>now+=ms,address,revoke:n=>revoked.add(n)};
}
const subscribe=(c,room=scope)=>c.send({type:'subscribe',scope:room,players:ids});
const start=(c,extra={})=>c.send({type:'start',emote:'bloom:wave',revision,playbackId,mode:'once',duration:2.5,...extra});
test('relay authenticates identity, isolates rooms, sends late snapshot and exact stops',async t=>{
 const env=await setup(t),a=await env.connect(0),b=await env.connect(1),c=await env.connect(2);
 subscribe(a);subscribe(b);subscribe(c,'c'.repeat(64));
 await b.wait(m=>m.type==='snapshot');await c.wait(m=>m.type==='snapshot');
 start(a,{uuid:ids[2]});
 const event=await b.wait(m=>m.type==='start');assert.equal(event.uuid,ids[0]);assert.equal(event.startedAt,100000);
 subscribe(b);const snap=await b.wait(m=>m.type==='snapshot');assert.equal(snap.playing[0].playbackId,playbackId);
 a.send({type:'stop',playbackId:'stale'});subscribe(b);assert.equal((await b.wait(m=>m.type==='snapshot')).playing.length,1);
 a.send({type:'stop',playbackId});assert.equal((await b.wait(m=>m.type==='stop')).playbackId,playbackId);
 assert.equal(c.messages.filter(m=>m.type==='start').length,0);
});
test('loops expire without renewals and disconnect removes remote playback',async t=>{
 const env=await setup(t),a=await env.connect(0),b=await env.connect(1);
 subscribe(a);subscribe(b);await b.wait(m=>m.type==='snapshot');start(a,{mode:'loop'});await b.wait(m=>m.type==='start');
 env.advance(31000);await b.wait(m=>m.type==='stop');
 start(a,{mode:'hold'});await b.wait(m=>m.type==='start');a.ws.close();await b.wait(m=>m.type==='stop');
});
test('rejects unauthenticated upgrade and malformed motion instead of forwarding payloads',async t=>{
 const env=await setup(t);
 const invalid=new WebSocket(env.address);await once(invalid,'error');
 const a=await env.connect(0);subscribe(a);await a.wait(m=>m.type==='snapshot');
 start(a,{emote:'https://invalid.example/file'});const [code]=await once(a.ws,'close');assert.equal(code,1008);
});

test('reconnect offsets preserve phase and old connections cannot leave duplicate account playback',async t=>{
 const env=await setup(t),a=await env.connect(0),b=await env.connect(1),replacement=await env.connect(0);
 subscribe(a);subscribe(b);subscribe(replacement);await b.wait(m=>m.type==='snapshot');await replacement.wait(m=>m.type==='snapshot');
 start(a,{mode:'loop'});const first=await b.wait(m=>m.type==='start');
 const next='12345678-1234-4123-8123-123456789013';start(replacement,{mode:'loop',offset:1,playbackId:next});
 assert.equal((await b.wait(m=>m.type==='stop')).playbackId,first.playbackId);
 const event=await b.wait(m=>m.type==='start');assert.equal(event.startedAt,99000);assert.ok(event.sequence>first.sequence);
 a.send({type:'stop',playbackId});subscribe(b);const snapshot=await b.wait(m=>m.type==='snapshot');assert.equal(snapshot.playing.length,1);assert.equal(snapshot.playing[0].playbackId,next);
});

test('renewed loops keep their start time and revoked sessions close existing sockets',async t=>{
 const env=await setup(t),a=await env.connect(0),b=await env.connect(1);
 subscribe(a);subscribe(b);await b.wait(m=>m.type==='snapshot');start(a,{mode:'loop'});const initial=await b.wait(m=>m.type==='start');
 env.advance(20000);a.send({type:'renew',playbackId});subscribe(b);
 const renewed=(await b.wait(m=>m.type==='snapshot')).playing[0];assert.equal(renewed.startedAt,initial.startedAt);assert.equal(renewed.expiresAt,150000);
 const closed=once(a.ws,'close');env.revoke(0);assert.equal((await closed)[0],1008);await b.wait(m=>m.type==='stop');
});

test('rejects forged subscription UUIDs and unbounded reconnect offsets',async t=>{
 const env=await setup(t),a=await env.connect(0);
 a.send({type:'subscribe',scope,players:['-'.repeat(36)]});assert.equal((await once(a.ws,'close'))[0],1008);
 const b=await env.connect(1);subscribe(b);await b.wait(m=>m.type==='snapshot');start(b,{offset:99999});assert.equal((await once(b.ws,'close'))[0],1008);
});
