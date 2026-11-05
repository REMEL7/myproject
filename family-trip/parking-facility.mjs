import {distanceKm,validPoint} from './planner.mjs';
const key=value=>String(value||'').normalize('NFKC').replace(/[^\p{L}\p{N}]/gu,'').toLowerCase();
const reviewedAt='2026-11-06T00:00:00+09:00';
// Official visitor-parking notices, matched to both venue identity and location.
// A similarly named private lot is not the venue's own visitor parking.
const notices=[
 {name:'덕수궁',latitude:37.565564,longitude:126.974895,sourceUrl:'https://royal.khs.go.kr/ROYAL/contents/R707000000.do?schGroupCode=dsg'},
 {name:'창덕궁',latitude:37.579647,longitude:126.991,sourceUrl:'https://royal.khs.go.kr/ROYAL/contents/R707000000.do?schGroupCode=cdg'}
];
export function facilityParkingInfo(place,items,now=Date.now){
 const names=new Set([key(place.name),key(place.info?.sourceName)]);
 const notice=validPoint(place)&&!['food','cafe','stay'].includes(place.category)&&notices.find(n=>names.has(key(n.name))&&distanceKm(n,place)<=.25);
 if(notice&&now()>=Date.parse(reviewedAt)&&now()-Date.parse(reviewedAt)<30*86400000)return {status:'none',message:'관람객용 자체 주차장이 없어요. 주변 주차장을 선택해 주세요.',provider:'국가유산청 궁능유적본부',sourceUrl:notice.sourceUrl,reviewedAt};
 if(items.some(p=>p.relation==='facility'))return {status:'confirmed',message:'공식 안내로 확인한 시설 주차장이 있어요.'};
 if(items.some(p=>p.relation==='facility_candidate'))return {status:'candidate',message:'시설명으로 찾은 후보예요. 전용·제휴 여부는 확인이 필요해요.'};
 return {status:'unknown',message:'자체 주차장은 아직 확인되지 않았어요. 주변 주차장을 선택할 수 있어요.'};
}
