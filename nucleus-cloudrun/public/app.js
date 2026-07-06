const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

const statusEl = $('#status');
const diagnostics = $('#diagnostics');
const pin = $('#pin');
const tabs = $$('.tab');
const views = $$('.view');

const chat = $('#chat');
const form = $('#composer');
const input = $('#message');
const send = $('#send');
const clear = $('#clear');

const yearLabel = $('#yearLabel');
const yearPercent = $('#yearPercent');
const yearDots = $('#yearDots');
const monthTitle = $('#monthTitle');
const calendarGrid = $('#calendarGrid');
const prevMonth = $('#prevMonth');
const nextMonth = $('#nextMonth');
const todayButton = $('#todayButton');
const selectedDateTitle = $('#selectedDateTitle');
const selectedDateMeta = $('#selectedDateMeta');
const dayNote = $('#dayNote');
const saveDayNote = $('#saveDayNote');

const factForm = $('#factForm');
const factInput = $('#factInput');
const factRun = $('#factRun');
const factClear = $('#factClear');
const factState = $('#factState');
const factResultCard = $('#factResultCard');
const factResult = $('#factResult');
const factQueriesWrap = $('#factQueriesWrap');
const factQueries = $('#factQueries');
const factSourcesWrap = $('#factSourcesWrap');
const factSources = $('#factSources');

const memoryBoost = $('#memoryBoost');
const saveMemory = $('#saveMemory');
const injectMemory = $('#injectMemory');
const memoryState = $('#memoryState');
const botInput = $('#botInput');
const runBotHunt = $('#runBotHunt');
const botResult = $('#botResult');
const hourPlan = $('#hourPlan');
const savePlan = $('#savePlan');
const globalNotes = $('#globalNotes');
const saveNotes = $('#saveNotes');
const printExport = $('#printExport');
const downloadExport = $('#downloadExport');

const STORE = 'nucleus-history-v2';
const PIN_STORE = 'nucleus-pin-v2';
const FACT_DRAFT_STORE = 'nucleus-fact-draft-v1';
const MEMORY_STORE = 'nucleus-memory-boost-v1';
const NOTES_STORE = 'nucleus-global-notes-v1';
const DAY_NOTES_STORE = 'nucleus-day-notes-v1';
const PLAN_STORE = 'nucleus-24h-plan-v1';

const CZ_MONTHS = ['leden','únor','březen','duben','květen','červen','červenec','srpen','září','říjen','listopad','prosinec'];
const CZ_DAYS = ['neděle','pondělí','úterý','středa','čtvrtek','pátek','sobota'];
const NAMEDAYS = {'01-01':'Nový rok','01-06':'Tři králové','02-14':'Valentýn','03-19':'Josef','04-24':'Jiří','05-01':'Svátek práce','05-08':'Den vítězství','06-24':'Jan','07-05':'Cyril a Metoděj','07-06':'Jan Hus','09-28':'Václav','10-28':'Den vzniku ČSR','11-17':'Den boje za svobodu','12-24':'Štědrý den','12-25':'1. svátek vánoční','12-26':'2. svátek vánoční'};
const FIXED_HOLIDAYS = {'01-01':'Nový rok / Den obnovy samostatného českého státu','05-01':'Svátek práce','05-08':'Den vítězství','07-05':'Cyril a Metoděj','07-06':'Jan Hus','09-28':'Den české státnosti','10-28':'Den vzniku samostatného Československa','11-17':'Den boje za svobodu a demokracii','12-24':'Štědrý den','12-25':'1. svátek vánoční','12-26':'2. svátek vánoční'};

let history = loadJson(STORE, []);
let dayNotes = loadJson(DAY_NOTES_STORE, {});
let plan = loadJson(PLAN_STORE, {});
let viewDate = new Date();
let selectedDate = toKey(new Date());

pin.value = localStorage.getItem(PIN_STORE) || '';
factInput.value = localStorage.getItem(FACT_DRAFT_STORE) || '';
memoryBoost.value = localStorage.getItem(MEMORY_STORE) || '';
globalNotes.value = localStorage.getItem(NOTES_STORE) || '';

