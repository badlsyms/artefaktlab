const $ = (selector) => document.querySelector(selector);

const PIN_STORE = 'nucleus-pin-v2';
const pin = $('#pin');
const refreshNews = $('#refreshNews');
const newsState = $('#newsState');
const newsSourceState = $('#newsSourceState');
const newsGrid = $('#newsGrid');
const vaultForm = $('#vaultForm');
const vaultTitle = $('#vaultTitle');
const vaultUrl = $('#vaultUrl');
const vaultInput = $('#vaultInput');
const vaultVerifySave = $('#vaultVerifySave');
const vaultState = $('#vaultState');
const vaultList = $('#vaultList');
const reloadVault = $('#reloadVault');
const botInput = $('#botInput');
const runBotHunt = $('#runBotHunt');
const botResult = $('#botResult');

let newsLoaded = false;
let vaultLoaded = false;

function currentPin() {
  return pin?.value || localStorage.getItem(PIN_STORE) || '';
}

function safeUrl(value) {
  try {
    const url = new URL(String(value || ''), location.origin);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
  } catch {
    return '';
  }
}

function formatDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('cs-CZ', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  const accessPin = currentPin();
  if (accessPin) headers.set('x-nucleus-pin', accessPin);
  if (options.body && !headers.has('content-type')) headers.set('content-type', 'application/json');

  const response = await fetch(path, { ...options, headers, cache: 'no-store' });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || `HTTP ${response.status}`);
    error.code = data.code || `HTTP_${response.status}`;
    throw error;
  }
  return data;
}

function state(element, text, kind = '') {
  if (!element) return;
  element.textContent = text;
  element.className = `cloud-state ${kind}`.trim();
}

function appendLink(parent, title, url) {
  const href = safeUrl(url);
  if (!href) return;
  const link = document.createElement('a');
  link.href = href;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.textContent = title || href;
  parent.append(link);
}

function renderSourceHealth(sources) {
  newsSourceState.replaceChildren();
  for (const source of Array.isArray(sources) ? sources : []) {
    const chip = document.createElement('span');
    chip.className = `source-health-chip ${source.ok ? 'ok' : 'error'}`;
    chip.textContent = `${source.source}: ${source.ok ? `${source.count} · ${source.transport}` : 'nedostupné'}`;
    if (Array.isArray(source.errors) && source.errors.length) chip.title = source.errors.join('\n');
    newsSourceState.append(chip);
  }
}

function buildNewsCard(item) {
  const card = document.createElement('article');
  card.className = 'news-card';

  const meta = document.createElement('div');
  meta.className = 'news-meta';
  const source = document.createElement('span');
  source.className = 'news-source';
  source.textContent = item.source || 'Zdroj';
  meta.append(source);
  if (item.publishedAt) {
    const published = document.createElement('span');
    published.textContent = formatDate(item.publishedAt);
    meta.append(published);
  }

  const title = document.createElement('h3');
  title.textContent = item.title || 'Bez názvu';
  card.append(meta, title);

  if (item.summary) {
    const summary = document.createElement('p');
    summary.textContent = item.summary;
    card.append(summary);
  }

  const actions = document.createElement('div');
  actions.className = 'news-actions';
  appendLink(actions, 'Otevřít zdroj', item.url);
  const saveButton = document.createElement('button');
  saveButton.type = 'button';
  saveButton.textContent = 'Ověřit + uložit';
  saveButton.addEventListener('click', async () => {
    saveButton.disabled = true;
    saveButton.textContent = 'Ověřuji…';
    state(newsState, `Lovec ověřuje „${item.title}“ a ukládá původní i opravený kontext…`, 'working');
    try {
      const input = [
        `TITULEK: ${item.title || ''}`,
        item.summary ? `SHRNUTÍ ZDROJE: ${item.summary}` : '',
        item.url ? `VEŘEJNÁ URL: ${item.url}` : '',
        item.source ? `PUBLIKOVAL: ${item.source}` : ''
      ].filter(Boolean).join('\n\n');
      const data = await api('/api/vault', {
        method: 'POST',
        body: JSON.stringify({
          title: item.title,
          url: item.url,
          input,
          summary: item.summary,
          publishedAt: item.publishedAt,
          origin: `real-news:${item.sourceId || item.source || 'unknown'}`,
          verify: true
        })
      });
      const verdict = data.record?.verdict || 'uloženo';
      state(newsState, `Uloženo do Disinfo Trezoru · ${verdict} · ${data.record?.sourceCount ?? 0} zdrojů.`, 'ok');
      saveButton.textContent = 'Uloženo ✓';
      vaultLoaded = false;
    } catch (error) {
      state(newsState, `Chyba: ${error.message}`, 'error');
      saveButton.textContent = 'Ověřit + uložit';
    } finally {
      saveButton.disabled = false;
    }
  });
  actions.append(saveButton);
  card.append(actions);
  return card;
}

