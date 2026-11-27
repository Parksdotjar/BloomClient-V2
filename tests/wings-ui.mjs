// Real cosmetic assets and React UI with an isolated native account fixture.
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
const page = await browser.newPage({ userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36", viewport: { width: 1440, height: 1000 } });
await page.exposeFunction('capturePickerView', async () => (await page.screenshot()).toString('base64'));
const url = process.env.BLOOM_TEST_URL || 'http://localhost:1420';
const errors = [];
page.on('pageerror', e => errors.push(e.message));
await page.route('**/*', route => route.request().url().startsWith(url) || route.request().url().startsWith('data:') ? route.continue() : route.abort());
const back = process.argv.includes('--back');
const mushroom = process.argv.includes('--mushroom');
const category = mushroom ? 'Hats' : back ? 'Back' : 'Wings';
const entries = JSON.parse(await readFile(new URL('../public/delight-wings/catalog.json', import.meta.url), 'utf8')).entries;
const secondHat = mushroom && entries.find(item => item.id === 'bunny-ears');
const offer = entries.find(item => mushroom ? item.id === 'mushroom-cap' : item.slot === (back ? "back" : undefined));
await page.addInitScript(({offer,secondHat}) => {
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
      if(command==="capture_picker_view")return window.capturePickerView();
      if(command==='cosmetics_request'){
        const api = offer.slot === 'hat' ? '/v1/hats/' : '/v1/wings/';
        if(args.path===api+'claim'){state.owned=true;return {id:offer.id,revision:offer.revision}}
        if(args.path===api+'equipped'){
          if (state.hold) await new Promise(resolve=>state.resume=resolve);
          if (state.rejectNext) {state.rejectNext=false;throw Error('Test equip failed');}
          state.equipped=args.body.id===null?null:args.body;
          return {equipped:state.equipped};
        }
        if(args.path.startsWith(api))return {items:args.path.endsWith('/shop')||state.owned?[{...offer,owned:state.owned,configured:state.equipped?.id===offer.id?state.equipped.colors:null},...(secondHat && state.owned?[{...secondHat,owned:true}]:[])]:[],equipped:state.equipped};
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
},{offer,secondHat});
const tab=name=>page.getByRole('navigation',{name:'Locker categories'}).getByRole('button',{name,exact:true}).click();
try {
  await page.goto(url);
  await page.getByRole('navigation',{name:'Main navigation'}).getByRole('button',{name:'Locker',exact:true}).click();
  await tab('Shop');
  await page.getByRole('group',{name:'Shop categories'}).getByRole('button',{name:category,exact:true}).click();
  await page.getByRole('button',{name:'Add to Locker',exact:true}).click();
  const openLocker = page.getByRole('button', { name: 'In Locker', exact: true });
  assert.ok(await openLocker.evaluate(button => {
    const row = button.getBoundingClientRect();
    const label = button.querySelector('span').getBoundingClientRect();
    const arrow = button.querySelector('svg:last-child').getBoundingClientRect();
    const centerX = bounds => bounds.left + bounds.width / 2;
    const centerY = bounds => bounds.top + bounds.height / 2;
    return Math.abs(centerX(label) - centerX(row)) <= 1 &&
      Math.abs(centerY(arrow) - centerY(row)) <= 1 &&
      Math.abs(row.right - arrow.right - 13) <= 1;
  }), 'In Locker centers its label and anchors the arrow to the right edge');
  await openLocker.click();
  await page.locator('.wing-detail canvas[data-ready="true"][data-skin="true"]').waitFor();
  const card=page.locator('.wing-card-preview canvas[data-ready="true"]');
  await card.first().waitFor();
  await page.waitForFunction(() => {
    const cards = Array.from(document.querySelectorAll('.wing-card-preview canvas'));
    return cards.length && cards.every(canvas => {
      const ctx = canvas.getContext('2d');
      return ctx && ctx.getImageData(0, 0, canvas.width, canvas.height).data.some((v, i) => i % 4 === 3 && v > 0);
    });
  });
  assert.equal(await page.locator('.wing-card img,.wing-card svg').count(),0);
  const detail = page.locator('.wing-detail canvas');
  const beforeZoom = await detail.screenshot();
  await detail.hover();
  await page.mouse.wheel(0, -420);
  await page.waitForTimeout(120);
  assert.ok(!beforeZoom.equals(await detail.screenshot()), 'wheel zoom changes the worn preview');
  const wear = page.getByRole('button',{name:'Wear ' + offer.name,exact:true});
  await wear.click();
  await page.waitForFunction(()=>window.wingUi.equipped?.id);
  assert.equal(await wear.getAttribute('aria-description'),'Equipped');
  assert.equal(await page.locator('.desktop-island-notice-preview').count(),0,'claim and equip stay quiet');
  assert.equal(await page.locator('.wing-detail img').count(),0);
  if (mushroom) {
    const bunny = page.getByRole('button',{name:'Wear Bunny Ears',exact:true});
    await page.evaluate(()=>{window.savedCanvas=document.querySelector('.wing-detail canvas');window.wingUi.hold=true});
    await bunny.click();
    assert.equal(await bunny.getAttribute('aria-description'),'Equipped');
    assert.equal(await wear.getAttribute('aria-description'),null);
    assert.ok(await page.evaluate(()=>window.savedCanvas===document.querySelector('.wing-detail canvas')));
    assert.equal(await page.locator('.wing-detail img').count(),0);
    await page.evaluate(()=>{window.wingUi.hold=false;window.wingUi.rejectNext=true;window.wingUi.resume()});
    await page.waitForFunction(()=>document.querySelector('[aria-label="Wear Mushroom Cap"]').getAttribute('aria-description')==='Equipped');
    await page.locator('.desktop-island-notice-preview').filter({hasText:'Test equip failed'}).waitFor();
    await bunny.click();
    await page.waitForFunction(()=>window.wingUi.equipped?.id==='bunny-ears');
    await wear.click();
    await page.waitForFunction(()=>window.wingUi.equipped?.id==='mushroom-cap');
    assert.deepEqual(offer.defaults,{left:'#9b2a22',right:'#f3dcb5',trim:'#b43929',rightOuter:'#a17d59'});
    for (const color of Object.values(offer.defaults)) assert.ok((await page.locator('.wing-colors').innerText()).toLowerCase().includes(color));
  }
  const labels = mushroom ? ['crown','spores','brim','stem'] : back ? ['needle tip','nozzle','casing','liquid','plunger'] : ['left wing'];
  const picker = page.getByRole('button',{name:'Choose '+labels[0]+' color',exact:true});
  await picker.click();
  const field = page.getByRole('slider',{name:'Saturation and brightness'});
  await page.evaluate(()=>{window.wingUi.hold=true});
  await field.click({position:{x:51,y:29}});
  await page.waitForFunction(()=>typeof window.wingUi.resume==='function');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+z');
  await page.evaluate(()=>{window.wingUi.hold=false;window.wingUi.resume()});
  await page.waitForFunction(()=>!document.querySelector('.wing-colors').disabled);
  assert.equal(await page.evaluate(()=>window.wingUi.equipped.colors.left),offer.defaults.left);
  await picker.click();
  await page.getByRole('textbox',{name:'Hex color'}).fill('#18265d');
  await page.locator('.locker-detail-copy').click();
  await page.waitForFunction(()=>window.wingUi.equipped.colors.left==='#18265d');
  await picker.click();
  const pipette = page.getByRole('button',{name:'Pick a color from the screen'});
  await pipette.click();
  const overlay = page.locator('.launcher-eyedropper');
  await overlay.locator('.eyedropper-frame').waitFor();
  await page.keyboard.press('Escape');
  await page.getByRole('textbox',{name:'Hex color'}).waitFor();
  assert.equal(await page.getByRole('textbox',{name:'Hex color'}).inputValue(),'#18265D','Escape cancels sampling only');
  await pipette.click();
  await overlay.locator('.eyedropper-frame').waitFor();
  const target = await page.evaluate(() => {
    const image = document.querySelector('.eyedropper-frame');
    const preview = document.querySelector('.wing-detail canvas').getBoundingClientRect();
    const bounds = image.getBoundingClientRect();
    const canvas = document.createElement('canvas');
    canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;
    const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);
    const pixels=ctx.getImageData(0,0,canvas.width,canvas.height).data;
    for(let y=Math.ceil(preview.top+preview.height*.12);y<preview.bottom-1;y++){
      for(let x=Math.ceil(preview.left+preview.width*.33);x<preview.left+preview.width*.67;x++){
        const i=4*(Math.floor(y*canvas.height/bounds.height)*canvas.width+Math.floor(x*canvas.width/bounds.width));
        const [r,g,b]=pixels.subarray(i,i+3);
        if(r>g+15 && b>g+12 && r>=b) return {x,y,hex:'#'+[r,g,b].map(v=>v.toString(16).padStart(2,'0')).join('')};
      }
    }
    throw Error('No skin-colored pixel in the player preview');
  });
  await page.mouse.move(target.x,target.y);
  assert.equal(await overlay.evaluate(el=>getComputedStyle(el).cursor),'crosshair');
  assert.equal(await overlay.locator('canvas').evaluate(el=>Array.from(el.getContext('2d').getImageData(5,5,1,1).data).slice(0,3).map(v=>v.toString(16).padStart(2,'0')).join('')),target.hex.slice(1));
  await page.mouse.click(target.x,target.y);
  await page.waitForFunction(hex=>window.wingUi.equipped.colors.left===hex,target.hex);
  assert.equal(await page.getByRole('textbox',{name:'Hex color'}).inputValue(),target.hex.toUpperCase());
  if (!mushroom) assert.equal(await page.locator('.desktop-island-notice-preview').count(),0,'color changes and undo stay quiet');
  await page.locator('.locker-detail-copy').click();
  assert.equal(await page.getByRole('textbox',{name:'Hex color'}).count(),0,'only a subsequent click dismisses the picker');
  await page.keyboard.press('Control+z');
  await page.waitForFunction(()=>window.wingUi.equipped.colors.left==='#18265d');
  for (const label of labels) {
    await page.getByRole('button',{name:'Choose ' + label + ' color',exact:true}).click();
  await page.getByRole('textbox',{name:'Hex color',exact:true}).fill('#123456');
  await page.getByRole('button',{name:'Apply color',exact:true}).click();
  }
  await page.waitForFunction(()=>window.wingUi.equipped?.colors.left==='#123456');
  if (back || mushroom) {
    assert.deepEqual(await page.evaluate(()=>Object.values(window.wingUi.equipped.colors)),Array(labels.length).fill('#123456'));
    await page.getByRole('button',{name:'Restore default colors'}).click();
    await page.getByRole('button',{name:'Save colors',exact:true}).click();
    assert.deepEqual(await page.evaluate(()=>window.wingUi.equipped.colors),offer.defaults);
  }
  await tab('Equipped look');
  const character=page.locator('.locker-detail .wing-preview canvas[data-ready="true"][data-skin="true"]');
  await character.waitFor();
  const size=await character.boundingBox();
  assert.ok(size.width>150&&size.height>200,'Character preview reserves visible space');
  assert.ok((await page.locator('.look-slots').innerText()).includes(offer.name));
  await mkdir('logs/wings-ui',{recursive:true});
  await page.locator('.locker-workspace').screenshot({path:'logs/wings-ui/equipped-look.png'});
  await tab(category);
  await page.getByRole('button',{name:'Unequip',exact:true}).click();
  await page.waitForFunction(()=>window.wingUi.equipped===null);
  await tab('Equipped look');
  await page.locator('.cape-preview canvas').waitFor();
  assert.equal(await page.locator('.locker-detail .wing-preview').count(),0);
  assert.deepEqual(errors,[]);
  console.log('Wings UI passed: Shop claim, cosmetic-only cards, skin loading, equip, persisted color, Equipped look dimensions and unequip fallback.');
} finally { await browser.close(); }
