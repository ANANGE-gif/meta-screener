// record.js — Record 数据模型与规范化。纯数据转换，无 DOM 访问。

import { normDoi, normTitle, generateId } from './utils.js?v=20260722b';
import { SOURCE_META } from './config.js?v=20260722b';

/**
 * 规范化后的文献记录
 */
export class Record {
  constructor(raw = {}) {
    const r = normalizeRecord(raw);
    Object.assign(this, r);
  }
}

/**
 * 推断记录的默认数据源
 */
export function defaultSourceFor(r) {
  if (!r) return 'unknown';
  if (r.source) return r.source;
  if (r.pmid) return 'pubmed';
  return 'unknown';
}

/**
 * 获取数据源的显示标签
 */
export function sourceLabelFor(src) {
  return (SOURCE_META[src] || SOURCE_META.unknown).label;
}

/**
 * 获取数据源元数据
 */
export function sourceInfo(src) {
  return SOURCE_META[src] || SOURCE_META.unknown;
}

/**
 * 规范化一条数据源条目
 */
export function normalizeSourceEntry(entry) {
  if (!entry) return null;
  if (typeof entry === 'string') {
    return { source: entry, sourceLabel: sourceLabelFor(entry), sourceId: '', sourceUrl: '' };
  }
  const source = entry.source || 'unknown';
  return {
    source,
    sourceLabel: entry.sourceLabel || sourceLabelFor(source),
    sourceId: entry.sourceId || '',
    sourceUrl: entry.sourceUrl || ''
  };
}

/**
 * 合并多条数据源条目（去重）
 */
export function mergeSourceEntries(entries) {
  const map = new Map();
  (entries || []).forEach(entry => {
    const item = normalizeSourceEntry(entry);
    if (!item) return;
    const key = `${item.source}::${item.sourceId || item.sourceUrl || ''}`;
    if (!map.has(key)) map.set(key, item);
  });
  return [...map.values()];
}

/**
 * 生成去重键
 */
export function makeDedupeKey(r) {
  if (r.pmid) return `pmid:${String(r.pmid).trim()}`;
  if (r.doi) return `doi:${normDoi(r.doi)}`;
  const title = normTitle(r.title);
  if (title && r.year) return `titleyear:${title}:${r.year}`;
  if (title) return `title:${title}`;
  return `source:${r.source || 'unknown'}:${r.sourceId || Math.random().toString(36).slice(2, 8)}`;
}

/**
 * 规范化一条原始记录为标准化 Record 数据
 */
export function normalizeRecord(r) {
  const raw = r || {};
  const source = defaultSourceFor(raw);
  const sourceId = raw.sourceId || raw.pmid || raw.doi || '';
  const sourceUrl = raw.sourceUrl || (raw.pmid ? `https://pubmed.ncbi.nlm.nih.gov/${raw.pmid}/` : '');

  let sources = Array.isArray(raw.sources) && raw.sources.length
    ? raw.sources.map(normalizeSourceEntry).filter(Boolean)
    : [{ source, sourceLabel: raw.sourceLabel || sourceLabelFor(source), sourceId, sourceUrl }];

  const normalized = {
    id: raw.id || '',
    source,
    sourceLabel: raw.sourceLabel || sourceLabelFor(source),
    sourceId,
    sourceUrl,
    sources: mergeSourceEntries(sources),
    pmid: raw.pmid || '',
    doi: normDoi(raw.doi || ''),
    title: raw.title || '',
    year: String(raw.year || '').trim(),
    journal: raw.journal || '',
    authors: raw.authors || '',
    abstract: raw.abstract || '',
    publicationTypes: Array.isArray(raw.publicationTypes) ? raw.publicationTypes.filter(Boolean) : [],
    language: raw.language || '',
    recordType: raw.recordType || '',
    queryUsed: raw.queryUsed || '',
    fetchedAt: raw.fetchedAt || '',
    importMethod: raw.importMethod || 'api',
    importBatch: raw.importBatch || '',
    score: Number(raw.score || 0),
    decision: raw.decision || '待人工判断',
    hits: raw.hits || '',
    reason: raw.reason || '',
    studyType: raw.studyType || 'unclear',
    humanScore: Number(raw.humanScore || 0),
    animalScore: Number(raw.animalScore || 0),
    scoreDetails: Array.isArray(raw.scoreDetails) ? raw.scoreDetails : [],
    manual: Boolean(raw.manual),
    manualNote: raw.manualNote || '',
    mergedCount: Number(raw.mergedCount || 1),
    dedupeKey: raw.dedupeKey || '',
    createdAt: raw.createdAt || new Date().toISOString()
  };

  normalized.dedupeKey = makeDedupeKey(normalized);
  normalized.id = normalized.id || normalized.dedupeKey || generateId();
  return normalized;
}

/**
 * 两条记录的标题和年份是否相同
 */
export function sameTitleYear(a, b) {
  return normTitle(a.title) && normTitle(a.title) === normTitle(b.title)
    && String(a.year || '') === String(b.year || '');
}

/**
 * 返回较长的字符串
 */
export function preferLonger(a, b) {
  return String(b || '').length > String(a || '').length ? b : a;
}
