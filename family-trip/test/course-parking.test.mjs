import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {estimateParkingFee} from '../parking.mjs';
import {suggestCourses} from '../planner.mjs';
import {createRelay} from '../server.mjs';

test('parking estimates honor units, unknown fees and explicit free status without treating day passes as caps',()=>{
 const p={feeType:'유료',basicMinutes:30,basicFee:500,extraMinutes:15,extraFee:200,dayTicketFee:600};
 assert.equal(estimateParkingFee(p,30),500);assert.equal(estimateParkingFee(p,60),900);assert.equal(estimateParkingFee(p,61),1100);
 assert.equal(estimateParkingFee({...p,basicFee:null},60),null);
 assert.equal(estimateParkingFee({...p,extraMinutes:0},60),null);
 assert.equal(estimateParkingFee({...p,feeType:'무료'},60),0);
 assert.equal(estimateParkingFee({...p,feeType:''},60),null);
 assert.throws(()=>estimateParkingFee(p,0));assert.throws(()=>estimateParkingFee(p,481));
});

test('course deletion is owner-only, rejects stale dialogs, preserves places and stays deleted after restart',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'gmg-course-delete-'));
 const options={dataDir:dir,kakaoKey:'',mapKey:'',mobilityKey:'',tourKey:'',parkingKey:''};
 let server=createRelay(options);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let base=`http://127.0.0.1:${server.address().port}`;
 const call=async(route,key,data)=>{const response=await fetch(base+route,{method:data?'POST':'GET',headers:{Authorization:`Bearer ${key||''}`,'Content-Type':'application/json'},...(data?{body:JSON.stringify(data)}:{})});return {status:response.status,body:await response.json()};};
 try{
  const room=(await call('/api/rooms','',{name:'코스 삭제 검증'})).body,root='/api/rooms/'+room.id;
  const id=(await call(root+'/places',room.ownerToken,{name:'보존할 장소',sender:'검증',latitude:37.57,longitude:126.98})).body.id;
  for(const complete of [false,true]){
   const plans=(await call(root+'/plan',room.ownerToken,{origin:{latitude:37.56,longitude:126.97},placeIds:[id],parkingSelections:{}})).body.plans;
   let saved=(await call(root+'/course',room.ownerToken,{action:'choose',planId:plans[0].id})).body;
   if(complete)saved=(await call(root+'/course',room.ownerToken,{action:'visit',placeId:id})).body;
   const input={action:'delete',courseId:saved.course.id};
   assert.equal((await call(root+'/course',room.joinToken,input)).status,403);
   assert.equal((await call(root+'/course',room.ownerToken,{...input,courseId:'stale-id'})).status,409);
   const result=await call(root+'/course',room.ownerToken,input);assert.equal(result.status,200);
   assert.equal(result.body.course,null);assert.deepEqual(result.body.plans,[]);assert.deepEqual(result.body.places,saved.places);
   assert.equal((await call(root+'/course',room.ownerToken,{action:'choose',planId:plans[0].id})).status,404);
  }
  server.closeAllConnections();await new Promise(resolve=>server.close(resolve));server=createRelay(options);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));base=`http://127.0.0.1:${server.address().port}`;
  const restored=(await call(root,room.ownerToken)).body;assert.equal(restored.course,null);assert.equal(restored.places[0].id,id);assert.deepEqual(restored.plans,[]);
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));if(!path.resolve(dir).startsWith(path.resolve(tmpdir())+path.sep))throw Error('Unexpected test directory');rmSync(dir,{recursive:true,force:true});}
});

test('time and distance comparisons use separate road matrices and actual selected parking destinations',async()=>{
 const modes=[];const origin={latitude:37,longitude:127};
 const road=async()=>{throw Error('matrix should cover all legs')};
 road.matrix=async(from,points,mode)=>{modes.push(mode);assert.equal(points[0].latitude,37.03);return [[null,{duration:60,distance:10000},{duration:600,distance:100}],[null,null,{duration:60,distance:100}],[null,{duration:60,distance:100},null]];};
 const plans=await suggestCourses({origin,comparison:'driving',maxStops:2,roadProvider:road,places:[
  {id:'A',name:'첫 장소',latitude:37.01,longitude:127,navigationTarget:{latitude:37.03,longitude:127,name:'주차장 A',address:'주소 A'},parking:{mode:'selected',estimatedFee:900,minutes:60}},
  {id:'B',name:'둘째 장소',latitude:37.02,longitude:127,parking:{mode:'none'}}
 ]});
 assert.deepEqual(modes.sort(),['distance','time']);assert.equal(plans[0].stops[0].placeId,'A');assert.equal(plans[1].stops[0].placeId,'B');
 assert.equal(plans[0].stops[0].latitude,37.01);assert.equal(plans[0].stops[0].navigationLatitude,37.03);assert.equal(plans[0].stops[0].arrivalTarget,'parking');
 assert.equal(plans[0].parkingSummary.knownTotal,900);assert.equal(plans[0].parkingSummary.unassignedCount,1);
 assert.equal(plans[0].roadMinutes,2);assert.equal(plans[1].roadDistanceKm,.2);
});

