import {priceParking} from './parking-policy.mjs';
import {validPoint} from './planner.mjs';
export function costPeople(value=1){if(!Number.isInteger(value)||value<1||value>20)throw Error('성인 인원은 1~20명으로 선택해 주세요.');return value;}
export function admissionEstimate(place,info,people=1,override){
 costPeople(people);
 const raw=String(info?.status==='matched'?info.fees||'':'').slice(0,3000);
 const base={adultCount:people,raw,provider:info?.provider==='tourapi'?'한국관광공사 TourAPI':'',sourceUrl:info?.sourceUrl||'',checkedAt:info?.checkedAt||'',unitAmount:null,total:null,status:'unknown'};
 if(override!==undefined){
  if(!Number.isInteger(override)||override<0||override>1000000)throw Error('관람료는 성인 1명 기준 0~1,000,000원으로 입력해 주세요.');
  return {...base,unitAmount:override,total:override*people,status:'manual',provider:'직접 입력',sourceUrl:'',checkedAt:''};
 }
 if(['food','cafe','stay'].includes(place.category))return {...base,status:'not_applicable',total:0};
 // Only an explicit single adult tariff or an entirely free tariff is numeric.
 // Child/group/foreigner ranges and special exhibitions remain a readable tariff, never a guessed total.
 const plain=raw.replace(/<[^>]*>/g,'').trim();
 if(/^(?:관람료|입장료|이용료)?\s*[:：]?\s*무료[.!。]?$/.test(plain))return {...base,unitAmount:0,total:0,status:'verified'};
 const lines=plain.split(/[\n|;]/).map(s=>s.trim()).filter(Boolean);
 const adult=lines.filter(s=>/^(?:[-*•]\s*)?(?:성인|대인|어른)/.test(s));
 const match=adult.length===1&&adult[0].match(/^(?:[-*•]\s*)?(?:성인|대인|어른)(?:\s*\([^)]*\))?\s*[:：]?\s*(무료|(?:\d{1,3}(?:,\d{3})+|\d+)\s*원)[.!。]?$/);
 const simpleOtherLines=lines.every(line=>line===adult[0]||/^(?:어린이|청소년|소인|유아)\s/.test(line)||/^(?:입장료|관람료|이용료)\s*[:：]?$/.test(line));
 if(match&&simpleOtherLines&&!/단체|외국|내국|특별|별도|후원|프로그램|~|부터/.test(plain)){
  const unit=match[1]==='무료'?0:Number(match[1].replace(/[,\s원]/g,''));
  if(Number.isFinite(unit)&&unit<=1000000)return {...base,unitAmount:unit,total:unit*people,status:'verified'};
 }
 return base;
}
export async function chooseParking(place,selection,{lookup,vehicle,now=Date.now}){
 if(selection!==undefined&&(!selection||typeof selection!=='object'||Array.isArray(selection)))throw Error('주차 설정을 다시 선택해 주세요.');
 if(selection?.mode==='none')return {mode:'none',selectionSource:'user'};
 const minutes=selection?.minutes===undefined?60:selection.minutes;
 if(!Number.isInteger(minutes)||minutes<15||minutes>480)throw Error('주차 비교 시간은 15~480분으로 선택해 주세요.');
 if(!lookup){if(selection?.parkingId)throw Object.assign(Error('주차정보 연결을 확인해 주세요.'),{status:503});return {mode:'none',selectionSource:'unavailable'};}
 const found=await lookup(place);
 if(found.status!=='ready'){if(selection?.parkingId)throw Object.assign(Error('주차정보를 준비하고 있어요. 잠시 후 다시 계산해 주세요.'),{status:503});return {mode:'none',selectionSource:'unavailable'};}
 const items=found.items.filter(validPoint);
 const lot=selection?.parkingId?items.find(p=>p.id===selection.parkingId):[...items].sort((a,b)=>a.distanceMeters-b.distanceMeters||a.id.localeCompare(b.id))[0];
 if(!lot){if(selection?.parkingId)throw Object.assign(Error('선택한 주차정보가 바뀌었어요. 주차장을 다시 선택해 주세요.'),{status:409});return {mode:'none',selectionSource:'not_found'};}
 return {...priceParking(lot,minutes,vehicle,now),mode:'selected',minutes,selectionSource:selection?.parkingId&&selection.selectionSource!=='nearest'?'user':'nearest',checkedAt:found.checkedAt,stale:found.stale,accessNote:'등록된 주차장 기준 · 이용 가능 여부·현장 조건 확인 필요'};
}
export function courseCosts(places,people=1){
 const admission=places.map(p=>p.admission||{status:'unknown',total:null});
 const parking=places.map(p=>p.parking||{mode:'none',selectionSource:'unavailable'});
 const parkingKnown=parking.reduce((s,p)=>s+(p.mode==='selected'?(p.estimatedFee??0):0),0);
 const admissionKnown=admission.reduce((s,a)=>s+(a.total??0),0);
 const unknownParking=parking.filter(p=>p.mode==='selected'?p.estimatedFee==null:['unavailable','not_found'].includes(p.selectionSource)).length;
 const unknownAdmission=admission.filter(a=>a.total==null).length;
 return {adultCount:people,parkingKnown,admissionKnown,knownTotal:parkingKnown+admissionKnown,unknownParking,unknownAdmission,complete:unknownParking+unknownAdmission===0,excludes:['fuel','tolls','food','shopping']};
}

