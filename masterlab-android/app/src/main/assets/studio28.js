/* MASTER LAB 2.8 — Korg TRITON taktile MIDI + analog capture, physical output checks. */
(function(){
'use strict';
const el=id=>document.getElementById('ml28-'+id);
const channels=['MASTER','DECK A','DECK B','GLOBAL BPM'];
let profile={model:'TRITON TAKTILE',cc:{},last:{},assigned:'',device:'',input:''};
try{const x=JSON.parse(localStorage.getItem('masterlab28-korg')||'null');if(x&&x.model==='TRITON TAKTILE'&&typeof x.cc==='object')profile={...profile,...x}}catch(e){}
const state=t=>{const n=el('status');if(n)n.textContent=t};
const save=()=>{try{localStorage.setItem('masterlab28-korg',JSON.stringify(profile))}catch(e){}};
function readDevices(){
 const sel=el('output');if(!sel)return;const previous=sel.value;sel.replaceChildren(new Option('PHYSICAL OUTPUT',''));
 let list=[];try{list=JSON.parse(window.AndroidMasterLab?.getAudioDevices?.()||'[]')}catch(e){state('AUDIO DEVICE JSON ERROR')}
 for(const d of list.filter(x=>x.output)){sel.add(new Option(d.name+' · ID '+d.id+' / CH '+(d.channelCounts||[]).join('/'),String(d.id)))}
 if([...sel.options].some(x=>x.value===previous))sel.value=previous;
 const midi=el('korg-midi');midi.replaceChildren(new Option('KORG MIDI PORT',''));
 let ports=[];try{ports=JSON.parse(window.AndroidMasterLab?.getMidiDevices?.()||'[]')}catch(e){}
 for(const d of ports)for(let n=0;n<(d.outputs||0);n++){midi.add(new Option(d.name+' · PORT '+(n+1),d.id+':'+n))}
 const korg=[...midi.options].find(o=>/TRITON|TAKTILE|KORG/i.test(o.textContent));
 if(korg)midi.value=korg.value;
 state('USB: '+list.length+' AUDIO DEVICES · '+ports.length+' MIDI DEVICES');
}
function renderCC(){
 const group=el('cc-map');group.replaceChildren();
 for(const target of channels){
  const row=document.createElement('div');row.className='ml28-cc-row';
  const name=document.createElement('span');name.textContent=target;
  const btn=document.createElement('button');const bound=Object.keys(profile.cc).find(k=>profile.cc[k]===target);
  btn.textContent=profile.assigned===target?'MOVE A KORG KNOB…':bound?'CC '+bound:'LEARN';
  btn.classList.toggle('active',profile.assigned===target);
  btn.onclick=()=>{profile.assigned=profile.assigned===target?'':target;renderCC()};
  const clear=document.createElement('button');clear.textContent='×';clear.onclick=()=>{for(const k of Object.keys(profile.cc))if(profile.cc[k]===target)delete profile.cc[k];save();renderCC()};
  row.append(name,btn,clear);group.append(row);
 }
}
function applyCC(target,value){
 try{
 const n=value/127;
 if(target==='MASTER'){masterTrim=n*1.3;if(masterOut)masterOut.gain.setTargetAtTime(masterTrim,audioCtx.currentTime,.012)}
 if(target==='DECK A'&&decks.A?.trim){decks.A.trim.gain.setTargetAtTime(n*1.5,audioCtx.currentTime,.012)}
 if(target==='DECK B'&&decks.B?.trim){decks.B.trim.gain.setTargetAtTime(n*1.5,audioCtx.currentTime,.012)}
 if(target==='GLOBAL BPM'){globalBpm=Math.round(60+n*140);const lab=document.getElementById('mixerBPM');if(lab)lab.textContent=globalBpm+' BPM'}
 }catch(e){state('MIDI APPLY: '+e.message)}
}
function midi(data){
 if(!data||data.length<3)return;
 const status=data[0]&240,channel=(data[0]&15)+1;
 if(status===0x90&&data[2]!==0){el('note').textContent='CH '+channel+' · '+['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'][data[1]%12]+(Math.floor(data[1]/12)-1)+' · V '+data[2]}
 if(status===0xb0){
 const key=String(data[1]);el('cc').textContent='CC '+key+' · '+data[2]+' / CH '+channel;
 if(profile.assigned){for(const k of Object.keys(profile.cc))if(profile.cc[k]===profile.assigned)delete profile.cc[k];profile.cc[key]=profile.assigned;profile.assigned='';save();renderCC()}
 const target=profile.cc[key];if(target)applyCC(target,data[2]);
 }
}
window.addEventListener('masterlab-native-midi',e=>midi(e.detail));
const orig=window.handleMidi;
if(typeof orig==='function')window.handleMidi=function(e){midi(e.data);return orig(e)};
el('connect').onclick=()=>{
 const v=el('korg-midi').value;if(!v){state('SELECT MIDI PORT');return}
 if(window.AndroidMasterLab?.connectMidiDevice){const [id,p]=v.split(':').map(Number);window.AndroidMasterLab.connectMidiDevice(id,p);profile.device=v;save();state('KORG MIDI CONNECTION REQUESTED')}
 else{state('ANDROID MIDI BRIDGE UNAVAILABLE · USE MIDI CONNECT')}
};
el('input').onclick=()=>{
 const n=document.getElementById('ml26-ext-input');if(n)n.scrollIntoView({behavior:'smooth',block:'center'});
 state('CONNECT KORG ANALOG STEREO OUT TO USB AUDIO INTERFACE INPUT, SELECT INPUT AND ENABLE CAPTURE');
};
el('scan').onclick=readDevices;
const low=el('safety');el('test-l').onclick=()=>probe(0);el('test-r').onclick=()=>probe(1);el('test-both').onclick=()=>probe(2);
function probe(channel){
 if(!low.checked){state('CONFIRM LOW OUTPUT LEVEL FIRST');return}
 if(!el('output').value){state('SELECT OUTPUT DEVICE');return}
 if(!window.AndroidMasterLab?.probeOutput){state('NATIVE AUDIO PROBE UNAVAILABLE');return}
 try{state(window.AndroidMasterLab.probeOutput(Number(el('output').value),channel))}
 catch(e){state(e.message)}
}
el('stop').onclick=()=>{window.AndroidMasterLab?.stopOutputProbe?.();state('PROBE STOPPED')};
el('export').onclick=()=>{
 const blob=new Blob([JSON.stringify(profile,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='MASTER-LAB-KORG-profile.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),30000)
};
el('import').onclick=()=>el('import-file').click();
el('import-file').onchange=async e=>{try{const f=e.target.files[0];if(!f)return;const o=JSON.parse(await f.text());if(o.model!=='TRITON TAKTILE'||typeof o.cc!=='object')throw Error('Invalid profile');profile={...profile,cc:o.cc,assigned:''};save();renderCC();state('KORG PROFILE IMPORTED')}catch(err){state(err.message)}};
renderCC();readDevices();
setInterval(()=>{if(!window.AndroidMasterLab?.probeOutputStatus)return;try{let s=JSON.parse(window.AndroidMasterLab.probeOutputStatus());if(s.status&&s.status!=='IDLE')el('probe-state').textContent=s.status+' / ACTUAL '+s.routedId}catch(e){}},800);
})();
