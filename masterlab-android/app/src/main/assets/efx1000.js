
/* EFX-1000 INSPIRED - independent Web Audio beat/jog DSP models */
(function(){
'use strict';
const BEAT=['DELAY','ECHO','PITCH ECHO','TRANS','FLANGER','FILTER','PHASER'];
const JOG=['JET','WAH','PHASE SHIFTER','RING','ZIP','HUMANIZER','VOCODER'];
const S={beat:'ECHO',jog:'WAH',onBeat:false,onJog:false,flow:'beat-jog',bpm:120,division:1,depth:.5,character:.5,beatMix:.5,jogDepth:.5,jogCharacter:.5,jogMix:.5,jogPosition:.5,hold:false,rec:false,memory:[],memoryPlay:false,lastTap:0,handle:0};
let fx=null,ctx=null;
const $e=id=>document.getElementById('efx-'+id);
const lim=(n,lo,hi)=>Math.max(lo,Math.min(hi,n));
function knob(id,label,value,callback){
 let wrap=document.createElement('div');wrap.className='efx-knob-wrap';
 let l=document.createElement('span');l.className='efx-knob-label';l.textContent=label;
 let k=document.createElement('div');k.className='efx-turn';k.setAttribute('role','slider');k.tabIndex=0;k.setAttribute('aria-label',label);
 let o=document.createElement('span');o.className='efx-value';wrap.append(l,k,o);
 function set(v){v=lim(v,0,1);k.dataset.value=v;k.style.setProperty('--angle',((v-.5)*270)+'deg');k.setAttribute('aria-valuenow',Math.round(v*100));o.textContent=String(Math.round(v*100));callback(v)}
 let start=null;
 k.addEventListener('pointerdown',e=>{e.preventDefault();start={y:e.clientY,value:Number(k.dataset.value)};k.setPointerCapture(e.pointerId)});
 k.addEventListener('pointermove',e=>{if(!start)return;set(start.value+(start.y-e.clientY)/(e.shiftKey?600:180))});
 k.addEventListener('pointerup',()=>start=null);k.addEventListener('pointercancel',()=>start=null);
 k.addEventListener('keydown',e=>{if(['ArrowUp','ArrowRight','ArrowDown','ArrowLeft'].includes(e.key)){e.preventDefault();set(Number(k.dataset.value)+(['ArrowUp','ArrowRight'].includes(e.key)?0.01:-0.01))}});
 set(value);$e(id).append(wrap);
}
function setStatus(){let t=globalBpm||S.bpm;$e('bpm').textContent=Math.round(S.bpm||t);$e('time').textContent=Math.round(60000/(S.bpm||120)*S.division)+'ms';$e('jogval').textContent=Math.round(S.jogPosition*100)+'%';}
function effectButtons(id,arr,key){
 let area=$e(id);for(const type of arr){const b=document.createElement('button');b.textContent=type;b.title=type;b.onclick=()=>{S[key]=type;for(const btn of area.children)btn.classList.toggle('active',btn===b);updateFX()};area.append(b)};area.children[arr.indexOf(S[key])].classList.add('active');
}
function makeBranch(input,output){
 let dry=ctx.createGain(),wet=ctx.createGain(),sum=ctx.createGain();
 input.connect(dry).connect(sum);wet.connect(sum);sum.connect(output);
 return {input,output,dry,wet};
}
function audioChain(src,nodes,dest){let end=src;for(const n of nodes){end.connect(n);end=n}end.connect(dest)}
function createBeat(){
 const input=ctx.createGain(),output=ctx.createGain(),branch=makeBranch(input,output), paths={};
 for(const type of BEAT){
   let gain=ctx.createGain();gain.gain.value=0;gain.connect(branch.wet);
   let nodes={gain};
   if(['DELAY','ECHO','PITCH ECHO'].includes(type)){
     nodes.delay=ctx.createDelay(4);nodes.feedback=ctx.createGain();nodes.lp=ctx.createBiquadFilter();nodes.lp.type='lowpass';
     input.connect(nodes.delay).connect(nodes.lp).connect(gain);
     nodes.delay.connect(nodes.feedback).connect(nodes.delay);
   }else if(type==='TRANS'){
     nodes.gate=ctx.createGain();input.connect(nodes.gate).connect(gain);
     nodes.lfo=ctx.createOscillator();nodes.lfo.type='square';nodes.scale=ctx.createGain();nodes.lfo.connect(nodes.scale).connect(nodes.gate.gain);nodes.lfo.start();
   }else if(type==='FLANGER'){
     nodes.delay=ctx.createDelay(.1);nodes.feedback=ctx.createGain();nodes.lfo=ctx.createOscillator();nodes.lfo.type='sine';nodes.scale=ctx.createGain();
     input.connect(nodes.delay).connect(gain);nodes.delay.connect(nodes.feedback).connect(nodes.delay);nodes.lfo.connect(nodes.scale).connect(nodes.delay.delayTime);nodes.lfo.start();
   }else if(type==='FILTER'){
     nodes.filter=ctx.createBiquadFilter();nodes.filter.type='lowpass';input.connect(nodes.filter).connect(gain);
   }else if(type==='PHASER'){
     nodes.stages=Array.from({length:4},()=>{let a=ctx.createBiquadFilter();a.type='allpass';return a});audioChain(input,nodes.stages,gain);
     nodes.lfo=ctx.createOscillator();nodes.scale=ctx.createGain();nodes.lfo.connect(nodes.scale);for(const st of nodes.stages)nodes.scale.connect(st.frequency);nodes.lfo.start();
   }
   paths[type]=nodes;
 }
 return {...branch,paths};
}
function createJog(){
 const input=ctx.createGain(),output=ctx.createGain(),branch=makeBranch(input,output),paths={};
 for(const type of JOG){
   let gain=ctx.createGain();gain.gain.value=0;gain.connect(branch.wet);let n={gain};
   if(type==='JET'){n.delay=ctx.createDelay(.1);n.feedback=ctx.createGain();input.connect(n.delay).connect(gain);n.delay.connect(n.feedback).connect(n.delay)}
   else if(type==='WAH'){n.filter=ctx.createBiquadFilter();n.filter.type='bandpass';input.connect(n.filter).connect(gain)}
   else if(type==='PHASE SHIFTER'){n.stages=Array.from({length:4},()=>{let a=ctx.createBiquadFilter();a.type='allpass';return a});audioChain(input,n.stages,gain)}
   else if(type==='RING'){n.ring=ctx.createGain();n.osc=ctx.createOscillator();n.mod=ctx.createGain();n.ring.gain.value=.5;n.osc.connect(n.mod).connect(n.ring.gain);n.osc.start();input.connect(n.ring).connect(gain)}
   else if(type==='ZIP'){n.filter=ctx.createBiquadFilter();n.filter.type='highpass';n.shape=ctx.createWaveShaper();n.shape.curve=Float32Array.from({length:256},(_,i)=>Math.tanh((i/127.5-1)*3));input.connect(n.filter).connect(n.shape).connect(gain)}
   else if(type==='HUMANIZER'){n.f1=ctx.createBiquadFilter();n.f1.type='peaking';n.f2=ctx.createBiquadFilter();n.f2.type='peaking';input.connect(n.f1).connect(n.f2).connect(gain)}
   else if(type==='VOCODER'){n.filter=ctx.createBiquadFilter();n.filter.type='bandpass';n.ring=ctx.createGain();n.osc=ctx.createOscillator();n.mod=ctx.createGain();n.ring.gain.value=.5;n.osc.connect(n.mod).connect(n.ring.gain);n.osc.start();input.connect(n.filter).connect(n.ring).connect(gain)}
   paths[type]=n;
 }
 return {...branch,paths};
}
function route(){if(!fx)return;const {input,beat,jog,output}=fx;
 try{input.disconnect();beat.output.disconnect();jog.output.disconnect()}catch(e){}
 if(S.flow==='jog-beat'){input.connect(jog.input);jog.output.connect(beat.input);beat.output.connect(output)}
 else{input.connect(beat.input);beat.output.connect(jog.input);jog.output.connect(output)}
}
function updateFX(){
 if(!fx)return;
 let d=fx.beat,j=fx.jog,now=ctx.currentTime,sec=60/lim(S.bpm,40,250)*S.division;
 d.dry.gain.setTargetAtTime(S.onBeat?1-S.beatMix:1,now,.015);
 d.wet.gain.setTargetAtTime(S.onBeat?S.beatMix:0,now,.015);
 j.dry.gain.setTargetAtTime(S.onJog?1-S.jogMix:1,now,.015);
 j.wet.gain.setTargetAtTime(S.onJog?S.jogMix:0,now,.015);
 for(const [name,n] of Object.entries(d.paths)){
 n.gain.gain.setTargetAtTime(name===S.beat?1:0,now,.015);
 if(n.delay){n.delay.delayTime.setTargetAtTime(name==='FLANGER'?.003+S.character*.005:lim(sec,.01,3.9),now,.01);n.feedback.gain.value=name==='DELAY'?.03:name==='ECHO'?.52:S.depth*.47}
 if(n.lp)n.lp.frequency.value=name==='PITCH ECHO'?500+S.character*4500:12000;
 if(n.gate){n.gate.gain.value=.5;n.lfo.frequency.value=1/Math.max(.03,sec);n.scale.gain.value=S.depth*.5}
 if(name==='FLANGER') {n.lfo.frequency.value=.12+S.character*3;n.scale.gain.value=.002+S.depth*.002}
 if(n.filter){n.filter.frequency.value=180+S.character*12000;n.filter.Q.value=.5+S.depth*12}
 if(n.stages){for(const stage of n.stages){stage.frequency.value=500+S.character*4000;stage.Q.value=.5+S.depth*5}n.lfo.frequency.value=.1+S.depth*3;n.scale.gain.value=200+S.character*300}
 }
 for(const [name,n] of Object.entries(j.paths)){
 n.gain.gain.setTargetAtTime(name===S.jog?1:0,now,.015);
 const x=S.jogPosition,frequency=100*Math.pow(100,x);
 if(n.delay){n.delay.delayTime.setTargetAtTime(.001+x*.018,now,.015);n.feedback.gain.value=S.jogDepth*.6}
 if(n.filter){n.filter.frequency.setTargetAtTime(frequency,now,.02);n.filter.Q.value=1+S.jogDepth*16}
 if(n.stages)for(const stage of n.stages){stage.frequency.setTargetAtTime(250+x*6500,now,.02);stage.Q.value=1+S.jogDepth*5}
 if(n.osc)n.osc.frequency.setTargetAtTime(20+Math.pow(x,2)*1600,now,.02);
 if(n.mod)n.mod.gain.value=.25+S.jogDepth*.25;
 if(n.f1){n.f1.frequency.value=300+x*750;n.f1.Q.value=2;n.f1.gain.value=10*S.jogDepth;n.f2.frequency.value=900+x*2100;n.f2.Q.value=3;n.f2.gain.value=10*S.jogDepth}
 }
}
window.initEFXAudio=function(){
 ctx=audioCtx;
 let input=ctx.createGain(),output=ctx.createGain();
 const beat=createBeat(),jog=createJog();
 fx={input,output,beat,jog};route();updateFX();
 masterIn.connect(input);return output;
};
function setJog(v){S.jogPosition=lim(v,0,1);if(S.rec){const t=performance.now()-S.recordStart;if(t<=8000)S.memory.push([t,S.jogPosition]);else{S.rec=false;$e('rec').classList.remove('efx-on')}}updateFX();setStatus()}
function bindJog(){
 const el=$e('jog'),pos=e=>{const r=el.getBoundingClientRect();let dx=e.clientX-r.left-r.width/2,dy=e.clientY-r.top-r.height/2;return (Math.atan2(dx,-dy)+Math.PI)/(Math.PI*2)};
 let active=false;el.addEventListener('pointerdown',e=>{active=true;el.setPointerCapture(e.pointerId);setJog(pos(e))});
 el.addEventListener('pointermove',e=>{if(active)setJog(pos(e))});
 el.addEventListener('pointerup',()=>{active=false;if(!S.hold)setJog(.5)});
 el.addEventListener('pointercancel',()=>{active=false;if(!S.hold)setJog(.5)});
}
function replay(){
 if(!S.memory.length)return;S.memoryPlay=!S.memoryPlay;$e('replay').classList.toggle('efx-on',S.memoryPlay);
 if(!S.memoryPlay)return;
 let start=performance.now(),duration=S.memory[S.memory.length-1][0];
 function frame(t){if(!S.memoryPlay)return;let elapsed=t-start;if(elapsed>=duration){if(!$e('replay-loop').checked){S.memoryPlay=false;$e('replay').classList.remove('efx-on');return}start=t;elapsed=0}
 let i=0;while(i<S.memory.length-1&&S.memory[i+1][0]<elapsed)i++;const a=S.memory[i],b=S.memory[Math.min(i+1,S.memory.length-1)],f=b[0]>a[0]?(elapsed-a[0])/(b[0]-a[0]):0;setJog(a[1]+(b[1]-a[1])*f);requestAnimationFrame(frame)}
 requestAnimationFrame(frame);
}
function init(){
 effectButtons('beats',BEAT,'beat');effectButtons('jogs',JOG,'jog');
 knob('beatdepth','DEPTH',S.depth,v=>{S.depth=v;updateFX()});
 knob('beatchar','CHARACTER',S.character,v=>{S.character=v;updateFX()});
 knob('beatmix','MIX',S.beatMix,v=>{S.beatMix=v;updateFX()});
 knob('jogdepth','DEPTH',S.jogDepth,v=>{S.jogDepth=v;updateFX()});
 knob('jogchar','CHARACTER',S.jogCharacter,v=>{S.jogCharacter=v;updateFX()});
 knob('jogmix','MIX',S.jogMix,v=>{S.jogMix=v;updateFX()});
 for(const div of [0.125,.25,.5,.75,1,2,4,8]){let b=document.createElement('button');b.textContent=div+'×';b.onclick=()=>{S.division=div;for(const x of $e('beatsel').children)x.classList.toggle('active',x===b);setStatus();updateFX()};if(div===1)b.classList.add('active');$e('beatsel').append(b)}
 $e('onbeat').onclick=()=>{S.onBeat=!S.onBeat;$e('onbeat').classList.toggle('efx-on',S.onBeat);updateFX()};
 $e('onjog').onclick=()=>{S.onJog=!S.onJog;$e('onjog').classList.toggle('efx-on',S.onJog);updateFX()};
 $e('flow').onchange=e=>{S.flow=e.target.value;route()};
 $e('tap').onclick=()=>{let t=performance.now();if(S.lastTap&&t-S.lastTap<2000){let instant=60000/(t-S.lastTap);S.bpm=lim(S.bpm*.35+instant*.65,40,250)}S.lastTap=t;setStatus();updateFX()};
 $e('sync').onclick=()=>{S.bpm=globalBpm||120;setStatus();updateFX()};
 $e('hold').onclick=()=>{S.hold=!S.hold;$e('hold').classList.toggle('efx-on',S.hold);if(!S.hold)setJog(.5)};
 $e('rec').onclick=()=>{S.rec=!S.rec;S.memory=[];S.recordStart=performance.now();$e('rec').classList.toggle('efx-on',S.rec)};
 $e('replay').onclick=replay;
 bindJog();setStatus();
}
init();
})();