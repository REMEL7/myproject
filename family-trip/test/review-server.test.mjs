import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createReviewRelay} from '../review-server.mjs';

test('review examples need no credentials and never share place state between rooms',async()=>{
  const dir=mkdtempSync(path.join(tmpdir(),'gmg-review-'));const server=createReviewRelay(dir);
  try {
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
    const config=await (await fetch(base+'/api/config')).json();assert.equal(config.localOnly,true);assert.equal(config.searchEnabled,false);assert.equal(config.roadRoutingEnabled,false);
    const create=async()=>{const response=await fetch(base+'/api/rooms',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});assert.equal(response.status,201);return response.json();};
    const a=await create(),b=await create();assert.equal(a.places.length,3);assert.equal(b.places.length,3);
    assert.notEqual(a.places[0].id,b.places[0].id);assert.match(a.places[0].name,/^\[예시\]/);
    const response=await fetch(base+`/api/rooms/${a.id}/places`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${a.ownerToken}`},body:JSON.stringify({action:'delete',placeId:a.places[0].id})});assert.equal(response.status,200);
    const roomB=await(await fetch(base+`/api/rooms/${b.id}`,{headers:{Authorization:`Bearer ${b.ownerToken}`}})).json();assert.equal(roomB.places.length,3);
  } finally {await new Promise(resolve=>server.close(resolve));rmSync(dir,{recursive:true,force:true});}
});
