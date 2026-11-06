/* MASTER LAB 2.7 — Native PCM hardware patchbay frontend */
(function(){
'use strict';
const $=id=>document.getElementById('ml27-'+id);
const bridge=window.AndroidMasterLab;
const state={input:-1,output:-1,levels:[1,0,0,1],active:false};
const names=['L → L','R → L','L → R','R → R'];
function persist(){try{localStorage.setItem('masterlab27-native-patch',JSON.stringify({input:$('input').value,output:$('output').value,levels:state.levels}))}catch(e){}}
function restore(){try{const p=JSON.parse(localStorage.getItem('masterlab27-native-patch')||'null');if(!p)return;if(Array.isArray(p.levels)&&p.levels.length===4)state.levels=p.levels.map(v=>Math.max(0,Math.min(2,Number(v)||0)));for(const id of ['input','output'])if([...$(id).options].some(o=>o.value===p[id]))$(id).value=p[id];}catch(e){}}
function message(s){$('status').textContent=s;}
function nativeAvailable(){return !!(bridge&&bridge.startPatchbay&&bridge.getPatchbayStatus)}
function listDevices(){
 const inSel=$('input'),outSel=$('output');
 inSel.replaceChildren(new Option('INPUT DEVICE',''));outSel.replaceChildren(new Option('OUTPUT DEVICE',''));
 let arr=[];
 try{if(bridge?.getAudioDevices)arr=JSON.parse(bridge.getAudioDevices())}catch(e){message(e.message)}
 for(const d of arr){
   const name=d.name+' · '+(d.channelCounts?.length?d.channelCounts.join('/')+'CH':'CH?')+' · ID '+d.id;
   if(d.input)inSel.add(new Option(name,String(d.id)));
   if(d.output)outSel.add(new Option(name,String(d.id)));
 }
 if(arr.length===0)message('No native devices detected');
 restore();
 $('status').textContent='AUDIO DEVICES '+arr.length+' · '+(nativeAvailable()?'NATIVE READY':'WEB ONLY');
}
function setMatrix(){
 if(nativeAvailable())bridge.setPatchbayMatrix(state.levels[0],state.levels[1],state.levels[2],state.levels[3]);
}
function drawMatrix(){
 const box=$('matrix');box.replaceChildren();
 names.forEach((name,i)=>{
  const row=document.createElement('label');row.className='ml27-route';
  const t=document.createElement('span');t.textContent=name;
  const range=document.createElement('input');range.type='range';range.min='0';range.max='2';range.step='.01';range.value=state.levels[i];
  const val=document.createElement('output');val.textContent=state.levels[i].toFixed(2);
  range.setAttribute('aria-label',name+' gain');
  range.oninput=()=>{state.levels[i]=Number(range.value);val.textContent=state.levels[i].toFixed(2);setMatrix();persist()};
  row.append(t,range,val);box.append(row);
 });
}
function preset(id){
 switch(id){
 case 'stereo':state.levels=[1,0,0,1];break;
 case 'swap':state.levels=[0,1,1,0];break;
 case 'mono':state.levels=[.5,.5,.5,.5];break;
 case 'mute':state.levels=[0,0,0,0];break;
 case 'left':state.levels=[1,0,1,0];break;
 case 'right':state.levels=[0,1,0,1];break;
 }
 drawMatrix();setMatrix();persist();
}
function refresh(){
 if(!nativeAvailable())return;
 try{
   const s=JSON.parse(bridge.getPatchbayStatus());
   state.active=!!s.running;
   $('active').textContent=s.running?'● ACTIVE':'■ OFF';
   $('active').classList.toggle('active',state.active);
   message(s.status+' · IN '+s.inputId+' → OUT '+s.outputId+' · '+s.rate+' Hz / '+s.channelCount+'CH');
 }catch(e){message('NATIVE STATUS '+e.message)}
}
function stop(){if(nativeAvailable()){bridge.stopPatchbay();refresh()}}
$('permission').onclick=()=>{if(bridge?.requestPatchbayPermission)bridge.requestPatchbayPermission()};
$('scan').onclick=listDevices;
$('input').onchange=persist;$('output').onchange=persist;
$('start').onclick=()=>{
 if(!nativeAvailable()){message('Native PCM engine unavailable in browser');return}
 const i=Number($('input').value),o=Number($('output').value);
 if(!$('input').value||!$('output').value){message('Select one real input and one real output');return}
 if(!$('safety').checked){message('Confirm low monitoring volume and no feedback loop before starting');return;}
 try{
   const result=bridge.startPatchbay(i,o);
   message(result);setMatrix();refresh();
 }catch(e){message('PATCH FAILED: '+e.message)}
};
$('stop').onclick=stop;
for(const id of ['stereo','swap','mono','mute','left','right'])$('preset-'+id).onclick=()=>preset(id);
$('save').onclick=()=>{
 const d={version:1,input:$('input').value,output:$('output').value,levels:state.levels};
 const blob=new Blob([JSON.stringify(d,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');
 a.href=url;a.download='MASTER-LAB-native-patch-v1.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);
};
$('load').onclick=()=>$('import').click();
$('import').onchange=async e=>{
 try{const f=e.target.files[0];if(!f)return;const d=JSON.parse(await f.text());if(d.version!==1||!Array.isArray(d.levels)||d.levels.length!==4)throw new Error('Unsupported patch');
  state.levels=d.levels.map(n=>Math.max(0,Math.min(2,Number(n)||0)));drawMatrix();setMatrix();
  if([...$('input').options].some(o=>o.value===d.input))$('input').value=d.input;
  if([...$('output').options].some(o=>o.value===d.output))$('output').value=d.output;
  message('PATCH LOADED · NOT STARTED');
 }catch(err){message(err.message)}
};
drawMatrix();listDevices();restore();drawMatrix();setMatrix();refresh();
setInterval(refresh,2000);
})();