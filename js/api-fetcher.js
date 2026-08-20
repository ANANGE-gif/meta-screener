// api-fetcher.js — PubMed / Europe PMC / Crossref / OpenAlex API 获取器。

import { sourceLabelFor } from './record.js?v=20260722b';
import { FileParser } from './parsers.js?v=20260722b';
import { QueryBuilder } from './query-builder.js?v=20260722b';
import { yearInRange, delay, fetchWithTimeout } from './utils.js?v=20260722b';

const MAX_RECORDS_PER_SOURCE = 10000;
const SEARCH_WINDOW_MS = 60 * 1000;
const MAX_SEARCHES_PER_WINDOW = 4;
const MIN_SEARCH_INTERVAL_MS = 2500;
const SEARCH_GUARD_KEY = 'meta_screener_search_guard_v1';

export class ApiFetcher {
  #aborted = false;
  #fetching = false;
  #onProgress;
  #onComplete;
  #onError;
  #onSourceComplete;
  #gatewayDisabled = false;

  #consumeSearchBudget() {
    const now = Date.now();
    let recent = [];
    try {
      recent = JSON.parse(sessionStorage.getItem(SEARCH_GUARD_KEY) || '[]');
      if (!Array.isArray(recent)) recent = [];
    } catch {
      recent = [];
    }
    recent = recent.filter(value => Number.isFinite(value) && now - value < SEARCH_WINDOW_MS);
    const last = recent[recent.length - 1] || 0;
    if (last && now - last < MIN_SEARCH_INTERVAL_MS) {
      const wait = Math.ceil((MIN_SEARCH_INTERVAL_MS - (now - last)) / 1000);
      throw new Error(`请求过快，请等待 ${wait} 秒后再检索`);
    }
    if (recent.length >= MAX_SEARCHES_PER_WINDOW) {
      const wait = Math.max(1, Math.ceil((SEARCH_WINDOW_MS - (now - recent[0])) / 1000));
      throw new Error(`一分钟内检索次数过多，请等待 ${wait} 秒`);
    }
    recent.push(now);
    sessionStorage.setItem(SEARCH_GUARD_KEY, JSON.stringify(recent));
  }

  constructor({ onProgress, onComplete, onError, onSourceComplete } = {}) {
    this.#onProgress = onProgress;
    this.#onComplete = onComplete;
    this.#onError = onError;
    this.#onSourceComplete = onSourceComplete;
  }

  abort() {
    this.#aborted = true;
    this.#fetching = false;
  }

  reset() {
    this.#aborted = false;
    this.#fetching = false;
  }

  get aborted() {
    return this.#aborted;
  }

  /** 获取当前限制条数 */
  getMaxFetch() {
    const trial = localStorage['meta_screener_pro_license'] === 'trial';
    if (trial) return 15;
    const v = +(document.getElementById('max')?.value || 0);
    if (v <= 0) return MAX_RECORDS_PER_SOURCE;
    return Math.min(Math.floor(v), MAX_RECORDS_PER_SOURCE);
  }

  /** 读取年份范围 */
  getYearRange() {
    return {
      from: document.getElementById('yf')?.value || '',
      to: document.getElementById('yt')?.value || ''
    };
  }

  #emitProgress(current, total, label) {
    if (this.#onProgress) this.#onProgress({ current, total, label });
  }

  #emitError(source, error) {
    if (this.#onError) this.#onError({ source, error });
  }

  #transportUrl(url) {
    if (this.#gatewayDisabled) return url;
    const local = location.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(location.hostname);
    return local ? `/api/proxy?url=${encodeURIComponent(url)}` : url;
  }

  async #fetchResponse(url, label, { timeoutMs = 25000, retries = 1 } = {}) {
    let lastError;
    for (let attempt = 0; attempt <= retries; attempt++) {
      if (this.#aborted) throw new Error('检索已停止');
      try {
        const transportUrl = this.#transportUrl(url);
        let response = await fetchWithTimeout(transportUrl, {}, timeoutMs);
        // Compatibility fallback for an old local static server without the gateway.
        if (transportUrl !== url && response.status === 404) {
          this.#gatewayDisabled = true;
          response = await fetchWithTimeout(url, {}, timeoutMs);
        }
        if (!response.ok) {
          const detail = await response.text().catch(() => '');
          const suffix = detail ? `：${detail.slice(0, 160)}` : '';
          const error = new Error(`${label} HTTP ${response.status}${suffix}`);
          error.status = response.status;
          const retryAfter = Number(response.headers.get('Retry-After') || 0);
          error.retryAfterMs = retryAfter > 0 ? retryAfter * 1000 : 0;
          throw error;
        }
        return response;
      } catch (error) {
        lastError = error;
        if (attempt < retries && !this.#aborted) {
          const backoff = error.retryAfterMs || Math.min(8000, 750 * (2 ** attempt));
          await delay(backoff);
        }
      }
    }
    throw lastError || new Error(`${label} 请求失败`);
  }

  async #fetchJson(url, label, options) {
    return (await this.#fetchResponse(url, label, options)).json();
  }

  async #fetchText(url, label, options) {
    return (await this.#fetchResponse(url, label, options)).text();
  }

  #yearFilterForCrossref(from, to) {
    const filters = [];
    if (from) filters.push(`from-pub-date:${from}-01-01`);
    if (to) filters.push(`until-pub-date:${to}-12-31`);
    return filters.length ? `&filter=${encodeURIComponent(filters.join(','))}` : '';
  }

  #yearFilterForOpenAlex(from, to) {
    const filters = [];
    if (from) filters.push(`from_publication_date:${from}-01-01`);
    if (to) filters.push(`to_publication_date:${to}-12-31`);
    return filters.length ? `&filter=${encodeURIComponent(filters.join(','))}` : '';
  }

  // ===== PubMed =====

  #resolveQuery(meta, elementId, isPubMed) {
    // Priority: meta.query > DOM element > rebuild from inputs
    const fromDom = (document.getElementById(elementId)?.textContent || '').trim();
    const query = meta.query || fromDom;
    if (query) return query;
    // Ultimate fallback: rebuild query string from current inputs
    const rebuilt = isPubMed ? QueryBuilder.buildPubMedQuery() : QueryBuilder.buildGenericQuery();
    if (!rebuilt) throw new Error('检索式为空，请填写疾病/人群和暴露/基因关键词');
    return rebuilt;
  }

  #pubMedApiKeyParam() {
    const apiKey = (document.getElementById('pubMedApiKey')?.value || '').trim();
    return apiKey ? `&api_key=${encodeURIComponent(apiKey)}` : '';
  }

  #pubMedRequestDelay() {
    return (document.getElementById('pubMedApiKey')?.value || '').trim() ? 120 : 350;
  }

  #pubMedSearchUrl(query, sort, retmax, retstart, apiKeyParam) {
    return `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&retmode=json&sort=${sort}&term=${encodeURIComponent(query)}&retmax=${retmax}&retstart=${retstart}${apiKeyParam}`;
  }

  #pubMedDate(value) {
    const d = new Date(value);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    return `${y}/${m}/${day}`;
  }

  /**
   * PubMed ESearch 只能访问单次检索结果的前 10,000 个 PMID。
   * 大结果集按发表日期递归拆分，直到每个时间片不超过该上限。
   */
  async #fetchPubMedIdsByDate({ query, sort, target, fromYear, toYear, apiKeyParam, requestDelay }) {
    const dayMs = 24 * 60 * 60 * 1000;
    const startYear = Math.max(1000, Number(fromYear) || 1800);
    const endYear = Math.min(3000, Number(toYear) || (new Date().getUTCFullYear() + 1));
    const queue = [[Date.UTC(startYear, 0, 1), Date.UTC(endYear, 11, 31)]];
    const seen = new Set();
    const ids = [];

    while (queue.length && ids.length < target && !this.#aborted) {
      const [start, end] = queue.shift();
      const range = `("${this.#pubMedDate(start)}"[Date - Publication] : "${this.#pubMedDate(end)}"[Date - Publication])`;
      const segmentQuery = `(${query}) AND ${range}`;
      await delay(requestDelay);
      const countJson = await this.#fetchJson(
        this.#pubMedSearchUrl(segmentQuery, sort, 0, 0, apiKeyParam),
        'PubMed 分段计数'
      );
      const segmentCount = Number(countJson.esearchresult?.count || 0);
      if (!segmentCount) continue;

      if (segmentCount > 10000) {
        if (start >= end) {
          throw new Error(`PubMed 在 ${this.#pubMedDate(start)} 单日命中超过 10,000 条，无法通过公开 ESearch 完整导出；请增加研究类型或其他限制条件`);
        }
        const mid = start + Math.floor((end - start) / (2 * dayMs)) * dayMs;
        queue.unshift([mid + dayMs, end]);
        queue.unshift([start, mid]);
        continue;
      }

      for (let retstart = 0; retstart < segmentCount && ids.length < target && !this.#aborted; retstart += 500) {
        await delay(requestDelay);
        const page = await this.#fetchJson(
          this.#pubMedSearchUrl(segmentQuery, sort, Math.min(500, segmentCount - retstart), retstart, apiKeyParam),
          'PubMed 分段 ESearch'
        );
        const pageIds = page.esearchresult?.idlist || [];
        if (!pageIds.length) break;
        pageIds.forEach(id => {
          if (ids.length < target && !seen.has(id)) {
            seen.add(id);
            ids.push(id);
          }
        });
        this.#emitProgress(ids.length, target, `PubMed: 分段获取 ID ${ids.length}/${target}`);
      }
    }
    return ids;
  }

  async fetchPubMed(meta) {
    const q = this.#resolveQuery(meta, 'pubmedQuery', true);
    const max = this.getMaxFetch();
    const unlimited = max === 0;
    const sort = document.getElementById('sort')?.value === 'pub date' ? 'pub_date' : 'relevance';
    const batchSize = 500;
    const { from: yf, to: yt } = this.getYearRange();
    const apiKeyParam = this.#pubMedApiKeyParam();
    const requestDelay = this.#pubMedRequestDelay();

    let allIds = [];

    this.#emitProgress(0, 0, 'PubMed: 搜索中...');
    const firstRes = await this.#fetchJson(
      this.#pubMedSearchUrl(q, sort, unlimited ? batchSize : Math.min(batchSize, max), 0, apiKeyParam),
      'PubMed ESearch'
    );
    const totalAvail = Number(firstRes.esearchresult?.count || 0);
    const target = unlimited ? totalAvail : Math.min(max, totalAvail);

    if (target > 10000) {
      this.#emitProgress(0, target, `PubMed: 命中 ${totalAvail.toLocaleString()}，按日期分段获取...`);
      allIds = await this.#fetchPubMedIdsByDate({
        query: q, sort, target, fromYear: yf, toYear: yt, apiKeyParam, requestDelay
      });
    } else {
      allIds = (firstRes.esearchresult?.idlist || []).slice(0, target);
      while (allIds.length < target && !this.#aborted) {
        const retstart = allIds.length;
        this.#emitProgress(allIds.length, target, `PubMed: 获取ID ${allIds.length}/${target}`);
        await delay(requestDelay);
        const res = await this.#fetchJson(
          this.#pubMedSearchUrl(q, sort, Math.min(batchSize, target - allIds.length), retstart, apiKeyParam),
          'PubMed ESearch'
        );
        const ids = res.esearchresult?.idlist || [];
        if (!ids.length) break;
        allIds.push(...ids);
      }
    }

    if (!allIds.length) {
      this.#emitError('pubmed', '未找到结果');
      return { source: 'pubmed', records: [], available: totalAvail, downloaded: 0, message: '命中 0，下载 0' };
    }

    let allRecords = [];
    const fetchBatch = 500;
    for (let i = 0; i < allIds.length && !this.#aborted; i += fetchBatch) {
      const chunk = allIds.slice(i, i + fetchBatch);
      this.#emitProgress(i, allIds.length, `PubMed: 下载 ${i}/${allIds.length}`);
      if (i > 0) await delay(requestDelay);
      const xml = await this.#fetchText(
        `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&retmode=xml&id=${chunk.join(',')}${apiKeyParam}`,
        'PubMed EFetch',
        { timeoutMs: 35000, retries: 1 }
      );
      allRecords.push(...FileParser.parsePubMedXML(xml, meta));
    }
    allRecords = allRecords.filter(r => yearInRange(r.year, yf, yt));
    return {
      source: 'pubmed', records: allRecords, available: totalAvail, downloaded: allRecords.length, rawDownloaded: allIds.length,
      message: `命中 ${totalAvail.toLocaleString()}，下载 ${allRecords.length.toLocaleString()}`
    };
  }

  // ===== Europe PMC =====

  async fetchEuropePMC(meta) {
    const q = this.#resolveQuery(meta, 'genericQuery', false);
    const max = this.getMaxFetch();
    const unlimited = max === 0;
    const pageSize = unlimited ? 1000 : Math.min(1000, max);
    const { from: yf, to: yt } = this.getYearRange();
    const yearQuery = (yf || yt) ? ` AND PUB_YEAR:[${yf || '1800'} TO ${yt || '3000'}]` : '';
    const apiQuery = `${q}${yearQuery}`;

    let allRecords = [];
    let cursorMark = '*';
    let totalAvail = 0;
    let rawDownloaded = 0;
    while ((unlimited || allRecords.length < max) && !this.#aborted) {
      this.#emitProgress(allRecords.length, unlimited ? 0 : max, `Europe PMC: ${allRecords.length} 条...`);
      const requestSize = unlimited ? pageSize : Math.min(pageSize, max - allRecords.length);
      const url = `https://www.ebi.ac.uk/europepmc/webservices/rest/search?format=json&resultType=core&pageSize=${requestSize}&cursorMark=${encodeURIComponent(cursorMark)}&query=${encodeURIComponent(apiQuery)}`;
      const json = await this.#fetchJson(url, 'Europe PMC');
      totalAvail = Number(json.hitCount || totalAvail || 0);
      const rawCount = json?.resultList?.result?.length || 0;
      rawDownloaded += rawCount;
      const records = FileParser.parseEuropePMCJson(json, meta).filter(r => yearInRange(r.year, yf, yt));
      allRecords.push(...records);
      if (!rawCount) break;
      const nextCursorMark = json.nextCursorMark || '';
      if (!nextCursorMark || nextCursorMark === cursorMark) break;
      cursorMark = nextCursorMark;
      await delay(60);
    }
    if (!unlimited) allRecords = allRecords.slice(0, max);
    return {
      source: 'europepmc', records: allRecords, available: totalAvail, downloaded: allRecords.length, rawDownloaded,
      message: `命中 ${totalAvail.toLocaleString()}，下载 ${allRecords.length.toLocaleString()}`
    };
  }

  // ===== Crossref =====

  async fetchCrossref(meta) {
    const q = this.#resolveQuery(meta, 'genericQuery', false);
    const max = this.getMaxFetch();
    const unlimited = max === 0;
    const rows = unlimited ? 1000 : Math.min(1000, max);
    const sortParam = (document.getElementById('sort')?.value === 'pub date') ? 'published' : 'relevance';
    const { from: yf, to: yt } = this.getYearRange();
    const dateFilter = this.#yearFilterForCrossref(yf, yt);
    const contactEmail = (document.getElementById('apiContactEmail')?.value || '').trim();
    const politeParam = contactEmail ? `&mailto=${encodeURIComponent(contactEmail)}` : '';

    let allRecords = [];
    let cursor = '*';
    let totalAvail = 0;
    let rawDownloaded = 0;
    while ((unlimited || allRecords.length < max) && !this.#aborted) {
      this.#emitProgress(allRecords.length, unlimited ? 0 : max, `Crossref: ${allRecords.length} 条...`);
      const requestSize = unlimited ? rows : Math.min(rows, max - allRecords.length);
      const url = `https://api.crossref.org/works?rows=${requestSize}&cursor=${encodeURIComponent(cursor)}&query.bibliographic=${encodeURIComponent(q)}&sort=${sortParam}${dateFilter}${politeParam}`;
      const json = await this.#fetchJson(url, 'Crossref');
      totalAvail = Number(json.message?.['total-results'] || totalAvail || 0);
      const rawCount = json.message?.items?.length || 0;
      rawDownloaded += rawCount;
      const records = FileParser.parseCrossrefJson(json, meta).filter(r => yearInRange(r.year, yf, yt));
      allRecords.push(...records);
      if (!rawCount || rawCount < requestSize) break;
      const nextCursor = json.message?.['next-cursor'] || '';
      if (!nextCursor || nextCursor === cursor) break;
      cursor = nextCursor;
      await delay(80);
    }
    if (!unlimited) allRecords = allRecords.slice(0, max);
    return {
      source: 'crossref', records: allRecords, available: totalAvail, downloaded: allRecords.length, rawDownloaded,
      message: `元数据匹配 ${totalAvail.toLocaleString()}，下载 ${allRecords.length.toLocaleString()}`
    };
  }

  // ===== OpenAlex =====

  async fetchOpenAlex(meta) {
    const q = this.#resolveQuery(meta, 'genericQuery', false);
    const max = this.getMaxFetch();
    const unlimited = max === 0;
    const perPage = 200;
    const { from: yf, to: yt } = this.getYearRange();
    const dateFilter = this.#yearFilterForOpenAlex(yf, yt);
    const apiKey = (document.getElementById('openAlexApiKey')?.value || '').trim();
    if (!apiKey) {
      throw new Error('需要免费 OpenAlex API Key；请在“高级评分设置”中填写后重试');
    }
    const apiKeyParam = apiKey ? `&api_key=${encodeURIComponent(apiKey)}` : '';
    const sortParam = document.getElementById('sort')?.value === 'pub date'
      ? '&sort=publication_date:desc'
      : '&sort=relevance_score:desc';

    let allRecords = [];
    let cursor = '*';
    let pageNum = 0;
    let totalAvail = 0;
    let rawDownloaded = 0;
    while ((unlimited || allRecords.length < max) && !this.#aborted) {
      pageNum++;
      this.#emitProgress(allRecords.length, unlimited ? 0 : max, `OpenAlex: ${allRecords.length} 条 (第${pageNum}页)...`);
      const requestSize = unlimited ? perPage : Math.min(perPage, max - allRecords.length);
      const select = '&select=id,doi,ids,title,publication_year,primary_location,authorships,abstract_inverted_index,type';
      const url = `https://api.openalex.org/works?per-page=${requestSize}&cursor=${encodeURIComponent(cursor)}&search=${encodeURIComponent(q)}${dateFilter}${sortParam}${apiKeyParam}${select}`;
      let json;
      try {
        json = await this.#fetchJson(url, 'OpenAlex', { timeoutMs: 30000, retries: 3 });
      } catch (e) {
        if (String(e.message || '').includes('403')) {
          throw new Error('OpenAlex 拒绝请求；请在高级设置中填写免费 API Key');
        }
        if (String(e.message || '').includes('429')) {
          throw new Error('OpenAlex 请求频率受限；请填写免费 API Key 后重试');
        }
        throw e;
      }
      totalAvail = Number(json?.meta?.count || totalAvail || 0);
      const rawCount = json?.results?.length || 0;
      rawDownloaded += rawCount;
      const parsed = FileParser.parseOpenAlexJson(json, meta);
      const records = parsed.filter(r => yearInRange(r.year, yf, yt));
      if (rawCount > 0 && !records.length) console.warn(`OpenAlex page ${pageNum}: ${rawCount} raw → 0 parsed`);
      allRecords.push(...records);
      if (!rawCount) break;
      const nextCursor = json.meta?.next_cursor || '';
      if (!nextCursor || nextCursor === cursor) break;
      cursor = nextCursor;
      await delay(100);
    }
    if (!unlimited) allRecords = allRecords.slice(0, max);
    return {
      source: 'openalex', records: allRecords, available: totalAvail, downloaded: allRecords.length, rawDownloaded,
      message: `命中 ${totalAvail.toLocaleString()}，下载 ${allRecords.length.toLocaleString()}`
    };
  }

  // ===== Orchestrator =====

  async fetchSelectedDatabases(chosenSources) {
    if (!chosenSources.length) return { messages: ['请先勾选至少一个数据库'], records: [] };
    if (this.#fetching) return { messages: ['正在检索中，请稍候...'], records: [] };
    this.#consumeSearchBudget();
    this.#fetching = true;

    const FETCHERS = {
      pubmed: this.fetchPubMed.bind(this),
      europepmc: this.fetchEuropePMC.bind(this),
      crossref: this.fetchCrossref.bind(this),
      openalex: this.fetchOpenAlex.bind(this)
    };

    const batch = `batch-${Date.now()}`;
    const messages = [];
    let allFetched = [];
    const audits = [];

    const requestedSources = [...new Set(chosenSources)].filter(source => Object.hasOwn(FETCHERS, source));
    const openAlexKey = (document.getElementById('openAlexApiKey')?.value || '').trim();
    const activeSources = requestedSources.filter(source => source !== 'openalex' || openAlexKey);
    if (requestedSources.includes('openalex') && !openAlexKey) {
      messages.push('OpenAlex：未填写 API Key，已安全跳过；不影响其他数据库');
      const audit = {
        source: 'openalex',
        label: sourceLabelFor('openalex'),
        ok: false,
        skipped: true,
        error: '未填写 API Key，已跳过',
        elapsedMs: 0,
        completedAt: new Date().toISOString()
      };
      audits.push(audit);
      this.#onSourceComplete?.(audit);
    }

    if (!activeSources.length) {
      this.#fetching = false;
      return { messages, records: [], audits };
    }

    const tasks = activeSources.map(async source => {
      if (this.#aborted) return null;
      const startedAt = Date.now();
      try {
        this.#emitProgress(0, 0, `${sourceLabelFor(source)}: 检索中...`);
        const pubmedQ = document.getElementById('pubmedQuery')?.textContent?.trim() || '';
        const genericQ = document.getElementById('genericQuery')?.textContent?.trim() || '';
        const sourceQuery = source === 'pubmed'
          ? pubmedQ
          : source === 'europepmc'
            ? QueryBuilder.buildEuropePMCQuery()
            : genericQ;
        const meta = {
          batch,
          query: sourceQuery
        };
        const result = await FETCHERS[source](meta);
        const audit = {
          source,
          label: sourceLabelFor(source),
          ok: true,
          query: sourceQuery,
          available: Number(result.available || 0),
          rawDownloaded: Number(result.rawDownloaded ?? result.downloaded ?? 0),
          downloaded: Number(result.downloaded || 0),
          elapsedMs: Date.now() - startedAt,
          completedAt: new Date().toISOString()
        };
        this.#onSourceComplete?.(audit);
        return { source, result, query: sourceQuery, audit };
      } catch (e) {
        this.#emitError(source, e);
        const audit = {
          source,
          label: sourceLabelFor(source),
          ok: false,
          error: e.message || '网络错误',
          elapsedMs: Date.now() - startedAt,
          completedAt: new Date().toISOString()
        };
        this.#onSourceComplete?.(audit);
        return { source, error: e, audit };
      }
    });

    try {
      const settled = await Promise.all(tasks);
      if (localStorage['meta_screener_pro_license'] === 'trial') {
        messages.push('试用模式：每个数据库最多下载 15 条；激活 Pro 后按“目标获取数量”执行');
      }
      settled.filter(Boolean).forEach(item => {
        if (item.error) {
          messages.push(`${sourceLabelFor(item.source)}：失败（${item.error.message || '网络错误'}）`);
          audits.push(item.audit);
          return;
        }
        const result = item.result;
        if (result.records?.length) allFetched.push(...result.records);
        messages.push(`${sourceLabelFor(item.source)}：${result.message || '完成'}`);
        audits.push(item.audit);
      });
    } finally {
      this.#fetching = false;
    }
    return { messages, records: allFetched, audits };
  }
}

// Re-export parser functions used by ApiFetcher (they're in parsers.js)
// This is handled by the import at the top — no circular dependency
// because parsers.js doesn't import from api-fetcher.js.
