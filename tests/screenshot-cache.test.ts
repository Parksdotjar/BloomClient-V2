import assert from "node:assert/strict";
import test from "node:test";
import { ScreenshotCache, type ScreenshotShot } from "../src/services/screenshot-cache.ts";
const shot = (name: string, revision = "1"): ScreenshotShot => ({instanceId:"a",instanceName:"Test",name,modified:1,revision});
const settle = () => new Promise<void>(resolve => setImmediate(resolve));
test("simultaneous preview requests share work and completed previews are synchronously available", async () => {
 let count=0; const cache=new ScreenshotCache(async s=>{count++;return {src:s.name,cost:10};});
 assert.deepEqual(await Promise.all([cache.get(shot("a"),"preview"),cache.get(shot("a"),"preview")]),["a","a"]);
 assert.equal(count,1);assert.equal(cache.peek(shot("a"),"preview"),"a");await cache.get(shot("a"),"preview");assert.equal(count,1);
});
test("changed revisions, image modes and instances never share old images", async () => {
 let count=0;const cache=new ScreenshotCache(async()=>({src:String(++count),cost:10}));
 await cache.get(shot("a"),"preview");await cache.get(shot("a","2"),"preview");await cache.get(shot("a"),"thumbnail");await cache.get({...shot("a"),instanceId:"b"},"preview");assert.equal(count,4);
});
test("user requests overtake queued background work and concurrency stays bounded", async () => {
 const calls:string[]=[];let release!:()=>void;
 const cache=new ScreenshotCache(async s=>{calls.push(s.name);if(s.name==='first')await new Promise<void>(r=>{release=r});return{src:s.name,cost:10}},100,1);
 const first=cache.get(shot('first'),'preview',10);const background=cache.get(shot('background'),'preview',10);const click=cache.get(shot('click'),'preview',100);
 assert.deepEqual(calls,['first']);release();await Promise.all([first,background,click]);assert.deepEqual(calls,['first','click','background']);
});
test("background warming preserves visible images while respecting memory limits",async()=>{
 const cache=new ScreenshotCache(async s=>({src:s.name,cost:10}),20);cache.prefer([shot('visible')]);
 await cache.get(shot('visible'),'preview',10);await cache.get(shot('old'),'preview',10);await cache.get(shot('new'),'preview',10);
 assert.equal(cache.peek(shot('visible'),'preview'),'visible');assert.equal(cache.peek(shot('old'),'preview'),undefined);assert.equal(cache.peek(shot('new'),'preview'),'new');
});
test("clear prevents in-flight results from repopulating the cache",async()=>{
 let release!:()=>void;const cache=new ScreenshotCache(async()=>{await new Promise<void>(r=>release=r);return{src:'a',cost:10}});
 const pending=cache.get(shot('a'),'preview');cache.clear();release();await pending;await settle();assert.equal(cache.peek(shot('a'),'preview'),undefined);
});
test("failed previews can be retried",async()=>{
 let count=0;const cache=new ScreenshotCache(async()=>{if(++count===1)throw Error('missing');return{src:'ok',cost:10}});
 await assert.rejects(cache.get(shot('a'),'preview'));await settle();assert.equal(await cache.get(shot('a'),'preview'),'ok');
});

test("pausing defers background work while still allowing explicit image opens",async()=>{
 const calls:string[]=[];const cache=new ScreenshotCache(async s=>{calls.push(s.name);return{src:s.name,cost:10}},100,1);
 cache.setPaused(true);const background=cache.get(shot('background'),'preview',10);
 const foreground=cache.get(shot('clicked'),'preview',150);await foreground;await settle();assert.deepEqual(calls,['clicked']);
 cache.setPaused(false);await background;assert.deepEqual(calls,['clicked','background']);
});

test("clicking an already queued preview promotes it even while background work is paused",async()=>{
 const calls:string[]=[];const cache=new ScreenshotCache(async s=>{calls.push(s.name);return{src:s.name,cost:10}},100,1);
 cache.setPaused(true);const queued=cache.get(shot('same'),'preview',10);
 const clicked=cache.get(shot('same'),'preview',150);
 assert.equal(await clicked,'same');await queued;assert.deepEqual(calls,['same']);
});
