import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createRelay} from '../server.mjs';
import {attachCostComparisons} from '../course-costs.mjs';

test('arrival and remaining budgets survive restart, skip, undo and stale requests',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'gmg-progress-'));let server,base;
 const start=async()=>{server=createRelay({dataDir:dir,kakaoKey:'',mapKey:'',mobilityKey:'',tourKey:'',parkingKey:''});await new Promise(r=>server.listen(0,'127.0.0.1',r));base=`http://127.0.0.1:${server.address().port}`;};
 const stop=async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));};
 const call=async(route,key,data)=>{const r=await fetch(base+route,{method:data?'POST':'GET',headers:{Authorization:'Bearer '+(key||''),'Content-Type':'application/json'},...(data?{body:JSON.stringify(data)}:{})});return {status:r.status,body:await r.json()};};
 try{
  await start();const room=(await call('/api/rooms','',{name:'progress fixture'})).body,root='/api/rooms/'+room.id;
  const ids=[];for(let i=0;i<3;i++)ids.push((await call(root+'/places',room.ownerToken,{name:'장소 '+i,sender:'검사',category:'trip',latitude:37.5+i*.01,longitude:127})).body.id);
  const payload={placeIds:ids,adultCount:2,parkingSelections:Object.fromEntries(ids.map(id=>[id,{mode:'none'}])),admissionOverrides:Object.fromEntries(ids.map((id,i)=>[id,(i+1)*1000])),origin:{latitude:37.49,longitude:127}};
  const plans=(await call(root+'/plan',room.ownerToken,payload)).body.plans;
  assert.equal(plans[2].costDelta.comparable,true);assert.equal(plans[2].costDelta.amount,0);
  let c=(await call(root+'/course',room.ownerToken,{action:'choose',planId:plans[0].id})).body.course;
  assert.equal(c.costSummary.knownTotal,12000);assert.equal(c.remainingCostSummary.knownTotal,12000);
  const first=c.stops[0],arrive={action:'arrive',placeId:first.placeId,courseId:c.id,expectedIndex:0};
  assert.equal((await call(root+'/course',room.joinToken,arrive)).status,403);
  assert.equal((await call(root+'/course',room.ownerToken,{...arrive,courseId:'stale'})).status,409);
  assert.equal((await call(root+'/course',room.ownerToken,{...arrive,expectedIndex:1})).status,409);
  const arrived=(await call(root+'/course',room.ownerToken,arrive)).body;
  assert.equal(arrived.course.nextIndex,0);assert.equal(arrived.course.stops[0].status,'arrived');
  assert.equal((await call(root+'/course',room.ownerToken,arrive)).body.revision,arrived.revision);
  await stop();await start();c=(await call(root,room.ownerToken)).body.course;
  assert.equal(c.stops[0].status,'arrived');assert.ok(c.stops[0].arrivedAt);assert.equal(c.remainingCostSummary.knownTotal,12000);
  c=(await call(root+'/course',room.ownerToken,{...arrive,action:'visit'})).body.course;
  assert.equal(c.nextIndex,1);assert.equal(c.visitedCostSummary.knownTotal,first.admission.total);assert.equal(c.remainingCostSummary.knownTotal,12000-first.admission.total);
  assert.equal((await call(root+'/course',room.ownerToken,{...arrive,action:'visit'})).status,409);
  c=(await call(root+'/course',room.ownerToken,{action:'undo',courseId:c.id,expectedIndex:1})).body.course;
  assert.equal(c.stops[0].status,'arrived');assert.equal(c.remainingCostSummary.knownTotal,12000);
  c=(await call(root+'/course',room.ownerToken,{...arrive,action:'skip'})).body.course;
  assert.equal(c.skippedCount,1);assert.equal(c.visitedCostSummary.knownTotal,0);assert.equal(c.remainingCostSummary.knownTotal,12000-first.admission.total);
  while(c.status==='active')c=(await call(root+'/course',room.ownerToken,{action:'visit',courseId:c.id,expectedIndex:c.nextIndex,placeId:c.stops[c.nextIndex].placeId})).body.course;
  assert.equal(c.status,'complete');assert.equal(c.remainingCostSummary.knownTotal,0);assert.equal(c.visitedCostSummary.knownTotal,12000-first.admission.total);assert.equal(c.costSummary.knownTotal,12000);
 }finally{if(server?.listening)await stop();if(!path.resolve(dir).startsWith(path.resolve(tmpdir())+path.sep))throw Error('Unexpected fixture path');rmSync(dir,{recursive:true,force:true});}
});

test('savings are asserted only when the same places, people and all tariffs can be compared',()=>{
 const make=(strategy,total,complete=true,placeId='a',people=2)=>({strategy,stops:[{placeId}],costSummary:{complete,knownTotal:total,adultCount:people,scope:'course'}});
 const plans=[make('time',7000),make('distance',8000),make('cost',5000)];attachCostComparisons(plans);
 assert.equal(plans[2].costDelta.amount,2000);assert.equal(plans[1].costDelta.amount,-1000);
 for(const other of [make('cost',1000,false),make('cost',1000,true,'b'),make('cost',1000,true,'a',3)]){
  const group=[make('time',7000),other];attachCostComparisons(group);assert.equal(other.costDelta.comparable,false);assert.equal(other.costDelta.amount,null);
 }
});
