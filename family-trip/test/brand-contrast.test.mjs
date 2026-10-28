import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../../PleosStarter/app/src/main/java/com/example/pleosstarter/MoagilBrand.kt',import.meta.url),'utf8');
function color(name,night){
 const line=source.split('\n').find(l=>new RegExp(`val ${name}[ =]`).test(l));assert.ok(line,`Missing color ${name}`);
 const values=[...line.matchAll(/Color\.rgb\((\d+),(\d+),(\d+)\)/g)].map(m=>m.slice(1).map(Number));
 if(!line.includes('if(night)'))return values[0];
 if(night)return values[0];
 if(values.length===2)return values[1];
 if(line.includes('else Color.WHITE'))return [255,255,255];
 return color(line.match(/else (\w+)/)[1],night);
}
const luminance=rgb=>rgb.map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((a,v,i)=>a+v*[.2126,.7152,.0722][i],0);
const ratio=(a,b)=>{const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);};
test('actual Android day/night palette keeps core text and actions at least 4.5:1',()=>{
 for(const night of [false,true])for(const [fg,bg] of [['ink','background'],['ink','surface'],['secondary','background'],['secondary','surface'],['navy','surface'],['onAccent','navy'],['danger','surface'],['warning','surface'],['secondary','mist']]){
  const value=ratio(color(fg,night),color(bg,night));assert.ok(value>=4.5,`${night?'night':'day'} ${fg}/${bg}: ${value.toFixed(2)}`);
 }
});
