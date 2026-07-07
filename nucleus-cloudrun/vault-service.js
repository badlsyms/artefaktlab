import { Firestore, FieldValue } from '@google-cloud/firestore';
import { XMLParser } from 'fast-xml-parser';
import { load } from 'cheerio';
import { createHash } from 'node:crypto';

const PROJECT = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || '';
const USER_UID = process.env.NUCLEUS_USER_UID || '';
const NEWS_TIMEOUT_MS = 10_000;
const NEWS_LIMIT_PER_SOURCE = 18;
const MAX_CLOUD_ITEMS = 100;

const firestore = PROJECT && USER_UID ? new Firestore({ projectId: PROJECT }) : null;
const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  trimValues: true,
  parseTagValue: false,
  parseAttributeValue: false
});

const NEWS_SOURCES = [
  {
    id: 'ct24',
    name: 'ČT24',
    home: 'https://ct24.ceskatelevize.cz/',
    feeds: [
      'https://ct24.ceskatelevize.cz/rss/hlavni-zpravy',
      'https://ct24.ceskatelevize.cz/rss'
    ]
  },
  {
    id: 'irozhlas',
    name: 'iROZHLAS',
    home: 'https://www.irozhlas.cz/',
    feeds: [
      'https://www.irozhlas.cz/rss/irozhlas',
      'https://www.irozhlas.cz/rss'
    ]
  },
  {
    id: 'novinky',
    name: 'Novinky.cz',
    home: 'https://www.novinky.cz/',
    feeds: [
      'https://www.novinky.cz/rss',
      'https://www.novinky.cz/rss2'
    ]
  }
];

function cloudError() {
  const error = new Error('Cloudová data Nucleusu nejsou nakonfigurována.');
  error.code = 'CLOUD_DATA_NOT_CONFIGURED';
  return error;
}

function cleanText(value, max = 1200) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function stripHtml(value, max = 1200) {
  const html = String(value ?? '');
  if (!html) return '';
  try {
    const $ = load(`<div id="nucleus-root">${html}</div>`);
    return cleanText($('#nucleus-root').text(), max);
  } catch {
    return cleanText(html.replace(/<[^>]+>/g, ' '), max);
  }
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  return value == null ? [] : [value];
}

function textValue(value) {
  if (value == null) return '';
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (Array.isArray(value)) return textValue(value[0]);
  if (typeof value === 'object') {
    return textValue(value['#text'] ?? value.text ?? value.value ?? value.title ?? '');
  }
  return '';
}

function linkValue(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  for (const item of asArray(value)) {
    if (typeof item === 'string' && item) return item;
    if (item && typeof item === 'object') {
      const href = item['@_href'] || item.href || item['#text'];
      if (href) return String(href);
    }
  }
  return '';
}

function publicHttpUrl(value) {
  const raw = cleanText(value, 2048);
  if (!raw) return '';
  try {
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    return url.href;
  } catch {
    return '';
  }
}

