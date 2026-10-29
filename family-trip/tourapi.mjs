import {distanceKm,validPoint} from './planner.mjs';

const plain=value=>String(value??'').replace(/<br\s*\/?\s*>/gi,'\n').replace(/<[^>]*>/g,'').replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&').replace(/&lt;/gi,'<').replace(/&gt;/gi,'>').trim().slice(0,2400);
const nameKey=value=>plain(value).normalize('NFKC').replace(/[^\p{L}\p{N}]/gu,'').toLowerCase();
const items=data=>{const value=data?.response?.body?.items?.item;return Array.isArray(value)?value:value&&typeof value==='object'?[value]:[];};
const fields={
 '12':{hours:'usetime',rest:'restdate'},
 '14':{hours:'usetimeculture',rest:'restdateculture',fee:'usefee'},
 '28':{hours:'usetimeleports',rest:'restdateleports',fee:'usefeeleports'},
 '32':{},'38':{hours:'opentime',rest:'restdateshopping'},
 '39':{hours:'opentimefood',rest:'restdatefood'}
};

/** Provider text is display-only: holiday prose is never converted into route constraints. */
export function normalizeVisitInfo(candidate,intro,repeated,now=Date.now){
 const type=String(candidate.contenttypeid),mapping=fields[type]||{},fees=[];
 if(mapping.fee&&plain(intro[mapping.fee]))fees.push(plain(intro[mapping.fee]));
 for(const row of repeated){const title=plain(row.infoname||row.infotitle),text=plain(row.infotext);if(/이용요금|입장료|관람료|이용료|체험비|요금안내/.test(title.replace(/\s/g,''))&&text)fees.push(title+': '+text);}
 return {provider:'tourapi',status:'matched',contentId:String(candidate.contentid),contentTypeId:type,sourceName:plain(candidate.title),sourceAddress:plain(candidate.addr1),sourceUrl:'https://www.data.go.kr/data/15101578/openapi.do',checkedAt:new Date(now()).toISOString(),providerModifiedAt:plain(candidate.modifiedtime),operatingHours:plain(intro[mapping.hours]),restDays:plain(intro[mapping.rest]),fees:[...new Set(fees)].join('\n').slice(0,3000),menu:plain(intro.treatmenu||intro.firstmenu),checkIn:plain(intro.checkintime),checkOut:plain(intro.checkouttime),routeUsable:false};
}

export function tourApiProvider(key,fetcher=fetch,now=Date.now){
 let serviceKey=String(key||'').trim();if(/%[0-9a-f]{2}/i.test(serviceKey)){try{serviceKey=decodeURIComponent(serviceKey);}catch{}}
 const cache=new Map(),pending=new Map();
 const request=async(path,params)=>{
  const query=new URLSearchParams({serviceKey,MobileOS:'ETC',MobileApp:'GMG',_type:'json',numOfRows:'50',pageNo:'1',...params});
  let response;try{response=await fetcher('https://apis.data.go.kr/B551011/KorService2/'+path+'?'+query,{signal:AbortSignal.timeout(6500)});}catch{throw Error('관광정보 서버에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.');}
  if(!response.ok)throw Error('관광정보 API 연결을 확인해 주세요.');
  let data;try{data=await response.json();}catch{throw Error('TourAPI 인증키와 활용 승인을 확인해 주세요.');}
  if(String(data?.response?.header?.resultCode)!=='0000')throw Error('TourAPI 인증키·활용 승인·요청 한도를 확인해 주세요.');
  return items(data);
 };
 const lookup=async place=>{
  if(!serviceKey)throw Error('TourAPI 인증키를 서버에 입력해 주세요.');
  if(!validPoint(place))throw Error('장소 좌표를 확인해 주세요.');
  const queryName=place.info?.sourceName||place.name,names=new Set([nameKey(queryName),nameKey(place.name)].filter(Boolean));
  const nearby=await request('locationBasedList2',{mapX:String(place.longitude),mapY:String(place.latitude),radius:'300',arrange:'E'});
  const matchRows=rows=>rows.filter(c=>/^\d+$/.test(String(c.contentid))&&fields[String(c.contenttypeid)]&&names.has(nameKey(c.title))&&validPoint({latitude:Number(c.mapy),longitude:Number(c.mapx)})&&distanceKm(place,{latitude:Number(c.mapy),longitude:Number(c.mapx)})<=.15);
  let matches=matchRows(nearby);
  if(!matches.length){const found=await request('searchKeyword2',{keyword:queryName});matches=matchRows(found);}
  matches=[...new Map(matches.map(c=>[String(c.contentid),c])).values()];
  if(matches.length!==1)return {provider:'tourapi',status:matches.length?'ambiguous':'not_found',checkedAt:new Date(now()).toISOString(),routeUsable:false};
  const candidate=matches[0],params={contentId:String(candidate.contentid),contentTypeId:String(candidate.contenttypeid)};
  const intro=await request('detailIntro2',params);
  if(intro.length!==1||intro[0].contentid&&String(intro[0].contentid)!==params.contentId)throw Error('관광정보의 장소 식별값을 확인하지 못했어요.');
  // Extra fee descriptions are optional. Missing prices are never interpreted as free.
  let repeated=[];if(['12','14','28'].includes(params.contentTypeId))try{repeated=await request('detailInfo2',params);}catch{}
  return normalizeVisitInfo(candidate,intro[0],repeated,now);
 };
 return async place=>{
  const cacheKey=[place.info?.sourceName||place.name,place.latitude,place.longitude].join('|'),cached=cache.get(cacheKey);
  if(cached&&now()-cached.at<86400000)return cached.result;
  if(pending.has(cacheKey))return pending.get(cacheKey);
  const job=lookup(place).then(result=>{if(cache.size>=500)cache.delete(cache.keys().next().value);cache.set(cacheKey,{at:now(),result});return result;}).finally(()=>pending.delete(cacheKey));pending.set(cacheKey,job);return job;
 };
}
