/* MASTER LAB 3.0: LAN PCM SEND / RECEIVE and hardware output fan-out UI */
(function(){
'use strict';
const $=s=>document.getElementById('ml30-'+s);
const native=window.AndroidMasterLab;
const persisted='masterlab-30-lan-profile';
let config={host:'192.168.1.2',port:49530,buffer:60,txId:'',outA:'',outB:'',outBGain:0,matA:[1,0,0,1],matB:[1,0,0,1]};
try{let prev=JSON.parse(localStorage.getItem(persisted)||'null');if(prev&&prev.version===1){config={...config,...prev}}}catch(e){}
const say=s=>{$('state').textContent=s};
const getDevices=()=>{try{return JSON.parse(native?.getAudioDevices?.()||'[]')}catch(e){return []}};
const validatedPort=()=>{const p=Number($('port').value);return Number.isInteger(p)&&p>=1024&&p<=65535?p:null};
function save(){config.host=$('host').value.trim();config.port=validatedPort()||49530;config.buffer=Number($('buffer').value)||60;config.txId=$('capture').value;config.outA=$('out-a').value;config.outB=$('out-b').value;try{localStorage.setItem(persisted,JSON.stringify({version:1,...config}))}catch(e){}}
function restore(){
 $('host').value=config.host;$('port').value=config.port;$('buffer').value=config.buffer;
}
function scan(){
 if($('capture').options.length>1)save();
 const values={capture:config.txId,'out-a':config.outA,'out-b':config.outB};
 const devices=getDevices();const make=(id,items,empty)=>{
  const sel=$(id);sel.replaceChildren(new Option(empty,''));
  for(const d of items)sel.add(new Option(d.name+' · CH '+(d.channelCounts?.join('/')||'?')+' · '+d.id,String(d.id)));
  if([...sel.options].some(x=>x.value===values[id]))sel.value=values[id];
 };
 make('capture',devices.filter(d=>d.input),'SELECT AUDIO INPUT');
 make('out-a',devices.filter(d=>d.output),'RECEIVE OUTPUT A');
 make('out-b',devices.filter(d=>d.output),'OFF (ONE OUTPUT)');
 try{const addrs=JSON.parse(native?.lanLocalAddresses?.()||'[]');$('local-addresses').textContent='RECEIVER IPv4: '+(addrs.map(x=>x.address+' ('+x.interface+')').join(' · ')||'UNAVAILABLE')}catch(e){}
 say('DETECTED '+devices.filter(d=>d.input).length+' INPUTS · '+devices.filter(d=>d.output).length+' OUTPUTS');
}
function updateMatrix(){
 if(!native?.lanSetGains)return;
 const m=config.matA,n=config.matB;
 native.lanSetGains(...m,...n);
}
function matrixControl(host,title,matrix,label){
 const section=document.createElement('div');section.className='ml30-matrix';
 const labelNode=document.createElement('div');labelNode.className='ml30-mini';labelNode.textContent=title;section.append(labelNode);
 const names=['L→L','R→L','L→R','R→R'];
 names.forEach((name,i)=>{
  const row=document.createElement('label');row.className='ml30-channel';
  const text=document.createElement('span');text.textContent=name;
  const slider=document.createElement('input');slider.type='range';slider.min='0';slider.max='2';slider.step='.01';slider.value=matrix[i];
  const out=document.createElement('output');out.textContent=matrix[i].toFixed(2);
  slider.oninput=()=>{matrix[i]=Number(slider.value);out.textContent=Number(slider.value).toFixed(2);updateMatrix();save()};
  slider.setAttribute('aria-label',label+' '+name);row.append(text,slider,out);section.append(row)
 });
 host.append(section)
}
function drawMatrix(){
 $('matrices').replaceChildren();
 matrixControl($('matrices'),'PHYSICAL OUTPUT A · L/R',config.matA,'Output A');
 matrixControl($('matrices'),'PHYSICAL OUTPUT B · L/R',config.matB,'Output B');
}
const updateStatus=()=>{
 if(!native?.lanDiagnostics)return;
 let s;try{s=JSON.parse(native.lanDiagnostics())}catch(e){return}
 $('tx-info').textContent=s.tx||'OFF';$('rx-info').textContent=s.rx||'OFF';
 $('loss').textContent=(s.missing||0)+' MISSING';
 $('jitter').textContent=Number(s.jitterMs||0).toFixed(1)+' ms';
 $('buffer-reading').textContent=(s.queuePackets||0)*5+' ms / '+s.configuredBufferMs+' ms';
 $('underrun').textContent=(s.underruns||0)+' XRUN';
 $('late').textContent=(s.late||0)+' LATE';
 $('throughput').textContent=(s.received||0)+' RX PKTS';
 $('routes').textContent='INPUT '+s.inputId+' · OUTPUT A '+s.outA+' · OUTPUT B '+s.outB;
 const bad=(s.underruns||0)>0||(s.missing||0)>0;
 $('health').textContent=bad?'CHECK DROPOUTS':s.receiving?'RECEIVING':s.sending?'TRANSMITTING':'IDLE';
 $('health').classList.toggle('active',!bad&&(s.receiving||s.sending));
};
$('scan').onclick=scan;
$('ping').onclick=()=>{
 if(!native?.lanPing){say('NATIVE LAN PING UNAVAILABLE');return}
 const port=validatedPort();if(!port){say('INVALID UDP PORT');return}
 try{let v=JSON.parse(native.lanPing($('host').value,port));
  $('rtt').textContent=v.error?v.error:(v.avgMs<0?'TIMEOUT':v.avgMs+' ms / '+v.received+'/'+v.sent);
  say(v.error?'PING ERROR: '+v.error:'PING RECEIVED '+v.received+'/'+v.sent+' · RTT '+v.avgMs+' ms')
 }catch(e){say('PING '+e.message)}
};
$('tx-start').onclick=()=>{
 if(!native?.lanStartTx){say('NATIVE AUDIO REQUIRED · INSTALL ANDROID APK');return}
 save();const port=validatedPort();if(!port){say('INVALID PORT');return}
 if(!config.txId){say('SELECT PHYSICAL INPUT');return}
 if(!$('confirm').checked){say('CONFIRM SAFE LEVELS BEFORE START');return}
 say(native.lanStartTx(config.host,port,Number(config.txId)));updateStatus()
};
$('tx-stop').onclick=()=>{native?.lanStopTx?.();updateStatus()};
$('rx-start').onclick=()=>{
 if(!native?.lanStartRx){say('NATIVE AUDIO REQUIRED · INSTALL ANDROID APK');return}
 save();const port=validatedPort();if(!port){say('INVALID PORT');return}
 if(!config.outA){say('SELECT OUTPUT A');return}
 if(config.outB&&config.outB===config.outA){say('OUTPUTS MUST DIFFER');return}
 if(!$('confirm').checked){say('CONFIRM SAFE LEVELS BEFORE START');return}
 updateMatrix();
 say(native.lanStartRx(port,Number(config.outA),config.outB?Number(config.outB):-1,config.buffer));updateStatus()
};
$('rx-stop').onclick=()=>{native?.lanStopRx?.();updateStatus()};
$('preset').onclick=()=>{config.matA=[1,0,0,1];config.matB=[1,0,0,1];drawMatrix();updateMatrix();save()};
$('mute').onclick=()=>{config.matA=[0,0,0,0];config.matB=[0,0,0,0];drawMatrix();updateMatrix();save()};
$('profile').onclick=()=>{
 save();const file=new Blob([JSON.stringify({version:1,...config},null,2)],{type:'application/json'}),url=URL.createObjectURL(file),a=document.createElement('a');
 a.href=url;a.download='MASTER-LAB-3.0-LAN-PROFILE.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),30000)
};
$('load').onclick=()=>$('file').click();
$('file').onchange=async e=>{
 try{
 const f=e.target.files[0];if(!f)return;const v=JSON.parse(await f.text());
 if(v.version!==1||!Array.isArray(v.matA)||v.matA.length!==4||!Array.isArray(v.matB)||v.matB.length!==4)throw Error('INVALID PROFILE');
 const sanitize=m=>m.map(x=>Math.max(0,Math.min(2,Number(x)||0)));
 config={...config,...v,matA:sanitize(v.matA),matB:sanitize(v.matB)};
 restore();scan();drawMatrix();updateMatrix();save();say('PROFILE LOADED · AUDIO NOT AUTO STARTED');
 }catch(e){say('PROFILE IMPORT FAILED: '+e.message)}
};
for(const id of ['host','port','buffer','capture','out-a','out-b'])$(id).addEventListener('change',save);
restore();scan();drawMatrix();updateMatrix();updateStatus();setInterval(updateStatus,800);
})();