function normalizeDate(value) {
  const raw = cleanText(value, 120);
  if (!raw) return '';
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

function parseFeed(xml, source) {
  const parsed = xmlParser.parse(xml);
  const channel = parsed?.rss?.channel || parsed?.channel || null;
  const entries = channel?.item || parsed?.feed?.entry || parsed?.RDF?.item || [];
  const items = [];

  for (const entry of asArray(entries).slice(0, NEWS_LIMIT_PER_SOURCE * 2)) {
    const title = cleanText(textValue(entry?.title), 320);
    const url = publicHttpUrl(linkValue(entry?.link) || textValue(entry?.guid) || textValue(entry?.id));
    const summary = stripHtml(
      textValue(entry?.description) || textValue(entry?.summary) || textValue(entry?.content),
      900
    );
    const publishedAt = normalizeDate(
      textValue(entry?.pubDate) || textValue(entry?.published) || textValue(entry?.updated) || textValue(entry?.date)
    );

    if (!title || !url) continue;
    items.push({
      id: createHash('sha256').update(`${source.id}|${url}`).digest('hex').slice(0, 20),
      source: source.name,
      sourceId: source.id,
      title,
      url,
      summary,
      publishedAt,
      transport: 'rss'
    });
    if (items.length >= NEWS_LIMIT_PER_SOURCE) break;
  }

  return items;
}

function hostMatches(candidateUrl, sourceHome) {
  try {
    const candidate = new URL(candidateUrl);
    const home = new URL(sourceHome);
    return candidate.hostname === home.hostname || candidate.hostname.endsWith(`.${home.hostname.replace(/^www\./, '')}`);
  } catch {
    return false;
  }
}

function parseHomepage(html, source) {
  const $ = load(html);
  const items = [];
  const seen = new Set();

  $('article a[href], main a[href], a[href]').each((_index, element) => {
    if (items.length >= NEWS_LIMIT_PER_SOURCE) return false;

    const anchor = $(element);
    let href = cleanText(anchor.attr('href'), 2048);
    if (!href || href.startsWith('#') || href.startsWith('javascript:')) return;

    try {
      href = new URL(href, source.home).href;
    } catch {
      return;
    }

    if (!hostMatches(href, source.home) || seen.has(href)) return;

    const container = anchor.closest('article');
    const heading = anchor.find('h1,h2,h3,h4').first().text()
      || container.find('h1,h2,h3,h4').first().text()
      || anchor.attr('aria-label')
      || anchor.text();
    const title = cleanText(heading, 320);
    if (title.length < 28 || /^více|zobrazit|menu|přihlásit|sledovat|podívejte|program/i.test(title)) return;

    const containerText = cleanText(container.text(), 1200);
    const summary = containerText && containerText !== title
      ? cleanText(containerText.replace(title, '').trim(), 900)
      : '';
    const timeValue = container.find('time').first().attr('datetime') || container.find('time').first().text();
    const publishedAt = normalizeDate(timeValue);

    seen.add(href);
    items.push({
      id: createHash('sha256').update(`${source.id}|${href}`).digest('hex').slice(0, 20),
      source: source.name,
      sourceId: source.id,
      title,
      url: href,
      summary,
      publishedAt,
      transport: 'html-fallback'
    });
  });

  return items;
}

async function fetchText(url, accept) {
  const response = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(NEWS_TIMEOUT_MS),
    headers: {
      accept,
      'user-agent': 'Muj-Nucleus/2.2 (+personal research news reader)'
    }
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

async function fetchNewsSource(source) {
  const errors = [];

  for (const feedUrl of source.feeds) {
    try {
      const xml = await fetchText(feedUrl, 'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.5');
      const items = parseFeed(xml, source);
      if (items.length) return { source: source.name, ok: true, transport: 'rss', items };
      errors.push(`${feedUrl}: prázdný feed`);
    } catch (error) {
      errors.push(`${feedUrl}: ${cleanText(error?.message, 180)}`);
    }
  }

  try {
    const html = await fetchText(source.home, 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5');
    const items = parseHomepage(html, source);
    if (items.length) return { source: source.name, ok: true, transport: 'html-fallback', items, errors };
    errors.push(`${source.home}: nenalezeny články`);
  } catch (error) {
    errors.push(`${source.home}: ${cleanText(error?.message, 180)}`);
  }

  return { source: source.name, ok: false, transport: 'none', items: [], errors };
}

export async function getNewsFeed() {
  const settled = await Promise.all(NEWS_SOURCES.map((source) => fetchNewsSource(source)));
  const all = [];
  const seen = new Set();

  for (const result of settled) {
    for (const item of result.items) {
      const key = item.url || `${item.source}|${item.title.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      all.push(item);
    }
  }

  all.sort((a, b) => {
    const aTime = a.publishedAt ? new Date(a.publishedAt).getTime() : 0;
    const bTime = b.publishedAt ? new Date(b.publishedAt).getTime() : 0;
    return bTime - aTime;
  });

  return {
    retrievedAt: new Date().toISOString(),
    items: all.slice(0, 45),
    sources: settled.map(({ items, errors, ...rest }) => ({ ...rest, count: items.length, errors: errors?.slice(-2) || [] }))
  };
}

function collection(name) {
  if (!firestore) throw cloudError();
  return firestore.collection('users').doc(USER_UID).collection(name);
}

function factMeta(text) {
  const source = String(text || '');
  const verdict = source.match(/VERDIKT:\s*([^\n\r]+)/i)?.[1]?.trim().slice(0, 80) || 'NEURČENO';
  const confidenceRaw = source.match(/JISTOTA:\s*(\d{1,3})\s*%/i)?.[1];
  const confidence = confidenceRaw ? Math.max(0, Math.min(100, Number(confidenceRaw))) : null;
  return { verdict, confidence };
}

function dateForJson(value) {
  if (!value) return null;
  if (typeof value.toDate === 'function') return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  return value;
}

function docToJson(doc) {
  const data = doc.data() || {};
  const normalized = {};
  for (const [key, value] of Object.entries(data)) {
    normalized[key] = dateForJson(value);
  }
  return { id: doc.id, ...normalized };
}

export const cloudDataConfigured = Boolean(firestore);

export async function saveFactRecord({ title, url, input, summary, publishedAt, origin, fact }) {
  if (!firestore) throw cloudError();

  const topicRef = collection('topics').doc();
  const coreRef = collection('cores').doc();
  const meta = factMeta(fact?.text);
  const batch = firestore.batch();
  const safeUrl = publicHttpUrl(url);
  const now = FieldValue.serverTimestamp();

  const topic = {
    type: 'disinfo-vault',
    origin: cleanText(origin || 'manual', 80),
    title: cleanText(title || input, 500),
    url: safeUrl,
    originalInput: cleanText(input, 18_000),
    sourceSummary: cleanText(summary, 4_000),
    publishedAt: normalizeDate(publishedAt),
    verdict: meta.verdict,
    confidence: meta.confidence,
    factCheckText: cleanText(fact?.text, 30_000),
    groundedSources: Array.isArray(fact?.sources) ? fact.sources.slice(0, 20).map((item) => ({
      title: cleanText(item?.title || item?.url, 500),
      url: publicHttpUrl(item?.url)
    })).filter((item) => item.url) : [],
    searchQueries: Array.isArray(fact?.queries) ? fact.queries.slice(0, 20).map((item) => cleanText(item, 500)).filter(Boolean) : [],
    provider: cleanText(fact?.provider, 120),
    model: cleanText(fact?.model, 120),
    createdAt: now,
    updatedAt: now
  };

  const core = {
    type: 'fact-core',
    topicId: topicRef.id,
    title: topic.title,
    url: topic.url,
    verdict: meta.verdict,
    confidence: meta.confidence,
    sourceCount: topic.groundedSources.length,
    origin: topic.origin,
    createdAt: now
  };

  batch.set(topicRef, topic);
  batch.set(coreRef, core);
  await batch.commit();

  return {
    topicId: topicRef.id,
    coreId: coreRef.id,
    verdict: meta.verdict,
    confidence: meta.confidence,
    sourceCount: topic.groundedSources.length
  };
}

export async function listVaultRecords(limit = 40) {
  if (!firestore) throw cloudError();
  const safeLimit = Math.max(1, Math.min(MAX_CLOUD_ITEMS, Number(limit) || 40));
  const snapshot = await collection('topics').orderBy('createdAt', 'desc').limit(safeLimit).get();
  return snapshot.docs.map(docToJson);
}

function tokenize(text) {
  return (String(text || '').toLowerCase().match(/[a-zá-ž0-9]{3,}/giu) || []).slice(0, 20_000);
}

function jaccard(a, b) {
  const left = new Set(a);
  const right = new Set(b);
  if (!left.size && !right.size) return 1;
  let intersection = 0;
  for (const item of left) if (right.has(item)) intersection += 1;
  const union = left.size + right.size - intersection;
  return union ? intersection / union : 0;
}

export function analyzeHound(input) {
  const text = String(input || '').slice(0, 50_000);
  const lines = text.split(/\r?\n+/).map((line) => line.trim()).filter(Boolean).slice(0, 1000);
  const words = tokenize(text);
  const uniqueWords = new Set(words);
  const exactCounts = new Map();
  const urls = text.match(/https?:\/\/[^\s)\]}>,]+/gi) || [];
  const timestamps = [];

  for (const line of lines) {
    exactCounts.set(line, (exactCounts.get(line) || 0) + 1);
    const stamp = line.match(/(?:^|\s)(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(?:\s|$)/);
    if (stamp) timestamps.push(Number(stamp[1]) * 3600 + Number(stamp[2]) * 60 + Number(stamp[3]));
  }

  const duplicatedLines = [...exactCounts.values()].filter((count) => count > 1).reduce((sum, count) => sum + count, 0);
  const lexicalDiversity = words.length ? uniqueWords.size / words.length : 1;
  const urlDensity = lines.length ? urls.length / lines.length : 0;

  let nearDuplicatePairs = 0;
  const sampled = lines.slice(0, 120).map((line) => tokenize(line));
  for (let i = 0; i < sampled.length; i += 1) {
    for (let j = i + 1; j < Math.min(sampled.length, i + 18); j += 1) {
      if (sampled[i].length >= 4 && sampled[j].length >= 4 && jaccard(sampled[i], sampled[j]) >= 0.86) {
        nearDuplicatePairs += 1;
      }
    }
  }

  const sortedTimes = timestamps.slice().sort((a, b) => a - b);
  const intervals = [];
  for (let i = 1; i < sortedTimes.length; i += 1) {
    let delta = sortedTimes[i] - sortedTimes[i - 1];
    if (delta < 0) delta += 86_400;
    if (delta <= 3600) intervals.push(delta);
  }
  const rapidIntervals = intervals.filter((value) => value <= 3).length;
  const sameIntervals = intervals.length > 2
    ? Math.max(...[...new Set(intervals)].map((value) => intervals.filter((item) => item === value).length))
    : 0;

  const ctaHits = (text.match(/\b(?:airdrop|giveaway|bonus|klikni|click here|výdělek|zaručený zisk|telegram|whatsapp|dm me|inbox me|crypto)\b/giu) || []).length;
  const accountMentions = (text.match(/@[a-z0-9_.-]{3,}/gi) || []).length;

  let score = 0;
  const signals = [];

  if (duplicatedLines >= 4) {
    score += Math.min(28, 10 + duplicatedLines * 2);
    signals.push(`Opakované shodné řádky: ${duplicatedLines}.`);
  }
  if (nearDuplicatePairs >= 4) {
    score += Math.min(24, 8 + nearDuplicatePairs);
    signals.push(`Velmi podobné zprávy v sérii: ${nearDuplicatePairs} párů.`);
  }
  if (urlDensity >= 0.3 && urls.length >= 3) {
    score += 18;
    signals.push(`Vysoká hustota odkazů: ${Math.round(urlDensity * 100)} % vůči počtu řádků.`);
  }
  if (lexicalDiversity < 0.34 && words.length >= 40) {
    score += 16;
    signals.push(`Nízká slovní rozmanitost: ${Math.round(lexicalDiversity * 100)} %.`);
  }
  if (rapidIntervals >= 3) {
    score += 18;
    signals.push(`Více velmi rychlých intervalů mezi časovými značkami: ${rapidIntervals}.`);
  }
  if (sameIntervals >= 4) {
    score += 12;
    signals.push(`Nápadně pravidelný časový rytmus: ${sameIntervals} shodných intervalů.`);
  }
  if (ctaHits >= 3) {
    score += Math.min(15, ctaHits * 3);
    signals.push(`Opakované spam/CTA výrazy: ${ctaHits}.`);
  }
  if (accountMentions >= 12 && lines.length && accountMentions / lines.length > 0.5) {
    score += 10;
    signals.push(`Vysoká hustota označení účtů: ${accountMentions}.`);
  }

  score = Math.max(0, Math.min(100, score));
  const level = score >= 70 ? 'HIGH' : score >= 40 ? 'MEDIUM' : 'LOW';
  const verdict = level === 'HIGH'
    ? 'Vysoké podezření na automatizovaný nebo koordinovaný spamový vzorec'
    : level === 'MEDIUM'
      ? 'Střední podezření; doporučena ruční kontrola kontextu'
      : 'Nízké podezření podle dostupného textového vzorku';

  if (!signals.length) signals.push('Ve vzorku nebyl nalezen silný automatizační signál podle použitých heuristik.');

  return {
    score,
    level,
    verdict,
    signals,
    metrics: {
      lines: lines.length,
      words: words.length,
      uniqueWords: uniqueWords.size,
      lexicalDiversity: Number(lexicalDiversity.toFixed(3)),
      urls: urls.length,
      urlDensity: Number(urlDensity.toFixed(3)),
      duplicatedLines,
      nearDuplicatePairs,
      timestampSamples: timestamps.length,
      rapidIntervals,
      sameIntervals,
      ctaHits,
      accountMentions
    },
    limitation: 'Jde o analýzu dodaného veřejného textu nebo logu. Výsledek není identifikace konkrétní osoby ani důkaz, že účet je bot.'
  };
}

export async function saveHoundFinding(input, analysis) {
  if (!firestore) throw cloudError();
  const ref = collection('bots').doc();
  const raw = String(input || '').slice(0, 50_000);
  await ref.set({
    type: 'hound-analysis',
    score: analysis.score,
    level: analysis.level,
    verdict: analysis.verdict,
    signals: analysis.signals.slice(0, 30),
    metrics: analysis.metrics,
    limitation: analysis.limitation,
    inputHash: createHash('sha256').update(raw).digest('hex'),
    rawExcerpt: cleanText(raw, 4_000),
    createdAt: FieldValue.serverTimestamp()
  });
  return { id: ref.id };
}

export async function listHoundFindings(limit = 30) {
  if (!firestore) throw cloudError();
  const safeLimit = Math.max(1, Math.min(MAX_CLOUD_ITEMS, Number(limit) || 30));
  const snapshot = await collection('bots').orderBy('createdAt', 'desc').limit(safeLimit).get();
  return snapshot.docs.map(docToJson);
}

export async function cloudSmokeTest() {
  if (!firestore) throw cloudError();
  const ref = collection('cores').doc(`smoke_${Date.now()}`);
  await ref.set({ type: 'cloud-smoke-test', createdAt: FieldValue.serverTimestamp() });
  const readBack = await ref.get();
  await ref.delete();
  if (!readBack.exists) throw new Error('Firestore smoke test document was not readable after write.');
  return { ok: true, path: `users/${USER_UID}/cores/<temporary-smoke-document>`, deleted: true };
}
