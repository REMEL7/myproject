import {readFileSync} from 'node:fs';
const p=JSON.parse(readFileSync(new URL('../data/ui-preview.json',import.meta.url),'utf8'));
const endpoint=`http://127.0.0.1:8787/api/rooms/${p.id}`;
const headers={Authorization:`Bearer ${p.ownerToken}`,'Content-Type':'application/json'};
async function post(action){const response=await fetch(endpoint+'/ballot',{method:'POST',headers,body:JSON.stringify({action})});if(!response.ok)throw Error((await response.json()).error);}
if(process.argv[2]==='open'){const r=await(await fetch(endpoint,{headers})).json();if(r.ballot?.status==='closed')await post('clear');if(!r.ballot||r.ballot.status==='closed')await post('open');}
else if(process.argv[2]==='close')await post('close');
else throw Error('Choose open or close');
console.log('Development ballot updated.');
