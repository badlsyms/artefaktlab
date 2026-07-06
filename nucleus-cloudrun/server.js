import express from 'express';
import helmet from 'helmet';
import { GoogleGenAI } from '@google/genai';
import { fileURLToPath } from 'node:url';

const app = express();
const PORT = Number(process.env.PORT || 8080);
const MODEL = process.env.NUCLEUS_MODEL || 'gemini-3.1-flash-lite';
const FALLBACK_MODEL = process.env.NUCLEUS_FALLBACK_MODEL || 'gemini-2.5-flash-lite';
const MODEL_CHAIN = [...new Set([MODEL, FALLBACK_MODEL].filter(Boolean))];
const PROJECT = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || '';
const LOCATION = process.env.GOOGLE_CLOUD_LOCATION || 'global';
const API_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '';
const ACCESS_PIN = process.env.NUCLEUS_ACCESS_PIN || '';
const MAX_HISTORY = 24;
const MAX_MESSAGE_CHARS = 12000;

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

async function callVertex(contents, model) {
  if (!PROJECT) throw new Error('GOOGLE_CLOUD_PROJECT is not configured');
  const ai = new GoogleGenAI({ vertexai: true, project: PROJECT, location: LOCATION });
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
  if (!text) throw new Error('Vertex AI returned empty text');
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

app.get('/health', (_req, res) => {
  res.status(200).json({ ok: true, service: 'muj-nucleus', version: '2.0.0' });
});

app.get('/api/status', (_req, res) => {
  res.json({
    ok: true,
    service: 'Můj Nucleus',
    version: '2.0.0',
    model: MODEL,
    modelChain: MODEL_CHAIN,
    vertexConfigured: Boolean(PROJECT),
    apiKeyFallbackConfigured: Boolean(API_KEY),
    pinProtected: Boolean(ACCESS_PIN)
  });
});

app.post('/api/chat', rateLimit, pinGuard, async (req, res) => {
  const message = String(req.body?.message || '').trim().slice(0, MAX_MESSAGE_CHARS);
  if (!message) {
    return res.status(400).json({ error: 'Zpráva je prázdná.', code: 'EMPTY_MESSAGE' });
  }

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
  console.log(`Můj Nucleus 2.0 listening on ${PORT}`);
  console.log(`Model: ${MODEL}; Vertex: ${Boolean(PROJECT)}; API key fallback: ${Boolean(API_KEY)}; PIN: ${Boolean(ACCESS_PIN)}`);
});
