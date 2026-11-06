/* MASTER LAB 2.5 - independent new studio units; preserves original 12 rack processors */
(function(){
'use strict';
const FREQ=[31,63,125,250,500,1000,2000,4000,8000,12000,16000,20000];
const STATE={
 g:{on:true,values:FREQ.map(()=>0)},p:{on:true,bands:Array.from({length:4},(_,i)=>({freq:[100,500,2500,9000][i],gain:0,q:1,type:'peaking',on:true}))},
 c:{on:true,threshold:-16,ratio:3,attack:.015,release:.3,knee:10,makeup:0,mix:1}
};
let live=null,recorder=null,recChunks=[],recDest=null,recording=false,lastUrl=null;
const $=id=>document.getElementById('st-'+id);
const clamp=(x,a,b)=>Math.min(b,Math.max(a,x));
function formatFreq(v){return v>=1000?(v/1000).toFixed(v%1000?1:0)+'k':Math.round(v)+''}
function knob(parent,label,min,max,value,step,onChange,display){
 const el=document.createElement('div');el.className='st-control';const title=document.createElement('span');title.className='st-control-label';title.textContent=label;
 const dial=document.createElement('div');dial.className='ml-dial';dial.tabIndex=0;dial.setAttribute('role','slider');dial.setAttribute('aria-label',label);
 const out=document.createElement('output');out.className='st-val';el.append(title,dial,out);parent.append(el);
 let valueNow=value;function paint(){dial.style.setProperty('--rot',(-135+(valueNow-min)/(max-min)*270)+'deg');dial.setAttribute('aria-valuemin',min);dial.setAttribute('aria-valuemax',max);dial.setAttribute('aria-valuenow',valueNow);out.textContent=display?display(valueNow):Number(valueNow).toFixed(step<1?1:0)}
 function set(v){valueNow=clamp(Math.round((v-min)/step)*step+min,min,max);paint();onChange(valueNow)}
 let start=null;dial.onpointerdown=e=>{e.preventDefault();start={y:e.clientY,v:valueNow};dial.setPointerCapture(e.pointerId)};
 dial.onpointermove=e=>{if(start)set(start.v+(start.y-e.clientY)*(max-min)/(e.shiftKey?700:175))};
 for(const name of ['pointerup','pointercancel','lostpointercapture'])dial.addEventListener(name,()=>start=null);
 dial.onkeydown=e=>{if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();set(e.key==='Home'?min:e.key==='End'?max:valueNow+(['ArrowUp','ArrowRight'].includes(e.key)?1:-1)*step)}};
 paint();return {set};
}
function makeGraphEQ(){
 const box=$('graphic-bands');FREQ.forEach((hz,i)=>{knob(box,formatFreq(hz),-15,15,0,.5,v=>{STATE.g.values[i]=v;updateAudio()},v=>(v>0?'+':'')+v.toFixed(1))});
 $('graphic-on').onclick=()=>{STATE.g.on=!STATE.g.on;$('graphic-on').classList.toggle('active',STATE.g.on);updateAudio()};
 $('graphic-reset').onclick=()=>{box.replaceChildren();STATE.g.values.fill(0);makeGraphEQKnobs();updateAudio()};
}
function makeGraphEQKnobs(){FREQ.forEach((hz,i)=>knob($('graphic-bands'),formatFreq(hz),-15,15,STATE.g.values[i],.5,v=>{STATE.g.values[i]=v;updateAudio()},v=>(v>0?'+':'')+v.toFixed(1)))}
function makeParamEQ(){
 const box=$('param-bands');
 STATE.p.bands.forEach((band,i)=>{
  const part=document.createElement('div');part.className='st-param-band';let head=document.createElement('div');head.className='st-band-head';
  let label=document.createElement('span');label.textContent='BAND '+(i+1);
  let toggle=document.createElement('button');toggle.textContent='●';toggle.className='active';toggle.onclick=()=>{band.on=!band.on;toggle.classList.toggle('active',band.on);updateAudio()};
  let select=document.createElement('select');select.setAttribute('aria-label','Filter type');for(const type of ['peaking','lowshelf','highshelf','notch','lowpass','highpass']){let opt=document.createElement('option');opt.value=type;opt.textContent={peaking:'BELL',lowshelf:'LOW SHELF',highshelf:'HIGH SHELF',notch:'NOTCH',lowpass:'LOW PASS',highpass:'HIGH PASS'}[type];select.append(opt)}select.onchange=()=>{band.type=select.value;updateAudio()};
  head.append(label,select,toggle);part.append(head);
  let controls=document.createElement('div');controls.className='st-band-knobs';part.append(controls);
  knob(controls,'FREQ',20,20000,band.freq,1,v=>{band.freq=v;updateAudio()},formatFreq);
  knob(controls,'GAIN',-18,18,band.gain,.5,v=>{band.gain=v;updateAudio()},v=>v.toFixed(1));
  knob(controls,'Q',.2,16,band.q,.1,v=>{band.q=v;updateAudio()},v=>v.toFixed(1));
  box.append(part)
 });
 $('param-on').onclick=()=>{STATE.p.on=!STATE.p.on;$('param-on').classList.toggle('active',STATE.p.on);updateAudio()};
}
function makeCompressor(){
 const ctr=$('comp-knobs');const cfg=[['THRESH',-50,0,'threshold',.5],['RATIO',1,20,'ratio',.1],['ATTACK',.001,.2,'attack',.001],['RELEASE',.01,2,'release',.01],['KNEE',0,40,'knee',.5],['MAKEUP',-12,18,'makeup',.5],['MIX',0,1,'mix',.01]];
 cfg.forEach(([label,min,max,key,step])=>knob(ctr,label,min,max,STATE.c[key],step,v=>{STATE.c[key]=v;updateAudio()},v=>key==='attack'||key==='release'?(v*1000).toFixed(0)+'ms':key==='mix'?(v*100).toFixed(0)+'%':v.toFixed(1)));
 $('comp-on').onclick=()=>{STATE.c.on=!STATE.c.on;$('comp-on').classList.toggle('active',STATE.c.on);updateAudio()};
}
function chainNodes(ctx,src,dest){
 const g=[],p=[];let current=src;
 for(let i=0;i<FREQ.length;i++){const filter=ctx.createBiquadFilter();filter.type='peaking';filter.frequency.value=Math.min(FREQ[i],ctx.sampleRate*.45);filter.Q.value=1.3;current.connect(filter);current=filter;g.push(filter)}
 for(const band of STATE.p.bands){const filter=ctx.createBiquadFilter();current.connect(filter);current=filter;p.push(filter)}
 const compressor=ctx.createDynamicsCompressor(),dry=ctx.createGain(),wet=ctx.createGain(),post=ctx.createGain();
 current.connect(dry).connect(post);current.connect(compressor).connect(wet).connect(post);post.connect(dest);
 return {g,p,compressor,dry,wet,post};
}
function apply(nodes,ctx){
 if(!nodes)return;const now=ctx.currentTime;
 nodes.g.forEach((n,i)=>{n.gain.setTargetAtTime(STATE.g.on?STATE.g.values[i]:0,now,.01)});
 nodes.p.forEach((n,i)=>{const b=STATE.p.bands[i];n.type=b.type;n.frequency.setTargetAtTime(Math.min(b.freq,ctx.sampleRate*.45),now,.01);n.Q.setTargetAtTime(b.q,now,.01);n.gain.setTargetAtTime(STATE.p.on&&b.on?b.gain:0,now,.01)});
 const c=STATE.c;nodes.compressor.threshold.setTargetAtTime(c.threshold,now,.01);nodes.compressor.ratio.setTargetAtTime(c.ratio,now,.01);nodes.compressor.knee.setTargetAtTime(c.knee,now,.01);nodes.compressor.attack.setTargetAtTime(c.attack,now,.01);nodes.compressor.release.setTargetAtTime(c.release,now,.01);
 nodes.dry.gain.setTargetAtTime(c.on?1-c.mix:1,now,.01);nodes.wet.gain.setTargetAtTime(c.on?c.mix:0,now,.01);nodes.post.gain.setTargetAtTime(Math.pow(10/correct(c.makeup),1),now,.01);
}
function correct(db){return 10**(-db/20)}
function updateAudio(){if(live&&window.audioCtx)apply(live,audioCtx)}
window.initStudio24Audio=function(upstream){
 if(!audioCtx)return upstream;const input=audioCtx.createGain(),output=audioCtx.createGain();
 upstream.connect(input);live=chainNodes(audioCtx,input,output);apply(live,audioCtx);return output;
};
window.addStudio24Offline=function(ctx,upstream){let input=ctx.createGain(),output=ctx.createGain();upstream.connect(input);const nodes=chainNodes(ctx,input,output);apply(nodes,ctx);return output};
function mimeList(){return ['audio/webm;codecs=opus','audio/mp4','audio/ogg;codecs=opus','audio/webm'].filter(t=>window.MediaRecorder&&MediaRecorder.isTypeSupported(t))}
function recordingState(v){recording=v;$('rec-start').classList.toggle('active',v);$('rec-state').textContent=v?'● REC':'■ READY'}
function setupRecorder(){
 $('rec-start').onclick=()=>{if(recording){recorder.stop();return}
 if(!window.MediaRecorder){$('rec-state').textContent='UNSUPPORTED';return}
 try{initAudio();if(!recDest){recDest=audioCtx.createMediaStreamDestination();anMaster.connect(recDest)}
 const type=mimeList()[0];if(!type)throw Error('Audio codec not supported');
 recChunks=[];recorder=new MediaRecorder(recDest.stream,{mimeType:type,audioBitsPerSecond:256000});
 recorder.ondataavailable=e=>{if(e.data.size)recChunks.push(e.data)};
 recorder.onerror=()=>{$('rec-state').textContent='ERROR'};
 recorder.onstop=()=>{recordingState(false);const ext=type.includes('mp4')?'m4a':type.includes('ogg')?'ogg':'webm';const blob=new Blob(recChunks,{type});const a=document.createElement('a');const url=URL.createObjectURL(blob);a.href=url;a.download='MASTER-LAB-REC_'+Date.now()+'.'+ext;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);$('rec-state').textContent='✓ SAVED'};
 recorder.start(250);recordingState(true);
 }catch(e){$('rec-state').textContent='ERR';status('RECORDER: '+e.message)}
 };
 $('rec-stop').onclick=()=>{if(recorder&&recording)recorder.stop()};
 $('rec-pause').onclick=()=>{if(!recorder||!recording)return;if(recorder.state==='recording'){recorder.pause();$('rec-state').textContent='Ⅱ PAUSE'}else if(recorder.state==='paused'){recorder.resume();$('rec-state').textContent='● REC'}};
}
function safeNativeList(){
 if(window.AndroidMasterLab?.getAudioDevices){try{const arr=JSON.parse(window.AndroidMasterLab.getAudioDevices());return arr.map(x=>({name:x.name,type:x.type,id:x.id}))}catch(e){}}
 return [];
}
async function devices(){
 const box=$('device-list');box.replaceChildren();
 let native=safeNativeList();for(const d of native){const node=document.createElement('div');node.className='st-device';node.textContent=d.name+' · '+d.type;box.append(node)}
 if(!native.length){const hint=document.createElement('span');hint.textContent='ANDROID AUDIO ROUTING';box.append(hint)}
 if(navigator.mediaDevices?.enumerateDevices){try{const web=await navigator.mediaDevices.enumerateDevices();const outputs=web.filter(d=>d.kind==='audiooutput');for(const d of outputs){const node=document.createElement('div');node.className='st-device';node.textContent=(d.label||'Audio Output')+' · WEB AUDIO';box.append(node)}}catch(e){}}
 if(window.audioCtx?.setSinkId){const hint=document.createElement('div');hint.textContent='WEB AUDIO SINK AVAILABLE';box.append(hint)}
}
function setupDevices(){
 $('devices-refresh').onclick=devices;
 $('bt-settings').onclick=()=>{if(window.AndroidMasterLab?.openBluetoothSettings)window.AndroidMasterLab.openBluetoothSettings();else status('Bluetooth: spravuje systém Android')};
 $('sound-settings').onclick=()=>{if(window.AndroidMasterLab?.openSoundSettings)window.AndroidMasterLab.openSoundSettings();else status('Sound: spravuje systém Android')};
 devices();
}
makeGraphEQKnobs();$('graphic-on').onclick=()=>{STATE.g.on=!STATE.g.on;$('graphic-on').classList.toggle('active',STATE.g.on);updateAudio()};
$('graphic-reset').onclick=()=>{STATE.g.values.fill(0);$('graphic-bands').replaceChildren();makeGraphEQKnobs();updateAudio()};
makeParamEQ();makeCompressor();setupRecorder();setupDevices();
})();