import express from 'express';
import helmet from 'helmet';
import { GoogleGenAI } from '@google/genai';
import { fileURLToPath } from 'node:url';
import {
  analyzeHound,
  cloudDataConfigured,
  cloudSmokeTest,
  getNewsFeed,
  listHoundFindings,
  listVaultRecords,
  saveFactRecord,
  saveHoundFinding
} from './vault-service.js';

const app = express();
const PORT = Number(process.env.PORT || 8080);
const VERSION = '2.2.0';
const MODEL = process.env.NUCLEUS_MODEL || 'gemini-3.1-flash-lite';
const FALLBACK_MODEL = process.env.NUCLEUS_FALLBACK_MODEL || 'gemini-2.5-flash-lite';
const FACT_MODEL = process.env.NUCLEUS_FACT_MODEL || 'gemini-2.5-flash';
const MODEL_CHAIN = [...new Set([MODEL, FALLBACK_MODEL].filter(Boolean))];
const PROJECT = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || '';
const LOCATION = process.env.GOOGLE_CLOUD_LOCATION || 'global';
const API_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '';
const ACCESS_PIN = process.env.NUCLEUS_ACCESS_PIN || '';
const MAX_HISTORY = 24;
const MAX_MESSAGE_CHARS = 12_000;
const MAX_FACT_CHARS = 18_000;
const MAX_HOUND_CHARS = 50_000;

const SYSTEM_PROMPT = `Jsi Nucleus, personalizovaný AI asistent Toma Arno Cvancary Van der Honse z Prahy.

Zaměření uživatele: psychonautika, věda, experimentování, hudba, grafika, SW/HW architektura, filozofie, kulturní produkce a podnikatelské projekty. Má dlouhou praxi v hudební a eventové produkci a chce převádět vlastní nápady do reálně fungujících a monetizovatelných produktů.

Dlouhodobé projekty, které máš držet v kontextu: QPSX / Kvantová psychologie, NeuroCosmetiX, FULLSKATE, sWeeds, Koruno, Generacoin #2073, Frekvenční Terapie, Emily f. a další webové, mobilní, hudební, tiskové a HW/SW prototypy.

Pracovní styl:
- Odpovídej primárně česky, pokud uživatel nepřejde do jiného jazyka.
- Jdi přímo k věci. Buď praktický, profesionální a faktický.
- Odděluj ověřená fakta od hypotéz a spekulací.
- U projektů preferuj konkrétní další krok, funkční návrh, architekturu a cestu k nasazení či monetizaci.
- Nevymýšlej, že jsi něco provedl, pokud to provedeno nebylo.
- U zdravotních, právních, finančních a chemických témat jasně přiznej omezení a nedávej nebezpečné operativní návody.
- Když je zadání neuhlazené, pochop záměr a pomoz ho dotáhnout, nezesměšňuj uživatele.
- Udržuj kontinuitu projektů, ale nikdy nevydávej odhad za uloženou paměť.

Jsi „Nucleus“: centrální pracovní vrstva mezi nápadem a realizací. Tvým cílem není jen konverzace, ale zpřesnění záměru a posun k použitelnému výsledku.`;

