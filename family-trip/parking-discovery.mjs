import {distanceKm,validPoint} from './planner.mjs';
import {officialParkingInfo} from './parking-policy.mjs';
import {facilityParkingInfo} from './parking-facility.mjs';
const clean=s=>String(s??'').replace(/<[^>]*>/g,'').trim().slice(0,300);
const nameKey=s=>clean(s).normalize('NFKC').replace(/[^\p{L}\p{N}]/gu,'').toLowerCase();
const lotKey=s=>nameKey(s).replace(/공영|민영|부설|주차장/g,'');
function facilityCandidate(place,lot){
 const venue=nameKey(place.info?.sourceName||place.name),candidate=nameKey(lot.name);
 if(venue.length<2||!candidate.startsWith(venue))return false;
 return /^(부설|지하|지상|전용|고객|동편|서편|남편|북편)?주차장\d*$/.test(candidate.slice(venue.length));
}
export function parkingDiscovery({national,kakaoKey='',fetcher=fetch,now=Date.now}){
 const cache=new Map(),pending=new Map();
 async function search(place){
  const basis=place.info?.sourceName||place.name;
  const common={x:String(place.longitude),y:String(place.latitude),radius:'1500',size:'15',sort:'distance',category_group_code:'PK6'};
  const requests=[['keyword.json',{...common,query:basis+' 주차장'}],['category.json',{...common,radius:'1000'}]];
  const responses=await Promise.allSettled(requests.map(async([method,params])=>{
   const r=await fetcher('https://dapi.kakao.com/v2/local/search/'+method+'?'+new URLSearchParams(params),{headers:{Authorization:'KakaoAK '+kakaoKey},signal:AbortSignal.timeout(3500)});
   if(!r.ok)throw Error('search unavailable');const data=await r.json();if(!Array.isArray(data.documents))throw Error('invalid parking search');return data.documents;
  }));
  return {partial:responses.some(r=>r.status==='rejected'),rows:responses.flatMap(r=>r.status==='fulfilled'?r.value:[])};
 }
 return async place=>{
  const nationalResult=national?national(place,{limit:40}):{status:'ready',items:[],checkedAt:new Date(now()).toISOString()};
  let maps={rows:[],partial:false};
  if(kakaoKey){
   const key=[place.info?.sourceName||place.name,place.latitude,place.longitude].join('|'),stored=cache.get(key);
   if(stored&&now()-stored.at<30*60000)maps=stored.data;
   else{
    if(!pending.has(key))pending.set(key,search(place).then(data=>{if(!data.partial){if(cache.size>=300)cache.delete(cache.keys().next().value);cache.set(key,{at:now(),data});}return data;}).finally(()=>pending.delete(key)));
    maps=await pending.get(key);
   }
  }
  const items=(nationalResult.items||[]).map(p=>({...p,relation:facilityCandidate(place,p)?'facility_candidate':'nearby',discoverySource:'national'}));
  const seen=new Set();
  for(const row of maps.rows){
   if(row.category_group_code!=='PK6'||!/^\d+$/.test(String(row.id))||seen.has(String(row.id)))continue;
   seen.add(String(row.id));const point={latitude:Number(row.y),longitude:Number(row.x)};
   if(!validPoint(point))continue;const meters=Math.round(distanceKm(place,point)*1000);if(meters>1500)continue;
   let lot=officialParkingInfo({id:'kakao:'+row.id,name:clean(row.place_name),...point,address:clean(row.road_address_name||row.address_name),phone:clean(row.phone),distanceMeters:meters,provider:'카카오 로컬 API',sourceUrl:'https://place.map.kakao.com/'+row.id,checkedAt:new Date(now()).toISOString(),feeType:'',basicMinutes:null,basicFee:null,extraMinutes:null,extraFee:null,referenceDate:'',notes:'',liveAvailability:null,storeBenefit:null,discoverySource:'kakao'},now);
   lot.relation=lot.officialVenue&&nameKey(lot.officialVenue)===nameKey(place.info?.sourceName||place.name)&&place.category!=='food'?'facility':facilityCandidate(place,lot)?'facility_candidate':'nearby';
   if(lot.relation==='nearby'&&meters>1000)continue;
   const match=items.find(p=>lotKey(p.name).length>=2&&lotKey(p.name)===lotKey(lot.name)&&distanceKm(p,lot)<.1);
   if(match){
    match.placeUrl=lot.sourceUrl;
    if(lot.relation!=='nearby')match.relation=lot.relation;
    if(lot.facilityKey){Object.assign(match,officialParkingInfo({...match,id:lot.id},now));}
    continue;
   }
   if(lot.facilityKey&&items.some(p=>p.facilityKey===lot.facilityKey))continue;
   items.push(lot);
  }
  const facilityParking=facilityParkingInfo(place,items,now);
  if(facilityParking.status==='none')for(const p of items){p.relation='nearby';}
  items.sort((a,b)=>(a.relation==='nearby'?1:0)-(b.relation==='nearby'?1:0)||a.distanceMeters-b.distanceMeters);
  const facilityText=place.visitInfo?.status==='matched'?clean(place.visitInfo.parking):'';
  const status=items.length||nationalResult.status==='ready'?'ready':nationalResult.status;
  return {...nationalResult,status,items:items.slice(0,12),facilityParking,searchIncomplete:maps.partial||nationalResult.status!=='ready',facilityInfo:facilityText?{text:facilityText,fees:clean(place.visitInfo.parkingFee),provider:'한국관광공사 TourAPI',sourceUrl:'https://www.data.go.kr/data/15101578/openapi.do'}:null,checkedAt:nationalResult.checkedAt||new Date(now()).toISOString(),message:status==='ready'?'':nationalResult.message};
 };
}
