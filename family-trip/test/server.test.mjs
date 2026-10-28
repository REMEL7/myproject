import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createRelay} from '../server.mjs';

test('room isolation, voting, validation, selection and restart persistence', async () => {
  const dataDir=mkdtempSync(path.join(tmpdir(),'moagil-test-'));
  let server=createRelay({dataDir,kakaoKey:'',mapKey:'',mobilityKey:''});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  let base=`http://127.0.0.1:${server.address().port}`;
  const call=async(route,token,data)=>{const r=await fetch(base+route,{method:data?'POST':'GET',headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(data?{'Content-Type':'application/json'}:{})},...(data?{body:JSON.stringify(data)}:{})});return {status:r.status,body:await r.json()};};
  try {
    server.setPublicUrl('http://192.168.1.10:8787');
    assert.equal((await call('/api/config')).body.localOnly,false);
    server.setPublicUrl('');
    assert.equal((await call('/api/config')).body.localOnly,true);
    const room=(await call('/api/rooms',null,{name:'가족 여행'})).body;
    const second=(await call('/api/rooms',null,{name:'다른 가족'})).body;
    const route=`/api/rooms/${room.id}`;
    assert.equal((await call(route)).status,403);
    assert.equal((await call(route,second.joinToken)).status,403);
    assert.equal((await call(route,room.joinToken)).body.ownerToken,undefined);
    assert.equal((await call(route+'/settings',room.joinToken,{name:'바꾼 여행'})).status,403);
    assert.equal((await call(route+'/settings',room.ownerToken,{name:'  '})).status,400);
    assert.equal((await call(route+'/settings',room.ownerToken,{name:'주말 바다 여행'})).body.name,'주말 바다 여행');
    assert.equal((await call(route+'/search?q=강릉',room.joinToken)).body.code,'SEARCH_NOT_CONFIGURED');
    const place={name:'시험 장소',sender:'지우',latitude:37.48544722,longitude:127.03636666,category:'cafe',note:'바다가 보이는 곳'};
    assert.equal((await call(route+'/places',room.joinToken,{...place,latitude:999})).status,400);
    assert.equal((await call(route+'/places',room.joinToken,{...place,latitude:''})).status,400);
    const created=await call(route+'/places',room.joinToken,place);
    assert.equal(created.status,201);
    assert.equal((await call(route+'/places',room.joinToken,place)).body.duplicate,true);
    const vote={placeId:created.body.id,voter:'participant-test-123',liked:true};
    await Promise.all(Array.from({length:5},()=>call(route+'/vote',room.joinToken,vote)));
    assert.equal((await call(route,room.joinToken)).body.places[0].votes,1);
    assert.equal((await call(route,room.joinToken)).body.places[0].voters,undefined);
    assert.equal((await call(route,room.joinToken)).body.places[0].category,'cafe');
    assert.equal((await call(route,room.joinToken)).body.places[0].note,'바다가 보이는 곳');
    assert.equal((await call(route+'/select',room.joinToken,{placeId:created.body.id})).status,403);
    assert.equal((await call(route+'/select',room.ownerToken,{placeId:created.body.id})).body.selectedId,created.body.id);
    await call(route+'/vote',room.joinToken,{...vote,liked:false});
    assert.equal((await call(route,room.joinToken)).body.places[0].votes,0);
    await new Promise(resolve=>server.close(resolve));
    server=createRelay({dataDir,kakaoKey:'',mapKey:'',mobilityKey:''});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));base=`http://127.0.0.1:${server.address().port}`;
    assert.equal((await call(route,room.ownerToken)).body.selectedId,created.body.id);
    assert.equal((await call(route,room.ownerToken)).body.name,'주말 바다 여행');
    const cross=await fetch(base+route,{headers:{Authorization:`Bearer ${room.joinToken}`,Origin:'https://unrelated.example'}});
    assert.equal(cross.status,403);
  } finally {await new Promise(resolve=>server.close(resolve));rmSync(dataDir,{recursive:true,force:true});}
});

