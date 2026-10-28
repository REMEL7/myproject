const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.hash.slice(1));
const room = params.get('room'), token = params.get('token');
const categories = {food:['맛집','食'],cafe:['카페','☕'],trip:['가볼 곳','↗'],stay:['숙소','⌂'],other:['기타','⌖']};
let member;
try { member = JSON.parse(localStorage.getItem('moagil-v1') || 'null'); } catch {}
if (!member?.id) member = {id:globalThis.crypto?.randomUUID?.() || 'member-' + Math.random().toString(36).slice(2) + Date.now(),name:'',liked:{}};
member.liked ||= {};
let currentRoom, config, filter='all', revision=-1, operation=false, online=false, map, markers=[], focusedPlace, recommendation, syncing=false;
const persist = () => {try {localStorage.setItem('moagil-v1',JSON.stringify(member));} catch {}};
const el = (tag,value,className) => {const node=document.createElement(tag);if(value!==undefined && value!==null)node.textContent=value;if(className)node.className=className;return node;};
const notice = (msg,error=false)=>{
  $('notice').textContent=msg;$('notice').classList.toggle('error',error);
  $('notice').hidden=!msg;
};
function connection(ok){online=ok;$('connection').textContent=ok?'모임 연결됨':'연결 대기';$('connection').classList.toggle('online',ok);}
async function api(action='',data){
  const response=await fetch(`/api/rooms/${room}${action}`,{method:data?'POST':'GET',signal:AbortSignal.timeout(12000),headers:{Authorization:`Bearer ${token}`,...(data?{'Content-Type':'application/json'}:{})},...(data?{body:JSON.stringify(data)}:{})});
  const result=await response.json();if(response.status===403){$('trip').hidden=true;currentRoom=null;connection(false);}if(!response.ok)throw Object.assign(Error(result.error||'연결을 확인해 주세요.'),{status:response.status});return result;
}
async function busy(fn){if(operation)return;operation=true;document.body.classList.add('busy');try{await fn();}catch(e){notice(e.message,true);}finally{operation=false;document.body.classList.remove('busy');}}
function sender(){if(!$('sharingConsent').checked){$('sharingConsent').focus();throw Error('참여자와 공유할 정보를 확인하고 동의해 주세요.');}const value=$('sender').value.trim();if(!value){$('sender').focus();throw Error('먼저 이름을 입력해 주세요.');}return value;}
function categoryOf(p){if(categories[p.category])return p.category;return ({FD6:'food',CE7:'cafe',AT4:'trip',CT1:'trip',AD5:'stay'})[p.categoryCode]||'other';}
const liked = p => currentRoom?.ballot ? member.ballots?.[currentRoom.ballot.id]===p.id : !!member.liked[`${room}:${p.id}`];
$('sender').value=member.name;
$('sender').addEventListener('input',()=>{member.name=$('sender').value;persist();renderNextStep();});
function mapLink(p){const a=el('a','카카오맵에서 열기 ↗');a.href=`https://map.kakao.com/link/map/${encodeURIComponent(p.name)},${p.latitude},${p.longitude}`;a.target='_blank';a.rel='noopener noreferrer';return a;}
async function add(p){const result=await api('/places',{...p,category:categoryOf(p),sender:sender()});await refresh(true);notice(result.duplicate?'이미 추가한 장소예요. 하트를 눌러 관심을 표시해 보세요.':'장소를 추가했어요. 차량 화면에서도 볼 수 있어요.');}
function showLocation(p){
  focusedPlace=p;
  const detail=el('div');detail.append(el('b',p.name),el('p',p.address||'주소 정보 없음'),el('small',`${Number(p.latitude).toFixed(5)}, ${Number(p.longitude).toFixed(5)}`),mapLink(p));
  $('mapSelection').replaceChildren(detail);
  if(map){map.panTo(new kakao.maps.LatLng(p.latitude,p.longitude));map.setLevel(4);}
  $('mapSelection').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'nearest'});
}
function placeCard(p,isResult=false){
  const selected=currentRoom?.selectedId===p.id;
  const category=categoryOf(p),[categoryName,symbol]=categories[category];
  const card=el('article',null,`place ${category}${selected?' selected':''}`);
  const head=el('div',null,'place-head');head.append(el('span',symbol,'category-icon'),el('span',categoryName,'category-name'));
  if(selected)head.append(el('span','차량 선택 ✓','badge'));
  if(p.demo)head.append(el('span','연동 시험','badge demo-badge'));
  card.append(head,el('h3',p.name));
  if(isResult)card.append(el('p',p.address||'주소 정보 없음','address'));
  else{
    if(currentRoom?.ballot){if(currentRoom.ballot.status==='open')card.append(el('p','투표 결과는 투표를 마친 뒤 공개해요','supporters'));}
    else{const names=(p.supporters||[]).slice(0,4),rest=p.votes-names.length;card.append(el('p',names.length?'♥ '+names.join(' · ')+(rest>0?` 외 ${rest}명`:''):(p.votes?`♥ ${p.votes}명 가고 싶어요`:'아직 관심 표시가 없어요'),'supporters'));}
    const details=el('details',null,'place-details');details.append(el('summary','상세 정보'));
    details.append(el('p',p.address||'주소 정보 없음','address'));
    if(p.note)details.append(el('p',p.note,'recommendation'));
    details.append(el('p',`${p.sender}님이 추가했어요`,'sender-name'));
    details.append(el('p',p.opensAt?`${p.opensAt}–${p.closesAt} · 직접 입력 · ${p.stayMinutes}분 머물기`:`운영시간 미확인 · ${p.stayMinutes||60}분 머물기`,'help'));
    card.append(details);
  }
  const actions=el('div',null,'card-actions');
  const ballot=currentRoom?.ballot,closed=ballot?.status==='closed',candidate=!ballot||ballot.candidateIds.includes(p.id);
  const vote=el('button',isResult?'장소 추가 ＋':closed?'투표 결과 보기':ballot?(!candidate?'이번 투표 후보 아님':liked(p)?'내가 투표한 곳 ✓':'이곳에 투표하기'):`${liked(p)?'♥':'♡'} 가고 싶어요`,`vote-button${!closed&&liked(p)?' liked':''}`);
  if(!isResult&&!closed)vote.setAttribute('aria-pressed',String(liked(p)));
  vote.setAttribute('aria-label',isResult?`${p.name} 장소 추가`:closed?`${p.name} 투표 결과 보기`:ballot?`${p.name} 비밀 투표`:`${p.name} 가고 싶어요`);
  vote.disabled=!online||(!isResult&&!!ballot&&!closed&&!candidate);
  vote.onclick=()=>busy(async()=>{
    if(isResult){sender();recommendation=p;$('recommendName').textContent=p.name;$('recommendAddress').textContent=p.address;$('recommendNote').value='';$('recommendOpens').value='';$('recommendCloses').value='';$('recommendStay').value='60';$('recommendExtras').open=false;$('recommendDialog').showModal();}
    else if(closed){openReveal();}
    else if(ballot){const name=sender();await api('/ballot',{action:'cast',placeId:p.id,voter:member.id,name});member.ballots ||= {};member.ballots[ballot.id]=p.id;persist();await refresh(true);notice('투표했어요. 투표를 마치기 전까지 바꿀 수 있어요.');}
    else{const key=`${room}:${p.id}`,value=!liked(p);await api('/vote',{placeId:p.id,voter:member.id,name:sender(),liked:value});member.liked[key]=value;persist();await refresh(true);notice(value?'가고 싶은 곳으로 표시했어요.':'관심 표시를 취소했어요.');}
  });
  const locate=el('button','위치 보기 ↗','text-button');locate.onclick=()=>showLocation(p);
  if(isResult||!closed)actions.append(vote);actions.append(locate);card.append(actions);return card;
}
function renderPlaces(){
  if(!currentRoom)return;
  let places=[...currentRoom.places].filter(p=>filter==='all'||(filter==='liked'?liked(p):categoryOf(p)===filter));
  places.sort($('sort').value==='newest'?(a,b)=>b.createdAt-a.createdAt:(a,b)=>b.votes-a.votes||a.createdAt-b.createdAt);
  const focus=document.activeElement?.getAttribute('aria-label');
  $('places').replaceChildren(...places.map(p=>placeCard(p)));
  if(!places.length){const empty=el('div',null,'empty-state');empty.append(el('span','↗'),el('h3',currentRoom.places.length?'아직 이 분류의 장소가 없어요':'가고 싶은 곳을 추가해 보세요'),el('p',currentRoom.places.length?'다른 분류를 선택하거나 장소를 더해보세요.':'장소를 검색하거나 좌표로 직접 추가할 수 있어요.'));$('places').append(empty);}
  if(focus){for(const b of $('places').querySelectorAll('button'))if(b.getAttribute('aria-label')===focus)b.focus({preventScroll:true});}
}
function renderSelected(){
  const p=currentRoom.places.find(p=>p.id===currentRoom.selectedId);if(!p){$('selectedPanel').replaceChildren(el('p','다음 목적지','eyebrow'),el('h2','고른 장소로 출발해요'),el('p','추천한 장소를 함께 고르고 차량에서 출발을 확인해 주세요.'));return;}
  $('selectedPanel').replaceChildren(el('p','목적지','eyebrow'),el('span','차량의 최근 선택 기록','selected-label'),el('h2',p.name),el('p',p.address),mapLink(p));
}
async function refresh(force=false){
  if(syncing)return;syncing=true;
  try{
    const r=await api();const reconnected=!online;const ballotChanged=currentRoom?.ballot?.id!==r.ballot?.id;connection(true);currentRoom=r;
    if(ballotChanged){filter='all';for(const b of $('filters').querySelectorAll('button')){const active=b.dataset.filter==='all';b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active));}}
    $('roomName').textContent=r.name;$('count').textContent=r.places.length;
    document.body.classList.add('joined');
    $('tripSummary').textContent=r.ballot?`장소 ${r.places.length}곳 · 투표 ${r.ballot.castCount}명 참여`:`장소 ${r.places.length}곳`;
    document.querySelector('[data-filter="liked"]').textContent=r.ballot?'내가 투표한 곳':'가고 싶은 곳';
    $('groupTypeLabel').textContent=({friends:'친구와 함께',family:'가족과 함께',colleagues:'동료와 함께',together:'함께하는 모임'})[r.groupType]||'함께하는 모임';
    if(force||r.revision!==revision||reconnected){revision=r.revision;renderPlaces();renderSelected();renderJourney();renderNextStep();updateMarkers();}
    if(reconnected&&$('trip').hidden){$('trip').hidden=false;$('welcome').hidden=true;$('share').hidden=false;notice('');if(map)map.relayout();}
    else if(reconnected)notice('다시 연결됐어요.');
  }catch(e){connection(false);if(currentRoom)renderPlaces();throw e;}finally{syncing=false;}
}
function updateMarkers(){
  if(!map||!currentRoom)return;
  markers.forEach(m=>m.setMap(null));markers=[];
  currentRoom.places.forEach((p,index)=>{
    const content=el('button',`${index+1} · ${p.name}`,'map-marker'+(p.id===currentRoom.selectedId?' chosen':''));content.onclick=()=>showLocation(p);
    const overlay=new kakao.maps.CustomOverlay({position:new kakao.maps.LatLng(p.latitude,p.longitude),content,yAnchor:1.2,map});markers.push(overlay);
  });
}
function fitMap(){if(!map||!currentRoom?.places.length)return;const bounds=new kakao.maps.LatLngBounds();currentRoom.places.forEach(p=>bounds.extend(new kakao.maps.LatLng(p.latitude,p.longitude)));map.relayout();map.setBounds(bounds,55,45,55,45);}
async function setupMap(){
  if(!config.mapEnabled){$('mapHint').textContent='카카오 지도 키 연결 전이에요. 장소의 위치는 외부 카카오맵에서 확인할 수 있어요.';return;}
  try{
    await new Promise((resolve,reject)=>{
      const script=document.createElement('script');let timer=setTimeout(()=>reject(Error('지도 연결 시간이 초과됐어요.')),12000);
      script.src=`https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(config.mapJavascriptKey)}&autoload=false`;
      script.onerror=()=>{clearTimeout(timer);reject(Error('지도 키와 등록 도메인을 확인해 주세요.'));};
      script.onload=()=>{if(!globalThis.kakao?.maps){clearTimeout(timer);reject(Error('지도 사용 권한과 키를 확인해 주세요.'));return;}kakao.maps.load(()=>{clearTimeout(timer);resolve();});};document.head.append(script);
    });
    $('map').hidden=false;$('mapFallback').hidden=true;
    const p=currentRoom?.places[0];map=new kakao.maps.Map($('map'),{center:new kakao.maps.LatLng(p?.latitude||37.5665,p?.longitude||126.9780),level:7});
    map.addControl(new kakao.maps.ZoomControl(),kakao.maps.ControlPosition.RIGHT);$('fitMap').disabled=false;updateMarkers();fitMap();
  }catch(e){$('mapHint').textContent=e.message;}
}
$('fitMap').onclick=fitMap;
$('filters').onclick=e=>{const button=e.target.closest('button[data-filter]');if(!button)return;filter=button.dataset.filter;for(const b of $('filters').querySelectorAll('button')){b.classList.toggle('active',b===button);b.setAttribute('aria-pressed',String(b===button));}renderPlaces();};
$('sort').onchange=renderPlaces;
$('searchForm').onsubmit=e=>{e.preventDefault();busy(async()=>{
  if(!config?.searchEnabled){$('mapHelpDialog').showModal();return;}
  $('searchButton').textContent='검색 중';$('retrySearch').hidden=true;
  try{const query=$('query').value.trim();const result=await api('/search?q='+encodeURIComponent(query));$('results').replaceChildren(el('p',`${query} · 검색 결과 ${result.places.length}곳`,'result-count'),...result.places.map(p=>placeCard(p,true)));notice(result.places.length?'가고 싶은 곳을 누르면 추가할 수 있어요.':'검색 결과가 없어요. 지역명을 함께 입력해 보세요.');}catch(e){$('retrySearch').hidden=e.status===403;throw e.status===403?e:Error('검색이 잠시 안 돼요. 입력한 검색어로 다시 시도해 주세요.');}finally{$('searchButton').textContent='검색';}
});};
for(const b of document.querySelectorAll('[data-query]'))b.onclick=()=>{$('query').value=b.dataset.query;$('searchForm').requestSubmit();};
$('manual').onsubmit=e=>{e.preventDefault();const values=Object.fromEntries(new FormData(e.target));busy(async()=>{await add({...values,latitude:Number(values.latitude),longitude:Number(values.longitude)});e.target.reset();$('manualDetails').open=false;});};
$('recommendForm').onsubmit=e=>{e.preventDefault();busy(async()=>{await add({...recommendation,note:$('recommendNote').value,opensAt:$('recommendOpens').value,closesAt:$('recommendCloses').value,stayMinutes:Number($('recommendStay').value)});$('recommendDialog').close();});};
$('closeRecommend').onclick=()=>$('recommendDialog').close();
$('mapHelp').onclick=()=>$('mapHelpDialog').showModal();$('closeMapHelp').onclick=()=>$('mapHelpDialog').close();
$('demo').onclick=()=>busy(()=>add({name:'42dot · 연동 시험 장소',address:'서울 강남구 남부순환로 2621',latitude:37.48544722,longitude:127.03636666,note:'공식 SDK 예제 좌표로 공유 흐름 시험',category:'other',demo:true}));
$('share').onclick=()=>busy(async()=>{
  const response=await fetch('/api/config',{signal:AbortSignal.timeout(5000)});if(!response.ok)throw Error('공유 연결을 확인해 주세요.');
  const latest=await response.json();
  if(latest.localOnly){notice('초대 연결을 확인해 주세요. 연결 후 차량에서 QR을 열 수 있어요.',true);return;}
  const invite=new URL(latest.publicUrl);invite.hash=new URLSearchParams({room,token}).toString();
  try{await navigator.clipboard.writeText(invite.href);notice('휴대폰에서 접속할 수 있는 초대 링크를 복사했어요.');}
  catch{notice('이 브라우저에서는 복사를 지원하지 않아요. 차량의 초대 QR로 참여해 주세요.',true);}
});
$('joinForm').onsubmit=e=>{e.preventDefault();try{const link=new URL($('joinLink').value);const p=new URLSearchParams(link.hash.slice(1));if(!/^https?:$/.test(link.protocol)||!/^[a-f0-9]{12}$/.test(p.get('room')||'')||!p.get('token'))throw Error();location.hash=new URLSearchParams({room:p.get('room'),token:p.get('token')}).toString();location.reload();}catch{notice('차량에서 만든 초대 링크 전체를 입력해 주세요.',true);}};
async function start(){
  try{config=await(await fetch('/api/config',{signal:AbortSignal.timeout(8000)})).json();$('searchHint').textContent=config.searchEnabled?'이름이나 지역으로 검색하고 가고 싶은 곳을 추가하세요.':'장소 검색 키 연결 전 · 좌표 직접 추가와 추천·투표는 사용할 수 있어요.';setupMap();}catch{notice('서버 연결을 확인해 주세요. 새로고침하면 다시 연결해요.',true);}
  if(!room||!token){$('welcome').hidden=false;connection(false);$('connection').textContent='QR로 참여하기';notice('차량 QR로 연결하면 일행의 장소가 여기에 모여요.');return;}
  try{await refresh();fitMap();}catch(e){notice(e.message,true);}
  setInterval(()=>{if(!document.hidden&&!operation)refresh().catch(()=>notice('연결이 잠시 끊겼어요. 마지막으로 받은 장소를 표시하며 다시 연결하고 있어요.',true));},3000);
}
start();

