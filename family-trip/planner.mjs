import {randomUUID} from 'node:crypto';
export const validPoint = p => p && typeof p.latitude==='number' && typeof p.longitude==='number' && Number.isFinite(p.latitude) && Number.isFinite(p.longitude) && Math.abs(p.latitude)<=90 && Math.abs(p.longitude)<=180;
const radians=n=>n*Math.PI/180;
export function distanceKm(a,b){const h=Math.sin(radians(b.latitude-a.latitude)/2)**2+Math.cos(radians(a.latitude))*Math.cos(radians(b.latitude))*Math.sin(radians(b.longitude-a.longitude)/2)**2;return 6371*2*Math.atan2(Math.sqrt(Math.min(1,h)),Math.sqrt(Math.max(0,1-h)));}
export function timing(input={}){
  const opensAt=typeof input.opensAt==='string'?input.opensAt:'',closesAt=typeof input.closesAt==='string'?input.closesAt:'';
  if((opensAt||closesAt)&&(!/^([01]\d|2[0-3]):[0-5]\d$/.test(opensAt)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(closesAt)||opensAt===closesAt))throw Error('운영시간은 시작·종료를 HH:mm으로 입력하세요. 24시간 운영은 비워두고 메모해 주세요.');
  const stayMinutes=input.stayMinutes===undefined?60:Number(input.stayMinutes);
  if(!Number.isInteger(stayMinutes)||stayMinutes<5||stayMinutes>480)throw Error('체류 시간은 5~480분으로 입력하세요.');
  return {opensAt,closesAt,stayMinutes,mustVisit:input.mustVisit===true,hoursSource:opensAt?'직접 확인한 운영시간':'운영시간 확인 필요'};
}
function permutations(items){if(items.length<2)return [items];return items.flatMap((p,i)=>permutations(items.filter((_,j)=>j!==i)).map(rest=>[p,...rest]));}
function minutes(s){return Number(s.slice(0,2))*60+Number(s.slice(3));}
// User-confirmed daily opening windows, evaluated in Korea Standard Time, including overnight hours.
function windowAt(point,arrival){
  if(!point.opensAt||!point.closesAt)return null;
  const day=Math.floor((arrival+9*3600000)/86400000)*86400000-9*3600000;
  const start=minutes(point.opensAt)*60000,end=minutes(point.closesAt)*60000;
  const spans=[-1,0,1].map(offset=>({open:day+offset*86400000+start,close:day+offset*86400000+end+(end<=start?86400000:0)}));
  return spans.find(w=>arrival<w.close) || spans[2];
}
function evaluate(order,origin,startAt,assumedMinutes,roadSeconds){
  let cursor=Date.parse(startAt),previous=origin,km=0,waitMinutes=0,violations=0,popularityDelay=0;
  const warnings=[],stops=[];
  for(const [i,p] of order.entries()){
    km+=distanceKm(previous,p);
    const leg=roadSeconds?roadSeconds[i]/60:assumedMinutes;
    const arrived=cursor+leg*60000;
    let begin=arrived,warning='';
    const w=windowAt(p,arrived);
    if(w){
      // Do not roll a missed stop into tomorrow's opening and pretend today's course is feasible.
      const arrivalDay=Math.floor((arrived+9*3600000)/86400000);
      if(Math.floor((w.open+9*3600000)/86400000)>arrivalDay){warning='도착 시 운영 종료 예상';violations++;}
      else {begin=Math.max(arrived,w.open);waitMinutes+=(begin-arrived)/60000;if(begin+p.stayMinutes*60000>w.close){warning='체류 중 운영 종료 예상';violations++;}}
    }else warnings.push(`${p.name}: 운영시간 확인 필요`);
    if(warning)warnings.push(`${p.name}: ${warning}`);
    popularityDelay+=(p.votes||0)*((begin-Date.parse(startAt))/60000);
    cursor=begin+p.stayMinutes*60000;
    stops.push({placeId:p.id,name:p.name,address:p.address,latitude:p.latitude,longitude:p.longitude,opensAt:p.opensAt||'',closesAt:p.closesAt||'',stayMinutes:p.stayMinutes,arrivalAt:new Date(arrived).toISOString(),startVisitAt:new Date(begin).toISOString(),departureAt:new Date(cursor).toISOString(),legMinutes:Math.round(leg),warning,status:'planned'});
    previous=p;
  }
  return {stops,straightKm:Number(km.toFixed(1)),waitMinutes:Math.round(waitMinutes),violations,popularityDelay,warnings:[...new Set(warnings)],finishAt:new Date(cursor).toISOString()};
}
export async function suggestCourses({places,origin,startAt=new Date().toISOString(),maxStops=4,assumedMinutes=20,roadProvider}){
  if(!validPoint(origin))throw Error('현재 위치 또는 직접 확인한 출발 좌표가 필요합니다.');
  if(!Number.isFinite(Date.parse(startAt)))throw Error('출발 일시를 확인해 주세요.');
  if(!Number.isInteger(maxStops)||maxStops<1||maxStops>5)throw Error('방문 장소 수는 1~5곳으로 선택하세요.');
  if(!Number.isInteger(assumedMinutes)||assumedMinutes<1||assumedMinutes>240)throw Error('구간당 임시 이동시간은 1~240분으로 입력하세요.');
  const usable=places.filter(p=>validPoint(p)&&!p.demo).map(p=>({...p,...timing(p),votes:p.voters?.length??p.votes??0}));
  if(!usable.length)throw Error('실제 장소를 먼저 추천해 주세요. 연동 시험 장소는 코스에서 제외됩니다.');
  const required=usable.filter(p=>p.mustVisit);
  if(required.length>maxStops)throw Error('필수 방문지가 방문 개수보다 많아요. 개수를 늘리거나 필수 표시를 줄여주세요.');
  const chosen=[...required,...usable.filter(p=>!p.mustVisit).sort((a,b)=>b.votes-a.votes||a.createdAt-b.createdAt)].slice(0,maxStops);
  let matrix=null;
  if(roadProvider?.matrix){try{matrix=await roadProvider.matrix(origin,chosen);}catch{/* Keep the fallback explicit in each result. */}}
  const options=permutations(chosen).map(order=>{
    const indices=order.map(p=>chosen.indexOf(p)+1);
    const edges=matrix?indices.map((to,i)=>matrix[i?indices[i-1]:0][to]):null;
    return {order,...evaluate(order,origin,startAt,assumedMinutes,edges?.map(e=>e.duration)),roadSeconds:edges?.reduce((s,e)=>s+e.duration,0)};
  });
  const burden=p=>matrix?Date.parse(p.finishAt)-Date.parse(startAt):p.straightKm;
  const select=mode=>[...options].sort((a,b)=>a.violations-b.violations||(mode==='distance'?burden(a)-burden(b)||a.waitMinutes-b.waitMinutes:a.popularityDelay-b.popularityDelay||burden(a)-burden(b)))[0];
  const courses=[];
  for(const strategy of ['distance','preference']){
    const best=select(strategy);let result=best,source='manual-estimate',roadSummary=null;
    const warnings=['구간당 이동시간은 직접 설정한 임시값입니다. 실제 도로 이동시간이 아닙니다.'];
    if(roadProvider){try{
      if(matrix){
        const indices=best.order.map(p=>chosen.indexOf(p)+1),edges=indices.map((to,i)=>matrix[i?indices[i-1]:0][to]);
        roadSummary={legs:edges.map(e=>e.duration),distance:edges.reduce((s,e)=>s+e.distance,0),duration:edges.reduce((s,e)=>s+e.duration,0)};
      }else roadSummary=await roadProvider(origin,best.order,strategy);
      if(roadSummary.legs.length!==best.order.length||roadSummary.legs.some(n=>!Number.isFinite(n)||n<0))throw Error('구간 정보 불일치');
      result=evaluate(best.order,origin,startAt,assumedMinutes,roadSummary.legs);source='kakao-road';warnings.length=0;
      warnings.push('카카오 조회 시점의 도로 예상시간입니다(최대 2분 캐시). 향후 각 출발 시각의 교통을 예측한 값은 아닙니다. 재출발 시 다시 계산하세요.');
    }catch{warnings.push('자동차 길찾기 연결을 확인하지 못해 임시 이동시간으로 표시합니다.');}}
    if(!matrix&&source==='kakao-road')warnings.push('방문 순서는 직선 동선으로 비교했고, 선택 순서의 도로시간만 확인했습니다.');
    courses.push({id:randomUUID(),strategy,title:strategy==='distance'?(matrix?'이동·대기시간 적게':'이동 부담 적게'):'인기 장소 먼저',reason:strategy==='distance'?(matrix?'필수 장소와 상위 득표 장소를 포함하고 도로 이동·대기시간이 적은 순서를 우선했어요.':'필수 장소와 상위 득표 장소를 포함하고 직선 동선이 짧은 방문 순서를 우선했어요.'):'같은 방문 후보 중 득표가 많은 장소를 먼저 즐기는 순서를 우선했어요.',engine:'constraint-search',sequenceSource:matrix?'kakao-road-matrix':'straight-line',origin,startAt,createdAt:new Date().toISOString(),timingSource:source,assumedMinutes,roadDistanceKm:roadSummary?Number((roadSummary.distance/1000).toFixed(1)):null,roadMinutes:roadSummary?Math.round(roadSummary.duration/60):null,...Object.fromEntries(Object.entries(result).filter(([k])=>!['order','popularityDelay','roadSeconds'].includes(k))),warnings:[...warnings,...result.warnings]});
  }
  if(courses[0].stops.map(p=>p.placeId).join()===courses[1].stops.map(p=>p.placeId).join())courses[1].reason+=' 이번 후보에서는 이동 절약 코스와 같은 순서가 나왔어요.';
  return courses;
}
export function kakaoRoadProvider(key,fetcher=fetch){
 const cache=new Map();
 const lookup=async(origin,stops,strategy)=>{
  const last=stops.at(-1),query=new URLSearchParams({origin:`${origin.longitude},${origin.latitude}`,destination:`${last.longitude},${last.latitude}`,priority:strategy==='distance'?'DISTANCE':'TIME',alternatives:'false',summary:'false'});
  if(stops.length>1)query.set('waypoints',stops.slice(0,-1).map(p=>`${p.longitude},${p.latitude}`).join('|'));
  const cacheKey=query.toString(),cached=cache.get(cacheKey);if(cached&&Date.now()-cached.at<120000)return cached.result;
  const response=await fetcher('https://apis-navi.kakaomobility.com/v1/directions?'+query,{headers:{Authorization:`KakaoAK ${key}`},signal:AbortSignal.timeout(2500)});
  if(!response.ok)throw Error('자동차 경로 연결 실패');const data=await response.json(),route=data.routes?.[0];
  if(route?.result_code!==0||!route.sections?.length)throw Error('자동차 경로 계산 실패');
  const result={legs:route.sections.map(s=>s.duration),distance:route.summary.distance,duration:route.summary.duration};
  if(result.legs.length!==stops.length||result.legs.some(n=>!Number.isFinite(n)||n<0)||!Number.isFinite(result.duration)||!Number.isFinite(result.distance))throw Error('도로시간 응답 불일치');
  if(cache.size>=500)cache.delete(cache.keys().next().value);cache.set(cacheKey,{at:Date.now(),result});return result;
 };
 lookup.matrix=async(origin,stops)=>{
   const points=[origin,...stops],matrix=points.map(()=>[]),jobs=[];
   for(let from=0;from<points.length;from++)for(let to=1;to<points.length;to++)if(from!==to)jobs.push({from,to});
   let next=0,failed=false;
   await Promise.all(Array.from({length:Math.min(4,jobs.length)},async()=>{
     while(!failed&&next<jobs.length){const {from,to}=jobs[next++];try{const route=await lookup(points[from],[points[to]],'time');matrix[from][to]={duration:route.duration,distance:route.distance};}catch{failed=true;}}
   }));
   if(failed)throw Error('도로 구간 비교 실패');return matrix;
 };
 return lookup;
}