test('Kakao adapter keeps REST key server-side and returns coordinates and categories', async () => {
  const dataDir=mkdtempSync(path.join(tmpdir(),'moagil-map-test-'));
  let requests=0;
  const server=createRelay({dataDir,kakaoKey:'test-rest-secret',mapKey:'public-domain-restricted-key',fetchPlaces:async(url,options)=>{
    requests++;
    assert.equal(new URL(url).searchParams.get('query'),'강릉 카페');
    assert.equal(options.headers.Authorization,'KakaoAK test-rest-secret');
    return {ok:true,json:async()=>({documents:[{id:'123',place_name:'카페',road_address_name:'강릉시 도로',x:'128.9',y:'37.7',category_name:'음식점 > 카페',category_group_code:'CE7',phone:'033-000-0000'}]})};
  }});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  try {
    const config=await(await fetch(base+'/api/config')).json();
    assert.equal(config.searchEnabled,true);assert.equal(config.mapEnabled,true);
    assert.equal(config.mapJavascriptKey,'public-domain-restricted-key');
    assert.equal(JSON.stringify(config).includes('test-rest-secret'),false);
    const room=await(await fetch(base+'/api/rooms',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'지도 시험'})})).json();
    const search=()=>fetch(base+`/api/rooms/${room.id}/search?q=${encodeURIComponent('강릉 카페')}`,{headers:{Authorization:`Bearer ${room.joinToken}`}});
    const result=await(await search()).json();
    assert.equal(result.places[0].latitude,37.7);assert.equal(result.places[0].longitude,128.9);
    assert.equal(result.places[0].categoryCode,'CE7');
    assert.equal(JSON.stringify(result).includes('test-rest-secret'),false);
    assert.equal((await search()).status,429);assert.equal(requests,1);
  } finally {await new Promise(resolve=>server.close(resolve));rmSync(dataDir,{recursive:true,force:true});}
});


import {suggestCourses,timing,kakaoRoadProvider} from '../planner.mjs';

test('course constraints, daily hours, mandatory stops and road-time source', async()=>{
  const origin={latitude:37.5,longitude:127};
  const places=[{id:'a',name:'먼 인기 장소',latitude:37.6,longitude:127,address:'주소 A',voters:['a','b'],createdAt:1,...timing({opensAt:'09:00',closesAt:'18:00',stayMinutes:30,mustVisit:true})},{id:'b',name:'가까운 장소',latitude:37.51,longitude:127,address:'주소 B',voters:['c'],createdAt:2,...timing({opensAt:'09:00',closesAt:'18:00',stayMinutes:30})},{id:'demo',name:'시험 제외',latitude:37.5,longitude:127,demo:true,voters:[],...timing()}];
  const plans=await suggestCourses({places,origin,startAt:'2026-10-24T09:00:00+09:00',maxStops:2,assumedMinutes:20});
  assert.equal(plans.length,2);assert.equal(plans[0].timingSource,'manual-estimate');
  assert.deepEqual(plans[0].stops.map(p=>p.placeId),['b','a']);
  assert.deepEqual(plans[1].stops.map(p=>p.placeId),['a','b']);
  assert.equal(plans.some(p=>p.stops.some(s=>s.placeId==='demo')),false);
  assert.equal(plans[0].stops[0].arrivalAt,'2026-10-24T00:20:00.000Z');
  const road=await suggestCourses({places,origin,startAt:'2026-10-24T09:00:00+09:00',maxStops:2,assumedMinutes:20,roadProvider:async()=>({legs:[300,600],distance:15000,duration:900})});
  assert.equal(road[0].timingSource,'kakao-road');assert.equal(road[0].stops[0].arrivalAt,'2026-10-24T00:05:00.000Z');
  const closing=await suggestCourses({places,origin,startAt:'2026-10-24T18:30:00+09:00',maxStops:2,assumedMinutes:20});
  assert.equal(closing[0].violations,2);
  assert.throws(()=>timing({opensAt:'25:00',closesAt:'18:00'}));
  await assert.rejects(()=>suggestCourses({places:[...places,{...places[1],id:'c',mustVisit:true}],origin,maxStops:1}));
});

