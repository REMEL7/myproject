import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createRelay} from '../server.mjs';

test('place information uses provider identity, safe links and exact matching',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'moagil-info-'));
 let documents=[{id:'123456',place_name:'검증카페',x:'127',y:'37.5',phone:'02-123-4567',category_name:'음식점 > 카페',place_url:'https://unsafe.example/'}];
 const server=createRelay({dataDir:dir,kakaoKey:'fixture',mapKey:'',mobilityKey:'',fetchPlaces:async()=>Response.json({documents})});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base=`http://127.0.0.1:${server.address().port}`;
 const call=async(route,token,data)=>{const r=await fetch(base+route,{method:data?'POST':'GET',headers:{Authorization:`Bearer ${token||''}`,'Content-Type':'application/json'},...(data?{body:JSON.stringify(data)}:{})});return {status:r.status,body:await r.json()};};
 try{
  const room=(await call('/api/rooms',null,{name:'정보 검증'})).body,root='/api/rooms/'+room.id;
  const search=(await call(root+'/search?q=검증카페',room.joinToken)).body.places[0];
  assert.equal(search.info.phone,'02-123-4567');assert.equal(search.info.placeUrl,'https://place.map.kakao.com/123456');assert.equal(search.info.hoursAvailable,false);
  const added=await call(root+'/places',room.joinToken,{name:search.name,sender:'검증',latitude:37.5,longitude:127,sourceId:search.sourceId,info:{phone:'forged'}});
  let saved=(await call(root,room.joinToken)).body.places[0];assert.equal(saved.id,added.body.id);assert.equal(saved.info.phone,'02-123-4567');assert.ok(saved.info.checkedAt);
  const manual=(await call(root+'/places',room.ownerToken,{name:'직접 입력',sender:'검증',latitude:38,longitude:128,sourceId:search.sourceId,info:search.info})).body;
  saved=(await call(root,room.ownerToken)).body.places.find(p=>p.id===manual.id);assert.equal(saved.info,null);
  assert.equal((await call(root+'/places',room.joinToken,{action:'details',placeId:added.body.id})).status,403);
  const old=(await call('/api/rooms',null,{name:'기존 장소'})).body,oldRoot='/api/rooms/'+old.id;
  const oldPlace=(await call(oldRoot+'/places',old.ownerToken,{name:'검증카페',sender:'검증',latitude:37.5,longitude:127})).body;
  const refreshed=await call(oldRoot+'/places',old.ownerToken,{action:'details',placeId:oldPlace.id});assert.equal(refreshed.status,200);assert.equal(refreshed.body.places[0].info.sourceId,'123456');assert.equal(refreshed.body.places[0].opensAt,'');
  const mismatch=(await call('/api/rooms',null,{name:'동명이점 방지'})).body,mRoot='/api/rooms/'+mismatch.id;
  const far=(await call(mRoot+'/places',mismatch.ownerToken,{name:'검증카페',sender:'검증',latitude:37.8,longitude:127})).body;
  assert.equal((await call(mRoot+'/places',mismatch.ownerToken,{action:'details',placeId:far.id})).status,409);
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));if(!path.resolve(dir).startsWith(path.resolve(tmpdir())+path.sep))throw Error('Unexpected test directory');rmSync(dir,{recursive:true,force:true});}
});