test('explicit course choices persist verified parking, reject forged lots and replan the remaining course safely',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'gmg-course-parking-'));
 const row={prkplceNo:'P1',prkplceNm:'공식 주차장',latitude:'37.5105',longitude:'127',parkingchrgeInfo:'유료',basicTime:'30',basicCharge:'500',addUnitTime:'15',addUnitCharge:'200',referenceDate:'2026-10-01',institutionNm:'서울시설공단',prkplceSe:'공영',rdnmadr:'서울 강남구'};
 let server=createRelay({dataDir:dir,now:()=>Date.parse('2026-11-06T01:00:00+09:00'),kakaoKey:'',mapKey:'',mobilityKey:'',tourKey:'',parkingKey:'server-only-key',fetchParking:async()=>Response.json({header:{resultCode:'00'},body:{items:{item:[row]},totalCount:1}})});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let base=`http://127.0.0.1:${server.address().port}`;
 const call=async(route,key,data)=>{const r=await fetch(base+route,{method:data?'POST':'GET',headers:{Authorization:`Bearer ${key||''}`,'Content-Type':'application/json'},...(data?{body:JSON.stringify(data)}:{})});return {status:r.status,body:await r.json()};};
 try{
  const r=(await call('/api/rooms','',{name:'별도 코스 검증'})).body,root='/api/rooms/'+r.id;
  const ids=[];for(let i=0;i<3;i++)ids.push((await call(root+'/places',r.ownerToken,{name:'장소'+i,sender:'검증',latitude:37.51+i*.01,longitude:127})).body.id);
  await call(root+'/parking',r.ownerToken,{placeId:ids[0],minutes:60});await new Promise(resolve=>setTimeout(resolve,20));
  const payload={origin:{latitude:37.5,longitude:127},placeIds:ids.slice(0,2),parkingSelections:{[ids[0]]:{parkingId:'P1',minutes:60,estimatedFee:0,latitude:0}}};
  assert.equal((await call(root+'/plan',r.ownerToken,{...payload,vehicle:{type:'forged'}})).status,400);
  assert.equal((await call(root+'/parking',r.ownerToken,{placeId:ids[0],vehicle:{type:'low2',diesel:'true'}})).status,400);
  assert.equal((await call(root+'/plan',r.joinToken,payload)).status,403);
  assert.equal((await call(root+'/plan',r.ownerToken,{...payload,placeIds:[ids[0],ids[0]]})).status,400);
  assert.equal((await call(root+'/plan',r.ownerToken,{...payload,parkingSelections:{[ids[0]]:{parkingId:'forged',minutes:60}}})).status,409);
  const discounted=await call(root+'/plan',r.ownerToken,{...payload,vehicle:{type:'compact'}});
  assert.equal(discounted.status,200);assert.equal(discounted.body.plans[0].stops.find(s=>s.placeId===ids[0]).parking.estimatedFee,450);
  assert.equal(discounted.body.plans[0].vehicle.type,'compact');
  const planned=await call(root+'/plan',r.ownerToken,payload);assert.equal(planned.status,200);const plan=planned.body.plans[0];
  assert.equal(plan.comparison,'driving');assert.equal(plan.stops.length,2);assert.ok(plan.stops.every(s=>s.placeId!==ids[2]));
  const parked=plan.stops.find(s=>s.placeId===ids[0]);assert.equal(parked.navigationLatitude,37.5105);assert.equal(parked.parking.estimatedFee,900);assert.equal(parked.parking.referenceDate,row.referenceDate);
  assert.ok(!JSON.stringify(plan).includes('server-only-key'));
  const saved=(await call(root+'/course',r.ownerToken,{action:'choose',planId:plan.id})).body.course;
  const renamed=(await call(root+'/places',r.ownerToken,{action:'update',placeId:ids[0],name:'이름 변경 장소'})).body.course.stops.find(s=>s.placeId===ids[0]);
  assert.equal(renamed.navigationName,'이름 변경 장소 · 공식 주차장');
  await call(root+'/course',r.ownerToken,{action:'visit',placeId:saved.stops[0].placeId});
  const next=saved.stops[1].placeId;
  const replanned=await call(root+'/plan',r.ownerToken,{remainingOnly:true,origin:payload.origin,placeIds:[next,ids[2]],parkingSelections:{}});
  assert.equal(replanned.status,200);assert.equal(replanned.body.plans[0].prefixStops.length,1);
  const updated=(await call(root+'/course',r.ownerToken,{action:'choose',planId:replanned.body.plans[0].id})).body.course;
  assert.equal(updated.nextIndex,1);assert.equal(updated.stops.length,3);assert.equal(updated.stops[0].status,'visited');
  server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
  server=createRelay({dataDir:dir,kakaoKey:'',mapKey:'',mobilityKey:'',tourKey:'',parkingKey:''});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));base=`http://127.0.0.1:${server.address().port}`;
  assert.deepEqual((await call(root,r.ownerToken)).body.course,updated);
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));if(!path.resolve(dir).startsWith(path.resolve(tmpdir())+path.sep))throw Error('Unexpected test directory');rmSync(dir,{recursive:true,force:true});}
});
