// renderer.js — UI 渲染：表格、统计、标签、过滤下拉、分页。

import { SOURCE_META, STUDY_TYPE_MAP, DEFAULT_PAGE_SIZE } from './config.js?v=20260722b';
import { esc, escAttr, escapeRegExp } from './utils.js?v=20260722b';
import { sourceLabelFor, sourceInfo } from './record.js?v=20260722b';
import { PrismaDiagram } from './prisma.js?v=20260722b';

export class Renderer {
  #state;
  #eventBus;
  #pageSize = DEFAULT_PAGE_SIZE;

  constructor(state, eventBus) {
    this.#state = state;
    this.#eventBus = eventBus;
  }

  // ===== Badge Helpers =====

  static sourceBadge(src, label) {
    const m = SOURCE_META[src] || SOURCE_META.unknown;
    return `<span class="src-badge ${m.className}">${esc(label || m.label)}</span>`;
  }

  static studyTypeBadge(st) {
    const { label, cls } = STUDY_TYPE_MAP[st] || STUDY_TYPE_MAP.unclear;
    return `<span class="${cls}">${label}</span>`;
  }

  static sourceDisplay(r) {
    const lst = (r.sources && r.sources.length ? r.sources : [{ source: r.source, sourceLabel: r.sourceLabel }]);
    return lst.map(s => Renderer.sourceBadge(s.source, s.sourceLabel || sourceLabelFor(s.source))).join('');
  }

  static sourceDisplayText(r) {
    const labels = (r.sources && r.sources.length ? r.sources : [{ source: r.source, sourceLabel: r.sourceLabel }])
      .map(s => s.sourceLabel || sourceLabelFor(s.source));
    return [...new Set(labels)].join(' + ');
  }

  static identifierLinks(r) {
    const parts = [];
    if (r.pmid) parts.push(`<a target="_blank" href="https://pubmed.ncbi.nlm.nih.gov/${esc(r.pmid)}/">PMID:${esc(r.pmid)}</a>`);
    if (r.doi) parts.push(`<a target="_blank" href="https://doi.org/${esc(r.doi)}">DOI</a>`);
    return parts.join(' ');
  }

  // ===== Text Highlighting =====

  highlightText(s, query) {
    let out = esc(s);
    if (query) {
      out = out.replace(new RegExp(escapeRegExp(query), 'ig'), m => `<span class="hl">${m}</span>`);
    }
    return out;
  }

  // ===== Table =====

  renderTable() {
    const filters = this.#state.filters;
    const records = this.#state.getFilteredRecords();
    const page = records.slice(0, this.#pageSize);
    const hasMore = records.length > this.#pageSize;
    const tbody = document.getElementById('tb');
    if (!tbody) return;

    tbody.innerHTML = page.map(r => {
      const absSnippet = (r.abstract || '').slice(0, 300);
      return `<tr>
        <td>${Renderer.sourceDisplay(r)}</td>
        <td>${Renderer.studyTypeBadge(r.studyType)}</td>
        <td><span class="tag ${r.decision}">${r.decision}</span></td>
        <td><b>${r.score}</b></td>
        <td><b>${this.highlightText(r.title, filters.query)}</b><div class="muted small">${this.highlightText(absSnippet, filters.query)}</div></td>
        <td>${esc(r.year)}</td>
        <td>${esc(r.journal)}</td>
        <td class="small">${esc(r.authors)}</td>
        <td class="small">${Renderer.identifierLinks(r)}</td>
        <td class="small">${esc(r.hits)}</td>
        <td class="small">${esc(r.reason)}</td>
        <td><div class="actions">
          <button class="g btn-mark" data-id="${escAttr(r.id)}" data-action="include">纳入</button>
          <button class="r btn-mark" data-id="${escAttr(r.id)}" data-action="exclude">排除</button>
        </div></td>
      </tr>`;
    }).join('')
    + (hasMore
      ? `<tr><td colspan="12" style="text-align:center;padding:12px"><span class="muted">显示前 ${this.#pageSize} / ${records.length} 条</span> <button id="btnShowAll" style="font-size:12px;padding:4px 10px">显示全部 (${records.length} 条)</button></td></tr>`
      : '');
  }

  showAll() {
    this.#pageSize = 99999;
    this.renderTable();
  }

  resetPage() {
    this.#pageSize = DEFAULT_PAGE_SIZE;
  }

  // ===== Statistics =====

  renderStats() {
    const stats = this.#state.getStats();

    const setText = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    setText('nFetched', stats.fetched);
    setText('total', stats.total);
    setText('nDup', stats.duplicates);
    setText('nIn', stats.autoIncluded);
    setText('nEx', stats.autoExcluded);
    setText('nMay', stats.pending);
    setText('nFinIn', stats.finalIncluded);
    setText('nFinEx', stats.finalExcluded);
  }

  renderSourceStats() {
    const el = document.getElementById('sourceStats');
    if (!el) return;
    const counts = this.#state.getSourceCounts();
    const total = Object.values(counts).reduce((a, b) => a + b, 0);

    el.innerHTML = Object.keys(counts).sort().map(key =>
      `${Renderer.sourceBadge(key)} <span class="muted">${counts[key]}</span>`
    ).join(' ')
    + `<span style="margin-left:8px;font-size:11px;color:#64748b">（来源计数合计 = ${total}，含同一记录被多库收录的重复计数）</span>`;
  }

  renderSourceFilterOptions() {
    const select = document.getElementById('fs');
    if (!select) return;
    const current = select.value;
    const counts = this.#state.getSourceCounts();

    select.innerHTML = '<option value="">全部来源</option>'
      + Object.keys(counts).sort().map(key =>
        `<option value="${esc(key)}">${esc(sourceLabelFor(key))} (${counts[key]})</option>`
      ).join('');
    select.value = counts[current] ? current : '';
  }

  // ===== PRISMA =====

  renderPRISMA() {
    const container = document.getElementById('prismaContainer');
    if (!container) return;
    const prismaRec = this.#state.getStudyFilteredRecords();
    PrismaDiagram.render(container, prismaRec);
    this.#state.markPrismaClean();
  }

  // ===== Main Render =====

  render() {
    this.renderSourceFilterOptions();
    this.renderTable();
    this.renderStats();
    this.renderSourceStats();
    if (this.#state.prismaDirty) {
      this.renderPRISMA();
    }
  }

  /**
   * Mark a record: include or exclude
   */
  markRecord(id, decision) {
    const r = this.#state.findRecord(id);
    if (!r) return;
    r.decision = decision;
    r.manual = decision === '最终纳入' || decision === '最终排除';
    r.reason = decision === '最终排除' ? '人工排除'
      : (decision === '最终纳入' ? '人工纳入' : '待人工重新判断');
    this.#state.markPrismaDirty();
    this.#state.saveNow();
    this.render();
    this.renderPRISMA();
    this.#eventBus?.emit('prisma:updated');
  }

  // ===== Event delegation for table =====

  setupTableDelegation() {
    const tbody = document.getElementById('tb');
    if (!tbody) return;

    tbody.addEventListener('click', (e) => {
      const btn = e.target.closest('.btn-mark');
      if (!btn) return;
      const id = btn.dataset.id;
      const action = btn.dataset.action;
      const decision = action === 'include' ? '最终纳入' : '最终排除';
      this.markRecord(id, decision);
    });

    // Show all button
    tbody.addEventListener('click', (e) => {
      const btn = e.target.closest('#btnShowAll');
      if (btn) this.showAll();
    });
  }
}
