import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {createServer} from 'node:http';
import {parseArgs} from 'node:util';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {build} from 'esbuild';
import {chromium} from 'playwright';

const {values} = parseArgs({options: {manifest: {type:'string'}, out: {type:'string'}, chrome: {type:'string'}}});
if (!values.manifest || !values.out || !values.chrome) throw Error('Required: --manifest download-ledger.json --out NEW_DIRECTORY --chrome EXECUTABLE');
const output = path.resolve(values.out);
await mkdir(output); // Never overwrite a previous bank.
const assets = JSON.parse(await readFile(values.manifest, 'utf8'));
if (assets.length > 16) throw Error('This diagnostic is capped at 16 assets');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const bundle = await build({stdin: {contents: `export {classifyVisualResource, refineVisualResourceClassification} from './src/vision/index';
export {recolorRasterDiagram} from './src/raster/index';
export {allowedAssetActions, decideAsset} from './src/vision/action-policy';`, resolveDir:process.cwd()},
  bundle:true, write:false, format:'iife', globalName:'bankEngine', target:'chrome120'});
const bodies = new Map();
for (const item of assets.filter(a => a.downloadExit === 0)) {
  const bytes = await readFile(item.path);
  if (hash(bytes) !== item.sha256) throw Error(`Source hash mismatch: ${item.id}`);
  bodies.set(`/asset/${item.id}`, {bytes, mime:item.response.split(' ').slice(1).join(' ') || item.mime});
}
const html = `<!doctype html><meta charset="utf-8"><style>
body{margin:0;background:#111416;color:#eee;font:14px sans-serif}.panel{width:340px;height:280px;display:flex;flex-direction:column;align-items:center;justify-content:center;overflow:hidden}
.panel img{max-width:320px;max-height:240px;object-fit:contain}.label{height:24px}#grid{display:grid;grid-template-columns:repeat(3,340px);width:1020px}#source{background:white;color:black}
</style><div id="source" class="panel"></div><div id="grid"></div>`;
const server=createServer((req,res)=>{
  const body=bodies.get(req.url);
  res.setHeader('Content-Type',body?.mime || 'text/html');res.end(body?.bytes || html);
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
let browser;
const records=[];
try {
  browser=await chromium.launch({executablePath:values.chrome,headless:true});
  const context=await browser.newContext({viewport:{width:1040,height:900},deviceScaleFactor:1});
  await context.route('**/*',route=>new URL(route.request().url()).origin===origin ? route.continue() : route.abort());
  const page=await context.newPage();
  for (const asset of assets) {
    const record={id:asset.id,sourceSha256:asset.sha256,family:asset.family,previouslyExposed:true};
    try {
      if(asset.downloadExit!==0) throw Error(`Source download failed: ${asset.downloadExit}`);
      await page.goto(origin);await page.addScriptTag({content:bundle.outputFiles[0].text});
      Object.assign(record,await page.evaluate(async ({id,url})=>{
        const source=new Image();source.src=`/asset/${id}`;await source.decode();
        const width=source.naturalWidth,height=source.naturalHeight;
        if(width*height>1_000_000) throw Error('Source exceeds production raster pixel budget');
        const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
        const ctx=canvas.getContext('2d');ctx.drawImage(source,0,0);const pixels=ctx.getImageData(0,0,width,height);
        const small=document.createElement('canvas');const scale=Math.min(1,128/Math.max(width,height));
        small.width=Math.max(1,Math.round(width*scale));small.height=Math.max(1,Math.round(height*scale));
        const smallContext=small.getContext('2d');smallContext.drawImage(source,0,0,small.width,small.height);
        const classification=bankEngine.refineVisualResourceClassification(bankEngine.classifyVisualResource(smallContext.getImageData(0,0,small.width,small.height),{maxSamples:4096}),{url});
        const diagram=bankEngine.recolorRasterDiagram(pixels,{r:17/255,g:20/255,b:22/255,a:1});
        const diagramCanvas=document.createElement('canvas');diagramCanvas.width=width;diagramCanvas.height=height;
        diagramCanvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(diagram.data),width,height),0,0);
        const reference=document.createElement('img');reference.src=source.src;document.querySelector('#source').append(reference);
        const actions=['keep','dim','monochrome','diagram','backplate'];
        for(const [index,action] of actions.entries()) {
          const panel=document.createElement('div');panel.className='panel';panel.id=action;
          const label=document.createElement('div');label.className='label';label.textContent=String.fromCharCode(65+index);
          const image=document.createElement('img');image.src=action==='diagram'?diagramCanvas.toDataURL():source.src;
          if(action==='dim')image.style.filter='brightness(.82) contrast(1.04)';
          if(action==='monochrome')image.style.filter='brightness(0) invert(.92)';
          if(action==='backplate')image.style.background='white';
          panel.append(label,image);document.querySelector('#grid').append(panel);await image.decode();
        }
        await reference.decode();
        return {width,height,actions,allowed:bankEngine.allowedAssetActions(classification),baseline:await bankEngine.decideAsset({schema:'semantic-dark.asset-decision.v1',source:url,pixels:smallContext.getImageData(0,0,small.width,small.height),classification,elementBackground:'transparent',parentBackground:'#111416',canvasBackground:'#111416',simpleBackdrop:true},undefined,new AbortController().signal),classification,diagramStatus:diagram.report.status,diagramReason:diagram.report.reason};
      },{id:asset.id,url:asset.url}));
      const dir=path.join(output,asset.id);await mkdir(dir);
      const reference=await page.locator('#source').screenshot({path:path.join(dir,'source.png')});
      const grid=await page.locator('#grid').screenshot({path:path.join(dir,'candidates.png')});
      record.sourcePanel=path.join(dir,'source.png');record.grid=path.join(dir,'candidates.png');
      record.sourcePanelSha256=hash(reference);record.gridSha256=hash(grid);
      record.candidates=[];
      for(const action of record.actions) {
        const file=path.join(dir,action+'.png');const bytes=await page.locator('#'+action).screenshot({path:file});
        record.candidates.push({action,path:file,sha256:hash(bytes)});
      }
      record.status='rendered';
    }catch(error){record.status='failed';record.error=String(error);}
    records.push(record);await writeFile(path.join(output,'bank.json'),JSON.stringify({schema:'semantic-dark.asset-action-bank.v1',manifest:path.resolve(values.manifest),scope:'Previously exposed public raw assets rendered on controlled backgrounds. No action labels or generalization claims.',records},null,2)+'\n');
    console.log(record.id,record.status,record.baseline?.action,record.allowed?.join(','));
  }
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
