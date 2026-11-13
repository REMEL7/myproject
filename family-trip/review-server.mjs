import {createRelay} from './server.mjs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

// Explicit, synthetic examples for offline review. Never presented as live business information.
export const reviewPlaces = [
  {name:'[예시] 나들이 공원',address:'심사용 가상 장소 · 실제 영업정보가 아닙니다',latitude:37.5796,longitude:126.9770,category:'trip',sender:'심사용 예시',note:'코스 저장과 이어가기 확인용',stayMinutes:60},
  {name:'[예시] 쉬어가는 카페',address:'심사용 가상 장소 · 실제 영업정보가 아닙니다',latitude:37.5716,longitude:126.9860,category:'cafe',sender:'심사용 예시',note:'주차·관람료는 직접 선택하거나 입력하세요',stayMinutes:60},
  {name:'[예시] 함께 가는 전시관',address:'심사용 가상 장소 · 실제 영업정보가 아닙니다',latitude:37.5658,longitude:126.9751,category:'trip',sender:'심사용 예시',note:'도로 API 미연결 시 도로시간 미확인과 직선 동선을 표시합니다',stayMinutes:60}
];

export function createReviewRelay(dataDir) {
  return createRelay({dataDir,publicUrl:'',kakaoKey:'',mapKey:'',mobilityKey:'',tourKey:'',parkingKey:'',initialPlaces:reviewPlaces});
}

if (process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const server=createReviewRelay(path.join(path.dirname(fileURLToPath(import.meta.url)),'data','review'));
  server.on('error',error=>{console.error(error.code==='EADDRINUSE'?'8787 포트가 사용 중입니다. 기존 서버를 종료하거나 실제 서버를 그대로 사용하세요.':error.message);process.exitCode=1;});
  server.listen(8787,'127.0.0.1',()=>console.log('GMG 심사용 예시 서버: http://127.0.0.1:8787 (가상 장소, 외부 API 미사용, 외부 공유 비활성)'));
}