test('named public votes, sealed ballot including owner, ties, course progress and restart',async()=>{
  const dataDir=mkdtempSync(path.join(tmpdir(),'moagil-group-'));
  let server=createRelay({dataDir,kakaoKey:'',mapKey:'',mobilityKey:''});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let base=`http://127.0.0.1:${server.address().port}`;
  const call=async(route,token,data)=>{const r=await fetch(base+route,{method:data?'POST':'GET',headers:{...(token?{Authorization:`Bearer ${token}`}:{ }),...(data?{'Content-Type':'application/json'}:{})},...(data?{body:JSON.stringify(data)}:{})});return {status:r.status,body:await r.json()};};
  try{
    const r=(await call('/api/rooms',null,{name:'친구들과 주말',groupType:'friends'})).body,root=`/api/rooms/${r.id}`;
    const a=(await call(root+'/places',r.joinToken,{name:'A',sender:'민수',latitude:37.51,longitude:127,opensAt:'09:00',closesAt:'20:00',stayMinutes:30})).body.id;
    const b=(await call(root+'/places',r.joinToken,{name:'B',sender:'지우',latitude:37.52,longitude:127})).body.id;
    await call(root+'/vote',r.joinToken,{placeId:a,voter:'test-member-0001',name:'민수',liked:true});
    assert.deepEqual((await call(root,r.joinToken)).body.places[0].supporters,['민수']);
    assert.equal((await call(root+'/ballot',r.joinToken,{action:'open'})).status,403);
    assert.equal((await call(root+'/ballot',r.ownerToken,{action:'open'})).status,200);
    await call(root+'/ballot',r.joinToken,{action:'cast',placeId:a,voter:'test-member-0001',name:'민수'});
    await call(root+'/ballot',r.joinToken,{action:'cast',placeId:b,voter:'test-member-0002',name:'지우'});
    const sealed=(await call(root,r.ownerToken)).body;
    assert.equal(sealed.ballot.castCount,2);assert.equal(sealed.ballot.counts,undefined);assert.equal(sealed.ballot.votes,undefined);
    assert.equal(sealed.places[0].votes,null);assert.deepEqual(sealed.places[0].supporters,[]);
    assert.equal((await call(root+'/vote',r.joinToken,{placeId:a,voter:'test-member-0003',liked:true})).status,409);
    assert.equal((await call(root+'/ballot',r.joinToken,{action:'close'})).status,403);
    const closed=(await call(root+'/ballot',r.ownerToken,{action:'close'})).body;
    assert.equal(closed.ballot.winnerIds.length,2);assert.equal(closed.ballot.counts[a],1);
    await call(root+'/ballot',r.ownerToken,{action:'clear'});
    assert.equal((await call(root+'/plan',r.joinToken,{origin:{latitude:37.5,longitude:127}})).status,403);
    const suggested=(await call(root+'/plan',r.ownerToken,{origin:{latitude:37.5,longitude:127},startAt:'2026-10-24T09:00:00+09:00',maxStops:2,assumedMinutes:20})).body;
    assert.equal(suggested.plans.length,2);
    assert.equal((await call(root+'/course',r.joinToken,{action:'choose',planId:suggested.plans[0].id})).status,403);
    const chosen=(await call(root+'/course',r.ownerToken,{action:'choose',planId:suggested.plans[0].id})).body.course;
    assert.equal((await call(root+'/course',r.ownerToken,{action:'visit',placeId:chosen.stops[1].placeId})).status,409);
    await call(root+'/course',r.ownerToken,{action:'visit',placeId:chosen.stops[0].placeId});
    await new Promise(resolve=>server.close(resolve));server=createRelay({dataDir,kakaoKey:'',mapKey:'',mobilityKey:''});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));base=`http://127.0.0.1:${server.address().port}`;
    const restored=(await call(root,r.ownerToken)).body;
    assert.equal(restored.course.nextIndex,1);assert.equal(restored.course.stops[0].status,'visited');assert.equal(restored.groupType,'friends');
    const remaining=(await call(root+'/plan',r.ownerToken,{remainingOnly:true,origin:{latitude:37.505,longitude:127},startAt:'2026-10-24T10:00:00+09:00',assumedMinutes:15})).body;
    assert.equal(remaining.plans[0].stops.length,1);assert.equal(remaining.plans[0].prefixStops.length,1);
    const reselected=(await call(root+'/course',r.ownerToken,{action:'choose',planId:remaining.plans[0].id})).body.course;
    assert.equal(reselected.nextIndex,1);assert.equal(reselected.stops[0].status,'visited');
    const undo=(await call(root+'/course',r.ownerToken,{action:'undo'})).body.course;assert.equal(undo.nextIndex,0);assert.equal(undo.stops[0].status,'planned');
  }finally{await new Promise(resolve=>server.close(resolve));rmSync(dataDir,{recursive:true,force:true});}
});

test('road adapter sends ordered coordinates and keeps its key out of the result',async()=>{
  const road=kakaoRoadProvider('test-mobility-key',async(url,options)=>{
    const q=new URL(url).searchParams;
    assert.equal(q.get('origin'),'127,37.5');assert.equal(q.get('destination'),'127.2,37.7');
    assert.equal(q.get('waypoints'),'127.1,37.6');assert.equal(q.get('priority'),'DISTANCE');
    assert.equal(options.headers.Authorization,'KakaoAK test-mobility-key');
    return {ok:true,json:async()=>({routes:[{result_code:0,summary:{distance:12000,duration:900},sections:[{duration:300},{duration:600}]}]})};
  });
  const result=await road({latitude:37.5,longitude:127},[{latitude:37.6,longitude:127.1},{latitude:37.7,longitude:127.2}],'distance');
  assert.deepEqual(result,{legs:[300,600],distance:12000,duration:900});
});

