import assert from 'node:assert/strict';
import {parseArgs} from 'node:util';
import {readFile, mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createServer} from 'node:http';
import {PNG} from 'pngjs';
import {openExtensionSession} from '../src/testing/e2e/chrome-session.mjs';
const {values}=parseArgs({options:{asset:{type:'string'},out:{type:'string'},chrome:{type:'string'}}});
for(const key of ['asset','out','chrome'])if(!values[key])throw Error(`Missing --${key}`);
const output=path.resolve(values.out);await mkdir(output);
const health=await fetch('http://127.0.0.1:18949/health');assert.equal(health.status,200);
const bytes=await readFile(values.asset);
const light=PNG.sync.read(bytes);
for(let i=0;i<light.data.length;i+=4){light.data[i]=80;light.data[i+1]=220;light.data[i+2]=255;}
const lightBytes=PNG.sync.write(light);
const server=createServer((req,res)=>{
 if(req.url==='/light-logo.png'){res.setHeader('Content-Type','image/png');res.end(lightBytes);return;}
 if(req.url==='/logo.png'){res.setHeader('Content-Type','image/png');res.end(bytes);return;}
 res.setHeader('Content-Type','text/html');res.end(`<!doctype html><html><head><meta name="color-scheme" content="light"><style>body{background:white;color:#111;font:20px sans-serif;padding:40px}article{background:white;padding:30px}img{width:340px;height:auto}</style></head><body><article><h1>Local logo repair</h1><p>Transparent brand artwork should remain readable.</p><img id="dark-logo" src="/logo.png" alt="Simons Foundation logo"><img id="logo" src="/light-logo.png" alt="transparent logo"></article></body></html>`);
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const url=`http://127.0.0.1:${server.address().port}/`;
const profilePath=await mkdtemp(path.join(tmpdir(),'semantic-dark-model-e2e-'));
let session,popup;
try{
 session=await openExtensionSession({chromePath:values.chrome,extensionDir:path.resolve('dist'),profilePath,headless:true,viewport:{width:900,height:600},colorScheme:'dark',url});
 await session.page.waitForFunction(()=>document.querySelector('#logo')?.hasAttribute('data-semantic-dark-image-action'));
 const read=()=>session.page.locator('#logo').evaluate(img=>({source:img.getAttribute('src'),action:img.getAttribute('data-semantic-dark-image-action'),background:getComputedStyle(img).backgroundColor,reason:img.getAttribute('data-semantic-dark-image-reason'),filter:getComputedStyle(img).filter}));
 await session.page.waitForFunction(()=>document.querySelector('#dark-logo')?.getAttribute('data-semantic-dark-image-action')==='constraint:backplate');
 const before=await read();await session.page.screenshot({path:path.join(output,'before.png')});
 popup=await session.context.newPage();await session.page.bringToFront();
 await popup.goto(`chrome-extension://${session.extensionId}/popup.html`);
 await popup.waitForFunction(()=>!document.querySelector('#appearance').hidden);
 const version=await popup.locator('#version').textContent();
 const started=performance.now();await popup.locator('#local-model').check();
 await session.page.waitForFunction(()=>/^(provider|fallback):keep$/.test(document.querySelector('#logo')?.getAttribute('data-semantic-dark-image-action')??''),null,{timeout:15000});
 const elapsedMs=performance.now()-started;
 const after=await read();assert.equal(after.source,before.source);assert.equal(after.background,before.background);
 await session.page.screenshot({path:path.join(output,'after.png')});
 await popup.locator('#local-model').uncheck();
 await session.page.waitForFunction(()=>document.querySelector('#logo')?.getAttribute('data-semantic-dark-image-action')==='heuristic:keep');
 const restored=await read();assert.equal(restored.source,before.source);assert.equal(restored.background,before.background);
 const result={ok:true,version,scope:'One real previously exposed dark logo repaired by numeric constraints; one color-modified control exercises real model transport and preservation. Not a model utility/generalization claim.',darkLogoAction:await session.page.locator('#dark-logo').getAttribute('data-semantic-dark-image-action'),before,after,restored,settingToAppliedMs:elapsedMs,pageErrors:session.pageErrors};
 await writeFile(path.join(output,'result.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
}catch(error){if(session){await session.page.screenshot({path:path.join(output,'failure.png')});await writeFile(path.join(output,'failure.json'),JSON.stringify({error:String(error),state:await session.page.evaluate(()=>[...document.querySelectorAll('img')].map(img=>({id:img.id,action:img.getAttribute('data-semantic-dark-image-action'),kind:img.getAttribute('data-semantic-dark-image-kind'),parentBackground:getComputedStyle(img.parentElement).backgroundColor}))),console:session.consoleMessages,pageErrors:session.pageErrors},null,2));}throw error;}
finally{await popup?.close();await session?.close();await new Promise(resolve=>server.close(resolve));await rm(profilePath,{recursive:true,force:true});}