async function loadNews() {
  refreshNews.disabled = true;
  state(newsState, 'Načítám živá veřejná data ze serverových zdrojů…', 'working');
  newsGrid.replaceChildren();
  try {
    const data = await api('/api/news/feed');
    renderSourceHealth(data.sources);
    for (const item of data.items || []) newsGrid.append(buildNewsCard(item));
    newsLoaded = true;
    state(newsState, `Načteno ${data.items?.length || 0} živých položek · ${formatDate(data.retrievedAt)}.`, data.items?.length ? 'ok' : 'error');
  } catch (error) {
    renderSourceHealth([]);
    state(newsState, `Reálné zprávy: ${error.message}`, 'error');
  } finally {
    refreshNews.disabled = false;
  }
}

function buildVaultCard(item) {
  const card = document.createElement('article');
  card.className = 'vault-card';

  const head = document.createElement('div');
  head.className = 'vault-card-head';
  const title = document.createElement('h3');
  title.textContent = item.title || 'Bez názvu';
  const verdict = document.createElement('span');
  verdict.className = 'verdict-badge';
  verdict.textContent = `${item.verdict || 'NEURČENO'}${Number.isFinite(item.confidence) ? ` · ${item.confidence} %` : ''}`;
  head.append(title, verdict);
  card.append(head);

  const meta = document.createElement('p');
  meta.className = 'vault-meta';
  meta.textContent = [item.origin, formatDate(item.createdAt), item.model].filter(Boolean).join(' · ');
  card.append(meta);

  if (item.url) {
    const sourceLine = document.createElement('div');
    sourceLine.className = 'vault-source-link';
    appendLink(sourceLine, 'Původní veřejný zdroj', item.url);
    card.append(sourceLine);
  }

  const originalTitle = document.createElement('h4');
  originalTitle.textContent = 'Původní obsah';
  const original = document.createElement('pre');
  original.textContent = item.originalInput || '';
  const factTitle = document.createElement('h4');
  factTitle.textContent = 'Ověření / korekce';
  const fact = document.createElement('pre');
  fact.textContent = item.factCheckText || '';
  card.append(originalTitle, original, factTitle, fact);

  if (Array.isArray(item.groundedSources) && item.groundedSources.length) {
    const sourceTitle = document.createElement('h4');
    sourceTitle.textContent = `Grounding zdroje (${item.groundedSources.length})`;
    const list = document.createElement('ol');
    list.className = 'vault-source-list';
    for (const sourceItem of item.groundedSources) {
      const li = document.createElement('li');
      appendLink(li, sourceItem.title || sourceItem.url, sourceItem.url);
      list.append(li);
    }
    card.append(sourceTitle, list);
  }

  return card;
}

