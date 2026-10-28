import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createRelay} from '../server.mjs';

test('vehicle edits and course-aware deletion preserve history and safe undo',async()=>{
 const dataDir=mkdtempSync(path.join(tmpdir(),'moagil-place-edit-'));
 const server=createRelay({dataDir,kakaoKey:'',mapKey:'',mobilityKey:''});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
 const call=async(route,token,data)=>{const response=await fetch(base+route,{method:data?'POST':'GET',headers:{Authorization:`Bearer ${token||''}`,...(data?{'Content-Type':'application/json'}:{})},...(data?{body:JSON.stringify(data)}:{})});return {status:response.status,body:await response.json()};};
 try{
  const r=(await call('/api/rooms',null,{name:'장소 관리 검사'})).body,root=`/api/rooms/${r.id}`;
  const ids=[];for(let i=0;i<3;i++)ids.push((await call(root+'/places',r.joinToken,{name:'장소 '+i,sender:'동행',latitude:37.5+i*.01,longitude:127})).body.id);
  assert.equal((await call(root+'/places',r.joinToken,{action:'update',placeId:ids[0],name:'변경'})).status,403);
  assert.equal((await call(root+'/places',r.ownerToken,{action:'update',placeId:ids[0],name:'수정한 식당',note:'여기서 만나요'})).status,200);
  assert.equal((await call(root+'/places',r.ownerToken,{action:'update',placeId:ids[0],name:' '})).status,400);
  assert.equal((await call(root+'/places',r.ownerToken,{action:'update',placeId:ids[0],name:'다른 위치',latitude:38})).status,400);
  const edited=(await call(root,r.ownerToken)).body.places.find(p=>p.id===ids[0]);assert.equal(edited.name,'수정한 식당');assert.equal(edited.latitude,37.5);assert.equal(edited.note,'여기서 만나요');
  const planned=(await call(root+'/plan',r.ownerToken,{origin:{latitude:37.49,longitude:127},maxStops:3,assumedMinutes:20})).body;
  const original=(await call(root+'/course',r.ownerToken,{action:'choose',planId:planned.plans[0].id})).body.course;
  const first=original.stops[0].placeId;
  const removed=(await call(root+'/places',r.ownerToken,{action:'delete',placeId:first})).body;
  assert.equal(removed.course.nextIndex,0);assert.equal(removed.course.stops.length,2);assert.equal(removed.course.needsReplan,true);
  const undone=(await call(root+'/places',r.ownerToken,{action:'restore',placeId:first})).body;
  assert.deepEqual(undone.course,original);assert.equal(undone.places.find(p=>p.id===first)._courseBeforeDelete,undefined);
  const removedAgain=(await call(root+'/places',r.ownerToken,{action:'delete',placeId:first})).body;
  const second=removedAgain.course.stops[0].placeId;
  await call(root+'/course',r.ownerToken,{action:'visit',placeId:second});
  const restoredAfterProgress=(await call(root+'/places',r.ownerToken,{action:'restore',placeId:first})).body;
  assert.equal(restoredAfterProgress.course.nextIndex,1);assert.equal(restoredAfterProgress.course.stops[0].status,'visited');assert.equal(restoredAfterProgress.course.stops.length,2);
  const last=restoredAfterProgress.course.stops[1].placeId;
  const completed=(await call(root+'/course',r.ownerToken,{action:'visit',placeId:last})).body.course;
  assert.equal(completed.status,'complete');
  await call(root+'/places',r.ownerToken,{action:'update',placeId:last,name:'새 이름'});
  const deletedHistory=(await call(root+'/places',r.ownerToken,{action:'delete',placeId:last})).body;
  assert.equal(deletedHistory.course.stops.at(-1).name,completed.stops.at(-1).name);assert.equal(deletedHistory.course.status,'complete');
  assert.equal((await call(root+'/course',r.ownerToken,{action:'undo'})).status,409);
  await call(root+'/places',r.ownerToken,{action:'restore',placeId:last});
  assert.equal((await call(root+'/course',r.ownerToken,{action:'undo'})).body.course.nextIndex,1);
  await call(root+'/ballot',r.ownerToken,{action:'open'});
  await call(root+'/ballot',r.joinToken,{action:'cast',placeId:first,voter:'legacy-ballot-voter-001',name:'동행'});
  const interrupted=(await call(root+'/places',r.ownerToken,{action:'delete',placeId:first})).body;
  assert.equal(interrupted.ballot.status,'closed');assert.equal(interrupted.ballot.cancelled,true);assert.equal(interrupted.ballot.counts[first],1);assert.ok(interrupted.ballot.candidateNames[first]);
 }finally{await new Promise(resolve=>server.close(resolve));if(!path.resolve(dataDir).startsWith(path.resolve(tmpdir())+path.sep))throw Error('Unexpected test path');rmSync(dataDir,{recursive:true,force:true});}
});
