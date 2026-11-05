import http from 'node:http';
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {createRelay} from '../family-trip/server.mjs';

const here=path.dirname(fileURLToPath(import.meta.url));
const host=process.env.TABLET_HOST||'127.0.0.1';
const until=Number(process.env.PHONE_SHARE_UNTIL||0);
if(host!=='127.0.0.1' && (host==='0.0.0.0'||host==='::'||!Number.isFinite(until)||until<=Date.now()))throw Error('An explicit interface and future sharing deadline are required');
const port=8789;
const origin=host==='127.0.0.1'?'':`http://${host}:${port}`;
const dataDir=path.join(here,'data');mkdirSync(dataDir,{recursive:true});
let session;
const relay=createRelay({dataDir,publicUrl:origin});
const handler=relay.listeners('request')[0];
const apk=path.join(here,'app/build/outputs/apk/debug/app-debug.apk');
const hits=new Map();
function serve(req,res){
  const url=new URL(req.url,'http://localhost');
  if(url.pathname==='/tablet.apk'){
    if(!existsSync(apk)){res.writeHead(503);res.end('APK build in progress');return;}
    res.writeHead(200,{'Content-Type':'application/vnd.android.package-archive','Content-Disposition':'attachment; filename="GMG-tablet-experience.apk"','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(readFileSync(apk));return;
  }
  if(url.pathname==='/api/tablet/session'){
    if(req.method!=='GET'||(req.headers.origin && req.headers.origin!==`http://${req.headers.host}`)){res.writeHead(403);res.end();return;}
    const minute=Math.floor(Date.now()/60000);if(hits.get('minute')!==minute){hits.clear();hits.set('minute',minute);}
    const client=req.socket.remoteAddress;const count=(hits.get(client)||0)+1;hits.set(client,count);
    if(count>12||!session){res.writeHead(503);res.end();return;}
    res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store','Referrer-Policy':'no-referrer'});res.end(JSON.stringify(session));return;
  }
  handler(req,res);
}
const local=http.createServer(serve);
local.listen(port,'127.0.0.1',async()=>{
  const file=path.join(dataDir,'tablet-session.json');
  if(existsSync(file))session=JSON.parse(readFileSync(file,'utf8'));
  else{
    const response=await fetch(`http://127.0.0.1:${port}/api/rooms`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'GMG 태블릿 체험',groupType:'friends'})});
    if(!response.ok)throw Error('Cannot create isolated tablet room');
    const room=await response.json();session={id:room.id,ownerToken:room.ownerToken,joinToken:room.joinToken};
    writeFileSync(file,JSON.stringify(session));
  }
  console.log('Independent tablet experience ready on localhost:8789');
  if(origin){
    const remote=http.createServer((req,res)=>{
      if(req.method==='POST' && new URL(req.url,origin).pathname==='/api/rooms'){res.writeHead(403);res.end();return;}
      serve(req,res);
    });
    remote.listen(port,host,()=>console.log('Temporary tablet listener enabled'));
    setTimeout(()=>{remote.close();remote.closeAllConnections();relay.setPublicUrl('');console.log('Tablet phone listener closed at deadline');},Math.min(until-Date.now(),24*60*60*1000)).unref();
  }
});
