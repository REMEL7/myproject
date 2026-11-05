import {estimateParkingFee} from './parking.mjs';
export const vehicleTypes=['standard','compact','low1','low2','low3'];
export function vehicleProfile(value={}){
 if(!value||typeof value!=='object'||Array.isArray(value)||!vehicleTypes.includes(value.type??'standard')||value.diesel!==undefined&&typeof value.diesel!=='boolean')throw Error('차량 조건을 다시 선택해 주세요.');
 return {type:value.type??'standard',diesel:value.diesel===true};
}
const palaceSource='https://royal.khs.go.kr/ROYAL/contents/R707000000.do';
const seoulSource='https://www.sisul.or.kr/open_content/parking/guidance/fee_dust2.jsp';
const reviewedAt='2026-11-06T00:00:00+09:00';
const current=now=>now()-Date.parse(reviewedAt)<30*86400000&&now()>=Date.parse(reviewedAt);
export function officialParkingInfo(parking,now=Date.now){
 // Verified source records supplement APIs that contain POIs but no tariffs. Not a general venue-name heuristic.
 if(['kakao:17577343','kakao:17938383'].includes(parking.id)){
  const base={...parking,facilityKey:'gyeongbokgung',officialVenue:'경복궁',provider:'국가유산청 궁능유적본부',sourceUrl:palaceSource,referenceDate:'2026-11-06',policyReviewedAt:reviewedAt,notes:'승용차의 지하주차 요금 기준입니다. 지상 주차 시 별도 요금이며 감면 증빙이 필요합니다. 충전 감면은 계산하지 않습니다.',operatingDays:'매일',weekday:'06:00–23:00',saturday:'06:00–23:00',holiday:'06:00–23:00',phone:'02-736-9536'};
  return current(now)?{...base,feeType:'유료',basicMinutes:60,basicFee:3000,extraMinutes:10,extraFee:800,discountRule:{rate:.5,types:['compact','low1','low2','low3'],sourceUrl:palaceSource,reviewedAt,conditions:'등록된 감면 대상 차량·증빙 기준, 중복 감면 및 충전 감면 제외'}}:{...base,feeType:'',basicMinutes:null,basicFee:null,extraMinutes:null,extraFee:null,discountRule:undefined,policyStale:true};
 }
 if(current(now)&&parking.kind==='공영'&&parking.institution==='서울시설공단'&&/^서울/.test(parking.address||''))return {...parking,discountRule:{rate:.5,types:['compact','low1','low2','low3'],excludeDiesel:true,sourceUrl:seoulSource,reviewedAt,conditions:'서울시설공단 공영주차장 감면 기준. 저공해 경유차 제외, 감면 자격·증빙 필요. 환승·충전 감면은 계산하지 않습니다.'}};
 return parking;
}
export function priceParking(parking,minutes,profile={},now=Date.now){
 const vehicle=vehicleProfile(profile),p=officialParkingInfo(parking,now),base=estimateParkingFee(p,minutes),rule=current(now)?p.discountRule:undefined;
 let status='not_requested',discount=0;
 if(vehicle.type!=='standard'){
  status='unconfirmed';
  if(rule?.types.includes(vehicle.type)){
   if(rule.excludeDiesel&&vehicle.type.startsWith('low')&&vehicle.diesel)status='not_eligible';
   else {status='estimated';discount=rule.rate;}
  }
 }
 return {...p,estimateMinutes:minutes,vehicle,baseEstimatedFee:base,estimatedFee:base==null?null:Math.round(base*(1-discount)),discountStatus:status,discountPercent:discount*100,discountSourceUrl:rule?.sourceUrl||'',discountConditions:rule?.conditions||'',estimateNote:discount?'공식 감면 기준의 예상요금 · 자격·증빙 확인 필요':'기본·추가요금 기준 · 확인되지 않은 할인·일주차권 미적용'};
}
