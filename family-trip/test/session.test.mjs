import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createRelay} from '../server.mjs';

test('owner-only session rotation, closure, expiry and deletion invalidate participant access',async()=>{
 const dataDir=mkdtempSync(path.join(tmpdir(),'moagil-session-'));let clock=10000;
 const relay=createRelay({dataDir,now:()=>clock,roomLifetimeMs:1000,kakaoKey:'',mapKey:'',mobilityKey:''});
 await new Promise(r=>relay.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${relay.address().port}`;
 const call=async(route,token,data)=>{const res=await fetch(base+route,{method:data?'POST':'GET',headers:{...(token?{Authorization:`Bearer ${token}`} :{}),...(data?{'Content-Type':'application/json'}:{})},...(data?{body:JSON.stringify(data)}:{})});return {status:res.status,body:await res.json()};};
 try{
  const room=(await call('/api/rooms',null,{name:'isolated-session-test'})).body;const route=`/api/rooms/${room.id}`;
  assert.equal((await call(route+'/session',room.joinToken,{action:'rotateInvite'})).status,403);
  const rotated=await call(route+'/session',room.ownerToken,{action:'rotateInvite'});assert.equal(rotated.status,200);assert.notEqual(rotated.body.joinToken,room.joinToken);
  assert.equal((await call(route,room.joinToken)).status,403);const join=rotated.body.joinToken;
  assert.equal((await call(route,join)).status,200);
  assert.equal((await call(route+'/session',join,{action:'delete'})).status,403);
  await call(route+'/session',room.ownerToken,{action:'close'});assert.equal((await call(route,join)).status,403);assert.equal((await call(route,room.ownerToken)).status,200);
  const renewed=(await call(route+'/session',room.ownerToken,{action:'rotateInvite'})).body;
  assert.equal((await call(route,renewed.joinToken)).status,200);clock+=1001;
  assert.equal((await call(route,renewed.joinToken)).status,403);
  assert.equal((await call(route+'/session',room.ownerToken,{action:'delete'})).body.deleted,true);
  assert.equal((await call(route,room.ownerToken)).status,403);
 }finally{await new Promise(r=>relay.close(r));rmSync(dataDir,{recursive:true,force:true});}
});

test('request flood is limited without creating unlimited client records',async()=>{
 const dataDir=mkdtempSync(path.join(tmpdir(),'moagil-rate-'));const relay=createRelay({dataDir,kakaoKey:'',mapKey:'',mobilityKey:''});
 await new Promise(r=>relay.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${relay.address().port}`;
 try{let last;for(let i=0;i<121;i++)last=await fetch(base+'/not-found',{method:'POST'});assert.equal(last.status,429);}
 finally{await new Promise(r=>relay.close(r));rmSync(dataDir,{recursive:true,force:true});}
});