async function loadVault() {
  reloadVault.disabled = true;
  state(vaultState, 'Načítám cloudový Disinfo Trezor…', 'working');
  vaultList.replaceChildren();
  try {
    const data = await api('/api/vault?limit=40');
    for (const item of data.items || []) vaultList.append(buildVaultCard(item));
    vaultLoaded = true;
    state(vaultState, `Cloud online · ${data.items?.length || 0} uložených témat.`, 'ok');
  } catch (error) {
    const prefix = error.code === 'PIN_REQUIRED' ? 'Vlož PIN v Nastavení. ' : '';
    state(vaultState, `${prefix}${error.message}`, 'error');
  } finally {
    reloadVault.disabled = false;
  }
}

vaultForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const input = vaultInput.value.trim();
  if (!input) return;

  vaultVerifySave.disabled = true;
  state(vaultState, 'Lovec ověřuje tvrzení přes živý web a připravuje cloudový záznam…', 'working');
  try {
    const data = await api('/api/vault', {
      method: 'POST',
      body: JSON.stringify({
        title: vaultTitle.value.trim(),
        url: vaultUrl.value.trim(),
        input,
        origin: 'manual-vault',
        verify: true
      })
    });
    state(vaultState, `Uloženo · ${data.record?.verdict || 'hotovo'} · ${data.record?.sourceCount ?? 0} grounding zdrojů.`, 'ok');
    vaultTitle.value = '';
    vaultUrl.value = '';
    vaultInput.value = '';
    await loadVault();
  } catch (error) {
    const prefix = error.code === 'PIN_REQUIRED' ? 'Vlož PIN v Nastavení. ' : '';
    state(vaultState, `${prefix}${error.message}`, 'error');
  } finally {
    vaultVerifySave.disabled = false;
  }
});

async function runHoundAnalysis() {
  const input = botInput.value.trim();
  if (!input) return;
  runBotHunt.disabled = true;
  botResult.textContent = 'Hounds analyzují dodaný vzorek na serveru…';
  try {
    const data = await api('/api/hound-hunt', {
      method: 'POST',
      body: JSON.stringify({ input, persist: true })
    });
    const analysis = data.analysis || {};
    const metrics = analysis.metrics || {};
    botResult.textContent = [
      analysis.verdict || 'Analýza dokončena',
      `Skóre podezření: ${analysis.score ?? 0}/100 · úroveň ${analysis.level || 'N/A'}`,
      '',
      'SIGNÁLY',
      ...(analysis.signals || []).map((item) => `- ${item}`),
      '',
      'METRIKY',
      `Řádky: ${metrics.lines ?? 0}`,
      `Slova / unikátní: ${metrics.words ?? 0} / ${metrics.uniqueWords ?? 0}`,
      `Slovní rozmanitost: ${Math.round((metrics.lexicalDiversity ?? 0) * 100)} %`,
      `URL: ${metrics.urls ?? 0} · hustota ${Math.round((metrics.urlDensity ?? 0) * 100)} %`,
      `Shodné řádky: ${metrics.duplicatedLines ?? 0}`,
      `Velmi podobné páry: ${metrics.nearDuplicatePairs ?? 0}`,
      `Časové vzorky: ${metrics.timestampSamples ?? 0} · rychlé intervaly: ${metrics.rapidIntervals ?? 0}`,
      '',
      analysis.limitation || '',
      data.saved?.id ? '\nVýsledek uložen do cloudové větve bots.' : ''
    ].join('\n');
  } catch (error) {
    const prefix = error.code === 'PIN_REQUIRED' ? 'Vlož PIN v Nastavení. ' : '';
    botResult.textContent = `Chyba Hound Hunt: ${prefix}${error.message}`;
  } finally {
    runBotHunt.disabled = false;
  }
}

refreshNews.addEventListener('click', loadNews);
reloadVault.addEventListener('click', loadVault);
runBotHunt.addEventListener('click', runHoundAnalysis);

pin?.addEventListener('change', () => {
  vaultLoaded = false;
});

document.addEventListener('nucleus:viewchange', (event) => {
  const id = event.detail?.id;
  if (id === 'realNewsView' && !newsLoaded) loadNews();
  if (id === 'vaultView' && !vaultLoaded) loadVault();
});
