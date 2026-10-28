// Explicit UI fixture: creates its own development room, never changes an existing trip.
import {writeFileSync} from 'node:fs';
const base='http://127.0.0.1:8787';
async function call(route,token,data){const response=await fetch(base+route,{method:data?'POST':'GET',headers:{...(token?{Authorization:`Bearer ${token}`}:{ }),...(data?{'Content-Type':'application/json'}:{})},...(data?{body:JSON.stringify(data)}:{})});const result=await response.json();if(!response.ok)throw Error(result.error);return result;}
const room=await call('/api/rooms',null,{name:'[개발검증] 친구들과 나들이',groupType:'friends'}),root=`/api/rooms/${room.id}`;
const found=await call(root+'/search?q='+encodeURIComponent('판교 카페'),room.joinToken);
const ids=[];
for(const [i,p]of found.places.slice(0,3).entries())ids.push((await call(root+'/places',room.joinToken,{...p,category:'cafe',sender:['민수','지우','수연'][i],note:'기능 검증용 모임에 추가한 실제 검색 장소 · 운영시간은 확인 필요',stayMinutes:30})).id);
if(ids.length<3)throw Error('Preview fixture needs three actual results');
for(const [i,name]of ['민수','지우','수연','태호'].entries())await call(root+'/vote',room.joinToken,{placeId:ids[0],voter:`ui-test-member-${i}`,name,liked:true});
const origin={latitude:found.places[0].latitude,longitude:found.places[0].longitude};
const planned=await call(root+'/plan',room.ownerToken,{origin,maxStops:3,assumedMinutes:20,startAt:new Date().toISOString()});
const saved=await call(root+'/course',room.ownerToken,{action:'choose',planId:planned.plans[0].id});
await call(root+'/course',room.ownerToken,{action:'visit',placeId:saved.course.stops[0].placeId});
writeFileSync(new URL('../data/ui-preview.json',import.meta.url),JSON.stringify({id:room.id,ownerToken:room.ownerToken,joinToken:room.joinToken,placeIds:ids}));
console.log('Separate development preview created: three places, four named votes, saved course with one completed stop.');
