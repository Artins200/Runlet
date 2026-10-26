import { JSDOM, VirtualConsole } from 'jsdom';
import fs from 'node:fs';
import * as acorn from 'acorn';
const html = fs.readFileSync('app/index.html','utf8');
const bundle = fs.readFileSync('app/dist/bundle.js','utf8');
const vc = new VirtualConsole(); const errs=[];
vc.on('jsdomError', e=>errs.push(e.message)); vc.on('error',(...a)=>errs.push(a.map(String).join(' ')));
const dom = new JSDOM(html,{url:'http://localhost:4173/',runScripts:'outside-only',pretendToBeVisual:true,virtualConsole:vc,
 beforeParse(w){
  w.matchMedia=q=>({matches:false,media:q,addListener(){},removeListener(){},addEventListener(){},removeEventListener(){}});
  w.ResizeObserver=class{observe(){}unobserve(){}disconnect(){}}; w.IntersectionObserver=w.ResizeObserver;
  w.PerformanceObserver=class{observe(){}disconnect(){}}; w.BroadcastChannel=class{postMessage(){}close(){}};
  w.fetch=(u,o)=>globalThis.fetch(new URL(u,'http://localhost:4173/'),o);
  w.structuredClone=globalThis.structuredClone; w.CSS={escape:s=>s};
  w.HTMLCanvasElement.prototype.getContext=()=>({clearRect(){},fillRect(){},fillText(){},drawImage(){},createLinearGradient:()=>({addColorStop(){}}),beginPath(){},fill(){},roundRect(){},set fillStyle(v){},set font(v){},set globalAlpha(v){},set textAlign(v){},set textBaseline(v){}});
  w.HTMLCanvasElement.prototype.toDataURL=()=> 'data:image/png;base64,AA';
  w.Range.prototype.getClientRects=function(){return {length:0,item:()=>null,[Symbol.iterator]:function*(){}}};
  w.Range.prototype.getBoundingClientRect=()=>({x:0,y:0,top:0,left:0,right:0,bottom:0,width:0,height:0});
  w.Element.prototype.scrollIntoView=()=>{}; w.Element.prototype.setPointerCapture=()=>{};
 }});
const w=dom.window; w.eval(bundle);
await new Promise(r=>setTimeout(r,2500));
const sd = w.document.querySelector('#previewFrame').getAttribute('srcdoc') || w.document.querySelector('#previewFrame').srcdoc || '';
console.log('srcdoc length',sd.length);
console.log('has bridge:',sd.includes('window.__RL__ =') || sd.includes('__RL =') || sd.includes('runlet-color') || sd.includes('__RL.t'));
console.log('has cfg:',sd.includes('__RL_CFG__'));
console.log('has style inlined:',sd.includes('data-runlet="style.css"'));
console.log('has instrumented js:',sd.includes('__RL.t('));
const scripts=[...sd.matchAll(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/gi)].map(m=>m[1]);
console.log('inline scripts:',scripts.length);
let bad=0;
for(const [i,s] of scripts.entries()){
  if(s.includes('__RL_CFG__=')) { try{ acorn.parse(s,{ecmaVersion:'latest'}); console.log(' script',i,'cfg OK',s.length); }catch(e){bad++;console.log(' script',i,'CFG FAIL',e.message);} continue; }
  const isJson = /application\/ld\+json/.test(sd.slice(Math.max(0,sd.indexOf(s)-200),sd.indexOf(s)));
  try{ acorn.parse(s,{ecmaVersion:'latest',sourceType:'module',allowAwaitOutsideFunction:true,allowReturnOutsideFunction:true}); console.log(' script',i,'OK',s.length,s.slice(0,60).replace(/\n/g,' ')); }
  catch(e){ bad++; console.log(' script',i,'PARSE FAIL',e.message,'\n  head:',s.slice(0,200).replace(/\n/g,' ')); }
}
console.log('bad scripts:',bad,'errors:',errs.slice(0,5));
dom.window.close();
