// Real cosmetic assets and React UI with an isolated native account fixture.
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const url = process.env.BLOOM_TEST_URL || 'http://localhost:1420';
const errors = [];
page.on('pageerror', e => errors.push(e.message));
await page.route('**/*', route => route.request().url().startsWith(url) || route.request().url().startsWith('data:') ? route.continue() : route.abort());
const offer = JSON.parse(await readFile(new URL('../public/delight-wings/catalog.json', import.meta.url), 'utf8')).entries[0];
await page.addInitScript(offer => {
  const profile = {id:'wing-ui-account',name:'Wing Check'};
  localStorage.setItem('bloom-profile',JSON.stringify(profile));
  localStorage.setItem('bloom-onboarding-complete-v1','complete');
  localStorage.setItem('bloom-settings',JSON.stringify({theme:'oled',animations:true,buttonPressDuration:0}));
  const canvas=document.createElement('canvas');canvas.width=canvas.height=64;
  const ctx=canvas.getContext('2d');ctx.fillStyle='#be91b5';ctx.fillRect(0,0,64,64);
  const skin={id:'current',name:'Current skin',texture:canvas.toDataURL(),variant:'classic'};
  const state=window.wingUi={owned:false,equipped:null,calls:[]};
  let next=1;
  window.__TAURI_EVENT_PLUGIN_INTERNALS__={unregisterListener(){}};
  window.__TAURI_INTERNALS__={
    metadata:{currentWindow:{label:'main'},currentWebview:{label:'main'}},
    transformCallback(){return next++},unregisterCallback(){},convertFileSrc(path){return path},
    async invoke(command,args){
      state.calls.push({command,args});
      if(command==='cosmetics_request'){
        if(args.path==='/v1/wings/claim'){state.owned=true;return {id:offer.id,revision:offer.revision}}
        if(args.path==='/v1/wings/equipped'){
          state.equipped=args.body.id===null?null:args.body;
          return {equipped:state.equipped};
        }
        if(args.path.startsWith('/v1/wings/'))return {items:args.path.endsWith('/shop')||state.owned?[{...offer,owned:state.owned,configured:state.equipped?.colors}]:[],equipped:state.equipped};
        if(args.path==='/v1/cosmetics/me')return {capeId:null,badgeVisible:true};
        return {items:[]};
      }
      if(command==='list_minecraft_accounts')return {activeId:profile.id,accounts:[profile]};
      if(command==='get_saved_minecraft_profile')return profile;
      if(command==='get_minecraft_wardrobe')return {currentSkin:skin,capes:[],skins:[]};
      if(command==='get_minecraft_skin')return skin.texture;
      if(command==='get_minecraft_launch_status')return {state:'idle',progress:0,message:''};
      if(command==='get_minecraft_process_running')return false;
      if(['list_instances','list_instance_folders','list_pack_channel_memberships','reconcile_cosmetics'].includes(command))return [];
      if(command==='plugin:event|listen')return next++;
      if(command==='plugin:app|version')return 'test';
      return null;
    }
  };
},offer);
const tab=name=>page.getByRole('navigation',{name:'Locker categories'}).getByRole('button',{name,exact:true}).click();
try {
  await page.goto(url);
  await page.getByRole('navigation',{name:'Main navigation'}).getByRole('button',{name:'Locker',exact:true}).click();
  await tab('Shop');
  await page.getByRole('group',{name:'Shop categories'}).getByRole('button',{name:'Wings',exact:true}).click();
  await page.getByRole('button',{name:'Add to Locker',exact:true}).click();
  const openLocker = page.getByRole('button', { name: 'In Locker', exact: true });
  assert.ok(await openLocker.evaluate(button => {
    const row = button.getBoundingClientRect();
    const label = button.querySelector('span').getBoundingClientRect();
    const arrow = button.querySelector('svg.lucide-arrow-right').getBoundingClientRect();
    const centerX = bounds => bounds.left + bounds.width / 2;
    const centerY = bounds => bounds.top + bounds.height / 2;
    return Math.abs(centerX(label) - centerX(row)) <= 1 &&
      Math.abs(centerY(arrow) - centerY(row)) <= 1 &&
      Math.abs(row.right - arrow.right - 13) <= 1;
  }), 'In Locker centers its label and anchors the arrow to the right edge');
  await openLocker.click();
  await page.locator('.wing-detail canvas[data-ready="true"][data-skin="true"]').waitFor();
  const card=page.locator('.wing-card-preview canvas[data-ready="true"]');
  await card.waitFor();
  assert.equal(await page.locator('.wing-card img,.wing-card svg').count(),0);
  await page.getByRole('button',{name:'Equip',exact:true}).click();
  await page.getByRole('button',{name:'Choose left wing color',exact:true}).click();
  await page.getByRole('textbox',{name:'Hex color',exact:true}).fill('#123456');
  await page.getByRole('button',{name:'Apply color',exact:true}).click();
  await page.getByRole('button',{name:'Save colors',exact:true}).click();
  await page.waitForFunction(()=>window.wingUi.equipped?.colors.left==='#123456');
  await tab('Equipped look');
  const character=page.locator('.locker-detail .wing-preview canvas[data-ready="true"][data-skin="true"]');
  await character.waitFor();
  const size=await character.boundingBox();
  assert.ok(size.width>150&&size.height>200,'Character preview reserves visible space');
  assert.ok((await page.locator('.look-slots').innerText()).includes(offer.name));
  await mkdir('logs/wings-ui',{recursive:true});
  await page.locator('.locker-workspace').screenshot({path:'logs/wings-ui/equipped-look.png'});
  await tab('Wings');
  await page.getByRole('button',{name:'Unequip',exact:true}).click();
  await page.waitForFunction(()=>window.wingUi.equipped===null);
  await tab('Equipped look');
  await page.locator('.cape-preview canvas').waitFor();
  assert.equal(await page.locator('.locker-detail .wing-preview').count(),0);
  assert.deepEqual(errors,[]);
  console.log('Wings UI passed: Shop claim, cosmetic-only cards, skin loading, equip, persisted color, Equipped look dimensions and unequip fallback.');
} finally { await browser.close(); }
