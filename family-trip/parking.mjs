import {readFileSync,writeFileSync,renameSync} from 'node:fs';
import {distanceKm,validPoint} from './planner.mjs';
export const parkingSource='https://www.data.go.kr/data/15012896/standard.do';
const text=value=>String(value??'').replace(/<[^>]*>/g,'').trim().slice(0,1200);
const quantity=value=>text(value)===''?null:/^\d+(\.\d+)?$/.test(text(value))?Number(value):null;
/** Basic + extra unit estimate only. Day passes and prose discounts are not maximum fee caps. */
export function estimateParkingFee(parking,minutes){
 if(!Number.isInteger(minutes)||minutes<15||minutes>480)throw Error('주차 비교 시간은 15~480분으로 선택하세요.');
 if(parking.feeType==='무료')return 0;
 if(parking.feeType!=='유료'||!Number.isFinite(parking.basicMinutes)||parking.basicMinutes<0||!Number.isFinite(parking.basicFee)||parking.basicFee<0)return null;
 if(minutes<=parking.basicMinutes)return parking.basicFee;
 if(!Number.isFinite(parking.extraMinutes)||parking.extraMinutes<=0||!Number.isFinite(parking.extraFee)||parking.extraFee<0)return null;
 return parking.basicFee+Math.ceil((minutes-parking.basicMinutes)/parking.extraMinutes)*parking.extraFee;
}
export function normalizeParking(row){
 const point={latitude:Number(row.latitude),longitude:Number(row.longitude)};
 if(!text(row.prkplceNo)||!text(row.prkplceNm)||!text(row.latitude)||!text(row.longitude)||!validPoint(point))return null;
 return {id:text(row.prkplceNo),name:text(row.prkplceNm),...point,address:text(row.rdnmadr||row.lnmadr),kind:text(row.prkplceSe),type:text(row.prkplceType),totalSpaces:quantity(row.prkcmprt),feeType:text(row.parkingchrgeInfo),basicMinutes:quantity(row.basicTime),basicFee:quantity(row.basicCharge),extraMinutes:quantity(row.addUnitTime),extraFee:quantity(row.addUnitCharge),dayTicketFee:quantity(row.dayCmmtkt),operatingDays:text(row.operDay),weekday:[text(row.weekdayOperOpenHhmm),text(row.weekdayOperColseHhmm)].join('–'),saturday:[text(row.satOperOperOpenHhmm),text(row.satOperCloseHhmm)].join('–'),holiday:[text(row.holidayOperOpenHhmm),text(row.holidayCloseOpenHhmm)].join('–'),notes:text(row.spcmnt),phone:text(row.phoneNumber),institution:text(row.institutionNm),provider:text(row.instt_nm||row.institutionNm),referenceDate:text(row.referenceDate),sourceUrl:parkingSource,liveAvailability:null,storeBenefit:null};
}

/** Imports every page before reporting nearby results; partial downloads never imply no parking. */
export function parkingApiProvider(key,{fetcher=fetch,now=Date.now,cacheFile}={}){
 let serviceKey=String(key||'').trim();if(/%[0-9a-f]{2}/i.test(serviceKey)){try{serviceKey=decodeURIComponent(serviceKey);}catch{}}
 let cache=null,job=null,lastError=false,lastAttempt=0;
 if(cacheFile)try{const stored=JSON.parse(readFileSync(cacheFile,'utf8'));if(stored.version===1&&Array.isArray(stored.rows)&&stored.rows.length&&Number.isFinite(stored.at))cache=stored;}catch{}
 async function page(pageNo){
  const query=new URLSearchParams({serviceKey,pageNo:String(pageNo),numOfRows:'1000',type:'json'});
  let data;
  try{const response=await fetcher('https://api.data.go.kr/openapi/tn_pubr_prkplce_info_api?'+query,{signal:AbortSignal.timeout(12000)});if(!response.ok)throw Error();data=await response.json();}catch{throw Error('주차정보 API 인증키·활용 승인·연결 상태를 확인해 주세요.');}
  const envelope=data?.response||data;
  if(!['00','0000'].includes(String(envelope?.header?.resultCode)))throw Error('주차정보 API 인증키·활용 승인·요청 한도를 확인해 주세요.');
  const body=envelope.body,rows=Array.isArray(body?.items)?body.items:body?.items?.item;
  if(!Array.isArray(rows)||!Number.isInteger(Number(body.totalCount))||Number(body.totalCount)<0)throw Error('주차정보 응답 형식을 확인하지 못했어요.');
  return {rows,total:Number(body.totalCount)};
 }
 async function download(){
  const first=await page(1),pages=Math.ceil(first.total/1000);
  if(first.total>200000||!first.total)throw Error('전체 주차정보를 확인하지 못했어요.');
  const rows=[...first.rows];
  for(let start=2;start<=pages;start+=3){
   const batch=await Promise.all(Array.from({length:Math.min(3,pages-start+1)},(_,i)=>page(start+i)));
   for(const result of batch){if(result.total!==first.total)throw Error('주차정보가 갱신 중이에요. 잠시 후 다시 확인해 주세요.');rows.push(...result.rows);}
  }
  if(rows.length!==first.total)throw Error('주차정보를 일부만 받아 다시 조회가 필요해요.');
  const unique=new Map();for(const row of rows){const p=normalizeParking(row);if(p)unique.set(p.id,p);}
  if(!unique.size)throw Error('위치가 확인된 주차정보가 없어요.');
  const next={version:1,at:now(),rows:[...unique.values()]};
  if(cacheFile){writeFileSync(cacheFile+'.tmp',JSON.stringify(next));renameSync(cacheFile+'.tmp',cacheFile);}
  cache=next;lastError=false;
 }
 return (point,{limit=5}={})=>{
  if(!serviceKey)throw Error('주차장 API 인증키를 서버에 입력해 주세요.');
  if(!validPoint(point))throw Error('장소 좌표를 확인해 주세요.');
  const stale=!!cache&&now()-cache.at>=86400000;
  if((!cache||stale)&&!job&&(!lastError||now()-lastAttempt>=60000)){
   lastAttempt=now();job=download().catch(()=>{lastError=true;}).finally(()=>{job=null;});
  }
  if(!cache)return {status:lastError&&!job?'error':'loading',sourceUrl:parkingSource,items:[],message:lastError&&!job?'주차정보 인증키·활용 승인·연결 상태를 확인해 주세요.':'전국 주차정보를 처음 불러오고 있어요. 잠시 후 다시 확인해 주세요.'};
  const items=cache.rows.map(p=>({...p,distanceMeters:Math.round(distanceKm(point,p)*1000)})).filter(p=>p.distanceMeters<=1000).sort((a,b)=>a.distanceMeters-b.distanceMeters||a.id.localeCompare(b.id)).slice(0,Math.min(40,Math.max(1,limit)));
  return {status:'ready',stale,checkedAt:new Date(cache.at).toISOString(),sourceUrl:parkingSource,radiusMeters:1000,items};
 };
}