function loadJson(key, fallback){try{return JSON.parse(localStorage.getItem(key)||'null') ?? fallback}catch{return fallback}}
function saveJson(key, value){localStorage.setItem(key, JSON.stringify(value))}
function setStatus(text, kind=''){statusEl.textContent=text;statusEl.className=`status ${kind}`.trim()}
function pad(n){return String(n).padStart(2,'0')}
function toKey(date){return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}`}
function md(date){return `${pad(date.getMonth()+1)}-${pad(date.getDate())}`}
function fromKey(key){const [y,m,d]=key.split('-').map(Number);return new Date(y,m-1,d)}
function easterDate(year){const a=year%19,b=Math.floor(year/100),c=year%100,d=Math.floor(b/4),e=b%4,f=Math.floor((b+8)/25),g=Math.floor((b-f+1)/3),h=(19*a+b-d-g+15)%30,i=Math.floor(c/4),k=c%4,l=(32+2*e+2*i-h-k)%7,m=Math.floor((a+11*h+22*l)/451),month=Math.floor((h+l-7*m+114)/31),day=((h+l-7*m+114)%31)+1;return new Date(year,month-1,day)}
function holidayFor(date){const fixed=FIXED_HOLIDAYS[md(date)];const easter=easterDate(date.getFullYear());const goodFriday=new Date(easter);goodFriday.setDate(easter.getDate()-2);const monday=new Date(easter);monday.setDate(easter.getDate()+1);if(toKey(date)===toKey(goodFriday))return 'Velký pátek';if(toKey(date)===toKey(monday))return 'Velikonoční pondělí';return fixed||''}
function namedayFor(date){return NAMEDAYS[md(date)]||''}

function switchView(id){for(const v of views){const active=v.id===id;v.hidden=!active;v.classList.toggle('active',active)}for(const t of tabs)t.classList.toggle('active',t.dataset.view===id);if(id==='chatView')input.focus();if(id==='factView')factInput.focus()}
for(const t of tabs)t.addEventListener('click',()=>switchView(t.dataset.view));

function renderYearProgress(){const now=new Date();const start=new Date(now.getFullYear(),0,1);const end=new Date(now.getFullYear()+1,0,1);const ratio=Math.max(0,Math.min(1,(now-start)/(end-start)));yearLabel.textContent=String(now.getFullYear());yearPercent.textContent=`${Math.round(ratio*100)} % roku`;yearDots.replaceChildren();for(let i=0;i<52;i++){const dot=document.createElement('span');dot.className=i/52<=ratio?'done':'';yearDots.append(dot)}}

function renderCalendar(){const year=viewDate.getFullYear();const month=viewDate.getMonth();monthTitle.textContent=`${CZ_MONTHS[month]} ${year}`;calendarGrid.replaceChildren();const first=new Date(year,month,1);const startOffset=(first.getDay()+6)%7;const gridStart=new Date(year,month,1-startOffset);const todayKey=toKey(new Date());for(let i=0;i<42;i++){const d=new Date(gridStart);d.setDate(gridStart.getDate()+i);const key=toKey(d);const card=document.createElement('button');card.type='button';card.className='day-tile';if(d.getMonth()!==month)card.classList.add('outside');if(d.getDay()===0||d.getDay()===6)card.classList.add('weekend');if(key===todayKey)card.classList.add('today');if(key===selectedDate)card.classList.add('selected');if(holidayFor(d))card.classList.add('holiday');const nday=namedayFor(d);const holiday=holidayFor(d);const note=dayNotes[key];card.innerHTML=`<strong>${d.getDate()}</strong><span>${CZ_DAYS[d.getDay()]}</span><small>${holiday||nday||' '}</small>${note?'<em>●</em>':''}`;card.addEventListener('click',()=>{selectedDate=key;renderCalendar();renderSelectedDay()});calendarGrid.append(card)}renderSelectedDay()}
function renderSelectedDay(){const d=fromKey(selectedDate);const h=holidayFor(d);const n=namedayFor(d);selectedDateTitle.textContent=`${d.getDate()}. ${CZ_MONTHS[d.getMonth()]} ${d.getFullYear()}`;selectedDateMeta.textContent=[CZ_DAYS[d.getDay()],h?`svátek: ${h}`:'',n?`jmeniny: ${n}`:''].filter(Boolean).join(' · ');dayNote.value=dayNotes[selectedDate]||''}
prevMonth.addEventListener('click',()=>{viewDate.setMonth(viewDate.getMonth()-1);renderCalendar()});
nextMonth.addEventListener('click',()=>{viewDate.setMonth(viewDate.getMonth()+1);renderCalendar()});
todayButton.addEventListener('click',()=>{viewDate=new Date();selectedDate=toKey(new Date());renderCalendar()});
saveDayNote.addEventListener('click',()=>{dayNotes[selectedDate]=dayNote.value.trim();saveJson(DAY_NOTES_STORE,dayNotes);renderCalendar()});

function addMessage(role,text,persist=true){const wrap=document.createElement('article');wrap.className=`message ${role==='user'?'user':'assistant'}`;const avatar=document.createElement('div');avatar.className='avatar';avatar.textContent=role==='user'?'T':'N';const bubble=document.createElement('div');bubble.className='bubble';bubble.textContent=text;wrap.append(avatar,bubble);chat.append(wrap);chat.scrollTop=chat.scrollHeight;if(persist){history.push({role:role==='user'?'user':'assistant',content:text});history=history.slice(-24);saveJson(STORE,history)}return bubble}
for(const item of history)addMessage(item.role,item.content,false);
async function refreshStatus(){try{const r=await fetch('/api/status',{cache:'no-store'});const d=await r.json();if(!r.ok)throw new Error(d.error||'status failed');setStatus(`Online · ${d.version} · ${d.model}`,'ok');diagnostics.textContent=JSON.stringify(d,null,2);if(d.factCheckAvailable===false){factState.textContent='Lovec není na backendu dostupný.';factRun.disabled=true}}catch(e){setStatus('Backend nedostupný','error');diagnostics.textContent=String(e)}}
async function ask(message){const bubble=addMessage('assistant','Přemýšlím…',false);send.disabled=true;setStatus('Nucleus pracuje…');const mem=localStorage.getItem(MEMORY_STORE)||'';const finalMessage=mem.trim()?`BOOST PAMĚTI PRO TENTO DOTAZ:\n${mem.trim()}\n\nDOTAZ UŽIVATELE:\n${message}`:message;try{const r=await fetch('/api/chat',{method:'POST',headers:{'content-type':'application/json',...(pin.value?{'x-nucleus-pin':pin.value}:{})},body:JSON.stringify({message:finalMessage,history:history.slice(0,-1)})});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||`HTTP ${r.status}`);bubble.textContent=d.text;history.push({role:'assistant',content:d.text});history=history.slice(-24);saveJson(STORE,history);setStatus(`Online · ${d.model}`,'ok')}catch(e){bubble.textContent=`⚠️ ${e.message}`;setStatus('Chyba AI','error')}finally{send.disabled=false;input.focus()}}
form.addEventListener('submit',async e=>{e.preventDefault();const msg=input.value.trim();if(!msg)return;addMessage('user',msg);input.value='';input.style.height='auto';await ask(msg)});
input.addEventListener('input',()=>{input.style.height='auto';input.style.height=`${Math.min(input.scrollHeight,180)}px`});
input.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();form.requestSubmit()}});
clear.addEventListener('click',()=>{history=[];localStorage.removeItem(STORE);location.reload()});
pin.addEventListener('change',()=>localStorage.setItem(PIN_STORE,pin.value));

function renderFactSources(sources){factSources.replaceChildren();if(!Array.isArray(sources)||!sources.length){factSourcesWrap.hidden=true;return}for(const s of sources){const li=document.createElement('li');const a=document.createElement('a');a.href=s.url;a.target='_blank';a.rel='noopener noreferrer';a.textContent=s.title||s.url;li.append(a);factSources.append(li)}factSourcesWrap.hidden=false}
function renderFactQueries(queries){factQueries.replaceChildren();if(!Array.isArray(queries)||!queries.length){factQueriesWrap.hidden=true;return}for(const q of queries){const chip=document.createElement('span');chip.className='query-chip';chip.textContent=q;factQueries.append(chip)}factQueriesWrap.hidden=false}
async function runFactCheck(text){factRun.disabled=true;factResultCard.hidden=true;factResult.textContent='';renderFactSources([]);renderFactQueries([]);factState.textContent='Lovec hledá zdroje a ověřuje tvrzení…';factState.className='fact-state working';setStatus('Lovec dezinformací pracuje…');try{const r=await fetch('/api/fact-check',{method:'POST',headers:{'content-type':'application/json',...(pin.value?{'x-nucleus-pin':pin.value}:{})},body:JSON.stringify({input:text})});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||`HTTP ${r.status}`);factResult.textContent=d.text;renderFactQueries(d.queries);renderFactSources(d.sources);factResultCard.hidden=false;const count=Array.isArray(d.sources)?d.sources.length:0;factState.textContent=`Hotovo · ${count} webových zdrojů · ${d.model}`;factState.className='fact-state ok';setStatus(`Online · Lovec · ${d.model}`,'ok')}catch(e){factState.textContent=`Chyba Lovce: ${e.message}`;factState.className='fact-state error';setStatus('Chyba Lovce','error')}finally{factRun.disabled=false;factInput.focus()}}
factForm.addEventListener('submit',async e=>{e.preventDefault();const text=factInput.value.trim();if(!text)return;localStorage.setItem(FACT_DRAFT_STORE,text);await runFactCheck(text)});
factInput.addEventListener('input',()=>localStorage.setItem(FACT_DRAFT_STORE,factInput.value));
factClear.addEventListener('click',()=>{factInput.value='';localStorage.removeItem(FACT_DRAFT_STORE);factResultCard.hidden=true;factState.textContent='Připraven. Vlož obsah k ověření.';factState.className='fact-state'});

saveMemory.addEventListener('click',()=>{localStorage.setItem(MEMORY_STORE,memoryBoost.value);memoryState.textContent='Boost paměti uložen.'});
injectMemory.addEventListener('click',()=>{switchView('chatView');input.value=`Použij můj Boost paměti a pomoz mi s tímto:\n\n`;input.focus()});

function analyzeBots(text){const lines=text.split(/\n+/).map(x=>x.trim()).filter(Boolean);const words=text.toLowerCase().match(/[a-zá-ž0-9]{3,}/gi)||[];const urls=(text.match(/https?:\/\/\S+/g)||[]).length;const repeated=new Map();for(const l of lines)repeated.set(l,(repeated.get(l)||0)+1);const dup=[...repeated.values()].filter(v=>v>1).reduce((a,b)=>a+b,0);const urlRatio=lines.length?urls/lines.length:0;const wordSet=new Set(words);const diversity=words.length?wordSet.size/words.length:1;let score=0;if(dup>1)score+=25;if(urlRatio>.3)score+=20;if(diversity<.35)score+=20;if(/crypto|airdrop|bonus|klikni|výdělek|prize|giveaway|telegram|whatsapp/i.test(text))score+=15;if(lines.length>8&&dup/lines.length>.25)score+=20;score=Math.min(100,score);const verdict=score>70?'Vysoké podezření na bot/spam vzorec':score>40?'Střední podezření':'Nízké až mírné podezření';return `${verdict}\nSkóre: ${score}/100\nŘádků: ${lines.length}\nURL: ${urls}\nOpakované řádky: ${dup}\nSlovní rozmanitost: ${Math.round(diversity*100)} %\n\nPoznámka: Bezpečná analýza textu/logů. Neprovádí skenování, útoky ani obcházení systémů.`}
runBotHunt.addEventListener('click',()=>{botResult.textContent=analyzeBots(botInput.value||'')});

function renderPlan(){hourPlan.replaceChildren();for(let h=0;h<24;h++){const row=document.createElement('label');row.className='hour-row';row.innerHTML=`<span>${pad(h)}:00</span><input value="${(plan[h]||'').replaceAll('"','&quot;')}" placeholder="plán / blok / úkol">`;hourPlan.append(row)}}
savePlan.addEventListener('click',()=>{const rows=$$('#hourPlan input');plan={};rows.forEach((el,i)=>plan[i]=el.value.trim());saveJson(PLAN_STORE,plan)});
saveNotes.addEventListener('click',()=>localStorage.setItem(NOTES_STORE,globalNotes.value));

