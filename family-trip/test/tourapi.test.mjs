import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {tourApiProvider,normalizeVisitInfo} from '../tourapi.mjs';
import {createRelay} from '../server.mjs';

const candidate={contentid:'123',contenttypeid:'39',title:'검증 식당',mapx:'127',mapy:'37.5',addr1:'검증 주소',modifiedtime:'20261030090000'};
const place={name:'검증 식당',latitude:37.5,longitude:127};
const response=rows=>Response.json({response:{header:{resultCode:'0000'},body:{items:rows.length?{item:rows}:''}}});

test('TourAPI maps raw hours, holiday and menus without guessing prices; caches and decodes key once',async()=>{
 const calls=[];
 const lookup=tourApiProvider('test%2Bkey',async url=>{const u=new URL(url);calls.push(u);return response(u.pathname.endsWith('locationBasedList2')?[candidate]:[{contentid:'123',opentimefood:'10:00~21:00<br>휴게시간 15:00~17:00',restdatefood:'매주 화요일',treatmenu:'비빔밥 / 국수'}]);});
 const info=await lookup(place);assert.equal(info.status,'matched');assert.equal(info.operatingHours,'10:00~21:00\n휴게시간 15:00~17:00');assert.equal(info.restDays,'매주 화요일');assert.equal(info.fees,'');assert.equal(info.routeUsable,false);assert.equal(calls[0].searchParams.get('serviceKey'),'test+key');
 assert.deepEqual(await lookup(place),info);assert.equal(calls.length,2);
});

test('same-name distant and ambiguous branches are not attached',async()=>{
 for(const [rows,expected] of [[[{...candidate,mapx:'128'}],'not_found'],[[candidate,{...candidate,contentid:'456'}],'ambiguous']]){
  const calls=[];const lookup=tourApiProvider('fixture',async url=>{calls.push(url);assert.ok(!url.includes('detailIntro2'));return response(rows);});
  assert.equal((await lookup(place)).status,expected);assert.ok(calls.length<=2);
 }
});

test('fees and hotel check-in are distinct from opening hours',()=>{
 const museum=normalizeVisitInfo({...candidate,contenttypeid:'14'},{usefee:'성인 5,000원',usetimeculture:'09:00~18:00'},[{infoname:'관람료',infotext:'어린이 무료'}]);
 assert.match(museum.fees,/5,000원/);assert.match(museum.fees,/어린이 무료/);
 const hotel=normalizeVisitInfo({...candidate,contenttypeid:'32'},{checkintime:'15:00',checkouttime:'11:00'},[]);assert.equal(hotel.operatingHours,'');assert.equal(hotel.checkIn,'15:00');assert.equal(hotel.fees,'');
});

test('upstream errors never reveal credentials',async()=>{
 const key='credential-that-must-not-appear';const lookup=tourApiProvider(key,async()=>new Response('<xml>bad key</xml>'));
 await assert.rejects(lookup(place),error=>!error.message.includes(key)&&/인증키/.test(error.message));
});

test('room endpoint persists verified visit information without modifying manual route constraints',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'moagil-tour-'));
 const server=createRelay({dataDir:dir,kakaoKey:'',mapKey:'',mobilityKey:'',tourKey:'fixture',fetchTour:async url=>response(url.includes('locationBasedList2')?[candidate]:[{contentid:'123',opentimefood:'10:00~21:00',restdatefood:'화요일'}])});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
 const call=async(route,token,data)=>{const r=await fetch(base+route,{method:data?'POST':'GET',headers:{Authorization:`Bearer ${token||''}`,'Content-Type':'application/json'},...(data?{body:JSON.stringify(data)}:{})});return {status:r.status,body:await r.json()};};
 try{
  const r=(await call('/api/rooms',null,{name:'관광정보 검사'})).body,root='/api/rooms/'+r.id;
  const added=(await call(root+'/places',r.ownerToken,{...place,sender:'검증',opensAt:'09:00',closesAt:'22:00'})).body;
  assert.equal((await call(root+'/places','invalid',{action:'tourDetails',placeId:added.id})).status,403);
  const result=await call(root+'/places',r.joinToken,{action:'tourDetails',placeId:added.id});assert.equal(result.status,200);
  const p=result.body.places[0];assert.equal(p.visitInfo.operatingHours,'10:00~21:00');assert.equal(p.opensAt,'09:00');assert.equal(p.closesAt,'22:00');assert.equal(p.visitInfo.routeUsable,false);
  assert.equal((await call(root,r.ownerToken)).body.places[0].visitInfo.contentId,'123');
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));if(!path.resolve(dir).startsWith(path.resolve(tmpdir())+path.sep))throw Error('Unexpected test directory');rmSync(dir,{recursive:true,force:true});}
});
