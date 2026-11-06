/* MASTER LAB 2.6 — physical-device-aware virtual FOH routing, multitrack recorder,
   MIDI events visualizer, skins, workspace persistence. No invented hardware channels. */
(function(){
'use strict';
const by=id=>document.getElementById('ml26-'+id);
const limit=(v,min,max)=>Math.min(max,Math.max(min,v));
const inputNames=['DECK A L','DECK A R','DECK B L','DECK B R','EXT IN L','EXT IN R'];
const outNames=['MAIN L','MAIN R','AUX L','AUX R'];
const defaultRoutes=()=>inputNames.map((s,i)=>outNames.map((d,j)=>i<4&&(i%2===j)?1:0));
const state={savedRack:null,version:2,skin:'console',routes:defaultRoutes(),volumes:Array(6).fill(1),widgets:['clock','audio','bpm','midi'],
 tracks:[{name:'MAIN MIX',bus:'main'},{name:'AUX STEM',bus:'aux'},{name:'DECK A',bus:'a'},{name:'DECK B',bus:'b'}],
 midiEvents:[],midiFilter:-1,monitor:false,selectedInput:'',recordMimes:[]};
let graph=null,extStream=null,externalSource=null,activeRecordings=new Map(),finished=new Map(),lastMidiAt=0;
const banner=msg=>{let node=by('state');if(node)node.textContent=msg;};
const now=()=>new Date().toLocaleTimeString('cs-CZ');
function readPrefs(){
 try{const raw=localStorage.getItem('masterlab26-workspace');if(!raw)return;let data=JSON.parse(raw);
  if(data.version!==2)return;if(data.rack&&typeof data.rack==='object')state.savedRack=data.rack;
  if(['console','british','vintage','blackout','modular','industrial'].includes(data.skin))state.skin=data.skin;
  if(Array.isArray(data.routes)&&data.routes.length===6&&data.routes.every(r=>Array.isArray(r)&&r.length===4))state.routes=data.routes.map(r=>r.map(v=>limit(Number(v)||0,0,2)));
  if(Array.isArray(data.volumes)&&data.volumes.length===6)state.volumes=data.volumes.map(v=>limit(Number(v)||0,0,2));
  if(Array.isArray(data.widgets))state.widgets=data.widgets.filter(x=>['clock','audio','bpm','midi','devices','rec','cpu'].includes(x));
  if(Array.isArray(data.tracks)&&data.tracks.length<=12)state.tracks=data.tracks.filter(x=>x&&typeof x.name==='string'&&['main','aux','a','b','ext'].includes(x.bus)).map(x=>({name:x.name.slice(0,80),bus:x.bus}));
 }catch(e){banner('WORKSPACE: invalid saved state')}
}
function serialize(){
 return {version:2,skin:state.skin,routes:state.routes,volumes:state.volumes,widgets:state.widgets,tracks:state.tracks,rack:(typeof rackDefs!=='undefined'&&typeof rack!=='undefined')?Object.fromEntries(rackDefs.map(d=>[d.id,{enabled:rack[d.id]?.enabled,vals:rack[d.id]?.vals}])):null};
}
function restoreRack(){
 if(!state.savedRack||typeof rackDefs==='undefined'||typeof rack==='undefined')return;
 for(const def of rackDefs){const saved=state.savedRack[def.id],target=rack[def.id];if(!saved||!target)continue;
  if(typeof saved.enabled==='boolean'&&saved.enabled!==target.enabled){
   const toggle=document.querySelector('#unit-'+def.id+' .heading button');if(toggle)toggle.click();
  }
  for(let i=0;i<def.controls.length;i++){const key=def.controls[i][0],value=saved.vals?.[key];if(typeof value!=='number'||!Number.isFinite(value))continue;
   const input=document.querySelectorAll('#unit-'+def.id+' input[type=range]')[i];if(input){input.value=value;input.dispatchEvent(new Event('input',{bubbles:true}))}
  }
 }
 state.savedRack=null;
}
function savePrefs(){try{localStorage.setItem('masterlab26-workspace',JSON.stringify(serialize()));by('save-led').textContent='● SAVED'}catch(e){banner('SAVE: '+e.message)}}
function download(name,content,mime){let blob=new Blob([content],{type:mime}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000)}
function applySkin(){document.body.dataset.mlSkin=state.skin;by('skin').value=state.skin}
function drawMatrix(){
 const tbl=by('matrix');tbl.replaceChildren();
 let top=document.createElement('tr');const first=document.createElement('th');first.textContent='SOURCE';top.append(first);
 outNames.forEach(name=>{let th=document.createElement('th');th.textContent=name;top.append(th)});tbl.append(top);
 inputNames.forEach((name,i)=>{
 let tr=document.createElement('tr'),th=document.createElement('th');th.textContent=name;tr.append(th);
 outNames.forEach((o,j)=>{let td=document.createElement('td'),field=document.createElement('input');field.type='number';field.step='.05';field.min='0';field.max='2';field.title=name+' → '+o;field.setAttribute('aria-label',name+' to '+o);field.value=state.routes[i][j].toFixed(2);field.addEventListener('change',()=>{state.routes[i][j]=limit(Number(field.value)||0,0,2);field.value=state.routes[i][j].toFixed(2);updateGraph();savePrefs()});td.append(field);tr.append(td)});tbl.append(tr)});
}
function drawLevels(){
 const area=by('levels');area.replaceChildren();
 inputNames.forEach((name,i)=>{
 const row=document.createElement('div');row.className='ml26-route';let label=document.createElement('span');label.textContent=name;row.append(label);
 const slider=document.createElement('input');slider.type='range';slider.min='0';slider.max='2';slider.step='.01';slider.value=state.volumes[i];slider.title='INPUT TRIM '+name;slider.setAttribute('aria-label','Input volume '+name);
 const out=document.createElement('output');out.textContent=Math.round(state.volumes[i]*100)+'%';slider.oninput=()=>{state.volumes[i]=Number(slider.value);out.textContent=Math.round(state.volumes[i]*100)+'%';updateGraph();savePrefs()};
 const group=document.createElement('div');group.style.gridColumn='span 3';group.append(slider);row.append(group,out);area.append(row)
 });
}
function createGraph(ctx){
 const srcs=Array.from({length:6},()=>ctx.createGain());
 const main=ctx.createChannelMerger(2),aux=ctx.createChannelMerger(2),gainNodes=[];
 for(let i=0;i<6;i++){
  const row=[];for(let j=0;j<4;j++){
   let gain=ctx.createGain();srcs[i].connect(gain);
   gain.connect(j<2?main:aux,0,j%2);row.push(gain)
  }gainNodes.push(row);
 }
 const auxMonitor=ctx.createMediaStreamDestination();aux.connect(auxMonitor);
 const deckRecorders={};
 let mainRec=ctx.createMediaStreamDestination(),aRec=ctx.createMediaStreamDestination(),bRec=ctx.createMediaStreamDestination(),extRec=ctx.createMediaStreamDestination();
 main.connect(masterIn); // Main bus continues into all existing mastering, SPEQTR and output processing.
 graph={ctx,srcs,main,aux,auxMonitor,gainNodes,records:{main:mainRec,aux:auxMonitor,a:aRec,b:bRec,ext:extRec},deckRecorders};
 updateGraph();return graph;
}
function updateGraph(){
 if(!graph)return;const at=graph.ctx.currentTime;
 graph.gainNodes.forEach((r,i)=>r.forEach((node,j)=>node.gain.setTargetAtTime(state.routes[i][j]*state.volumes[i],at,.01)));
}
window.ml26Routing={
 attachDeck(d){
  if(!audioCtx)return;
  if(!graph)createGraph(audioCtx);
  if(d._ml26Attached)return;
  const splitter=audioCtx.createChannelSplitter(2);
  d.analyser.connect(splitter);
  const off=d.id==='A'?0:2;
  splitter.connect(graph.srcs[off],0);splitter.connect(graph.srcs[off+1],1);
  d.analyser.connect(graph.records[d.id.toLowerCase()]);
  d._ml26Attached=true;
 },
 attachMaster(){
  if(!graph||graph._masterTap)return;
  anMaster.connect(graph.records.main);graph._masterTap=true;
 },
 getRecordingBus(bus){return graph?.records?.[bus]||null}
};
async function enumerate(){
 const el=by('devices');el.replaceChildren();
 let devices=[];
 try{if(window.AndroidMasterLab?.getAudioDevices)devices=JSON.parse(window.AndroidMasterLab.getAudioDevices())}catch(e){banner('DEVICE SCAN: '+e.message)}
 devices.forEach(d=>{let node=document.createElement('div');node.className='st-device';
  const type=d.input?'IN':d.output?'OUT':'PORT',channels=Array.isArray(d.channelCounts)&&d.channelCounts.length?d.channelCounts.join('/'): '?';
  node.textContent=type+' · '+d.name+' · CH '+channels+' · '+(d.sampleRates||[]).slice(0,5).join('/')+' Hz';el.append(node)});
 if(!devices.length){let node=document.createElement('div');node.className='st-device';node.textContent='Android output/input profile not exposed';el.append(node)}
 try{const usb=window.AndroidMasterLab?.getUsbTopology?JSON.parse(window.AndroidMasterLab.getUsbTopology()):[];
 for(const d of usb){const classes=(d.interfaces||[]).map(i=>i.class===1?'AUDIO'+(i.subclass===3?'/MIDI':''):i.class===9?'HUB':'CLASS '+i.class).join(',');
 const entry=document.createElement('div');entry.className='st-device';entry.textContent='USB · '+d.name+' · '+d.vendorId+':'+d.productId+' · '+(classes||'NO INTERFACES');el.append(entry)}
 }catch(e){banner('USB SCAN: '+e.message)}
 const pick=by('ext-input');let last=pick.value||state.selectedInput;pick.replaceChildren(new Option('SYSTEM DEFAULT',''));
 try{if(navigator.mediaDevices?.enumerateDevices){
  let list=await navigator.mediaDevices.enumerateDevices();
  for(const d of list.filter(x=>x.kind==='audioinput'))pick.add(new Option(d.label||'Audio Input',d.deviceId));
  if([...pick.options].some(o=>o.value===last))pick.value=last;
 }}catch(e){}
 by('device-total').textContent='ANDROID DEVICES '+devices.length+' · '+now();
 return devices;
}
async function connectExternal(){
 if(!navigator.mediaDevices?.getUserMedia){banner('CAPTURE: unsupported by this WebView');return}
 try{
  if(extStream){extStream.getTracks().forEach(t=>t.stop());extStream=null}
  const id=by('ext-input').value;
  extStream=await navigator.mediaDevices.getUserMedia({audio:{...(id?{deviceId:{ideal:id}}:{}),channelCount:{ideal:2},echoCancellation:false,noiseSuppression:false,autoGainControl:false}});
  initAudio();
  if(!graph)createGraph(audioCtx);
  if(externalSource)try{externalSource.disconnect()}catch(e){}
  externalSource=audioCtx.createMediaStreamSource(extStream);
  let split=audioCtx.createChannelSplitter(2);externalSource.connect(split);
  split.connect(graph.srcs[4],0);split.connect(graph.srcs[5],1);
  externalSource.connect(graph.records.ext);
  const settings=extStream.getAudioTracks()[0]?.getSettings?.()||{};
  by('ext-status').textContent='IN ACTIVE · '+(settings.channelCount||'?')+' CH · '+(settings.sampleRate||'?')+' Hz';
  state.selectedInput=id;banner('EXT IN ACTIVE · route carefully to avoid feedback');savePrefs();
 }catch(e){banner('CAPTURE: '+e.message);by('ext-status').textContent='INPUT UNAVAILABLE'}
}
function stopExternal(){if(extStream){extStream.getTracks().forEach(t=>t.stop());extStream=null}if(externalSource){externalSource.disconnect();externalSource=null}by('ext-status').textContent='INPUT OFF'}
function buildTracks(){
 let el=by('tracks');el.replaceChildren();
 state.tracks.forEach((t,i)=>{
  let row=document.createElement('div');row.className='ml26-track';
  let name=document.createElement('input');name.value=t.name;name.setAttribute('aria-label','Track name');name.onchange=()=>{t.name=name.value.slice(0,80)||'TRACK '+(i+1);savePrefs()};
  let bus=document.createElement('select');for(let b of ['main','aux','a','b','ext'])bus.add(new Option(b.toUpperCase(),b));bus.value=t.bus;
  bus.onchange=()=>{t.bus=bus.value;savePrefs()};
  let rec=document.createElement('button');rec.textContent='● REC';rec.onclick=()=>toggleRecording(i,rec);
  let dl=document.createElement('button');dl.textContent='↧';dl.title='Download last recording';dl.onclick=()=>downloadRecording(i);
  let remove=document.createElement('button');remove.textContent='×';remove.onclick=()=>{if(activeRecordings.has(i))return;state.tracks.splice(i,1);savePrefs();buildTracks()};
  row.append(name,bus,rec,dl,remove);
  let meter=document.createElement('div');meter.className='ml26-meter';let fill=document.createElement('span');meter.append(fill);meter.style.gridColumn='1/-1';row.append(meter);el.append(row)
 });
}
function formatExt(mime){return mime.includes('mp4')?'m4a':mime.includes('ogg')?'ogg':'webm'}
function preferredMime(){const choices=['audio/webm;codecs=opus','audio/mp4','audio/ogg;codecs=opus','audio/webm'];return choices.find(t=>window.MediaRecorder?.isTypeSupported(t))||''}
async function toggleRecording(i,btn){
 let active=activeRecordings.get(i);if(active){if(active.state!=='inactive')active.stop();return}
 if(!window.MediaRecorder){banner('MediaRecorder unavailable');return}
 try{initAudio();const bus=state.tracks[i]?.bus;let stream=window.ml26Routing.getRecordingBus(bus)?.stream;
  if(!stream)throw Error('No routed bus for '+bus);
  if(bus==='main')window.ml26Routing.attachMaster();
  const mime=preferredMime();if(!mime)throw Error('No supported audio encoder');
  let chunks=[],rec=new MediaRecorder(stream,{mimeType:mime,audioBitsPerSecond:192000});
  rec.ondataavailable=e=>{if(e.data.size)chunks.push(e.data)};
  rec.onstop=()=>{activeRecordings.delete(i);finished.set(i,{blob:new Blob(chunks,{type:mime}),mime,time:Date.now()});btn.classList.remove('active');btn.textContent='● REC';banner('TRACK '+(i+1)+' REC SAVED')};
  rec.onerror=e=>banner('REC ERROR '+(e.error?.message||'unknown'));
  rec.start(300);activeRecordings.set(i,rec);btn.classList.add('active');btn.textContent='■ STOP';
 }catch(e){banner('RECORD: '+e.message)}
}
async function downloadRecording(i){
 const item=finished.get(i);if(!item){banner('No recording on track '+(i+1));return}
 const ext=formatExt(item.mime),name=(state.tracks[i]?.name||'Track').replace(/[^a-zA-Z0-9_-]/g,'_').slice(0,45);
 download('MASTER-LAB_'+name+'_'+item.time+'.'+ext,item.blob,item.mime)
}
function saveSnapshot(){download('MASTER-LAB-workspace-v2.json',JSON.stringify(serialize(),null,2),'application/json')}
function restoreSnapshot(file){if(!file)return;file.text().then(t=>{let p=JSON.parse(t);if(p.version!==2)throw Error('Unsupported workspace version');localStorage.setItem('masterlab26-workspace',t);readPrefs();applySkin();restoreRack();drawMatrix();drawLevels();buildTracks();drawWidgets();banner('WORKSPACE IMPORTED')}).catch(e=>banner('IMPORT: '+e.message))}
function drawWidgets(){
 const area=by('widgets');area.replaceChildren();const list=['clock','audio','bpm','midi','devices','rec','cpu'];
 for(const id of list){
  if(!state.widgets.includes(id))continue;
  const tile=document.createElement('div');tile.className='ml26-widget';let label=document.createElement('strong');label.textContent=id.toUpperCase();
  let out=document.createElement('output');out.id='ml26-widget-'+id;out.textContent='—';let x=document.createElement('button');x.textContent='×';x.title='Remove widget';
  x.onclick=()=>{state.widgets=state.widgets.filter(a=>a!==id);savePrefs();drawWidgets()};
  tile.append(label,out,x);area.append(tile)
 }
}
function addWidget(){
 const id=by('widget-choice').value;if(!state.widgets.includes(id)){state.widgets.push(id);savePrefs();drawWidgets()}
}
const MIDI={notes:[],held:new Map(),origin:performance.now(),offset:0,count:0};
function midiEvent(event){
 const data=event.data||[],cmd=data[0]&0xf0,ch=data[0]&15,note=data[1],vel=data[2],time=performance.now();
 if(![0x80,0x90].includes(cmd))return;
 if(state.midiFilter!==-1&&state.midiFilter!==ch)return;
 const key=ch+'-'+note,down=cmd===0x90&&vel>0;
 if(down){MIDI.held.set(key,{note,ch,vel,start:time});MIDI.count++}
 else{const start=MIDI.held.get(key);if(start){MIDI.notes.push({...start,end:time});MIDI.held.delete(key)}}
 if(MIDI.notes.length>2000)MIDI.notes.splice(0,500);
 lastMidiAt=time;
}
function drawMidi(){
 const canvas=by('piano');if(!canvas)return;
 const box=canvas.getBoundingClientRect();let w=Math.max(240,Math.round(box.width)),h=190;
 if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h}
 const ctx=canvas.getContext('2d');ctx.fillStyle='#091921';ctx.fillRect(0,0,w,h);
 const low=36,high=96,left=33,rows=high-low,step=h/rows,pxSec=70,right=performance.now(),start=right-(w-left)/pxSec*1000;
 for(let n=low;n<high;n++){let y=h-(n-low+1)*step;const semitone=n%12;
  ctx.fillStyle=[1,3,6,8,10].includes(semitone)?'#14242f':'#1b323a';ctx.fillRect(0,y,left,step);
  ctx.strokeStyle='#19323d';ctx.beginPath();ctx.moveTo(left,y);ctx.lineTo(w,y);ctx.stroke();
  if(n%12===0){ctx.fillStyle='#b0d4d8';ctx.font='8px monospace';ctx.fillText('C'+(Math.floor(n/12)-1),2,y+7)}
 }
 for(let x=left;x<w;x+=pxSec/2){ctx.strokeStyle='#25424b';ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,h);ctx.stroke()}
 const events=[...MIDI.notes,...MIDI.held.values()].filter(e=>e.note>=low&&e.note<high);
 for(const e of events){let begin=left+(e.start-start)/1000*pxSec,end=left+((e.end||right)-start)/1000*pxSec;if(end<left||begin>w)continue;
  ctx.fillStyle=['#36d3cb','#e7b352','#c089ee','#68a8f6'][e.ch%4];ctx.fillRect(Math.max(left,begin),h-(e.note-low+1)*step,Math.max(2,end-Math.max(left,begin)),Math.max(2,step-1))}
 by('note-count').textContent=MIDI.count+' NOTES · '+MIDI.held.size+' HELD';
 requestAnimationFrame(drawMidi);
}
function nativeMidiRefresh(){
 const select=by('native-midi');if(!select)return;
 select.replaceChildren(new Option('USB MIDI INPUT',''));
 try{let list=window.AndroidMasterLab?.getMidiDevices?JSON.parse(window.AndroidMasterLab.getMidiDevices()):[];
 for(const dev of list){for(let port=0;port<(dev.outputs||0);port++){select.add(new Option(dev.name+' / OUT '+(port+1),dev.id+':'+port))}}
 }catch(e){banner('MIDI DEVICES: '+e.message)}
}
function nativeMidiConnect(){
 const v=by('native-midi').value;if(!v||!window.AndroidMasterLab?.connectMidiDevice){banner('Native USB MIDI unavailable');return}
 const [id,port]=v.split(':').map(Number);window.AndroidMasterLab.connectMidiDevice(id,port);
 banner('NATIVE MIDI PORT REQUESTED: '+v)
}
function attachMidi(){
 window.addEventListener('masterlab-native-midi',e=>midiEvent({data:e.detail}));
 // Hook original MIDI handler without stealing MIDI clock or transport.
 try{if(typeof handleMidi==='function'){const original=handleMidi;handleMidi=function(e){midiEvent(e);return original(e)};banner('MIDI visualization ready')}}catch(e){}
}
function updateWidgets(){
 for(const id of state.widgets){let out=by('widget-'+id);if(!out)continue;
  let t={clock:now(),audio:typeof audioCtx!=='undefined'&&audioCtx?audioCtx.sampleRate+' Hz':'OFF',
   bpm:typeof globalBpm!=='undefined'?globalBpm+' BPM':'—',midi:MIDI.count+' NOTES',
   devices:by('device-total')?.textContent?.split(' · ')[0]||'—',
   rec:activeRecordings.size+' REC',cpu:'DSP / ACTIVE'};out.textContent=t[id]||'—'
 }
}
readPrefs();applySkin();restoreRack();drawMatrix();drawLevels();buildTracks();drawWidgets();attachMidi();drawMidi();
by('skin').onchange=e=>{state.skin=e.target.value;applySkin();savePrefs()};
by('save').onclick=()=>{savePrefs();saveSnapshot()};
by('load').onclick=()=>by('file').click();
by('file').onchange=e=>restoreSnapshot(e.target.files[0]);
by('add-widget').onclick=addWidget;
by('add-track').onclick=()=>{if(state.tracks.length>=12)return;state.tracks.push({name:'TRACK '+(state.tracks.length+1),bus:'aux'});savePrefs();buildTracks()};
by('scan').onclick=()=>{enumerate();nativeMidiRefresh()};
by('midi-connect').onclick=nativeMidiConnect;
by('connect-ext').onclick=connectExternal;
by('disconnect-ext').onclick=stopExternal;
by('midi-filter').onchange=e=>state.midiFilter=Number(e.target.value);
by('reset-routing').onclick=()=>{state.routes=defaultRoutes();state.volumes.fill(1);drawMatrix();drawLevels();updateGraph();savePrefs()};
by('bt').onclick=()=>window.AndroidMasterLab?.openBluetoothSettings?.();
by('sound').onclick=()=>window.AndroidMasterLab?.openSoundSettings?.();
addEventListener('pagehide',savePrefs);addEventListener('error',()=>{try{savePrefs()}catch(e){}});
setInterval(()=>{savePrefs();updateWidgets()},4000);
enumerate();nativeMidiRefresh();
banner('READY · VIRTUAL FOH / PHYSICAL DEVICE DIAGNOSTICS');
})();