function exportHtml(){const d=fromKey(selectedDate);const day=dayNotes[selectedDate]||'';return `<!doctype html><meta charset="utf-8"><title>Nucleus export</title><style>body{font-family:Arial,sans-serif;line-height:1.5;padding:24px}h1,h2{margin-bottom:6px}pre{white-space:pre-wrap;background:#eee;padding:12px}</style><h1>Můj Nucleus export</h1><h2>${d.getDate()}. ${CZ_MONTHS[d.getMonth()]} ${d.getFullYear()}</h2><p>${selectedDateMeta.textContent}</p><h2>Denní poznámka</h2><pre>${escapeHtml(day)}</pre><h2>24h plán</h2><pre>${escapeHtml(Object.entries(plan).map(([h,v])=>`${pad(h)}:00 ${v||''}`).join('\n'))}</pre><h2>Globální poznámky</h2><pre>${escapeHtml(globalNotes.value)}</pre><h2>Boost paměti</h2><pre>${escapeHtml(memoryBoost.value)}</pre>`}
function escapeHtml(s){return String(s).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]))}
printExport.addEventListener('click',()=>{const w=window.open('','_blank');w.document.write(exportHtml());w.document.close();w.print()});
downloadExport.addEventListener('click',()=>{const blob=new Blob([exportHtml()],{type:'text/html;charset=utf-8'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`nucleus-export-${selectedDate}.html`;a.click();URL.revokeObjectURL(a.href)});

if('serviceWorker'in navigator)navigator.serviceWorker.register('/sw.js').catch(console.error);
renderYearProgress();renderCalendar();renderPlan();refreshStatus();
