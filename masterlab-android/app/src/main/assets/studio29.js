/* MASTER LAB 2.9 — offline LAN WebRTC data link and simultaneous audio output diagnostic */
(function(){
'use strict';
const el=n=>document.getElementById('ml29-'+n);
let pc=null,channel=null,timing={pingSent:0,lastRtt:0},role='none',peerName='',lastConnected=0;
const banner=msg=>{if(el('status'))el('status').textContent=msg};
const sleepICE=async pc=>new Promise((resolve,reject)=>{
 if(pc.iceGatheringState==='complete')return resolve();
 const abort=setTimeout(()=>{pc.removeEventListener('icegatheringstatechange',check);resolve()},10000);
 function check(){if(pc.iceGatheringState==='complete'){clearTimeout(abort);pc.removeEventListener('icegatheringstatechange',check);resolve()}}
 pc.addEventListener('icegatheringstatechange',check)
});
const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
function close(){
 if(channel){try{channel.close()}catch(e){}channel=null}
 if(pc){try{pc.close()}catch(e){}pc=null}
 role='none';peerName='';el('peer').textContent='OFFLINE';banner('DISCONNECTED');
}
function networkAvailable(){return typeof RTCPeerConnection==='function'}
function send(packet){if(channel?.readyState!=='open'){banner('PEER NOT CONNECTED');return false}channel.send(JSON.stringify({...packet,origin:'MASTER LAB 2.9',timestamp:Date.now()}));return true}
function onMessage(ev){
 let m;try{m=JSON.parse(ev.data)}catch(e){return}
 if(m.origin!=='MASTER LAB 2.9')return;
 if(m.kind==='ping'){send({kind:'pong',id:m.id});return}
 if(m.kind==='pong'){if(m.id===timing.pingSent){timing.lastRtt=Math.round(performance.now()-m.id);el('latency').textContent='RTT '+timing.lastRtt+'ms'}return}
 if(m.kind==='bpm'){
  if(Number.isFinite(m.value)&&m.value>=30&&m.value<=300){globalBpm=m.value;const display=document.getElementById('mixerBPM');if(display)display.textContent=globalBpm+' BPM';banner('REMOTE BPM '+globalBpm)}
 }
 if(m.kind==='transport'){
  if(!['play','stop','cue'].includes(m.action)||!['A','B','both'].includes(m.deck))return;
  const ids=m.deck==='both'?['A','B']:[m.deck];
  for(const id of ids){const d=decks[id];if(!d||!d.file)continue;
   if(m.action==='stop'){d.audio.pause()}
   if(m.action==='cue'){d.audio.pause();d.audio.currentTime=d.cue||0}
   if(m.action==='play'){initAudio();d.audio.play().catch(e=>banner('REMOTE PLAY BLOCKED: '+e.message))}
   if(typeof updateDeck==='function')updateDeck(id)
  }
  banner('REMOTE '+m.action.toUpperCase()+' '+m.deck)
 }
}
function makePeer(){
 if(!networkAvailable())throw Error('WebRTC unavailable on this Android WebView');
 if(pc)close();
 pc=new RTCPeerConnection({iceServers:[]});
 pc.onconnectionstatechange=()=>{
  let s=pc?.connectionState||'CLOSED';el('peer').textContent=s.toUpperCase();
  if(s==='connected'){lastConnected=Date.now();banner('LOCAL PEER CONNECTED');}
  if(['failed','disconnected','closed'].includes(s))banner('NETWORK '+s.toUpperCase());
 };
 pc.ondatachannel=e=>bind(e.channel);
 pc.onicecandidateerror=e=>banner('ICE '+e.errorText);
 return pc;
}
function bind(ch){
 channel=ch;
 channel.onopen=()=>{el('peer').textContent='CONNECTED';banner('CONTROL CHANNEL OPEN');send({kind:'hello'})};
 channel.onclose=()=>{el('peer').textContent='DISCONNECTED';banner('DATA CHANNEL CLOSED')};
 channel.onmessage=onMessage;
}
async function offer(){
 try{
  const p=makePeer();role='host';bind(p.createDataChannel('masterlab-control',{ordered:true}));
  await p.setLocalDescription(await p.createOffer());await sleepICE(p);
  el('out').value=JSON.stringify({type:'offer',sdp:p.localDescription.sdp});banner('HOST OFFER GENERATED — SEND TO TABLET/PHONE');
 }catch(e){banner('HOST FAILED: '+e.message)}
}
async function answer(){
 try{
  const offer=JSON.parse(el('in').value.trim());
  if(offer.type!=='offer'||typeof offer.sdp!=='string')throw Error('Expected OFFER JSON');
  const p=makePeer();role='guest';await p.setRemoteDescription(offer);
  await p.setLocalDescription(await p.createAnswer());await sleepICE(p);
  el('out').value=JSON.stringify({type:'answer',sdp:p.localDescription.sdp});banner('ANSWER GENERATED — RETURN TO HOST');
 }catch(e){banner('ANSWER FAILED: '+e.message)}
}
async function acceptAnswer(){
 try{
  const ans=JSON.parse(el('in').value.trim());
  if(ans.type!=='answer'||typeof ans.sdp!=='string')throw Error('Expected ANSWER JSON');
  if(!pc||role!=='host')throw Error('Create HOST OFFER first');
  await pc.setRemoteDescription(ans);banner('ANSWER ACCEPTED — CONNECTING');
 }catch(e){banner('PAIRING FAILED: '+e.message)}
}
function copy(){
 let input=el('out');input.focus();input.select();
 if(navigator.clipboard?.writeText)navigator.clipboard.writeText(input.value).then(()=>banner('SIGNAL COPIED')).catch(()=>banner('SELECT TEXT AND COPY'));
 else banner('TEXT SELECTED — COPY MANUALLY');
}
function deviceChoices(){
 let arr=[];try{arr=JSON.parse(window.AndroidMasterLab?.getAudioDevices?.()||'[]')}catch(e){banner(e.message)}
 for(const id of ['first','second']){
  const box=el(id),previous=box.value;box.replaceChildren(new Option('SELECT OUTPUT '+id.toUpperCase(),''));
  for(const d of arr.filter(x=>x.output))box.add(new Option(d.name+' ['+d.id+'] '+(d.channelCounts||[]).join('/')+' CH',String(d.id)));
  if([...box.options].some(x=>x.value===previous))box.value=previous;
 }
 banner(arr.length+' ANDROID AUDIO DEVICE PROFILES');
}
function probe(){
 let a=el('first').value,b=el('second').value;
 if(!a||!b||a===b){banner('SELECT TWO DIFFERENT HARDWARE OUTPUTS');return}
 if(!el('safety').checked){banner('CONFIRM LOW VOLUME AND FEEDBACK SAFETY');return}
 if(!window.AndroidMasterLab?.beginDualOutputTest){banner('NATIVE TEST UNAVAILABLE IN WEB BROWSER');return}
 try{
  let msg=window.AndroidMasterLab.beginDualOutputTest(Number(a),Number(b));
  banner(msg);
 }catch(e){banner(e.message)}
}
el('offer').onclick=offer;
el('answer').onclick=answer;
el('accept').onclick=acceptAnswer;
el('copy').onclick=copy;
el('close').onclick=close;
el('refresh').onclick=deviceChoices;
el('dual-start').onclick=probe;
el('dual-stop').onclick=()=>window.AndroidMasterLab?.stopDualOutputTest?.();
el('sync-bpm').onclick=()=>send({kind:'bpm',value:globalBpm});
for(const action of ['play','stop','cue']){
 el('tx-'+action).onclick=()=>send({kind:'transport',action,deck:el('deck').value});
}
el('ping').onclick=()=>{timing.pingSent=performance.now();send({kind:'ping',id:timing.pingSent})};
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden'&&pc?.connectionState==='failed')close()});
setInterval(()=>{
 if(!window.AndroidMasterLab?.getDualOutputStatus)return;
 try{
  let d=JSON.parse(window.AndroidMasterLab.getDualOutputStatus());
  el('output-status').textContent=(d.status||'IDLE')+' · REQUESTED '+d.requestedA+'/'+d.requestedB+' · ACTUAL '+d.actualA+'/'+d.actualB;
 }catch(e){}
},850);
deviceChoices();
})();
