// state.js — 集中式响应状态管理。所有状态变更经过此处，自动通知 EventBus。

import { normalizeRecord } from './record.js?v=20260722b';
import { loadRecords as storageLoadRecords, saveRecords as storageSaveRecords, saveNow as storageSaveNow, loadSettings, saveSettings, collectSettings, applySettings } from './storage.js?v=20260818c';
import { DEFAULT_PAGE_SIZE } from './config.js?v=20260722b';
import { delay } from './utils.js?v=20260722b';

export class AppState {
  #records = [];
  #filters = { query: '', decision: '', source: '', studyType: '', pageSize: DEFAULT_PAGE_SIZE };
  #prismaDirty = true;
  #eventBus;

  constructor(eventBus) {
    this.#eventBus = eventBus;
  }

  // ===== Records =====

  get records() {
    return this.#records;
  }

  get recordCount() {
    return this.#records.length;
  }

  load() {
    this.#records = storageLoadRecords();
    return this.#records;
  }

  setRecords(records) {
    this.#records = records.map(normalizeRecord);
    this.#prismaDirty = true;
    this.#save();
    this.#emit('records:changed');
  }

  addRecords(newRecords) {
    // dedup is handled by the caller; state just accepts the final array
    this.#prismaDirty = true;
    this.#save();
    this.#emit('records:changed');
  }

  updateRecord(id, partial) {
    const idx = this.#records.findIndex(r => r.id === id);
    if (idx === -1) return false;
    Object.assign(this.#records[idx], partial);
    this.#prismaDirty = true;
    this.#save();
    this.#emit('records:changed');
    return true;
  }

  findRecord(id) {
    return this.#records.find(r => r.id === id);
  }

  // ===== Filters =====

  get filters() {
    return { ...this.#filters };
  }

  setFilter(name, value) {
    this.#filters[name] = value;
    if (name !== 'pageSize') this.#filters.pageSize = DEFAULT_PAGE_SIZE;
    this.#emit('filter:changed', { name, value });
  }

  resetFilters() {
    this.#filters = { query: '', decision: '', source: '', studyType: '', pageSize: DEFAULT_PAGE_SIZE };
    this.#emit('filter:changed');
  }

  setPageSize(n) {
    this.#filters.pageSize = n;
  }

  resetPage() {
    this.#filters.pageSize = DEFAULT_PAGE_SIZE;
  }

  // ===== Settings =====

  loadSettings() {
    return loadSettings();
  }

  saveSettings(settings) {
    saveSettings(settings);
    this.#emit('settings:changed', settings);
  }

  collectSettings() {
    return collectSettings();
  }

  applySettings(settings) {
    applySettings(settings);
  }

  // ===== Study Mode Filtering =====

  getStudyMode() {
    const el = document.getElementById('studyMode');
    return el ? el.value : 'both';
  }

  /**
   * 返回按研究模式过滤后的记录
   */
  getStudyFilteredRecords() {
    const mode = this.getStudyMode();
    // “不明确”记录必须保留给人工复核，不能因自动分类置信度不足而静默漏掉。
    if (mode === 'human') return this.#records.filter(r => r.studyType === 'human' || r.studyType === 'unclear');
    if (mode === 'animal') return this.#records.filter(r => r.studyType === 'animal' || r.studyType === 'unclear');
    if (mode === 'in_vitro') return this.#records.filter(r => r.studyType === 'in_vitro' || r.studyType === 'unclear');
    return this.#records; // 'both'
  }

  /**
   * 返回应用了所有过滤条件的记录列表
   */
  getFilteredRecords() {
    const f = this.#filters;
    const studyRecords = this.getStudyFilteredRecords();

    return studyRecords.filter(r => {
      if (f.decision && r.decision !== f.decision) return false;
      if (f.source && !(r.sources || []).some(s => s.source === f.source) && r.source !== f.source) return false;
      if (f.studyType && r.studyType !== f.studyType) return false;
      if (!f.query) return true;
      const searchText = [
        r.title, r.abstract, r.authors, r.journal, r.hits, r.reason,
        r.pmid, r.doi,
        [...new Set((r.sources || []).map(s => s.sourceLabel))]
      ].join(' ').toLowerCase();
      return searchText.includes(f.query.toLowerCase());
    }).sort((a, b) => b.score - a.score || String(b.year || '').localeCompare(String(a.year || '')));
  }

  // ===== Stats =====

  getStats() {
    const frec = this.getStudyFilteredRecords();
    return {
      fetched: frec.reduce((s, r) => s + Math.max(1, Number(r.mergedCount) || 1), 0),
      total: frec.length,
      duplicates: frec.reduce((s, r) => s + Math.max(0, (Number(r.mergedCount) || 1) - 1), 0),
      autoIncluded: frec.filter(r => r.decision === '建议纳入').length,
      autoExcluded: frec.filter(r => r.decision === '建议排除').length,
      pending: frec.filter(r => r.decision === '待人工判断').length,
      finalIncluded: frec.filter(r => r.decision === '最终纳入').length,
      finalExcluded: frec.filter(r => r.decision === '最终排除').length
    };
  }

  getSourceCounts(records) {
    const subset = records || this.getStudyFilteredRecords();
    const counts = {};
    subset.forEach(r => {
      counts[r.source] = (counts[r.source] || 0) + 1;
    });
    return counts;
  }

  // ===== Dirty Flags =====

  get prismaDirty() {
    return this.#prismaDirty;
  }

  markPrismaClean() {
    this.#prismaDirty = false;
  }

  markPrismaDirty() {
    this.#prismaDirty = true;
  }

  // ===== Persistence =====

  #saveTimer = null;

  #save() {
    clearTimeout(this.#saveTimer);
    this.#saveTimer = setTimeout(() => {
      storageSaveRecords(this.#records);
    }, 800);
  }

  saveNow() {
    clearTimeout(this.#saveTimer);
    storageSaveNow(this.#records);
  }

  // ===== Events =====

  #emit(event, payload) {
    if (this.#eventBus) {
      this.#eventBus.emit(event, payload);
    }
  }
}
