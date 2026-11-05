import test from 'node:test';
import assert from 'node:assert/strict';
import {parkingDiscovery} from '../parking-discovery.mjs';
import {priceParking,vehicleProfile} from '../parking-policy.mjs';
import {facilityParkingInfo} from '../parking-facility.mjs';
const now=()=>Date.parse('2026-11-06T01:00:00+09:00');
const lot=(id,name,x=126.9789,y=37.5774)=>({id,place_name:name,x:String(x),y:String(y),category_group_code:'PK6',road_address_name:'서울 종로구 사직로 161'});
test('Deoksugung and Changdeokgung explicitly explain no visitor parking and still offer nearby alternatives',async()=>{
 for(const place of [{name:'덕수궁',latitude:37.565564,longitude:126.974895},{name:'창덕궁',latitude:37.579647,longitude:126.991}]){
  const lookup=parkingDiscovery({now,kakaoKey:'private',fetcher:async()=>Response.json({documents:[lot('88',place.name+' 주차장',place.longitude+.001,place.latitude),lot('89','주변 공영주차장',place.longitude,place.latitude+.001)]})});
  const r=await lookup(place);assert.equal(r.facilityParking.status,'none');assert.ok(r.facilityParking.sourceUrl.includes('schGroupCode='));
  assert.equal(r.items.length,2);assert.ok(r.items.every(p=>p.relation==='nearby'));assert.ok(r.items.every(p=>p.basicFee===null));
 }
});
test('unknown facility parking is not inferred absent; official notices are geofenced, category scoped and expire',()=>{
 const place={name:'덕수궁',latitude:37.565564,longitude:126.974895};
 assert.equal(facilityParkingInfo({...place,name:'새로운 관광지'},[],now).status,'unknown');
 assert.equal(facilityParkingInfo({...place,category:'cafe'},[],now).status,'unknown');
 assert.equal(facilityParkingInfo({...place,latitude:35},[],now).status,'unknown');
 assert.equal(facilityParkingInfo(place,[],()=>now()+31*86400000).status,'unknown');
 assert.equal(facilityParkingInfo({...place,name:'우리미술관'},[{relation:'facility_candidate'}],now).status,'candidate');
});
test('venue parking search finds onsite parking beyond national data, groups candidates and avoids station false matches',async()=>{
 let calls=0;
 const lookup=parkingDiscovery({now,kakaoKey:'private',national:()=>({status:'ready',items:[]}),fetcher:async(url)=>{
  calls++;assert.equal(new URL(url).searchParams.get('category_group_code'),'PK6');
  return Response.json({documents:[lot('17577343','경복궁 주차장'),lot('17938383','경복궁 지하주차장1'),lot('22','경복궁역 주차장'),lot('23','경복궁 주차장',127.5,37.5)]});
 }});
 const p={name:'경복궁',category:'attraction',latitude:37.5796,longitude:126.977};
 const r=await lookup(p);assert.equal(r.items.length,2);assert.equal(r.items[0].relation,'facility');assert.equal(r.items[1].relation,'nearby');
 assert.equal(r.items[0].basicFee,3000);assert.equal(r.items[1].basicFee,null);
 assert.ok(!JSON.stringify(r).includes('private'));await lookup(p);assert.equal(calls,2);
 const generic=parkingDiscovery({now,kakaoKey:'private',fetcher:async()=>Response.json({documents:[lot('55','우리미술관 주차장')]})});
 const g=await generic({...p,name:'우리미술관'});assert.equal(g.items[0].relation,'facility_candidate');assert.equal(g.items[0].basicFee,null);
});
test('partial POI failures remain visible, retry, and do not claim missing prices are free',async()=>{
 let calls=0;const lookup=parkingDiscovery({now,kakaoKey:'private',fetcher:async url=>{calls++;if(url.includes('keyword'))throw Error('private');return Response.json({documents:[lot('12','주변 주차장')]});}});
 const p={name:'장소',latitude:37.5796,longitude:126.977};const r=await lookup(p);
 assert.equal(r.searchIncomplete,true);assert.equal(priceParking(r.items[0],60,{type:'low1'},now).estimatedFee,null);
 await lookup(p);assert.equal(calls,4);
});
test('verified official tariffs apply vehicle classes only within known rules and review lifetime',()=>{
 const palace={id:'kakao:17577343',basicFee:null,feeType:''};
 assert.equal(priceParking(palace,60,{},now).estimatedFee,3000);
 for(const type of ['compact','low1','low2','low3']){const p=priceParking(palace,60,{type},now);assert.equal(p.estimatedFee,1500);assert.equal(p.discountPercent,50);assert.ok(p.discountSourceUrl.startsWith('https://royal.khs.go.kr/'));}
 assert.equal(priceParking(palace,70,{type:'low1'},now).estimatedFee,1900);
 const city={id:'seoul',kind:'공영',institution:'서울시설공단',address:'서울 종로구',feeType:'유료',basicMinutes:60,basicFee:4000};
 assert.equal(priceParking(city,60,{type:'low2'},now).estimatedFee,2000);
 assert.equal(priceParking(city,60,{type:'low2',diesel:true},now).discountStatus,'not_eligible');
 assert.equal(priceParking(city,60,{type:'low2',diesel:true},now).estimatedFee,4000);
 assert.equal(priceParking({...city,institution:'다른 기관'},60,{type:'compact'},now).estimatedFee,4000);
 assert.equal(priceParking(palace,60,{type:'low1'},()=>now()+31*86400000).estimatedFee,null);
 assert.throws(()=>vehicleProfile({type:'fake'}));assert.throws(()=>vehicleProfile({type:'low2',diesel:'yes'}));
});