const FACT_CHECK_PROMPT = `Jsi modul Nucleusu s názvem LOVEC DEZINFORMACÍ.
Tvým úkolem je provést skutečný fact-check nad aktuálními veřejnými webovými zdroji pomocí Google Search grounding.

Pravidla:
1. Nejprve rozlož vstup na jednotlivá ověřitelná tvrzení.
2. U každého důležitého tvrzení hledej více nezávislých zdrojů, pokud jsou dostupné.
3. Preferuj primární a autoritativní zdroje: oficiální instituce, zákony, registry, výzkumné práce, odborné organizace a původní dokumenty. Zpravodajství používej jako doplněk.
4. Nehodnoť politický názor jako pravdu nebo lež. Ověřuj konkrétní faktická tvrzení.
5. Jasně odděl: potvrzeno, nepravdivé, zavádějící, neověřitelné a chybí kontext.
6. Když jsou kvalitní zdroje ve sporu, popiš spor a neskrývej nejistotu.
7. Nevymýšlej citace ani zdroje. Použij pouze výsledky grounding nástroje.
8. Odpověď napiš česky.

Povinná struktura:
VERDIKT: <POTVRZENO | NEPRAVDIVÉ | ZAVÁDĚJÍCÍ | SMÍŠENÉ | NELZE OVĚŘIT>
JISTOTA: <0-100 %>

ROZKLAD TVRZENÍ
- ...

OVĚŘENÍ
- u každého tvrzení stručně: co zdroje potvrzují nebo vyvracejí

CHYBĚJÍCÍ KONTEXT / MANIPULAČNÍ PRVKY
- uveď cherry-picking, falešnou kauzalitu, neaktuální data, záměnu korelace za příčinu, emotivní framing apod. pouze pokud je skutečně vidíš

ZÁVĚR
- krátký a praktický závěr bez ideologického hodnocení.`;

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'"],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      frameAncestors: ["'none'"]
    }
  },
  crossOriginEmbedderPolicy: false
}));
app.use(express.json({ limit: '1mb' }));

const buckets = new Map();
function rateLimit(req, res, next) {
  const key = req.ip || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const windowMs = 60_000;
  const limit = 30;
  const bucket = buckets.get(key) || { start: now, count: 0 };
  if (now - bucket.start >= windowMs) {
    bucket.start = now;
    bucket.count = 0;
  }
  bucket.count += 1;
  buckets.set(key, bucket);
  if (bucket.count > limit) {
    return res.status(429).json({ error: 'Příliš mnoho požadavků. Zkus to za chvíli znovu.', code: 'LOCAL_RATE_LIMIT' });
  }
  next();
}

setInterval(() => {
  const cutoff = Date.now() - 10 * 60_000;
  for (const [key, value] of buckets.entries()) {
    if (value.start < cutoff) buckets.delete(key);
  }
}, 5 * 60_000).unref();

function pinGuard(req, res, next) {
  if (!ACCESS_PIN) return next();
  const provided = String(req.get('x-nucleus-pin') || '');
  if (provided !== ACCESS_PIN) {
    return res.status(401).json({ error: 'Nucleus je uzamčen. Zadej přístupový PIN.', code: 'PIN_REQUIRED' });
  }
  next();
}

function normalizeHistory(history) {
  if (!Array.isArray(history)) return [];
  return history
    .slice(-MAX_HISTORY)
    .map((item) => {
      const role = item?.role === 'assistant' || item?.role === 'model' ? 'model' : 'user';
      const text = String(item?.content ?? item?.text ?? '').trim().slice(0, MAX_MESSAGE_CHARS);
      return text ? { role, parts: [{ text }] } : null;
    })
    .filter(Boolean);
}

function publicError(error) {
  const code = Number(error?.status || error?.code || 0);
  const message = String(error?.message || 'Neznámá chyba AI služby');
  if (code === 429 || /quota|resource_exhausted|rate limit/i.test(message)) {
    return { status: 429, code: 'AI_QUOTA', error: 'AI model je dočasně omezen kvótou. Nucleus zkusil dostupné poskytovatele.' };
  }
  if (code === 401 || code === 403 || /permission|unauthorized|forbidden|billing/i.test(message)) {
    return { status: 503, code: 'AI_AUTH', error: 'AI backend nemá potřebné oprávnění nebo aktivní přístup k modelu.' };
  }
  return { status: 503, code: 'AI_UNAVAILABLE', error: 'AI backend je momentálně nedostupný.' };
}

