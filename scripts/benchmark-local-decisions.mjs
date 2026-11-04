import {parseArgs} from 'node:util';
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
const {values}=parseArgs({options:{bank:{type:'string'},labels:{type:'string'},runtime:{type:'string'},deployment:{type:'string'},out:{type:'string'}}});
for(const key of ['bank','labels','runtime','deployment','out'])if(!values[key])throw Error(`Missing --${key}`);
const output=path.resolve(values.out);await mkdir(output);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const bankBytes=await readFile(values.bank),bank=JSON.parse(bankBytes);
const labelBytes=await readFile(values.labels),labels=JSON.parse(labelBytes);
if(labels.bankSha256!==sha(bankBytes))throw Error('Frozen labels do not match bank');
const records=bank.records.filter(r=>r.status==='rendered');
if(records.length>16)throw Error('Bounded diagnostic supports at most 16 source assets');
const runtime=path.resolve(values.runtime);
const {validatedDeployment}=await import(pathToFileURL(path.join(runtime,'deployment-router.mjs')));
const {startDecisionService}=await import(pathToFileURL(path.join(runtime,'service-client.mjs')));
const deployment=await validatedDeployment(path.resolve(values.deployment),'adapted');
await writeFile(path.join(output,'protocol.json'),JSON.stringify({schema:'semantic-dark.local-decision-probe.v1',bankSha256:sha(bankBytes),labelsSha256:sha(labelBytes),deployment,
  maxCalls:records.length,scope:'Prepared source/candidate PNG diagnostic using previously exposed assets. Existing adapted model, no training. Five-action input differs from the older four-action training. No browser transport or product E2E timing claim.'},null,2)+'\n');
const service=await startDecisionService({out:output,...deployment,minPixels:24576,maxPixels:196608,maxCalls:records.length});
const predictions=[];
try{
 for(const row of records){
  const source=await readFile(row.sourcePanel),grid=await readFile(row.grid);
  if(sha(source)!==row.sourcePanelSha256||sha(grid)!==row.gridSha256)throw Error(`Candidate bytes changed: ${row.id}`);
  const criteria=Object.fromEntries(row.actions.map((_,i)=>[String.fromCharCode(65+i),`Candidate ${String.fromCharCode(65+i)}`]));criteria.F='Abstain';
  const request={model:'semantic-dark-e2e',state:{task:'Choose one bounded image repair for a dark interface.',original:'<image:1>',alternatives:'<image:2>'},questions:{action:{type:'choice',
    instructions:'The original image is image 1. Image 2 shows five actual candidate renderings A-E. Choose the candidate that makes the image useful in the surrounding dark interface while preserving readable marks, recognizable shapes, meaningful colors and natural photographic appearance. Do not choose a blank or information-destroying result. Subject to those requirements, prefer less large flat bright background area. Choose F if none is acceptable or the evidence is insufficient.',criteria}},
    media:[{type:'image',data:'data:image/png;base64,'+source.toString('base64')},{type:'image',data:'data:image/png;base64,'+grid.toString('base64')}]};
  const result=await service.call(request,{backend:'single-direct-restricted'});
  predictions.push({id:row.id,actions:row.actions,allowed:row.allowed,baseline:row.baseline,requestSha256:sha(JSON.stringify(request)),...result});
  await writeFile(path.join(output,'predictions.json'),JSON.stringify(predictions,null,2)+'\n');
  console.log(row.id,result.apiMs.toFixed(1),JSON.stringify(result.response).slice(0,350));
 }
 await service.memory('after-probe');
}finally{await service.stop();}
