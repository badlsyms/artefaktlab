const chat = document.querySelector('#chat');
const form = document.querySelector('#composer');
const input = document.querySelector('#message');
const send = document.querySelector('#send');
const statusEl = document.querySelector('#status');
const pin = document.querySelector('#pin');
const clear = document.querySelector('#clear');
const diagnostics = document.querySelector('#diagnostics');

const moduleButtons = [...document.querySelectorAll('.module-button')];
const views = [...document.querySelectorAll('.view')];

const factForm = document.querySelector('#factForm');
const factInput = document.querySelector('#factInput');
const factRun = document.querySelector('#factRun');
const factClear = document.querySelector('#factClear');
const factState = document.querySelector('#factState');
const factResultCard = document.querySelector('#factResultCard');
const factResult = document.querySelector('#factResult');
const factQueriesWrap = document.querySelector('#factQueriesWrap');
const factQueries = document.querySelector('#factQueries');
const factSourcesWrap = document.querySelector('#factSourcesWrap');
const factSources = document.querySelector('#factSources');

const STORE = 'nucleus-history-v2';
const PIN_STORE = 'nucleus-pin-v2';
const FACT_DRAFT_STORE = 'nucleus-fact-draft-v1';

let history = [];
try {
  history = JSON.parse(localStorage.getItem(STORE) || '[]');
} catch {
  history = [];
}

pin.value = localStorage.getItem(PIN_STORE) || '';
factInput.value = localStorage.getItem(FACT_DRAFT_STORE) || '';

function addMessage(role, text, persist = true) {
  const wrap = document.createElement('article');
  wrap.className = `message ${role === 'user' ? 'user' : 'assistant'}`;

  const avatar = document.createElement('div');
  avatar.className = 'avatar';
  avatar.textContent = role === 'user' ? 'T' : 'N';

  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.textContent = text;

  wrap.append(avatar, bubble);
  chat.append(wrap);
  chat.scrollTop = chat.scrollHeight;

  if (persist) {
    history.push({ role: role === 'user' ? 'user' : 'assistant', content: text });
    history = history.slice(-24);
    localStorage.setItem(STORE, JSON.stringify(history));
  }

  return bubble;
}

for (const item of history) {
  addMessage(item.role, item.content, false);
}

function setStatus(text, kind = '') {
  statusEl.textContent = text;
  statusEl.className = `status ${kind}`.trim();
}

function setFactState(text, kind = '') {
  factState.textContent = text;
  factState.className = `fact-state ${kind}`.trim();
}

function switchView(viewId) {
  for (const view of views) {
    const isActive = view.id === viewId;
    view.hidden = !isActive;
    view.classList.toggle('active', isActive);
  }

  for (const button of moduleButtons) {
    button.classList.toggle('active', button.dataset.view === viewId);
  }

  if (viewId === 'factView') factInput.focus();
  if (viewId === 'chatView') input.focus();
}

for (const button of moduleButtons) {
  button.addEventListener('click', () => switchView(button.dataset.view));
}

async function refreshStatus() {
  try {
    const response = await fetch('/api/status', { cache: 'no-store' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'status failed');

    setStatus(`Online · ${data.model}`, 'ok');
    diagnostics.textContent = JSON.stringify(data, null, 2);

    if (data.factCheckAvailable === false) {
      setFactState('Lovec není na backendu dostupný.', 'error');
      factRun.disabled = true;
    }
  } catch (error) {
    setStatus('Backend nedostupný', 'error');
    setFactState('Backend je nedostupný.', 'error');
    diagnostics.textContent = String(error);
  }
}

async function ask(message) {
  const bubble = addMessage('assistant', 'Přemýšlím…', false);
  send.disabled = true;
  setStatus('Nucleus pracuje…');

  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(pin.value ? { 'x-nucleus-pin': pin.value } : {})
      },
      body: JSON.stringify({ message, history: history.slice(0, -1) })
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);

    bubble.textContent = data.text;
    history.push({ role: 'assistant', content: data.text });
    history = history.slice(-24);
    localStorage.setItem(STORE, JSON.stringify(history));
    setStatus(`Online · ${data.model}`, 'ok');
  } catch (error) {
    bubble.textContent = `⚠️ ${error.message}`;
    setStatus('Chyba AI', 'error');
  } finally {
    send.disabled = false;
    input.focus();
  }
}

function renderFactSources(sources) {
  factSources.replaceChildren();

  if (!Array.isArray(sources) || sources.length === 0) {
    factSourcesWrap.hidden = true;
    return;
  }

  for (const source of sources) {
    const item = document.createElement('li');
    const link = document.createElement('a');
    link.href = source.url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = source.title || source.url;
    item.append(link);
    factSources.append(item);
  }

  factSourcesWrap.hidden = false;
}

function renderFactQueries(queries) {
  factQueries.replaceChildren();

  if (!Array.isArray(queries) || queries.length === 0) {
    factQueriesWrap.hidden = true;
    return;
  }

  for (const query of queries) {
    const chip = document.createElement('span');
    chip.className = 'query-chip';
    chip.textContent = query;
    factQueries.append(chip);
  }

  factQueriesWrap.hidden = false;
}

async function runFactCheck(inputText) {
  factRun.disabled = true;
  factResultCard.hidden = true;
  factResult.textContent = '';
  renderFactSources([]);
  renderFactQueries([]);
  setFactState('Lovec hledá zdroje a ověřuje tvrzení…', 'working');
  setStatus('Lovec dezinformací pracuje…');

  try {
    const response = await fetch('/api/fact-check', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(pin.value ? { 'x-nucleus-pin': pin.value } : {})
      },
      body: JSON.stringify({ input: inputText })
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);

    factResult.textContent = data.text;
    renderFactQueries(data.queries);
    renderFactSources(data.sources);
    factResultCard.hidden = false;

    const sourceCount = Array.isArray(data.sources) ? data.sources.length : 0;
    setFactState(`Hotovo · ${sourceCount} webových zdrojů · ${data.model}`, 'ok');
    setStatus(`Online · Lovec · ${data.model}`, 'ok');
  } catch (error) {
    setFactState(`Chyba Lovce: ${error.message}`, 'error');
    setStatus('Chyba Lovce dezinformací', 'error');
  } finally {
    factRun.disabled = false;
    factInput.focus();
  }
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const message = input.value.trim();
  if (!message) return;

  addMessage('user', message);
  input.value = '';
  input.style.height = 'auto';
  await ask(message);
});

factForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const inputText = factInput.value.trim();
  if (!inputText) return;
  localStorage.setItem(FACT_DRAFT_STORE, inputText);
  await runFactCheck(inputText);
});

factInput.addEventListener('input', () => {
  localStorage.setItem(FACT_DRAFT_STORE, factInput.value);
});

factClear.addEventListener('click', () => {
  factInput.value = '';
  localStorage.removeItem(FACT_DRAFT_STORE);
  factResultCard.hidden = true;
  factResult.textContent = '';
  renderFactSources([]);
  renderFactQueries([]);
  setFactState('Připraven. Vlož obsah k ověření.');
  factInput.focus();
});

input.addEventListener('input', () => {
  input.style.height = 'auto';
  input.style.height = `${Math.min(input.scrollHeight, 180)}px`;
});

input.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    form.requestSubmit();
  }
});

pin.addEventListener('change', () => localStorage.setItem(PIN_STORE, pin.value));

clear.addEventListener('click', () => {
  history = [];
  localStorage.removeItem(STORE);
  location.reload();
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(console.error);
}

refreshStatus();