function cloudPublicError(error) {
  console.error('Cloud data operation failed:', error?.code || '', error?.message || error);
  if (error?.code === 'CLOUD_DATA_NOT_CONFIGURED') {
    return { status: 503, code: 'CLOUD_DATA_NOT_CONFIGURED', error: 'Cloudový trezor Nucleusu není nakonfigurován.' };
  }
  if (Number(error?.code) === 7 || /permission|denied|forbidden/i.test(String(error?.message || ''))) {
    return { status: 503, code: 'CLOUD_DATA_PERMISSION', error: 'Cloud Run service identity nemá oprávnění k zápisu do Firestore.' };
  }
  return { status: 503, code: 'CLOUD_DATA_UNAVAILABLE', error: 'Cloudová data Nucleusu jsou momentálně nedostupná.' };
}

function createVertexClient() {
  if (!PROJECT) throw new Error('GOOGLE_CLOUD_PROJECT is not configured');
  return new GoogleGenAI({ vertexai: true, project: PROJECT, location: LOCATION, apiVersion: 'v1' });
}

function extractGrounding(response) {
  const metadata = response?.candidates?.[0]?.groundingMetadata || null;
  const chunks = Array.isArray(metadata?.groundingChunks) ? metadata.groundingChunks : [];
  const queries = Array.isArray(metadata?.webSearchQueries) ? metadata.webSearchQueries : [];
  const seen = new Set();
  const sources = [];

  for (const chunk of chunks) {
    const uri = String(chunk?.web?.uri || '').trim();
    const title = String(chunk?.web?.title || '').trim();
    if (!uri || seen.has(uri)) continue;
    seen.add(uri);
    sources.push({ title: title || uri, url: uri });
  }

  return { sources: sources.slice(0, 20), queries: queries.slice(0, 20) };
}

async function callVertex(contents, model) {
  const ai = createVertexClient();
  const response = await ai.models.generateContent({
    model,
    contents,
    config: {
      systemInstruction: SYSTEM_PROMPT,
      temperature: 0.8,
      topP: 0.95,
      maxOutputTokens: 8192
    }
  });
  const text = String(response.text || '').trim();
  if (!text) throw new Error('Google Cloud Gemini returned empty text');
  return { text, provider: 'vertex-ai', model };
}

async function callDeveloperApi(contents, model) {
  if (!API_KEY) throw new Error('GEMINI_API_KEY is not configured');
  const ai = new GoogleGenAI({ apiKey: API_KEY });
  const response = await ai.models.generateContent({
    model,
    contents,
    config: {
      systemInstruction: SYSTEM_PROMPT,
      temperature: 0.8,
      topP: 0.95,
      maxOutputTokens: 8192
    }
  });
  const text = String(response.text || '').trim();
  if (!text) throw new Error('Gemini Developer API returned empty text');
  return { text, provider: 'gemini-api', model };
}

async function factCheckVertex(input) {
  const ai = createVertexClient();
  const response = await ai.models.generateContent({
    model: FACT_MODEL,
    contents: `${FACT_CHECK_PROMPT}\n\nVSTUP K OVĚŘENÍ:\n${input}`,
    config: {
      tools: [{ googleSearch: {} }],
      temperature: 0.2,
      topP: 0.8,
      maxOutputTokens: 8192
    }
  });
  const text = String(response.text || '').trim();
  if (!text) throw new Error('Fact-check returned empty text');
  const grounding = extractGrounding(response);
  return { text, ...grounding, provider: 'vertex-ai-google-search', model: FACT_MODEL };
}

async function factCheckDeveloperApi(input) {
  if (!API_KEY) throw new Error('GEMINI_API_KEY is not configured');
  const ai = new GoogleGenAI({ apiKey: API_KEY });
  const response = await ai.models.generateContent({
    model: FACT_MODEL,
    contents: `${FACT_CHECK_PROMPT}\n\nVSTUP K OVĚŘENÍ:\n${input}`,
    config: {
      tools: [{ googleSearch: {} }],
      temperature: 0.2,
      topP: 0.8,
      maxOutputTokens: 8192
    }
  });
  const text = String(response.text || '').trim();
  if (!text) throw new Error('Fact-check returned empty text');
  const grounding = extractGrounding(response);
  return { text, ...grounding, provider: 'gemini-api-google-search', model: FACT_MODEL };
}