addEventListener('hashchange',()=>location.reload());



function renderJourney(){
  const ballot=currentRoom.ballot;
  $('ballotPanel').hidden=!ballot||(ballot.status==='closed'&&currentRoom.course?.status!=='active');
  $('courseDetails').closest('.course-panel').hidden=!currentRoom.course&&!(currentRoom.plans||[]).length;
  const container=$('ballotState');container.replaceChildren();
  if(ballot){
    if(ballot.status==='open')container.append(el('span',`비밀 투표 · ${ballot.castCount}명 참여`,'ballot-pill'),el('p','한 기기에서 한 표씩 · 투표를 마치기 전까지 바꿀 수 있어요.','help'));
    else{const reveal=el('button','지난 투표 결과 보기','text-button');reveal.onclick=openReveal;container.append(reveal);}
  }
  const content=$('courseContent'),course=currentRoom.course;
  content.replaceChildren();
  $('courseBadge').textContent='차량에서 코스 만들기 ↗';
  if(!course&&!(currentRoom.plans||[]).length)return;
  if(course){
    $('courseBadge').textContent=course.status==='complete'?'방문 완료 ✓':`${course.nextIndex}/${course.stops.length}곳 방문 · 이어가기`;
    const head=el('div',null,'course-summary');head.append(el('h3',course.title),el('p','코스와 방문 기록은 저장돼 있어요. 다음 목적지 안내·방문 완료는 차량에서 진행하세요.','muted'));content.append(head);
    const timeline=el('ol',null,'timeline');
    course.stops.forEach((p,i)=>{
      const li=el('li',null,p.status==='planned'?'':'done');
      li.append(el('b',`${i+1}. ${p.name}${i===course.nextIndex&&course.status==='active'?' · 다음 목적지':''}`),el('span',p.status==='visited'?'방문 완료':p.status==='skipped'?'건너뜀':`${formatTime(p.startVisitAt)} 도착 계획 · 체류 ${p.stayMinutes}분`));timeline.append(li);
    });content.append(timeline);
    content.append(el('p',course.timingSource==='kakao-road'?`카카오 도로 ${course.roadDistanceKm}km · 이동 약 ${course.roadMinutes}분 · 체류·대기 별도 · 저장 이후 교통상황은 달라질 수 있어요.`:'구간당 임시 이동시간 기준 · 실제 도로 소요시간이 아닙니다.','help'));
    content.append(el('p','다른 날 이어가거나 현재 위치가 바뀌었다면 차량에서 남은 일정의 운영시간과 동선을 다시 확인해 주세요.','help'));
  }
  if((currentRoom.plans||[]).length){content.append(el('p','차량에서 비교할 추천 코스','eyebrow'));for(const p of currentRoom.plans){const box=el('article',null,'plan-option');box.append(el('h3',p.title),el('p',p.reason,'muted'),el('p',p.stops.map(s=>s.name).join(' → ')),el('small',`${p.timingSource==='kakao-road'?`도로 ${p.roadDistanceKm}km · 이동 약 ${p.roadMinutes}분`:`직선 연결 ${p.straightKm}km · 직접 설정한 임시 이동시간`} · 차량에서 선택`));content.append(box);}}
}
function formatTime(value){return new Intl.DateTimeFormat('ko-KR',{hour:'2-digit',minute:'2-digit',timeZone:'Asia/Seoul'}).format(new Date(value));}
let revealTimer,audio;
function openReveal(){
  $('revealStage').replaceChildren(el('div','?','reveal-symbol'),el('h2','우리의 선택은…'),el('p','함께 볼 준비가 됐나요?','muted'));
  $('playReveal').disabled=false;$('revealDialog').showModal();
}
function tone(freq,seconds,offset=0){if(!audio)return;const oscillator=audio.createOscillator(),gain=audio.createGain();oscillator.connect(gain);gain.connect(audio.destination);oscillator.type='sine';oscillator.frequency.value=freq;const t=audio.currentTime+offset;gain.gain.setValueAtTime(.035,t);gain.gain.exponentialRampToValueAtTime(.001,t+seconds);oscillator.start(t);oscillator.stop(t+seconds);}
$('playReveal').onclick=async()=>{
  if(currentRoom?.ballot?.status!=='closed')return;
  $('playReveal').disabled=true;
  if($('revealSound').checked){try{audio ||= new (window.AudioContext||window.webkitAudioContext)();await audio.resume();}catch{audio=null;}}
  const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
  $('revealStage').replaceChildren(el('div','🥁','reveal-symbol drum'),el('h2','두구두구두구…'));
  if(audio&&$('revealSound').checked)for(let i=0;i<8;i++)tone(110+i*9,.08,i*.16);
  const b=currentRoom.ballot;
  revealTimer=setTimeout(()=>{
    const winners=b.winnerIds.map(id=>currentRoom.places.find(p=>p.id===id)||{id,name:b.candidateNames?.[id]||'삭제된 장소'}).filter(Boolean);
    $('revealStage').replaceChildren(el('div','🎉','reveal-symbol'),el('p',winners.length>1?'공동 1위! 함께 마지막 선택을 해요.':'함께 고른 오늘의 목적지','eyebrow'),...winners.map(p=>el('h2',p.name)),el('p',`최다 ${b.counts[b.winnerIds[0]]}표 · 동점은 공동 1위로 표시해요.`,'muted'));
    if(audio&&$('revealSound').checked)[523,659,784,1047].forEach((n,i)=>tone(n,.35,i*.13));
    if(!reduced)for(let i=0;i<24;i++){const confetti=el('i',null,'confetti');confetti.style.left=`${Math.random()*100}%`;confetti.style.animationDelay=`${Math.random()*.4}s`;confetti.style.background=['#215e4f','#e59155','#b5ce94'][i%3];$('revealStage').append(confetti);}
  },reduced?0:1500);
};
$('closeReveal').onclick=()=>{clearTimeout(revealTimer);$('revealDialog').close();};
$('revealDialog').addEventListener('close',()=>{clearTimeout(revealTimer);audio?.close();audio=null;});