test('road matrix changes the visit order, caches segments and falls back visibly',async()=>{
  const origin={latitude:37,longitude:127};
  const places=[{id:'near',name:'직선으로 가까운 곳',latitude:37.01,longitude:127,voters:[],...timing({stayMinutes:5})},{id:'far',name:'도로로 빠른 곳',latitude:37.02,longitude:127,voters:[],...timing({stayMinutes:5})}];
  let calls=0;
  const road=kakaoRoadProvider('test-key',async(url)=>{
    calls++;const q=new URL(url).searchParams;const from=Number(q.get('origin').split(',')[1]),to=Number(q.get('destination').split(',')[1]);
    const duration=from===37.02||to===37.02&&from===37?60:900;
    return {ok:true,json:async()=>({routes:[{result_code:0,summary:{distance:duration*10,duration},sections:[{duration}]}]})};
  });
  const input={places,origin,startAt:'2026-10-24T09:00:00+09:00',maxStops:2};
  const fallback=await suggestCourses(input);assert.equal(fallback[0].stops[0].placeId,'near');
  const plans=await suggestCourses({...input,roadProvider:road});
  assert.deepEqual(plans[0].stops.map(s=>s.placeId),['far','near']);
  assert.equal(plans[0].sequenceSource,'kakao-road-matrix');assert.equal(plans[0].roadMinutes,2);assert.equal(calls,4);
  await suggestCourses({...input,roadProvider:road});assert.equal(calls,4);
  const failed=await suggestCourses({...input,roadProvider:kakaoRoadProvider('bad-key',async()=>({ok:false}))});
  assert.equal(failed[0].timingSource,'manual-estimate');assert.equal(failed[0].sequenceSource,'straight-line');
  assert.ok(failed[0].warnings.some(w=>w.includes('연결을 확인하지 못해')));
});

