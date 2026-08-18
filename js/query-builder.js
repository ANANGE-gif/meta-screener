// query-builder.js — PubMed + 中文数据库检索式构建。

import { SOURCE_META, CN_QUERY_STEPS } from './config.js?v=20260722b';
import { esc } from './utils.js?v=20260722b';

export class QueryBuilder {
  static escapeDoubleQuotedTerm(value) {
    return String(value || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"').trim();
  }

  static escapeSingleQuotedTerm(value) {
    return String(value || '').replace(/'/g, "''").trim();
  }

  /**
   * 从 textarea 读取行（去空行）
   */
  static getLines(id) {
    const el = document.getElementById(id);
    if (!el) return [];
    return el.value.split(/\n+/).map(x => x.trim()).filter(Boolean);
  }

  /**
   * 读取多组概念词组（用 ; 或 , 分隔同组同义词）
   */
  static getConceptGroups(id) {
    return QueryBuilder.getLines(id).map(line =>
      line.split(/[;；,，]/).map(y => y.trim()).filter(Boolean)
    ).filter(g => g.length);
  }

  /**
   * 构建 PubMed 的 [Title/Abstract] 检索组
   */
  static pubmedTitleAbstractGroup(keywords) {
    return '(' + keywords.map(k => `"${QueryBuilder.escapeDoubleQuotedTerm(k)}"[Title/Abstract]`).join(' OR ') + ')';
  }

  /**
   * 构建通用检索组（不带字段限定）
   */
  static genericGroup(keywords) {
    return '(' + keywords.map(k => `"${QueryBuilder.escapeDoubleQuotedTerm(k)}"`).join(' OR ') + ')';
  }

  /** Europe PMC 标题/摘要字段组，口径更接近 PubMed [Title/Abstract] */
  static europePmcTitleAbstractGroup(keywords) {
    return '(' + keywords.map(k => `TITLE_ABS:"${QueryBuilder.escapeDoubleQuotedTerm(k)}"`).join(' OR ') + ')';
  }

  /**
   * 构建 PubMed 检索式
   */
  static buildPubMedQuery() {
    const mode = document.getElementById('mode')?.value || 'wide';
    const parts = [
      ...QueryBuilder.getConceptGroups('pop'),
      ...QueryBuilder.getConceptGroups('expo')
    ];

    const studyMode = document.getElementById('studyMode')?.value;
    if (studyMode === 'animal') parts.push(...QueryBuilder.getConceptGroups('animalTerms'));
    if (mode === 'middle' || mode === 'strict') parts.push(...QueryBuilder.getConceptGroups('outcome'));
    if (mode === 'strict') parts.push(...QueryBuilder.getConceptGroups('design'));

    let query = parts.filter(g => g.length).map(QueryBuilder.pubmedTitleAbstractGroup).join(' AND ');

    const yf = (document.getElementById('yf')?.value || '').trim();
    const yt = (document.getElementById('yt')?.value || '').trim();
    if (yf || yt) {
      const dateClause = `("${yf || '1800'}"[Date - Publication] : "${yt || '3000'}"[Date - Publication])`;
      query = query ? `${query} AND ${dateClause}` : dateClause;
    }
    return query;
  }

  /**
   * 构建通用检索式（Europe PMC / Crossref / OpenAlex）
   */
  static buildGenericQuery() {
    const mode = document.getElementById('mode')?.value || 'wide';
    const parts = [
      ...QueryBuilder.getConceptGroups('pop'),
      ...QueryBuilder.getConceptGroups('expo')
    ];
    const studyMode = document.getElementById('studyMode')?.value;
    if (studyMode === 'animal') parts.push(...QueryBuilder.getConceptGroups('animalTerms'));
    if (mode === 'middle' || mode === 'strict') parts.push(...QueryBuilder.getConceptGroups('outcome'));
    if (mode === 'strict') parts.push(...QueryBuilder.getConceptGroups('design'));

    return parts.filter(g => g.length).map(QueryBuilder.genericGroup).join(' AND ');
  }

  /**
   * 构建 Europe PMC 专用检索式。
   * 不使用默认全文自由检索，避免同一主题相较 PubMed 出现数量级膨胀。
   */
  static buildEuropePMCQuery() {
    const mode = document.getElementById('mode')?.value || 'wide';
    const parts = [
      ...QueryBuilder.getConceptGroups('pop'),
      ...QueryBuilder.getConceptGroups('expo')
    ];
    const studyMode = document.getElementById('studyMode')?.value;
    if (studyMode === 'animal') parts.push(...QueryBuilder.getConceptGroups('animalTerms'));
    if (mode === 'middle' || mode === 'strict') parts.push(...QueryBuilder.getConceptGroups('outcome'));
    if (mode === 'strict') parts.push(...QueryBuilder.getConceptGroups('design'));
    return parts.filter(g => g.length).map(QueryBuilder.europePmcTitleAbstractGroup).join(' AND ');
  }

  /**
   * 获取中文检索关键词（优先中文字段，回退英文）
   */
  static getChineseConceptGroups() {
    const preferChinese = (cnId, fallbackId) => {
      const cnGroups = QueryBuilder.getConceptGroups(cnId);
      return cnGroups.length ? cnGroups : QueryBuilder.getConceptGroups(fallbackId);
    };
    return {
      pops: preferChinese('cnPop', 'pop'),
      animals: preferChinese('cnAnimal', 'animalTerms'),
      expos: preferChinese('cnExpo', 'expo'),
      includeAnimals: (document.getElementById('studyMode')?.value) === 'animal'
    };
  }

  /**
   * 返回最终参与中文数据库检索的概念组。
   * 每行是一个独立概念组（组间 AND）；同一行分号/逗号分隔的是同义词（组内 OR）。
   */
  static getChineseSearchGroups() {
    const { pops, animals, expos, includeAnimals } = QueryBuilder.getChineseConceptGroups();
    return [
      ...pops,
      ...(includeAnimals ? animals : []),
      ...expos
    ].filter(group => Array.isArray(group) && group.length);
  }

  /**
   * 构建 CNKI 专业检索式
   */
  static buildCNKIQuery() {
    return QueryBuilder.getChineseSearchGroups().map(group =>
      '(' + group.map(term => `SU='${QueryBuilder.escapeSingleQuotedTerm(term)}'`).join(' OR ') + ')'
    ).join(' AND ');
  }

  /**
   * 构建万方检索式
   */
  static buildWanfangQuery() {
    return QueryBuilder.getChineseSearchGroups().map(group =>
      '(' + group.map(term => `"${QueryBuilder.escapeDoubleQuotedTerm(term)}"`).join(' OR ') + ')'
    ).join(' AND ');
  }

  /**
   * 构建维普检索式
   */
  static buildVIPQuery() {
    return QueryBuilder.getChineseSearchGroups().map(group =>
      '(' + group.map(term => `SU="${QueryBuilder.escapeDoubleQuotedTerm(term)}"`).join(' OR ') + ')'
    ).join(' AND ');
  }

  /**
   * 构建 CBM/SinoMed 检索式
   */
  static buildCBMQuery() {
    return QueryBuilder.getChineseSearchGroups().map(group =>
      '(' + group.map(term => `"${QueryBuilder.escapeDoubleQuotedTerm(term)}"`).join(' OR ') + ')'
    ).join(' AND ');
  }

  static buildLogicPreview() {
    const englishGroups = [
      ...QueryBuilder.getConceptGroups('pop'),
      ...QueryBuilder.getConceptGroups('expo')
    ];
    const studyMode = document.getElementById('studyMode')?.value;
    if (studyMode === 'animal') englishGroups.push(...QueryBuilder.getConceptGroups('animalTerms'));
    const mode = document.getElementById('mode')?.value || 'wide';
    if (mode === 'middle' || mode === 'strict') englishGroups.push(...QueryBuilder.getConceptGroups('outcome'));
    if (mode === 'strict') englishGroups.push(...QueryBuilder.getConceptGroups('design'));

    const render = groups => groups.map((group, index) =>
      `<div class="logic-group"><span>概念组 ${index + 1}</span><b>${group.map(esc).join(' <em>OR</em> ')}</b></div>`
    ).join('<div class="logic-and">AND</div>');

    return `<div class="logic-preview-head"><b>连接关系预览</b><span>同一行的同义词用 OR；不同行及不同概念字段用 AND</span></div>${render(englishGroups)}`;
  }

  /**
   * 构建所有中文数据库检索式
   */
  static buildCnQueries(chosenSources) {
    const panel = document.getElementById('cnQueryPanel');
    if (!panel) return;
    if (!chosenSources || !chosenSources.length) {
      panel.innerHTML = '';
      return;
    }

    const builders = {
      cnki: QueryBuilder.buildCNKIQuery,
      wanfang: QueryBuilder.buildWanfangQuery,
      vip: QueryBuilder.buildVIPQuery,
      cbm: QueryBuilder.buildCBMQuery
    };

    panel.innerHTML = chosenSources.map(src => {
      const meta = SOURCE_META[src];
      const query = (builders[src] && builders[src]()) || '';
      const steps = CN_QUERY_STEPS[src] || '';
      return `<div class="cn-query-card">
        <b>${esc(meta.label)}</b>
        <div class="q" style="margin:6px 0;font-size:13px">${esc(query)}</div>
        <div class="actions">
          <button class="btn-copy-cn" data-src="${src}">复制检索式</button>
          <button class="btn-open-cn" data-url="${esc(meta.searchUrl || '')}" data-label="${esc(meta.label)}">打开${esc(meta.label)}</button>
        </div>
        <p class="note">${esc(steps)}</p>
      </div>`;
    }).join('');
  }

  /**
   * 获取特定数据源的检索式文本
   */
  static getQueryForSource(src) {
    const builders = {
      cnki: QueryBuilder.buildCNKIQuery,
      wanfang: QueryBuilder.buildWanfangQuery,
      vip: QueryBuilder.buildVIPQuery,
      cbm: QueryBuilder.buildCBMQuery
    };
    return (builders[src] && builders[src]()) || '';
  }

  /**
   * 主入口：刷新所有检索式并更新 UI
   */
  static refreshAll() {
    const pubmedQ = QueryBuilder.buildPubMedQuery();
    const europePmcQ = QueryBuilder.buildEuropePMCQuery();
    const genericQ = QueryBuilder.buildGenericQuery();

    const pubmedEl = document.getElementById('pubmedQuery');
    const europePmcEl = document.getElementById('europePmcQuery');
    const genericEl = document.getElementById('genericQuery');
    if (pubmedEl) pubmedEl.textContent = pubmedQ;
    if (europePmcEl) europePmcEl.textContent = europePmcQ;
    if (genericEl) genericEl.textContent = genericQ;

    const logicPreview = document.getElementById('queryLogicPreview');
    if (logicPreview) logicPreview.innerHTML = QueryBuilder.buildLogicPreview();

    const cnSources = [...document.querySelectorAll('.db-check-cn:checked')].map(x => x.value);
    QueryBuilder.buildCnQueries(cnSources);

    return { pubmed: pubmedQ, europePmc: europePmcQ, generic: genericQ };
  }
}
