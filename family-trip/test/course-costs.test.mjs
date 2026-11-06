import test from 'node:test';
import assert from 'node:assert/strict';
import {admissionEstimate,chooseParking,courseCosts,cheaperParkingPlaces} from '../course-costs.mjs';
import {createRelay} from '../server.mjs';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
const info=fees=>({status:'matched',provider:'tourapi',fees,sourceUrl:'https://www.data.go.kr/data/15101578/openapi.do'});
test('admission counts explicit adult prices and free tariffs without guessing mixed, variable or child fees',()=>{
 for(const fees of ['성인 3,000원','관람료:\n성인 3,000원\n어린이 1,000원'])assert.equal(admissionEstimate({category:'trip'},info(fees),3).total,9000);
 assert.equal(admissionEstimate({},info('무료'),2).total,0);
 for(const fees of ['', '어린이 1,000원','성인 3,000~5,000원','성인 3,000원\n주말 5,000원','성인 3,000원\n특별전 별도','성인 3,000원 / 청소년 1,000원'])assert.equal(admissionEstimate({},info(fees),2).total,null);
 assert.equal(admissionEstimate({category:'food'},null,2).status,'not_applicable');
 assert.equal(admissionEstimate({},null,3,2000).total,6000);
 for(const amount of [-1,1.5,'3000',1000001])assert.throws(()=>admissionEstimate({},null,1,amount));
});
test('nearest default uses distance across facility groups, preserves overrides and never turns unknown fees into free',async()=>{
 const rows=[{id:'facility',relation:'facility',distanceMeters:400,latitude:37.51,longitude:127,feeType:'유료',basicMinutes:60,basicFee:3000},{id:'nearby',relation:'nearby',distanceMeters:100,latitude:37.51,longitude:127.001,basicFee:null}];
 let calls=0;const options={vehicle:{type:'standard'},lookup:async()=>{calls++;return {status:'ready',items:rows};}};
 const automatic=await chooseParking({},undefined,options);assert.equal(automatic.id,'nearby');assert.equal(automatic.estimatedFee,null);assert.equal(automatic.selectionSource,'nearest');
 const manual=await chooseParking({},{parkingId:'facility',minutes:60},options);assert.equal(manual.id,'facility');assert.equal(manual.estimatedFee,3000);assert.equal(manual.selectionSource,'user');
 const before=calls;assert.equal((await chooseParking({},{mode:'none'},options)).selectionSource,'user');assert.equal(calls,before);
 await assert.rejects(chooseParking({},{parkingId:'fake'},options),{status:409});
 assert.equal((await chooseParking({},undefined,{...options,lookup:async()=>({status:'error'})})).selectionSource,'unavailable');
});
test('cost summary keeps unknown parking and admission separate from known totals',()=>{
 const c=courseCosts([{parking:{mode:'selected',estimatedFee:900},admission:{total:6000}},{parking:{mode:'selected',estimatedFee:null},admission:{total:null}}],2);
 assert.equal(c.knownTotal,6900);assert.equal(c.unknownParking,1);assert.equal(c.unknownAdmission,1);assert.equal(c.complete,false);
 assert.equal(courseCosts([{parking:{mode:'none',selectionSource:'user'},admission:{total:0}}]).complete,true);
});
test('cost strategy changes automatic parking to a cheaper known tariff while preserving explicit decisions',async()=>{
 const lots=[{id:'near',name:'가까운 곳',latitude:37.5,longitude:127,distanceMeters:50,feeType:'유료',basicMinutes:60,basicFee:5000},{id:'cheap',name:'저렴한 곳',latitude:37.503,longitude:127,distanceMeters:330,feeType:'유료',basicMinutes:60,basicFee:1000},{id:'unknown',latitude:37.501,longitude:127,distanceMeters:100,basicFee:null},{id:'too-far',latitude:37.52,longitude:127,distanceMeters:1500,feeType:'무료'}];
 const options={lookup:async()=>({status:'ready',items:lots}),vehicle:{type:'standard'}};
 const p={id:'venue',name:'관광지',admission:{total:6000},parking:{...lots[0],mode:'selected',selectionSource:'nearest',minutes:60,estimatedFee:5000}};
 const r=await cheaperParkingPlaces([p],options);assert.equal(r.pool[0].parking.id,'cheap');assert.equal(r.pool[0].navigationTarget.latitude,37.503);assert.equal(r.pool[0].admission.total,6000);assert.equal(r.changes.length,1);assert.equal(r.unknownCandidates,1);assert.equal(p.parking.id,'near');
 const locked={...p,parking:{...p.parking,selectionSource:'user'}};assert.equal((await cheaperParkingPlaces([locked],options)).pool[0].parking.id,'near');
 const none={...p,parking:{mode:'none',selectionSource:'user'}};assert.equal((await cheaperParkingPlaces([none],options)).pool[0].parking.mode,'none');
});
test('prepare and plan share server-verified nearest parking, allow explicit no parking and persist per-person costs',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'gmg-costs-'));
 const row={prkplceNo:'P1',prkplceNm:'가까운 주차장',latitude:'37.5001',longitude:'127',parkingchrgeInfo:'유료',basicTime:'60',basicCharge:'1000',referenceDate:'2026-11-06'};
 const cheaper={...row,prkplceNo:'P2',prkplceNm:'조금 먼 저렴한 주차장',latitude:'37.503',basicCharge:'500'};
 let server=createRelay({dataDir:dir,kakaoKey:'',mapKey:'',mobilityKey:'',tourKey:'',parkingKey:'private',fetchParking:async()=>Response.json({header:{resultCode:'00'},body:{items:{item:[row,cheaper]},totalCount:2}})});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
 const call=async(route,key,data)=>{const r=await fetch(base+route,{method:data?'POST':'GET',headers:{Authorization:'Bearer '+(key||''),'Content-Type':'application/json'},...(data?{body:JSON.stringify(data)}:{})});return {status:r.status,body:await r.json()};};
 try{
  const r=(await call('/api/rooms','',{name:'자동 주차 비용 검증'})).body,root='/api/rooms/'+r.id;
  const id=(await call(root+'/places',r.ownerToken,{name:'관광지',latitude:37.5,longitude:127,category:'trip',sender:'검증'})).body.id;
  await call(root+'/parking',r.ownerToken,{placeId:id});await new Promise(resolve=>setTimeout(resolve,20));
  const payload={placeIds:[id],adultCount:3,admissionOverrides:{[id]:2000},parkingSelections:{}};
  assert.equal((await call(root+'/course',r.joinToken,{...payload,action:'prepare'})).status,403);
  const prepared=(await call(root+'/course',r.ownerToken,{...payload,action:'prepare'})).body;
  assert.equal(prepared.places[0].parking.id,'P1');assert.equal(prepared.costSummary.knownTotal,7000);
  const planned=(await call(root+'/plan',r.ownerToken,{...payload,origin:{latitude:37.49,longitude:127}})).body;
  assert.equal(planned.plans.length,3);assert.deepEqual(planned.plans.map(p=>p.strategy),['time','distance','cost']);
  const cost=planned.plans[2];assert.equal(cost.costSummary.knownTotal,6500);assert.equal(cost.stops[0].parking.id,'P2');assert.equal(cost.stops[0].navigationLatitude,37.503);assert.equal(cost.costComparison.changedCount,1);assert.equal(cost.costDelta.comparable,true);assert.equal(cost.costDelta.amount,500);
  assert.equal(planned.plans[0].stops[0].navigationLatitude,37.5001);assert.equal(planned.plans[0].costSummary.knownTotal,7000);
  const chosen=(await call(root+'/course',r.ownerToken,{action:'choose',planId:planned.plans[0].id})).body.course;
  assert.equal(chosen.stops[0].admission.total,6000);assert.equal(chosen.adultCount,3);
  const locked=(await call(root+'/plan',r.ownerToken,{...payload,origin:{latitude:37.49,longitude:127},parkingSelections:{[id]:{parkingId:'P1',minutes:60,selectionSource:'user'}}})).body;
  assert.equal(locked.plans[2].stops[0].parking.id,'P1');assert.equal(locked.plans[2].costSummary.knownTotal,7000);
  const none=(await call(root+'/course',r.ownerToken,{...payload,action:'prepare',parkingSelections:{[id]:{mode:'none'}}})).body;
  assert.equal(none.places[0].parking.mode,'none');assert.equal(none.costSummary.knownTotal,6000);
  assert.equal((await call(root+'/course',r.ownerToken,{...payload,action:'prepare',admissionOverrides:{[id]:'free'}})).status,400);
  assert.equal((await call(root+'/course',r.ownerToken,{...payload,action:'prepare',adultCount:0})).status,400);
  assert.equal((await call(root,r.ownerToken)).body.course.id,chosen.id);
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));if(!path.resolve(dir).startsWith(path.resolve(tmpdir())+path.sep))throw Error('Unexpected test directory');rmSync(dir,{recursive:true,force:true});}
});
