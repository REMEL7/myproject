const $=id=>document.getElementById(id);
const params=new URLSearchParams(location.hash.slice(1));
const room=params.get('room'),token=params.get('token');
let config,currentRoom,map,markers=[],results=[],selected,online=false,searching=false,adding=false,refreshing=false,consented=false,accessLost=false,revision=-1,searchGeneration=0;
let activeSavedId=null,savedScrollTimer;
const point=p=>p&&Number.isFinite(Number(p.latitude))&&Number.isFinite(Number(p.longitude))&&Math.abs(Number(p.latitude))<=90&&Math.abs(Number(p.longitude))<=180;
const samePlace=(a,b)=>a.id&&b.id&&a.id===b.id||a.name===b.name&&Math.abs(Number(a.latitude)-Number(b.latitude))<.0001&&Math.abs(Number(a.longitude)-Number(b.longitude))<.0001;
const places=()=>(currentRoom?.places||[]).filter(p=>!p.demo);
const existing=p=>places().find(q=>samePlace(p,q));
const el=(tag,text,className)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(className)n.className=className;return n;};
function notice(text='',error=false){$('notice').textContent=text;$('notice').hidden=!text;$('notice').classList.toggle('error',error);}
let successToastTimer;
function showSuccessToast(text){
 clearTimeout(successToastTimer);$('successToast').textContent=text;$('successToast').hidden=false;
 successToastTimer=setTimeout(()=>{$('successToast').hidden=true;$('successToast').textContent='';},2800);
}
function connected(value){online=value;$('connection').textContent=value?'연결됨':'연결 확인 중';$('connection').classList.toggle('online',value);$('connection').setAttribute('aria-label',value?'차량에 연결됨':'차량 연결 확인 중');updateAddButton();}
async function api(path='',data){
 const response=await fetch(`/api/rooms/${room}${path}`,{method:data?'POST':'GET',signal:AbortSignal.timeout(12000),headers:{Authorization:`Bearer ${token}`,...(data?{'Content-Type':'application/json'}:{})},...(data?{body:JSON.stringify(data)}:{})});
 const result=await response.json();
 if(!response.ok){if(response.status===403){accessLost=true;currentRoom=null;connected(false);$('placeSheet').close();showWelcome(true);renderPlaces();renderMarkers();}throw Object.assign(Error(result.error||'연결을 확인해 주세요.'),{status:response.status});}
 return result;
}
function showWelcome(expired=false){$('welcome').hidden=false;$('searchDock').hidden=true;$('savedShelf').hidden=true;$('welcome').querySelector('h1').textContent=expired?'차량 QR로 다시 연결해 주세요':'차량 QR로 연결해 주세요';$('connection').textContent=expired?'초대 만료':'QR로 연결';}
function row(p,index,onClick,added=false){
 const button=el('button',undefined,'place-row');button.type='button';button.setAttribute('aria-label',p.name+' 장소 보기');
 const copy=el('span',undefined,'place-copy');copy.append(el('strong',p.name),el('small',p.address||'주소 정보 없음'));
 button.append(el('span',String(index+1),'number'),copy,el('span',added?'추가됨':'›',added?'added-tag':'chevron'));button.onclick=onClick;return button;
}
function renderPlaces(){
 const list=places();$('count').textContent=list.length;
 if(selected?.id){const latest=list.find(p=>p.id===selected.id);if(latest){selected=latest;$('placeName').textContent=latest.name;$('placeAddress').textContent=latest.address||'주소 정보 없음';renderPlaceInfo(latest);}else if($('placeSheet').open){$('placeSheet').close();selected=null;notice('차량에서 삭제한 장소예요.');}}
 renderSavedPlaces(list);if(results.length)renderResults();updateAddButton();
}
function renderSavedPlaces(list){
 clearTimeout(savedScrollTimer);
 const previous=activeSavedId,previousIndex=[...$('savedPlaces').children].findIndex(c=>c.dataset.placeId===previous);activeSavedId=list.some(p=>p.id===activeSavedId)?activeSavedId:list[Math.min(Math.max(0,previousIndex),list.length-1)]?.id||null;
 $('savedShelf').hidden=!currentRoom||accessLost;document.querySelector('.map-shell').classList.toggle('has-saved-shelf',!!currentRoom&&!accessLost);
 $('savedPlaces').replaceChildren(...list.map(p=>{
  const card=el('button',undefined,'saved-card');card.type='button';card.dataset.placeId=p.id;card.setAttribute('aria-label',p.name+' 지도에서 보기');
  card.append(el('strong',p.name),el('small',p.address||'주소 정보 없음'));card.onclick=()=>focusSaved(p.id);return card;
 }));
 if(!list.length)$('savedPlaces').append(el('p','지도에서 가고 싶은 곳을 추가해 보세요.','saved-empty'));
 updateSavedSelection();scrollSaved('instant');
 if(activeSavedId!==previous&&activeSavedId)focusSaved(activeSavedId,{scroll:false});
}
function updateSavedSelection(){
 const list=places(),index=list.findIndex(p=>p.id===activeSavedId);
 $('savedPosition').textContent=index<0?'':`${index+1} / ${list.length}`;
 $('previousSaved').disabled=index<=0;$('nextSaved').disabled=index<0||index>=list.length-1;
 $('savedDetails').disabled=index<0;
 for(const card of $('savedPlaces').children){const active=card.dataset.placeId===activeSavedId;card.classList.toggle('active',active);if(card.dataset.placeId)card.setAttribute('aria-pressed',String(active));}
}
function scrollSaved(behavior='smooth'){
 const track=$('savedPlaces'),card=[...track.children].find(c=>c.dataset.placeId===activeSavedId);if(!card)return;
 track.scrollTo({left:card.offsetLeft-(track.clientWidth-card.offsetWidth)/2,behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':behavior});
}
function focusSaved(id,{scroll=true}={}){
 const p=places().find(p=>p.id===id);if(!p)return;activeSavedId=id;selected=p;updateSavedSelection();if(scroll)scrollSaved();renderMarkers();
 if(map&&point(p)){map.relayout();map.setLevel(3);map.panTo(new kakao.maps.LatLng(Number(p.latitude),Number(p.longitude)));}
}
function stepSaved(delta){const list=places(),index=list.findIndex(p=>p.id===activeSavedId);const next=list[index+delta];if(next)focusSaved(next.id);}
function renderResults(){
 $('results').replaceChildren(...results.map((p,i)=>row(p,i,()=>openPlace(p),!!existing(p))));
 if(!results.length)$('results').append(el('p','검색 결과가 없어요.\n지역이나 장소 이름을 바꿔보세요.','empty'));
}
function clearSearchResults(){
 ++searchGeneration;results=[];$('resultsPanel').hidden=true;$('results').replaceChildren();$('retrySearch').hidden=true;
}
function updateAddButton(){
 if(!selected)return;
 $('closePlace').disabled=adding;const saved=!!existing(selected);$('addPlace').textContent=adding?'추가 중…':saved?'추가한 장소예요':'차량에 추가';$('addPlace').disabled=adding||saved||!online;
 $('consentRow').hidden=saved||consented;$('placeNotice').textContent=saved?'수정·삭제는 차량에서 할 수 있어요.':'추가하면 차량의 장소 목록에 바로 보여요.';
}
function openPlace(p){
 selected=existing(p)||p;p=selected;$('placeName').textContent=p.name;$('placeAddress').textContent=p.address||'주소 정보 없음';$('placeCategory').textContent=({food:'맛집',cafe:'카페',trip:'가볼 곳',stay:'숙소'})[categoryOf(p)]||'장소';$('placeError').hidden=true;$('sharingConsent').checked=consented;updateAddButton();renderMarkers();
 renderPlaceInfo(p);if(map&&point(p)){map.panTo(new kakao.maps.LatLng(Number(p.latitude),Number(p.longitude)));map.setLevel(4);}
 if(!$('placeSheet').open)$('placeSheet').showModal();
}
function renderPlaceInfo(p){
 const box=$('placeInfo'),info=p.info;box.replaceChildren();box.hidden=false;
 if(info){
  if(info.categoryName)box.append(el('p',info.categoryName,'info-category'));
  if(info.phone)box.append(el('p','전화 '+info.phone));
  if(/^https:\/\/place\.map\.kakao\.com\/\d+$/.test(info.placeUrl||'')){const link=el('a','카카오맵에서 영업시간·상세 보기');link.href=info.placeUrl;link.target='_blank';link.rel='noopener noreferrer';box.append(link);}
  box.append(el('small','카카오 검색 · '+new Date(info.checkedAt).toLocaleDateString('ko-KR',{timeZone:'Asia/Seoul'})+' 확인'));
 }else box.append(el('p','가게 정보는 차량에서 불러올 수 있어요.'));
 box.append(el('p','영업시간은 자동 제공되지 않아 상세페이지에서 확인해 주세요.','help'));
}
function categoryOf(p){return ['food','cafe','trip','stay','other'].includes(p.category)?p.category:({FD6:'food',CE7:'cafe',AT4:'trip',CT1:'trip',AD5:'stay'})[p.categoryCode]||'other';}
async function addPlace(){
 if(adding||!selected||existing(selected)||!online)return;
 if(!consented&&!$('sharingConsent').checked){$('placeError').textContent='장소 공유에 동의해 주세요.';$('placeError').hidden=false;$('sharingConsent').focus();return;}
 const chosen=selected;adding=true;updateAddButton();$('placeError').hidden=true;
 try{
  const result=await api('/places',{name:chosen.name,address:chosen.address||'',latitude:Number(chosen.latitude),longitude:Number(chosen.longitude),category:categoryOf(chosen),sourceId:chosen.sourceId,sender:'동행'});
  consented=true;selected={...chosen,id:result.id};activeSavedId=result.id;
  if(currentRoom&&!places().some(p=>p.id===result.id))currentRoom.places.push({...chosen,id:result.id,demo:false});
  $('placeSheet').close();clearSearchResults();$('query').value='';$('query').blur();renderPlaces();focusSaved(result.id);renderMarkers();notice();showSuccessToast(result.duplicate?'이미 추가한 장소예요.':'차량에 추가했어요.');
  refresh().catch(()=>{});
 }catch(error){$('placeError').textContent=error.status===403?'차량 QR로 다시 연결해 주세요.':'추가하지 못했어요. 연결을 확인하고 다시 눌러주세요.';$('placeError').hidden=false;}
 finally{adding=false;updateAddButton();}
}
async function search(){
 if(searching||accessLost||!room||!token)return;
 const query=$('query').value.trim();if(query.length<2)return;
 if(!config?.searchEnabled){notice('장소 검색을 준비 중이에요. 차량에서 연결을 확인해 주세요.',true);return;}
 const generation=++searchGeneration;searching=true;$('searchButton').textContent='검색 중';$('searchButton').disabled=true;$('retrySearch').hidden=true;notice();
 try{
  const result=await api('/search?q='+encodeURIComponent(query));if(generation!==searchGeneration)return;
  connected(true);results=result.places.filter(point);$('resultsTitle').textContent=`${query} · ${results.length}곳`;$('resultsPanel').hidden=false;renderResults();renderMarkers();fitPoints(results);
 }catch(error){if(generation===searchGeneration&&!accessLost){notice('검색이 잠시 안 돼요. 같은 검색어로 다시 시도해 주세요.',true);$('retrySearch').hidden=false;}}
 finally{searching=false;$('searchButton').textContent='검색';$('searchButton').disabled=accessLost;}
}
async function refresh(){
 if(refreshing||accessLost||!room||!token)return;refreshing=true;
 try{const first=!currentRoom,r=await api();currentRoom=r;const reconnected=!online;connected(true);if(reconnected&&$('notice').textContent.startsWith('차량 연결'))notice();$('welcome').hidden=true;$('searchDock').hidden=false;
  if(r.revision!==revision){revision=r.revision;renderPlaces();renderMarkers();if(first&&activeSavedId)focusSaved(activeSavedId,{scroll:false});}
 }catch(error){connected(false);if(!accessLost)notice('차량 연결을 확인하고 있어요. 잠시 후 다시 연결해요.',true);throw error;}
 finally{refreshing=false;}
}
function renderMarkers(){
 if(!map)return;for(const m of markers)m.setMap(null);markers=[];
 const list=places().filter(point).map(p=>({p,saved:true}));for(const p of results)if(!list.some(item=>samePlace(item.p,p)))list.push({p,saved:false});
 for(const {p,saved} of list){const button=el('button',p.name,'map-marker'+(saved?' saved':'')+(selected&&samePlace(selected,p)?' selected':''));button.type='button';button.setAttribute('aria-label',p.name+' 지도에서 선택');button.onclick=()=>saved?focusSaved(p.id):openPlace(p);markers.push(new kakao.maps.CustomOverlay({position:new kakao.maps.LatLng(Number(p.latitude),Number(p.longitude)),content:button,yAnchor:1.3,map}));}
 $('fitMap').disabled=!list.length;
}
function fitPoints(list){if(!map||!list.length)return;const bounds=new kakao.maps.LatLngBounds();for(const p of list)if(point(p))bounds.extend(new kakao.maps.LatLng(Number(p.latitude),Number(p.longitude)));map.relayout();map.setBounds(bounds,65,45,65,45);}
async function setupMap(){
 if(!config?.mapEnabled){$('mapHint').textContent='지도를 준비 중이에요. 검색으로 장소를 추가할 수 있어요.';return;}
 try{
  await new Promise((resolve,reject)=>{const script=document.createElement('script');const timer=setTimeout(()=>reject(Error('timeout')),12000);script.src=`https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(config.mapJavascriptKey)}&autoload=false`;script.onerror=()=>{clearTimeout(timer);reject(Error('map'));};script.onload=()=>{if(!globalThis.kakao?.maps){clearTimeout(timer);reject(Error('map'));return;}kakao.maps.load(()=>{clearTimeout(timer);resolve();});};document.head.append(script);});
  $('map').hidden=false;map=new kakao.maps.Map($('map'),{center:new kakao.maps.LatLng(37.5665,126.9780),level:8});$('mapFallback').hidden=true;$('zoomIn').disabled=false;$('zoomOut').disabled=false;renderMarkers();if(results.length)fitPoints(results);else if(activeSavedId)focusSaved(activeSavedId,{scroll:false});
 }catch{$('mapHint').textContent='지도를 불러오지 못했어요. 검색으로 장소를 추가할 수 있어요.';}
}
$('searchForm').onsubmit=e=>{e.preventDefault();search();};$('retrySearch').onclick=search;
$('query').oninput=()=>{++searchGeneration;$('retrySearch').hidden=true;};
$('clearResults').onclick=()=>{clearSearchResults();selected=null;renderMarkers();notice();};
$('fitMap').onclick=()=>fitPoints([...places(),...results]);
$('zoomIn').onclick=()=>{if(map)map.setLevel(Math.max(1,map.getLevel()-1));};
$('zoomOut').onclick=()=>{if(map)map.setLevel(Math.min(14,map.getLevel()+1));};
$('addPlace').onclick=addPlace;$('closePlace').onclick=()=>$('placeSheet').close();
$('placeSheet').addEventListener('cancel',e=>{if(adding)e.preventDefault();});
$('previousSaved').onclick=()=>stepSaved(-1);$('nextSaved').onclick=()=>stepSaved(1);
$('savedDetails').onclick=()=>{const p=places().find(p=>p.id===activeSavedId);if(p)openPlace(p);};
$('savedPlaces').onkeydown=e=>{if(e.key==='ArrowRight'||e.key==='ArrowLeft'){e.preventDefault();stepSaved(e.key==='ArrowRight'?1:-1);}};
$('savedPlaces').onscroll=()=>{clearTimeout(savedScrollTimer);savedScrollTimer=setTimeout(()=>{const track=$('savedPlaces'),center=track.getBoundingClientRect().left+track.clientWidth/2;const nearest=[...track.children].filter(c=>c.dataset.placeId).sort((a,b)=>Math.abs(a.getBoundingClientRect().left+a.offsetWidth/2-center)-Math.abs(b.getBoundingClientRect().left+b.offsetWidth/2-center))[0];if(nearest&&nearest.dataset.placeId!==activeSavedId)focusSaved(nearest.dataset.placeId,{scroll:false});},140);};
addEventListener('resize',()=>{scrollSaved('instant');if(map){map.relayout();if(activeSavedId&&!results.length)focusSaved(activeSavedId,{scroll:false});}});
$('joinForm').onsubmit=e=>{e.preventDefault();try{const link=new URL($('joinLink').value);const p=new URLSearchParams(link.hash.slice(1));if(!/^https?:$/.test(link.protocol)||!/^[a-f0-9]{12}$/.test(p.get('room')||'')||!p.get('token'))throw Error();location.hash=new URLSearchParams({room:p.get('room'),token:p.get('token')}).toString();}catch{$('joinLink').setCustomValidity('차량에서 받은 초대 링크를 입력해 주세요.');$('joinLink').reportValidity();}};
$('joinLink').oninput=()=>$('joinLink').setCustomValidity('');
addEventListener('hashchange',()=>location.reload());
async function start(){
 try{const response=await fetch('/api/config',{signal:AbortSignal.timeout(8000)});if(!response.ok)throw Error();config=await response.json();setupMap();}catch{notice('서버에 연결하지 못했어요. 잠시 후 새로고침해 주세요.',true);}
 if(!room||!token){showWelcome();return;}
 $('searchDock').hidden=false;try{await refresh();}catch{}
 setInterval(()=>{if(!document.hidden&&!accessLost)refresh().catch(()=>{});},4000);
}
start();