function renderNextStep(){
  if(!currentRoom)return;
  $('decisionLabel').textContent=currentRoom.ballot?.status==='open'?'비밀 투표':'함께 갈 장소';
  let title,hint,label,action;
  if(!$('sender').value.trim()){
    title='먼저 이름을 알려주세요';hint='함께 보는 이름이에요. 별명을 써도 괜찮아요.';label='내 이름 입력하기';action=()=>$('sender').focus();
  }else if(!$('sharingConsent').checked){
    title='공유할 정보를 확인해 주세요';hint='이름과 추가한 장소를 함께 갈 사람에게 보여드려요.';label='공유 동의 확인';action=()=>$('sharingConsent').focus();
  }else if(currentRoom.ballot?.status==='open'){
    title='투표가 진행 중이에요';hint='후보 중 한 곳을 골라주세요. 마감 전에는 선택을 바꿀 수 있어요.';label='투표할 장소 보기';action=()=>document.querySelector('.collection').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
  }else if(currentRoom.ballot?.status==='closed'&&currentRoom.course?.status!=='active'){
    title='투표가 끝났어요';hint='어디가 가장 많은 표를 받았는지 확인해 보세요.';label='결과 보기';action=openReveal;
  }else if(currentRoom.course){
    title='저장한 코스가 있어요';hint='남은 장소를 확인해 보세요. 실제 출발과 방문 완료는 차량에서 진행해요.';label='저장한 코스 확인';action=()=>{$('courseDetails').open=true;$('courseDetails').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});};
  }else{
    title='가고 싶은 곳을 찾아보세요';hint='검색해서 추가하고, 마음에 드는 곳에는 하트를 눌러주세요.';label='장소 찾아보기';action=()=>{$('query').scrollIntoView({block:'center',behavior:'instant'});$('query').focus({preventScroll:true});};
  }
  $('nextTitle').textContent=title;$('nextHint').textContent=hint;$('nextAction').textContent=label;$('nextAction').onclick=action;
}


$('sharingConsent').addEventListener('change',renderNextStep);

$('retrySearch').onclick=()=>$('searchForm').requestSubmit();