test('vehicle-only recoverable deletion protects ballot/course and survives restart',async()=>{
  const dataDir=mkdtempSync(path.join(tmpdir(),'moagil-delete-'));
  let server=createRelay({dataDir,kakaoKey:'',mapKey:'',mobilityKey:''});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let base=`http://127.0.0.1:${server.address().port}`;
  const call=async(route,token,data)=>{const response=await fetch(base+route,{method:data?'POST':'GET',headers:{Authorization:`Bearer ${token||''}`,...(data?{'Content-Type':'application/json'}:{})},...(data?{body:JSON.stringify(data)}:{})});return {status:response.status,body:await response.json()};};
  try{
    const r=(await call('/api/rooms',null,{name:'삭제 검사'})).body,root=`/api/rooms/${r.id}`;
    const a=(await call(root+'/places',r.joinToken,{name:'A',sender:'검사',latitude:37.51,longitude:127})).body.id;
    const b=(await call(root+'/places',r.joinToken,{name:'B',sender:'검사',latitude:37.52,longitude:127})).body.id;
    await call(root+'/vote',r.joinToken,{placeId:a,voter:'delete-test-voter-0001',liked:true,name:'민수'});
    await call(root+'/select',r.ownerToken,{placeId:a});
    assert.equal((await call(root+'/places',r.joinToken,{action:'delete',placeId:a})).status,403);
    const deleted=await call(root+'/places',r.ownerToken,{action:'delete',placeId:a});
    assert.equal(deleted.body.places.length,1);assert.equal(deleted.body.selectedId,null);assert.equal(deleted.body.canUndoPlaceDelete,true);
    assert.equal(deleted.body.deletedPlaces,undefined);assert.equal(deleted.body.plans.length,0);
    assert.equal((await call(root+'/places',r.joinToken,{action:'restore'})).status,403);
    await new Promise(resolve=>server.close(resolve));server=createRelay({dataDir,kakaoKey:'',mapKey:'',mobilityKey:''});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));base=`http://127.0.0.1:${server.address().port}`;
    const restored=(await call(root+'/places',r.ownerToken,{action:'restore'})).body;
    assert.equal(restored.places.find(p=>p.id===a).votes,1);assert.deepEqual(restored.places.find(p=>p.id===a).supporters,['민수']);assert.equal(restored.selectedId,null);
    // A quick undo must restore its own item even if a newer deletion exists.
    await call(root+'/places',r.ownerToken,{action:'delete',placeId:a});
    await call(root+'/places',r.ownerToken,{action:'delete',placeId:b});
    assert.equal((await call(root+'/places',r.joinToken,{action:'restore',placeId:a})).status,403);
    const targeted=(await call(root+'/places',r.ownerToken,{action:'restore',placeId:a})).body;
    assert.deepEqual(targeted.places.map(p=>p.id),[a]);assert.equal(targeted.places[0].votes,1);
    assert.equal((await call(root+'/places',r.ownerToken,{action:'restore',placeId:a})).status,409);
    assert.equal((await call(root+'/places',r.ownerToken,{action:'restore',placeId:'missing'})).status,409);
    const latest=(await call(root+'/places',r.ownerToken,{action:'restore'})).body;
    assert.equal(latest.places.length,2);assert.ok(latest.places.some(p=>p.id===b));
    await call(root+'/ballot',r.ownerToken,{action:'open'});
    assert.equal((await call(root+'/places',r.ownerToken,{action:'delete',placeId:a})).status,409);
    await call(root+'/ballot',r.joinToken,{action:'cast',placeId:a,voter:'delete-test-voter-0001',name:'민수'});
    await call(root+'/ballot',r.ownerToken,{action:'close'});
    const archived=await call(root+'/places',r.ownerToken,{action:'delete',placeId:a});
    assert.equal(archived.status,200);assert.equal(archived.body.places.some(p=>p.id===a),false);
    assert.equal(archived.body.ballot.candidateNames[a],'A');assert.equal(archived.body.ballot.counts[a],1);
    assert.deepEqual(archived.body.ballot.winnerIds,[a]);
    await new Promise(resolve=>server.close(resolve));server=createRelay({dataDir,kakaoKey:'',mapKey:'',mobilityKey:''});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));base=`http://127.0.0.1:${server.address().port}`;
    const kept=(await call(root,r.joinToken)).body;
    assert.equal(kept.ballot.candidateNames[a],'A');assert.equal(kept.ballot.counts[a],1);
    assert.equal((await call(root+'/places',r.ownerToken,{action:'restore'})).status,200);
    await call(root+'/ballot',r.ownerToken,{action:'clear'});
    const planned=(await call(root+'/plan',r.ownerToken,{origin:{latitude:37.5,longitude:127},maxStops:2,assumedMinutes:20})).body;
    await call(root+'/course',r.ownerToken,{action:'choose',planId:planned.plans[0].id});
    assert.equal((await call(root+'/places',r.ownerToken,{action:'delete',placeId:b})).status,409);
    assert.equal((await call(root,r.joinToken)).body.places.length,2);
  }finally{await new Promise(resolve=>server.close(resolve));rmSync(dataDir,{recursive:true,force:true});}
});

test('decision mode is owner controlled, atomic and persists across restart',async()=>{
 const dataDir=mkdtempSync(path.join(tmpdir(),'moagil-flow-'));let server=createRelay({dataDir,kakaoKey:'',mapKey:'',mobilityKey:''});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let base=`http://127.0.0.1:${server.address().port}`;
 const call=async(route,token,data)=>{const r=await fetch(base+route,{method:data?'POST':'GET',headers:{...(token?{Authorization:`Bearer ${token}`}:{ }),...(data?{'Content-Type':'application/json'}:{ })},...(data?{body:JSON.stringify(data)}:{ })});return {status:r.status,body:await r.json()};};
 try{
  const room=(await call('/api/rooms',null,{name:'모임'})).body,root=`/api/rooms/${room.id}`;
  assert.equal((await call(root,room.joinToken)).body.decisionMode,'');
  assert.equal((await call(root+'/settings',room.joinToken,{decisionMode:'trip'})).status,403);
  assert.equal((await call(root+'/settings',room.ownerToken,{name:'변경되면 안됨',decisionMode:'bad'})).status,400);
  assert.equal((await call(root,room.ownerToken)).body.name,'모임');
  assert.equal((await call(root+'/settings',room.ownerToken,{decisionMode:'trip'})).body.decisionMode,'trip');
  await new Promise(resolve=>server.close(resolve));server=createRelay({dataDir,kakaoKey:'',mapKey:'',mobilityKey:''});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));base=`http://127.0.0.1:${server.address().port}`;
  assert.equal((await call(root,room.joinToken)).body.decisionMode,'trip');
  assert.equal((await call(root+'/settings',room.ownerToken,{decisionMode:'single'})).body.decisionMode,'single');
 }finally{await new Promise(resolve=>server.close(resolve));rmSync(dataDir,{recursive:true,force:true});}
});