async function performFactCheck(input) {
  const attempts = [];
  if (PROJECT) {
    try {
      return await factCheckVertex(input);
    } catch (error) {
      console.error('Vertex fact-check failed:', error?.status || error?.code || '', error?.message || error);
      attempts.push(error);
    }
  }
  if (API_KEY) {
    try {
      return await factCheckDeveloperApi(input);
    } catch (error) {
      console.error('Gemini API fact-check failed:', error?.status || error?.code || '', error?.message || error);
      attempts.push(error);
    }
  }
  throw attempts.at(-1) || new Error('No grounded AI provider configured');
}

app.get('/health', (_req, res) => {
  res.status(200).json({ ok: true, service: 'muj-nucleus', version: VERSION });
});

app.get('/api/status', (_req, res) => {
  res.json({
    ok: true,
    service: 'Můj Nucleus',
    version: VERSION,
    model: MODEL,
    modelChain: MODEL_CHAIN,
    factModel: FACT_MODEL,
    factCheckAvailable: Boolean(PROJECT || API_KEY),
    realNewsAvailable: true,
    houndHuntAvailable: true,
    cloudDataConfigured,
    cloudAiConfigured: Boolean(PROJECT),
    apiKeyFallbackConfigured: Boolean(API_KEY),
    pinProtected: Boolean(ACCESS_PIN)
  });
});

app.post('/api/chat', rateLimit, pinGuard, async (req, res) => {
  const message = String(req.body?.message || '').trim().slice(0, MAX_MESSAGE_CHARS);
  if (!message) return res.status(400).json({ error: 'Zpráva je prázdná.', code: 'EMPTY_MESSAGE' });

  const history = normalizeHistory(req.body?.history);
  const contents = [...history, { role: 'user', parts: [{ text: message }] }];
  const attempts = [];

  if (PROJECT) {
    for (const model of MODEL_CHAIN) {
      try {
        const result = await callVertex(contents, model);
        return res.json({ ok: true, ...result });
      } catch (error) {
        console.error(`Vertex AI failed for ${model}:`, error?.status || error?.code || '', error?.message || error);
        attempts.push({ provider: 'vertex-ai', model, error });
      }
    }
  }

  if (API_KEY) {
    for (const model of MODEL_CHAIN) {
      try {
        const result = await callDeveloperApi(contents, model);
        return res.json({ ok: true, ...result });
      } catch (error) {
        console.error(`Gemini API failed for ${model}:`, error?.status || error?.code || '', error?.message || error);
        attempts.push({ provider: 'gemini-api', model, error });
      }
    }
  }

  const last = attempts.at(-1)?.error || new Error('No AI provider configured');
  const safe = publicError(last);
  return res.status(safe.status).json({ ...safe, model: MODEL });
});

app.post('/api/fact-check', rateLimit, pinGuard, async (req, res) => {
  const input = String(req.body?.input || '').trim().slice(0, MAX_FACT_CHARS);
  if (!input) return res.status(400).json({ error: 'Vlož tvrzení, text nebo veřejnou URL k ověření.', code: 'EMPTY_FACT_CHECK' });

  try {
    const result = await performFactCheck(input);
    return res.json({ ok: true, ...result });
  } catch (error) {
    const safe = publicError(error);
    return res.status(safe.status).json({ ...safe, model: FACT_MODEL });
  }
});

app.get('/api/news/feed', rateLimit, async (_req, res) => {
  try {
    const feed = await getNewsFeed();
    return res.json({ ok: true, ...feed });
  } catch (error) {
    console.error('News feed failed:', error?.message || error);
    return res.status(503).json({ error: 'Reálné zprávy se nyní nepodařilo načíst.', code: 'NEWS_UNAVAILABLE' });
  }
});

