import http from 'node:http';
import {randomBytes, randomUUID} from 'node:crypto';
import {readFileSync, writeFileSync, mkdirSync, renameSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {loadEnvFile} from 'node:process';
import {timing, suggestCourses, kakaoRoadProvider} from './planner.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
try { loadEnvFile(path.join(here, '.env')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
const token = () => randomBytes(24).toString('base64url');
const fail = (status, message) => { throw Object.assign(new Error(message), {status}); };
const text = (value, max = 120) => typeof value === 'string' ? value.trim().slice(0, max) : '';

export function createRelay({dataDir = path.join(here, 'data'), publicUrl = process.env.PUBLIC_URL || '', kakaoKey = process.env.KAKAO_REST_API_KEY || '', mapKey = process.env.KAKAO_JAVASCRIPT_KEY || '', mobilityKey = process.env.KAKAO_MOBILITY_REST_API_KEY || kakaoKey, fetchPlaces = fetch, roadProvider = null, now = Date.now, roomLifetimeMs = 30*24*60*60*1000} = {}) {
  mkdirSync(dataDir, {recursive:true});
  const dbFile = path.join(dataDir, 'rooms.json');
  let rooms = {};
  try { rooms = JSON.parse(readFileSync(dbFile, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  const save = () => { writeFileSync(dbFile + '.tmp', JSON.stringify(rooms)); renameSync(dbFile + '.tmp', dbFile); };
  for(const r of Object.values(rooms)){r.members ||= {};r.plans ||= [];r.course ||= null;r.ballot ||= null;r.groupType ||= 'together';}
  let migrated=false;for(const r of Object.values(rooms)){if(!r.expiresAt){r.expiresAt=now()+roomLifetimeMs;migrated=true;}}if(migrated)save();
  const roadLookup=roadProvider || (mobilityKey?kakaoRoadProvider(mobilityKey):null);
  const planning=new Set();
  const placeInfoCache=new Map();
  const rememberPlace=doc=>{
    if(!/^\d+$/.test(String(doc.id)))return null;
    const info={provider:'kakao',sourceId:String(doc.id),sourceName:text(doc.place_name),categoryName:text(doc.category_name,200),phone:/^[0-9+()\-\s]{3,40}$/.test(doc.phone||'')?doc.phone:'',placeUrl:`https://place.map.kakao.com/${doc.id}`,checkedAt:new Date(now()).toISOString(),hoursAvailable:false};
    if(placeInfoCache.size>=500)placeInfoCache.delete(placeInfoCache.keys().next().value);
    placeInfoCache.set(info.sourceId,{info,latitude:Number(doc.y),longitude:Number(doc.x),at:now()});return info;
  };
  const cachedInfo=(id,latitude,longitude)=>{const entry=placeInfoCache.get(String(id));return entry&&now()-entry.at<30*60*1000&&Math.abs(entry.latitude-latitude)<.0001&&Math.abs(entry.longitude-longitude)<.0001?entry.info:null;};
  const ballotView=(b,r)=>!b?null:{id:b.id,status:b.status,candidateIds:b.candidateIds,castCount:Object.keys(b.votes).length,closedAt:b.closedAt||null,cancelled:!!b.cancelled,...(b.status==='closed'?{counts:b.counts,winnerIds:b.winnerIds,candidateNames:Object.fromEntries(b.candidateIds.map(id=>[id,[...r.places,...(r.deletedPlaces||[])].find(p=>p.id===id)?.name||'삭제된 장소']))}:{})};
  const snapshot=r=>{
    const secret=!!r.ballot;
    return {id:r.id,expiresAt:r.expiresAt,closedAt:r.closedAt||null,name:r.name,groupType:r.groupType||'together',decisionMode:r.decisionMode||'',selectedId:r.selectedId,revision:r.revision,canUndoPlaceDelete:!!r.deletedPlaces?.length,ballot:ballotView(r.ballot,r),plans:r.plans||[],course:r.course||null,places:r.places.map(p=>({id:p.id,name:p.name,address:p.address,sender:p.sender,note:p.note,category:p.category||'other',info:p.info||null,latitude:p.latitude,longitude:p.longitude,createdAt:p.createdAt,demo:!!p.demo,opensAt:p.opensAt||'',closesAt:p.closesAt||'',stayMinutes:p.stayMinutes||60,mustVisit:!!p.mustVisit,hoursSource:p.opensAt?'직접 확인':'확인 필요',votes:secret?null:p.voters.length,supporters:secret?[]:p.voters.map(id=>r.members?.[id]).filter(Boolean),unnamedVotes:secret?null:p.voters.filter(id=>!r.members?.[id]).length}))};
  };
  const owner=(r,auth)=>{if(auth!==r.ownerToken)fail(403,'이 작업은 차량의 모임 진행자만 할 수 있습니다.');};
  const changed=r=>{r.revision++;save();return snapshot(r);};
  const reply = (res, status, body, type = 'application/json; charset=utf-8') => {
    res.writeHead(status, {'Content-Type':type, 'Cache-Control':'no-store', 'Referrer-Policy':'no-referrer', 'X-Content-Type-Options':'nosniff'});
    res.end(type.startsWith('application/json') ? JSON.stringify(body) : body);
  };
  const body = async req => {
    if (!req.headers['content-type']?.startsWith('application/json')) fail(415, 'JSON 요청이 필요합니다.');
    let raw = ''; for await (const chunk of req) { raw += chunk; if (raw.length > 16000) fail(413, '요청이 너무 큽니다.'); }
    try { return JSON.parse(raw); } catch { fail(400, '올바른 JSON이 아닙니다.'); }
  };
  const searchTimes = new Map();
  const requestLimits=new Map();
  let limitWindow=now();
  const server = http.createServer(async (req, res) => {
    try {
      if(now()-limitWindow>=60000){requestLimits.clear();limitWindow=now();}
      const client=req.socket.remoteAddress||'unknown';const limitKey=client+':'+(req.method==='GET'?'read':'write');
      if(!requestLimits.has(limitKey)&&requestLimits.size>=2048)fail(429,'요청이 많습니다. 잠시 후 다시 시도해 주세요.');
      const count=(requestLimits.get(limitKey)||0)+1;requestLimits.set(limitKey,count);
      if(count>(req.method==='GET'?600:120))fail(429,'요청이 많습니다. 잠시 후 다시 시도해 주세요.');
      if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}` && req.headers.origin !== `https://${req.headers.host}`) fail(403, '외부 사이트 요청은 허용하지 않습니다.');
      const url = new URL(req.url, 'http://localhost');
      if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/app.js' || url.pathname === '/style.css' || url.pathname === '/moagil-mark.svg' || url.pathname === '/privacy')) {
        const file = url.pathname === '/' ? 'index.html' : url.pathname === '/privacy' ? 'privacy.html' : url.pathname.slice(1);
        const type = file.endsWith('.svg') ? 'image/svg+xml; charset=utf-8' : file.endsWith('.js') ? 'text/javascript; charset=utf-8' : file.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/html; charset=utf-8';
        return reply(res, 200, readFileSync(path.join(here, 'public', file), 'utf8'), type);
      }
      if (req.method === 'GET' && url.pathname === '/api/config') return reply(res, 200, {publicUrl:publicUrl || 'http://localhost:8787', searchEnabled:!!kakaoKey, mapEnabled:!!mapKey, roadRoutingEnabled:!!roadLookup, recommendationEngine:'constraint-search', mapJavascriptKey:mapKey, localOnly:!publicUrl});
      if (req.method === 'POST' && url.pathname === '/api/rooms') {
        if (!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress)) fail(403, '여행방은 차량 또는 PC 내부에서만 만들 수 있습니다.');
        const input = await body(req);
        if (Object.keys(rooms).length >= 200) fail(429, '개발 서버의 여행방 한도에 도달했습니다.');
        const r = {id:randomBytes(6).toString('hex'), name:text(input.name,40) || '우리의 모임', ownerToken:token(), joinToken:token(), places:[], selectedId:null, revision:0, expiresAt:now()+roomLifetimeMs, members:{}, plans:[], course:null, ballot:null, groupType:(['together','friends','family','colleagues'].includes(input.groupType)?input.groupType:'together')};
        rooms[r.id] = r; save();
        return reply(res, 201, {...snapshot(r), ownerToken:r.ownerToken, joinToken:r.joinToken});
      }
      const match = url.pathname.match(/^\/api\/rooms\/([a-f0-9]{12})(?:\/(places|vote|select|search|settings|timing|plan|course|ballot|session))?$/);
      if (!match) fail(404, '찾을 수 없는 주소입니다.');
      const r = rooms[match[1]];
      const auth = req.headers.authorization?.replace(/^Bearer /, '');
      if (!r || !auth || (auth !== r.ownerToken && auth !== r.joinToken)) fail(403, '참여 링크가 올바르지 않습니다.');
      if(auth===r.joinToken&&(r.closedAt||now()>=r.expiresAt))fail(403,'모임이 종료됐거나 초대 링크가 만료됐습니다. 차량에서 새 초대를 받아주세요.');
      if (req.method === 'GET' && !match[2]) return reply(res, 200, snapshot(r));
      if (req.method === 'GET' && match[2] === 'search') {
        if (!kakaoKey) return reply(res, 503, {error:'카카오 검색 키를 연결하면 실제 맛집 검색을 사용할 수 있습니다. 지금은 장소 직접 추가로 시험하세요.', code:'SEARCH_NOT_CONFIGURED'});
        const q = text(url.searchParams.get('q'), 100); if (q.length < 2) fail(400, '검색어를 두 글자 이상 입력하세요.');
        if (Date.now() - (searchTimes.get(r.id) || 0) < 1000) fail(429, '잠시 후 검색해 주세요.');
        searchTimes.set(r.id, Date.now());
        const upstream = await fetchPlaces('https://dapi.kakao.com/v2/local/search/keyword.json?' + new URLSearchParams({query:q,size:'10'}), {headers:{Authorization:`KakaoAK ${kakaoKey}`},signal:AbortSignal.timeout(8000)});
        if (!upstream.ok) fail(502, `지도 검색 연결 오류 (${upstream.status})`);
        const result = await upstream.json();
        return reply(res, 200, {places:result.documents.map(p => ({sourceId:p.id, name:p.place_name, address:p.road_address_name || p.address_name, latitude:Number(p.y), longitude:Number(p.x), category:p.category_name, categoryCode:p.category_group_code, phone:p.phone,info:rememberPlace(p)}))});
      }
      if (req.method !== 'POST') fail(405, '지원하지 않는 요청입니다.');
      const input = await body(req);
      if(match[2]==='session'){
        owner(r,auth);
        if(input.action==='rotateInvite'){r.joinToken=token();r.closedAt=null;r.expiresAt=now()+roomLifetimeMs;changed(r);return reply(res,200,{...snapshot(r),joinToken:r.joinToken});}
        if(input.action==='close'){r.closedAt=now();return reply(res,200,changed(r));}
        if(input.action==='delete'){delete rooms[r.id];save();return reply(res,200,{deleted:true});}
        fail(400,'모임 관리 작업을 확인해 주세요.');
      }
      if (match[2] === 'settings') {
        if (auth !== r.ownerToken) fail(403, '여행 이름은 차량에서만 바꿀 수 있습니다.');
        const name=input.name===undefined?r.name:text(input.name,40);
        if(!name)fail(400,'모임 이름을 입력하세요.');
        if(input.groupType!==undefined&&!['together','friends','family','colleagues'].includes(input.groupType))fail(400,'모임 유형을 확인하세요.');
        if(input.decisionMode!==undefined&&!['single','trip'].includes(input.decisionMode))fail(400,'장소 선택 방식을 확인하세요.');
        r.name=name;if(input.groupType!==undefined)r.groupType=input.groupType;
        if(input.decisionMode!==undefined)r.decisionMode=input.decisionMode;
        return reply(res,200,changed(r));
      }
      if(match[2]==='timing'){
        owner(r,auth);const p=r.places.find(p=>p.id===input.placeId);if(!p)fail(404,'장소가 없습니다.');
        try{Object.assign(p,timing(input));}catch(e){fail(400,e.message);}r.plans=[];return reply(res,200,changed(r));
      }
      if(match[2]==='ballot'){
        if(input.action==='open'){
          owner(r,auth);if(r.ballot)fail(409,'현재 투표 결과를 정리한 뒤 새 투표를 여세요.');
          const ids=input.candidateIds || r.places.filter(p=>!p.demo).map(p=>p.id);
          if(!Array.isArray(ids)||ids.length<2||ids.length>50||new Set(ids).size!==ids.length||ids.some(id=>!r.places.some(p=>p.id===id)))fail(400,'서로 다른 후보를 2곳 이상 골라주세요.');
          r.ballot={id:randomUUID(),status:'open',candidateIds:ids,votes:{},openedAt:Date.now()};
        }else if(input.action==='cast'){
          if(r.ballot?.status!=='open')fail(409,'진행 중인 비밀 투표가 없습니다.');
          const voter=text(input.voter,80),name=text(input.name,30);if(voter.length<12||!name)fail(400,'참여자 이름과 기기 식별자가 필요합니다.');
          if(!r.ballot.candidateIds.includes(input.placeId))fail(400,'이번 투표의 후보가 아닙니다.');
          if(!r.ballot.votes[voter]&&Object.keys(r.ballot.votes).length>=100)fail(400,'투표 인원 한도입니다.');
          r.ballot.votes[voter]=input.placeId;
        }else if(input.action==='close'){
          owner(r,auth);if(r.ballot?.status!=='open')fail(409,'진행 중인 비밀 투표가 없습니다.');
          const counts=Object.fromEntries(r.ballot.candidateIds.map(id=>[id,0]));for(const id of Object.values(r.ballot.votes))counts[id]++;
          const highest=Math.max(...Object.values(counts));if(!highest)fail(400,'한 표 이상 모인 뒤 종료하세요.');
          r.ballot.status='closed';r.ballot.counts=counts;r.ballot.winnerIds=r.ballot.candidateIds.filter(id=>counts[id]===highest);r.ballot.closedAt=Date.now();
        }else if(input.action==='clear'){
          owner(r,auth);if(r.ballot?.status==='open')fail(409,'투표를 종료한 뒤 결과를 정리하세요.');r.ballot=null;
        }else fail(400,'투표 동작을 확인하세요.');
        return reply(res,200,changed(r));
      }
      if(match[2]==='plan'){
        owner(r,auth);
        if(planning.has(r.id))fail(409,'코스 계산 중입니다. 잠시 기다려주세요.');
        planning.add(r.id);const version=r.revision;
        try{
          const prefix=input.remainingOnly?r.course?.stops.slice(0,r.course.nextIndex):[];
          const remaining=input.remainingOnly?r.course?.stops.slice(r.course.nextIndex):null;
          if(input.remainingOnly&&!remaining?.length)fail(400,'다시 계산할 남은 방문지가 없습니다.');
          const pool=remaining?r.places.filter(p=>remaining.some(s=>s.placeId===p.id)):r.places;
          const plans=await suggestCourses({places:pool,origin:input.origin,startAt:input.startAt,maxStops:remaining?remaining.length:input.maxStops,assumedMinutes:input.assumedMinutes,roadProvider:roadLookup});
          if(input.remainingOnly)for(const p of plans)p.prefixStops=structuredClone(prefix);
          if(r.revision!==version)fail(409,'계산 중 장소나 투표가 바뀌었어요. 다시 추천해 주세요.');
          r.plans=plans;return reply(res,200,changed(r));
        }catch(e){fail(e.status||400,e.message);}finally{planning.delete(r.id);}
      }
      if(match[2]==='course'){
        owner(r,auth);
        if(input.action==='choose'){
          const p=r.plans.find(p=>p.id===input.planId);if(!p)fail(404,'추천 코스를 다시 불러와 주세요.');
          if(p.violations>0)fail(400,'운영시간과 충돌하는 코스입니다. 방문 조건이나 출발 시간을 바꿔 다시 계산하세요.');
          const prefix=p.prefixStops||[];
          r.course={...structuredClone(p),stops:[...structuredClone(prefix),...structuredClone(p.stops)],status:'active',selectedAt:Date.now(),nextIndex:prefix.length};
        }else if(['visit','skip'].includes(input.action)){
          const c=r.course;if(!c||c.status!=='active')fail(409,'진행 중인 코스가 없습니다.');
          const next=c.stops[c.nextIndex];if(next?.placeId!==input.placeId)fail(409,'현재 방문 순서를 다시 확인하세요.');
          next.status=input.action==='visit'?'visited':'skipped';next.completedAt=Date.now();c.nextIndex++;if(c.nextIndex>=c.stops.length){c.status='complete';c.needsReplan=false;}
          r.plans=[];
        }else if(input.action==='undo'){
          const c=r.course;if(!c||!c.nextIndex)fail(409,'되돌릴 방문 기록이 없습니다.');
          if(!r.places.some(p=>p.id===c.stops[c.nextIndex-1].placeId))fail(409,'삭제된 장소의 방문 기록입니다. 장소를 먼저 복원해 주세요.');
          c.nextIndex--;c.stops[c.nextIndex].status='planned';delete c.stops[c.nextIndex].completedAt;c.status='active';
          r.plans=[];
        }else fail(400,'코스 동작을 확인하세요.');
        return reply(res,200,changed(r));
      }
      if (match[2] === 'places') {
        if(input.action==='details'){
          owner(r,auth);const p=r.places.find(p=>p.id===input.placeId);if(!p)fail(404,'장소가 없습니다.');
          if(p.info&&now()-Date.parse(p.info.checkedAt)<86400000)return reply(res,200,snapshot(r));
          if(!kakaoKey)fail(503,'장소 정보 연결을 준비 중이에요.');
          if(Date.now()-(searchTimes.get(r.id)||0)<1000)fail(429,'잠시 후 다시 확인해 주세요.');searchTimes.set(r.id,Date.now());
          const query=new URLSearchParams({query:p.info?.sourceName||p.name,x:String(p.longitude),y:String(p.latitude),radius:'150',size:'15'});
          const response=await fetchPlaces('https://dapi.kakao.com/v2/local/search/keyword.json?'+query,{headers:{Authorization:`KakaoAK ${kakaoKey}`},signal:AbortSignal.timeout(8000)});
          if(!response.ok)fail(502,'가게 정보를 불러오지 못했어요.');
          const data=await response.json();
          const matches=(data.documents||[]).filter(d=>Number.isFinite(Number(d.x))&&Number.isFinite(Number(d.y))&&Math.abs(Number(d.y)-p.latitude)<.001&&Math.abs(Number(d.x)-p.longitude)<.001&&(p.info?.sourceId?String(d.id)===p.info.sourceId:d.place_name===p.name));
          if(matches.length!==1)fail(409,'같은 장소인지 확인하지 못했어요. 휴대폰 지도에서 장소를 다시 선택해 주세요.');
          const info=rememberPlace(matches[0]);if(!info)fail(502,'장소 식별 정보를 확인하지 못했어요.');
          if(!r.places.includes(p))fail(409,'이미 삭제된 장소예요.');p.info=info;return reply(res,200,changed(r));
        }
        if(input.action==='update'){
          owner(r,auth);
          const p=r.places.find(p=>p.id===input.placeId);if(!p)fail(404,'삭제됐거나 없는 장소입니다.');
          if(['latitude','longitude','address'].some(k=>input[k]!==undefined&&input[k]!==p[k]))fail(400,'위치를 바꾸려면 지도에서 장소를 다시 추가해 주세요.');
          const name=input.name===undefined?p.name:text(input.name),note=input.note===undefined?p.note:text(input.note,160);
          const category=input.category===undefined?p.category:input.category;
          if(!name)fail(400,'장소 이름을 입력하세요.');
          if(!['food','cafe','trip','stay','other'].includes(category||'other'))fail(400,'장소 분류를 확인하세요.');
          if(r.places.some(q=>q.id!==p.id&&q.name===name&&Math.abs(q.latitude-p.latitude)<0.0001&&Math.abs(q.longitude-p.longitude)<0.0001))fail(409,'같은 위치에 같은 이름의 장소가 이미 있어요.');
          p.name=name;p.note=note;p.category=category||'other';
          if(r.course?.status==='active')for(const stop of r.course.stops.slice(r.course.nextIndex))if(stop.placeId===p.id)stop.name=name;
          r.plans=[];return reply(res,200,changed(r));
        }
        if(input.action==='delete'){
          owner(r,auth);
          const index=r.places.findIndex(p=>p.id===input.placeId);if(index<0)fail(404,'이미 삭제됐거나 없는 장소입니다.');
          const removed=r.places[index];
          const c=r.course;
          if(c?.status==='active'&&c.stops.slice(c.nextIndex).some(s=>s.placeId===input.placeId)){
            removed._courseBeforeDelete=structuredClone(c);
            c.stops=c.stops.filter((s,i)=>i<c.nextIndex||s.placeId!==input.placeId);
            c.needsReplan=c.nextIndex<c.stops.length;
            if(!c.needsReplan)c.status=c.nextIndex?'complete':'cancelled';
            c.changedAt=now();
            removed._courseAfterDelete=JSON.stringify(c);
          }
          r.deletedPlaces ||= [];r.deletedPlaces.push(r.places.splice(index,1)[0]);
          if(r.ballot?.status==='open'&&r.ballot.candidateIds.includes(input.placeId)){
            const b=r.ballot;const counts=Object.fromEntries(b.candidateIds.map(id=>[id,0]));
            for(const id of Object.values(b.votes))if(Object.hasOwn(counts,id))counts[id]++;
            const highest=Math.max(...Object.values(counts));
            b.status='closed';b.cancelled=true;b.counts=counts;b.winnerIds=highest?b.candidateIds.filter(id=>counts[id]===highest):[];b.closedAt=now();
          }
          if(r.selectedId===input.placeId)r.selectedId=null;
          r.plans=[];return reply(res,200,changed(r));
        }
        if(input.action==='restore'){
          owner(r,auth);const index=input.placeId===undefined?(r.deletedPlaces?.length||0)-1:(r.deletedPlaces||[]).findIndex(p=>p.id===input.placeId);const p=r.deletedPlaces?.[index];if(!p)fail(409,'이미 복원됐거나 복원할 장소가 없습니다.');
          if(r.places.length>=50)fail(409,'장소가 50곳입니다. 다른 장소를 정리한 뒤 복원하세요.');
          if(r.places.some(s=>s.id===p.id||(s.name===p.name&&Math.abs(s.latitude-p.latitude)<0.0001&&Math.abs(s.longitude-p.longitude)<0.0001)))fail(409,'동일한 장소가 이미 있습니다.');
          const {_courseBeforeDelete,_courseAfterDelete,...restored}=r.deletedPlaces.splice(index,1)[0];
          r.places.push(restored);
          if(_courseBeforeDelete&&JSON.stringify(r.course)===_courseAfterDelete)r.course=_courseBeforeDelete;
          r.plans=[];return reply(res,200,changed(r));
        }
        const latitude = input.latitude, longitude = input.longitude;
        if (typeof latitude !== 'number' || typeof longitude !== 'number' || !Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude)>90 || Math.abs(longitude)>180) fail(400, '유효한 위도와 경도를 입력하세요.');
        if (!text(input.name) || !text(input.sender,30)) fail(400, '장소명과 보낸 사람을 입력하세요.');
        const existing = r.places.find(p => p.name === text(input.name) && Math.abs(p.latitude-latitude)<0.0001 && Math.abs(p.longitude-longitude)<0.0001);
        if (existing) {const info=cachedInfo(input.sourceId,latitude,longitude);if(info&&!existing.info){existing.info=info;changed(r);}return reply(res, 200, {id:existing.id, duplicate:true});}
        if (r.places.length >= 50) fail(400, '여행방당 장소는 50개까지 추가할 수 있습니다.');
        const category = ['food','cafe','trip','stay','other'].includes(input.category) ? input.category : 'other';
        const p = {id:randomUUID(),name:text(input.name),address:text(input.address,200),sender:text(input.sender,30),note:text(input.note,160),category,latitude,longitude,voters:[],createdAt:Date.now(),demo:input.demo === true};
        p.info=cachedInfo(input.sourceId,latitude,longitude);
        try{Object.assign(p,timing(input));}catch(e){fail(400,e.message);}
        r.plans=[];r.places.push(p); r.revision++; save(); return reply(res, 201, {id:p.id});
      }
      const p = r.places.find(p=>p.id===input.placeId); if (!p) fail(404, '장소가 없습니다.');
      if (match[2] === 'vote') {
        if(r.ballot)fail(409,'비밀 투표 중에는 공개 투표를 사용할 수 없습니다.');
        const voter = text(input.voter,80); if (voter.length < 12) fail(400, '참여자 식별자가 필요합니다.');
        const name=text(input.name,30);if(name){r.members ||= {};r.members[voter]=name;}
        if (input.liked === true && !p.voters.includes(voter)) { if (p.voters.length>=100) fail(400,'투표 한도입니다.'); p.voters.push(voter); }
        if (input.liked === false) p.voters = p.voters.filter(v=>v!==voter);
        r.plans=[];
      } else if (match[2] === 'select') {
        if (auth !== r.ownerToken) fail(403, '차량에서만 목적지를 선택할 수 있습니다.');
        if(r.ballot?.status==='open')fail(409,'비밀 투표 종료 후 목적지를 선택하세요.');
        r.selectedId = p.id;
      } else fail(404, '찾을 수 없는 주소입니다.');
      r.revision++; save(); reply(res, 200, snapshot(r));
    } catch(e) { reply(res, e.status || 500, {error:e.status ? e.message : '서버 연결 처리 중 오류가 발생했습니다.'}); }
  });
  server.setPublicUrl = value => { publicUrl = value; };
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const host = process.env.HOST || '127.0.0.1'; const port = Number(process.env.PORT || 8787);
  if (host === '0.0.0.0' || host === '::') throw Error('Use one explicitly approved interface, not all interfaces.');
  const relay = createRelay();
  relay.listen(port, '127.0.0.1', () => console.log(`Moagil local relay listening on 127.0.0.1:${port}`));
  if (host !== '127.0.0.1') {
    const approvedUntil=Number(process.env.PHONE_SHARE_UNTIL || Date.now()+30*60*1000);
    if(!Number.isFinite(approvedUntil)||approvedUntil<=Date.now()){relay.setPublicUrl('');console.log('Phone sharing approval expired; local relay only.');}
    else {
    const shareMs=Math.min(60*60*1000,approvedUntil-Date.now());
    const lan = http.createServer(relay.listeners('request')[0]);
    lan.listen(port, host, () => console.log(`Temporary phone listener: ${host}:${port} (${Math.ceil(shareMs/60000)} minutes remaining)`));
    setTimeout(() => {lan.close();lan.closeAllConnections();relay.setPublicUrl('');console.log('Phone listener closed; local relay remains available.');},shareMs).unref();
    }
  }
}
