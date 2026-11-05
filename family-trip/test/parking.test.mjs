import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {parkingApiProvider,normalizeParking} from '../parking.mjs';
import {createRelay} from '../server.mjs';
import {normalizeVisitInfo} from '../tourapi.mjs';
const row={prkplceNo:'P1',prkplceNm:'검증 주차장',latitude:'37.5',longitude:'127',parkingchrgeInfo:'유료',basicTime:'30',basicCharge:'',institutionNm:'검증 관리공단',instt_nm:'검증 시청',referenceDate:'2026-10-01'};
const response=(rows,total=rows.length)=>Response.json({response:{header:{resultCode:'00'},body:{items:rows,totalCount:total}}});
const settle=()=>new Promise(resolve=>setTimeout(resolve,15));

test('parking preserves missing fees, facility attribution and static availability',()=>{
 const p=normalizeParking(row);assert.equal(p.basicFee,null);assert.equal(p.basicMinutes,30);assert.equal(p.liveAvailability,null);assert.equal(p.storeBenefit,null);assert.equal(p.provider,'검증 시청');assert.equal(p.referenceDate,'2026-10-01');assert.match(p.sourceUrl,/15012896/);
 assert.equal(normalizeParking({...row,latitude:''}),null);
 const visit=normalizeVisitInfo({contentid:'1',contenttypeid:'39'},{parkingfood:'고객전용 주차장 있음'},[]);
 assert.equal(visit.parking,'고객전용 주차장 있음');assert.equal(visit.parkingFee,'');
});

test('all pages complete before nearby results; secret is decoded and refresh coalesces',async()=>{
 const calls=[];let release;const wait=new Promise(resolve=>release=resolve);
 const lookup=parkingApiProvider('encoded%2Bkey',{fetcher:async url=>{
  const u=new URL(url);calls.push(u);assert.equal(u.searchParams.get('serviceKey'),'encoded+key');
  if(u.searchParams.get('pageNo')==='1')return response(Array.from({length:1000},(_,i)=>({...row,prkplceNo:'P'+i,longitude:'128'})),1001);
  await wait;return response([row],1001);
 }});
 assert.equal(lookup({latitude:37.5,longitude:127}).status,'loading');await settle();
 assert.equal(lookup({latitude:37.5,longitude:127}).status,'loading');assert.equal(calls.length,2);
 release();await settle();const result=lookup({latitude:37.5,longitude:127});assert.equal(result.status,'ready');assert.equal(result.items.length,1);assert.equal(result.items[0].name,row.prkplceNm);
 assert.equal(calls.length,2);
});

test('incomplete downloads and provider errors never become empty successful results or expose keys',async()=>{
 for(const fetcher of [async()=>response([row],1001),async()=>{throw Error('secret-credential')}]){
  const lookup=parkingApiProvider('secret-credential',{fetcher});lookup({latitude:37.5,longitude:127});await settle();const r=lookup({latitude:37.5,longitude:127});assert.equal(r.status,'error');assert.ok(!JSON.stringify(r).includes('secret-credential'));
 }
});

test('live national API envelope with body.items.item is supported',async()=>{
 const lookup=parkingApiProvider('fixture',{fetcher:async()=>Response.json({header:{resultCode:'00'},body:{totalCount:1,items:{item:[row]}}})});
 assert.equal(lookup({latitude:37.5,longitude:127}).status,'loading');await settle();
 assert.equal(lookup({latitude:37.5,longitude:127}).items[0].id,'P1');
});

test('parking endpoint requires room authentication and never changes room or exposes credentials',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'gmg-parking-'));
 const server=createRelay({dataDir:dir,kakaoKey:'',mapKey:'',mobilityKey:'',tourKey:'',parkingKey:'private-key',fetchParking:async()=>response([row,{...row,prkplceNo:'P2',latitude:'37.5002',basicTime:'60',basicCharge:'500'},{...row,prkplceNo:'P3',latitude:'37.5004',parkingchrgeInfo:'무료'},{...row,prkplceNo:'P4',latitude:'37.5006'}])});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
 const call=async(route,key,data)=>{const r=await fetch(base+route,{method:data?'POST':'GET',headers:{Authorization:`Bearer ${key||''}`,'Content-Type':'application/json'},...(data?{body:JSON.stringify(data)}:{})});return {status:r.status,body:await r.json()};};
 try{
  const room=(await call('/api/rooms','',{name:'주차 검증'})).body,root='/api/rooms/'+room.id;
  const added=(await call(root+'/places',room.ownerToken,{name:'목적지',latitude:37.5,longitude:127,sender:'QA'})).body;
  const before=(await call(root,room.ownerToken)).body;
  assert.equal((await call(root+'/parking','invalid',{placeId:added.id})).status,403);
  assert.equal((await call(root+'/parking',room.joinToken,{placeId:'missing'})).status,404);
  const first=await call(root+'/parking',room.joinToken,{placeId:added.id});assert.equal(first.body.status,'loading');await settle();
  const ready=await call(root+'/parking',room.joinToken,{placeId:added.id});assert.equal(ready.body.status,'ready');assert.equal(ready.body.items[0].provider,'검증 시청');assert.ok(!JSON.stringify(ready).includes('private-key'));
  const prices=await call(root+'/parking',room.joinToken,{placeId:added.id,sort:'price',minutes:60});assert.deepEqual(prices.body.items.map(p=>p.id),['P3','P2','P1','P4']);
  assert.equal(prices.body.items[0].estimatedFee,0);assert.equal(prices.body.items[1].estimatedFee,500);assert.equal(prices.body.items[2].estimatedFee,null);
  assert.deepEqual((await call(root,room.ownerToken)).body,before);
  const sources=await fetch(base+'/sources');assert.equal(sources.status,200);assert.match(await sources.text(),/전국주차장정보표준데이터/);
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));if(!path.resolve(dir).startsWith(path.resolve(tmpdir())+path.sep))throw Error('Unexpected test directory');rmSync(dir,{recursive:true,force:true});}
});
