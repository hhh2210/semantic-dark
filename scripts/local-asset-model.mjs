import {parseArgs} from 'node:util';
import {mkdir, writeFile, appendFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {PNG} from 'pngjs';
import {build} from 'esbuild';

const {values}=parseArgs({options:{runtime:{type:'string'},deployment:{type:'string'},out:{type:'string'},'max-calls':{type:'string',default:'32'}}});
for(const key of ['runtime','deployment','out'])if(!values[key])throw Error(`Missing --${key}`);
const output=path.resolve(values.out);await mkdir(output);
const runtime=path.resolve(values.runtime),maxCalls=Number(values['max-calls']);
if(!Number.isInteger(maxCalls)||maxCalls<2||maxCalls>128)throw Error('max-calls must be 2..128');
const {validatedDeployment}=await import(pathToFileURL(path.join(runtime,'deployment-router.mjs')));
const {startDecisionService}=await import(pathToFileURL(path.join(runtime,'service-client.mjs')));
const colorsFile=path.join(output,'colors.mjs');
await build({stdin:{contents:`export {parseCssColor, compositeSrgb, contrastRatio} from './src/color/index';`,resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',outfile:colorsFile});
const {parseCssColor,compositeSrgb,contrastRatio}=await import(pathToFileURL(colorsFile));
let service,busy=false,ready=false,calls=0;
const cache=new Map();
const log=record=>appendFile(path.join(output,'requests.jsonl'),JSON.stringify(record)+'\n');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');

function validate(body){
 const {width,height,data}=body.pixels??{};
 if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>128||height>128||!Array.isArray(data)||data.length!==width*height*4||data.some(v=>!Number.isInteger(v)||v<0||v>255))throw Error('Invalid pixels');
 if(!Array.isArray(body.allowed)||!body.allowed.includes('keep')||body.allowed.some(a=>!['keep','dim','backplate'].includes(a)))throw Error('Invalid actions');
 for(const value of [body.background,body.canvasBackground])if(typeof value!=='string'||value.length>80)throw Error('Invalid background');
 return body;
}
const glyphs={A:['01110','10001','10001','11111','10001','10001','10001'],B:['11110','10001','10001','11110','10001','10001','11110'],C:['01111','10000','10000','10000','10000','10000','01111']};
function panel(pixels,background,action,label){
 const result=new PNG({width:160,height:160});
 for(let i=0;i<result.data.length;i+=4){result.data.set([...background,255],i);}
 const ox=Math.floor((160-pixels.width)/2),oy=25+Math.floor((128-pixels.height)/2);
 for(let y=0;y<pixels.height;y++)for(let x=0;x<pixels.width;x++){
  const at=(y*pixels.width+x)*4,to=((oy+y)*160+ox+x)*4,a=pixels.data[at+3]/255;
  for(let c=0;c<3;c++){
   let value=pixels.data[at+c];if(action==='dim')value=Math.max(0,Math.min(255,1.04*0.82*value-0.02*255));
   result.data[to+c]=Math.round(value*a+(action==='backplate'?255:background[c])*(1-a));
  }
 }
 if(label)for(const [y,row]of glyphs[label].entries())for(const[x,pixel]of[...row].entries())if(pixel==='1')for(let dy=0;dy<2;dy++)for(let dx=0;dx<2;dx++){const at=((7+y*2+dy)*160+75+x*2+dx)*4;result.data.set([240,240,240,255],at);}
 return result;
}
async function decide(body,warmup=false){
 const canvas=parseCssColor(body.canvasBackground)??{r:17/255,g:20/255,b:22/255,a:1};
 const background=compositeSrgb(parseCssColor(body.background)??canvas,canvas);
 const rgb=[background.r,background.g,background.b].map(c=>Math.round(c*255));
 const original=PNG.sync.write(panel(body.pixels,[255,255,255],'keep'));
 const actions=['keep','dim','backplate'];
 const contrast = Object.fromEntries(actions.map(action => {
  let minimum=21,count=0;
  for(let i=0;i<body.pixels.data.length;i+=4){
   if(body.pixels.data[i+3]<250)continue;
   let rgb=body.pixels.data.slice(i,i+3).map(c=>c/255);
   if(action==='dim')rgb=rgb.map(c=>Math.max(0,Math.min(1,1.04*.82*c-.02)));
   const bg=action==='backplate'?{r:1,g:1,b:1,a:1}:background;
   minimum=Math.min(minimum,contrastRatio({r:rgb[0],g:rgb[1],b:rgb[2],a:1},bg));count++;
  }
  return [action,count?Number(minimum.toFixed(2)):null];
 }));
 const grid=new PNG({width:480,height:160});
 actions.forEach((action,i)=>PNG.bitblt(panel(body.pixels,rgb,action,String.fromCharCode(65+i)),grid,0,0,160,160,i*160,0));
 const candidates=PNG.sync.write(grid);
 const key=hash(Buffer.concat([original,candidates,Buffer.from(body.allowed.join(','))]));
 if(cache.has(key))return {...cache.get(key),cached:true};
 if(calls>=maxCalls)throw Error('Request cap reached');
 calls++;
 const result=await service.call({model:'semantic-dark-e2e',state:{original:'<image:1>',alternatives:'<image:2>',minimumOpaquePixelContrast:{A:contrast.keep,B:contrast.dim,C:contrast.backplate},requiredShapeContrast:3},
  questions:{action:{type:'choice',instructions:'Image 1 is the original logo on a light background. Image 2 shows three actual alternatives A-C in a dark interface. Choose the one that preserves recognizable shapes, readable marks and meaningful brand colors. The numeric minimumOpaquePixelContrast in state is measured from actual opaque pixels against the candidate background. Require at least 3:1 for visible logo shapes. Prefer keeping the image when it is already readable; otherwise choose a repair that makes it readable. Choose D if none is acceptable.',criteria:{A:'Candidate A',B:'Candidate B',C:'Candidate C',D:'Abstain'}}},
  media:[{type:'image',data:'data:image/png;base64,'+original.toString('base64')},{type:'image',data:'data:image/png;base64,'+candidates.toString('base64')}]},{backend:'single-direct-restricted'});
 const choice=result.response.answers?.action?.choice;
 const selected=actions[choice?.charCodeAt(0)-65]??'keep';
 const answer={action:body.allowed.includes(selected)?selected:'keep',apiMs:result.apiMs};
 cache.set(key,answer);if(cache.size>32)cache.delete(cache.keys().next().value);
 await log({key,warmup,contrast,choice,...answer,allowed:body.allowed,model:result.response.model,usage:result.response.usage});
 return answer;
}
const server=createServer(async(req,res)=>{
 res.setHeader('Content-Type','application/json');
 const origin=req.headers.origin;
 if(origin&&!/^chrome-extension:\/\/[a-p]{32}$/.test(origin)){res.writeHead(403);res.end('{}');return;}
 if(origin)res.setHeader('Access-Control-Allow-Origin',origin);
 if(req.method==='OPTIONS'){res.setHeader('Access-Control-Allow-Headers','Content-Type');res.setHeader('Access-Control-Allow-Methods','POST');res.end();return;}
 if(req.url==='/health'){res.writeHead(ready?200:503);res.end(JSON.stringify({ready,calls}));return;}
 if(req.url!=='/decide'||req.method!=='POST'||!req.headers['content-type']?.startsWith('application/json')){res.writeHead(400);res.end('{}');return;}
 if(!ready||busy){res.writeHead(503);res.end('{}');return;}
 busy=true;
 try{
  let bytes=0;const chunks=[];
  for await(const chunk of req){bytes+=chunk.length;if(bytes>400000)throw Error('Body too large');chunks.push(chunk);}
  const body=validate(JSON.parse(Buffer.concat(chunks).toString()));
  const started=performance.now();const answer=await decide(body);
  res.end(JSON.stringify({...answer,totalMs:performance.now()-started}));
 }catch(error){res.writeHead(400);res.end(JSON.stringify({action:'keep',error:String(error)}));}
 finally{busy=false;}
});
let closing=false;
async function close(){if(closing)return;closing=true;ready=false;server.close();await service?.stop();}
process.on('SIGTERM',()=>void close().then(()=>process.exit(0)));
process.on('SIGINT',()=>void close().then(()=>process.exit(0)));
try{
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(18949,'127.0.0.1',resolve);});
 const deployment=await validatedDeployment(path.resolve(values.deployment),'adapted');
 service=await startDecisionService({out:output,...deployment,minPixels:24576,maxPixels:65536,maxCalls});
 await writeFile(path.join(output,'deployment.json'),JSON.stringify(deployment,null,2)+'\n');
 const pixels={width:64,height:64,data:Array.from({length:64*64},(_,i)=>[20,30,60,i%64>16&&i%64<48?255:0]).flat()};
 await decide({pixels,background:'#111416',canvasBackground:'#111416',allowed:['keep','dim','backplate']},true);
 ready=true;console.log('Local asset model ready on 127.0.0.1:18949');
}catch(error){await close();throw error;}