app.get('/api/vault', rateLimit, pinGuard, async (req, res) => {
  try {
    const items = await listVaultRecords(req.query?.limit);
    return res.json({ ok: true, items });
  } catch (error) {
    const safe = cloudPublicError(error);
    return res.status(safe.status).json(safe);
  }
});

app.post('/api/vault', rateLimit, pinGuard, async (req, res) => {
  const title = String(req.body?.title || '').trim().slice(0, 500);
  const input = String(req.body?.input || req.body?.summary || title || '').trim().slice(0, MAX_FACT_CHARS);
  const url = String(req.body?.url || '').trim().slice(0, 2048);
  const summary = String(req.body?.summary || '').trim().slice(0, 4000);
  const publishedAt = String(req.body?.publishedAt || '').trim().slice(0, 120);
  const origin = String(req.body?.origin || 'manual').trim().slice(0, 80);
  const verify = req.body?.verify !== false;

  if (!input) return res.status(400).json({ error: 'Trezor potřebuje text nebo tvrzení.', code: 'EMPTY_VAULT_INPUT' });

  try {
    const fact = verify
      ? await performFactCheck(input)
      : {
          text: 'VERDIKT: NELZE OVĚŘIT\nJISTOTA: 0 %\n\nZÁVĚR\nPoložka byla uložena bez fact-checku.',
          sources: [],
          queries: [],
          provider: 'none',
          model: 'none'
        };
    const record = await saveFactRecord({ title, url, input, summary, publishedAt, origin, fact });
    return res.json({ ok: true, record, fact });
  } catch (error) {
    if (/Firestore|Cloud|permission|denied|CLOUD_DATA/i.test(String(error?.message || error?.code || ''))) {
      const safe = cloudPublicError(error);
      return res.status(safe.status).json(safe);
    }
    const safe = publicError(error);
    return res.status(safe.status).json({ ...safe, model: FACT_MODEL });
  }
});

app.post('/api/hound-hunt', rateLimit, pinGuard, async (req, res) => {
  const input = String(req.body?.input || '').trim().slice(0, MAX_HOUND_CHARS);
  const persist = req.body?.persist !== false;
  if (!input) return res.status(400).json({ error: 'Vlož veřejný text, komentáře nebo log k analýze.', code: 'EMPTY_HOUND_INPUT' });

  try {
    const analysis = analyzeHound(input);
    const saved = persist ? await saveHoundFinding(input, analysis) : null;
    return res.json({ ok: true, analysis, saved });
  } catch (error) {
    const safe = cloudPublicError(error);
    return res.status(safe.status).json(safe);
  }
});

app.get('/api/hound-findings', rateLimit, pinGuard, async (req, res) => {
  try {
    const items = await listHoundFindings(req.query?.limit);
    return res.json({ ok: true, items });
  } catch (error) {
    const safe = cloudPublicError(error);
    return res.status(safe.status).json(safe);
  }
});

app.post('/api/cloud/smoke', rateLimit, pinGuard, async (_req, res) => {
  try {
    const result = await cloudSmokeTest();
    return res.json(result);
  } catch (error) {
    const safe = cloudPublicError(error);
    return res.status(safe.status).json(safe);
  }
});

app.use(express.static('public', {
  etag: false,
  lastModified: false,
  maxAge: 0,
  setHeaders(res, filePath) {
    if (filePath.endsWith('sw.js') || filePath.endsWith('manifest.json')) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    }
  }
}));

app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'API endpoint neexistuje.', code: 'NOT_FOUND' });
});

app.use((_req, res) => {
  res.sendFile(fileURLToPath(new URL('./public/index.html', import.meta.url)));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Můj Nucleus ${VERSION} listening on ${PORT}`);
  console.log(`Chat model: ${MODEL}; Fact model: ${FACT_MODEL}; Vertex: ${Boolean(PROJECT)}; Cloud data: ${cloudDataConfigured}; PIN: ${Boolean(ACCESS_PIN)}`);
});