/** Change only automatic parking choices; explicit choices and no-parking decisions are locks. */
export async function cheaperParkingPlaces(places,{lookup,vehicle,now=Date.now}){
 const changes=[];let unknownCandidates=0,knownCandidates=0;
 const pool=await Promise.all(places.map(async original=>{
  const p={...original},current=p.parking;
  if(!lookup||current?.mode!=='selected'||current.selectionSource==='user')return p;
  let found;try{found=await lookup(p);}catch{return p;}
  if(found.status!=='ready')return p;
  const priced=found.items.filter(l=>validPoint(l)&&l.distanceMeters<=1000).map(l=>priceParking(l,current.minutes,vehicle,now));
  const known=priced.filter(l=>l.estimatedFee!=null);knownCandidates+=known.length;unknownCandidates+=priced.length-known.length;
  known.sort((a,b)=>a.estimatedFee-b.estimatedFee||a.distanceMeters-b.distanceMeters||a.id.localeCompare(b.id));
  const best=known[0];
  if(!best||best.id===current.id||current.estimatedFee!=null&&best.estimatedFee>=current.estimatedFee)return p;
  p.parking={...best,mode:'selected',minutes:current.minutes,selectionSource:'cost',checkedAt:found.checkedAt,stale:found.stale,accessNote:current.accessNote};
  p.navigationTarget={latitude:best.latitude,longitude:best.longitude,name:`${p.name} · ${best.name}`,address:best.address};
  changes.push({placeId:p.id,fromId:current.id,toId:best.id,fromName:current.name,toName:best.name,before:current.estimatedFee,after:best.estimatedFee,distanceMeters:best.distanceMeters});
  return p;
 }));
 return {pool,changes,unknownCandidates,knownCandidates};
}

/** Read models are derived from saved stops so a restart cannot leave stale budget totals. */
export function courseProgressView(course){
 if(!course)return null;
 const people=course.adultCount||course.costSummary?.adultCount||1;
 const index=course.nextIndex||0;
 return {...course,
  costSummary:{...courseCosts(course.stops,people),scope:'course'},
  remainingCostSummary:{...courseCosts(course.stops.slice(index),people),scope:'remaining'},
  visitedCostSummary:{...courseCosts(course.stops.filter(s=>s.status==='visited'),people),scope:'visited'},
  visitedCount:course.stops.filter(s=>s.status==='visited').length,
  skippedCount:course.stops.filter(s=>s.status==='skipped').length};
}
export function attachCostComparisons(plans){
 const base=plans.find(p=>p.strategy==='time');if(!base)return;
 for(const p of plans){
  const a=base.costSummary,b=p.costSummary;
  const sameStops=base.stops.length===p.stops.length&&base.stops.every(s=>p.stops.some(t=>t.placeId===s.placeId));
  const comparable=!!(a?.complete&&b?.complete&&sameStops&&a.adultCount===b.adultCount&&a.scope===b.scope);
  p.costDelta={baseline:'time',comparable,amount:comparable?a.knownTotal-b.knownTotal:null,
   reason:comparable?'same-stops-and-known-fees':'unknown-fees-or-different-conditions'};
 }
}
