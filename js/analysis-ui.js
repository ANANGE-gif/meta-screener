// analysis-ui.js — 数据提取、确定性计算与图形输出工作台。

import { computeStudyEffect, poolEffects, poolSubgroups, eggerTest, leaveOneOut, toDisplay, isRatioMeasure, measureLabel, formatP } from './meta-analysis.js?v=20260723g';
import { getProjectStorage } from './storage.js?v=20260820b';

const STORAGE_KEY = 'meta_screener_analysis_v1';

function esc(value) {
  return String(value ?? '').replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[c]);
}

function uid() {
  return `study-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function csvCell(value) {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function parseCsvLine(line) {
  const cells = [];
  let value = '', quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') { value += '"'; i++; }
      else quoted = !quoted;
    } else if (ch === ',' && !quoted) { cells.push(value); value = ''; }
    else value += ch;
  }
  cells.push(value);
  return cells;
}

function download(name, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 500);
}

const FIELD_SETS = {
  binary: [
    ['eventsT', '试验组事件数'], ['totalT', '试验组总例数'], ['eventsC', '对照组事件数'], ['totalC', '对照组总例数']
  ],
  continuous: [
    ['nT', '试验组 N'], ['meanT', '试验组 Mean'], ['sdT', '试验组 SD'], ['nC', '对照组 N'], ['meanC', '对照组 Mean'], ['sdC', '对照组 SD']
  ],
  generic: [['effect', '报告效应值'], ['lower', '95% CI 下限'], ['upper', '95% CI 上限']]
};

const TYPE_MEASURES = {
  binary: [['OR', '比值比 OR'], ['RR', '风险比 RR'], ['RD', '风险差 RD']],
  continuous: [['MD', '均数差 MD'], ['SMD', '标准化均数差 SMD']],
  generic: [['GENERIC', '报告效应值（差值型）'], ['GENERIC_RATIO', '报告效应值（OR/RR/HR 型）']]
};

export class MetaAnalysisWorkspace {
  #getRecords;
  #rows = [];
  #type = 'binary';
  #measure = 'OR';
  #model = 'random';
  #outcome = '';
  #initialized = false;
  #lastAnalysis = null;

  constructor({ getRecords }) {
    this.#getRecords = getRecords;
  }

  init() {
    if (this.#initialized || !document.getElementById('metaWorkspace')) return;
    this.#initialized = true;
    this.#load();
    this.#bind();
    this.#renderMeasureOptions();
    this.#renderTable();
    this.updateIncludedCount();
  }

  reload() {
    this.#load();
    this.#renderMeasureOptions();
    this.#renderTable();
    this.#invalidateAnalysis('已载入当前账号的数据提取表，请重新计算统计结果。');
    this.updateIncludedCount();
  }

  exportState() {
    this.#readRows();
    return JSON.parse(JSON.stringify({ rows: this.#rows, type: this.#type, measure: this.#measure, model: this.#model, outcome: this.#outcome }));
  }

  importState(data) {
    if (!data || typeof data !== 'object') return;
    this.#rows = Array.isArray(data.rows) ? data.rows : [];
    this.#type = FIELD_SETS[data.type] ? data.type : 'binary';
    this.#measure = TYPE_MEASURES[this.#type].some(([value]) => value === data.measure) ? data.measure : TYPE_MEASURES[this.#type][0][0];
    this.#model = data.model === 'fixed' ? 'fixed' : 'random';
    this.#outcome = String(data.outcome || '');
    const typeEl = document.getElementById('metaDataType'); const modelEl = document.getElementById('metaModel');
    if (typeEl) typeEl.value = this.#type; if (modelEl) modelEl.value = this.#model;
    this.#renderMeasureOptions(); this.#renderTable(); this.#invalidateAnalysis('已恢复数据提取表，请重新计算统计结果。'); this.#save();
  }

  getReportData() {
    if (!this.#lastAnalysis) return null;
    const { pooled, measure } = this.#lastAnalysis;
    return {
      measureLabel: measureLabel(measure),
      modelLabel: pooled.model === 'random' ? '随机效应模型（DerSimonian–Laird）' : '固定效应模型（逆方差）',
      estimate: toDisplay(pooled.estimate, measure).toFixed(3),
      lower: toDisplay(pooled.lower, measure).toFixed(3),
      upper: toDisplay(pooled.upper, measure).toFixed(3),
      p: formatP(pooled.p), i2: pooled.i2.toFixed(1), tau2: pooled.tau2.toFixed(4), k: pooled.k
    };
  }

  calculate() {
    this.#calculate();
    return this.getReportData();
  }

  updateIncludedCount() {
    const records = this.#getRecords?.() || [];
    const count = records.filter(r => r.decision === '最终纳入').length;
    const el = document.getElementById('metaIncludedAvailable');
    if (el) el.textContent = String(count);
  }

  #load() {
    try {
      const saved = JSON.parse(getProjectStorage().getItem(STORAGE_KEY) || '{}');
      this.#rows = Array.isArray(saved.rows) ? saved.rows : [];
      this.#type = FIELD_SETS[saved.type] ? saved.type : 'binary';
      this.#measure = saved.measure || TYPE_MEASURES[this.#type][0][0];
      this.#model = saved.model === 'fixed' ? 'fixed' : 'random';
      this.#outcome = String(saved.outcome || '');
    } catch {
      this.#rows = [];
      this.#type = 'binary';
      this.#measure = 'OR';
      this.#model = 'random';
      this.#outcome = '';
    }
    const typeEl = document.getElementById('metaDataType');
    const modelEl = document.getElementById('metaModel');
    if (typeEl) typeEl.value = this.#type;
    if (modelEl) modelEl.value = this.#model;
  }

  #save() {
    getProjectStorage().setItem(STORAGE_KEY, JSON.stringify({ rows: this.#rows, type: this.#type, measure: this.#measure, model: this.#model, outcome: this.#outcome }));
  }

  #bind() {
    document.querySelectorAll('.meta-tab').forEach(btn => btn.addEventListener('click', () => this.#switchTab(btn.dataset.tab)));
    document.getElementById('metaDataType')?.addEventListener('change', e => {
      this.#readRows(); this.#type = e.target.value; this.#measure = TYPE_MEASURES[this.#type][0][0]; this.#renderMeasureOptions(); this.#renderTable(); this.#invalidateAnalysis('数据类型已改变，请按新字段录入并重新计算。'); this.#save();
    });
    document.getElementById('metaMeasure')?.addEventListener('change', e => { this.#measure = e.target.value; this.#invalidateAnalysis('效应量已改变，请重新计算。'); this.#save(); });
    document.getElementById('metaModel')?.addEventListener('change', e => { this.#model = e.target.value; this.#invalidateAnalysis('合并模型已改变，请重新计算。'); this.#save(); });
    document.getElementById('metaOutcomeFilter')?.addEventListener('change', e => { this.#outcome = e.target.value; this.#invalidateAnalysis('分析结局已改变，请重新计算。'); this.#save(); });
    document.getElementById('btnMetaAddStudy')?.addEventListener('click', () => { this.#readRows(); this.#rows.push({ id: uid(), study: '', year: '', subgroup: '' }); this.#renderTable(); this.#invalidateAnalysis('研究数据已改变，请重新计算。'); this.#save(); });
    document.getElementById('btnMetaSyncIncluded')?.addEventListener('click', () => this.#syncIncluded());
    document.getElementById('btnMetaCalculate')?.addEventListener('click', () => this.#calculate());
    document.getElementById('btnMetaExportCsv')?.addEventListener('click', () => this.#exportCsv());
    document.getElementById('metaCsvFile')?.addEventListener('change', e => this.#importCsv(e));
    document.getElementById('btnForestPng')?.addEventListener('click', () => this.#exportCanvas('metaForestCanvas', 'Meta分析_森林图.png'));
    document.getElementById('btnFunnelPng')?.addEventListener('click', () => this.#exportCanvas('metaFunnelCanvas', 'Meta分析_漏斗图.png'));
    document.getElementById('metaExtractionBody')?.addEventListener('input', e => { this.#readRows(); if (e.target.dataset.field === 'outcome') this.#renderOutcomeOptions(); this.#invalidateAnalysis('研究数据已改变，请重新计算。'); this.#save(); });
    document.getElementById('metaExtractionBody')?.addEventListener('change', e => { if (e.target.dataset.field === 'outcome') { this.#readRows(); this.#renderOutcomeOptions(); this.#save(); } });
    document.getElementById('metaExtractionBody')?.addEventListener('click', e => {
      const btn = e.target.closest('.btn-meta-remove');
      if (!btn) return;
      this.#readRows(); this.#rows = this.#rows.filter(r => r.id !== btn.dataset.id); this.#renderTable(); this.#invalidateAnalysis('研究数据已改变，请重新计算。'); this.#save();
    });
  }

  #switchTab(name) {
    document.querySelectorAll('.meta-tab').forEach(btn => {
      const active = btn.dataset.tab === name;
      btn.classList.toggle('active', active); btn.setAttribute('aria-selected', String(active));
    });
    document.querySelectorAll('.meta-pane').forEach(pane => pane.hidden = pane.dataset.pane !== name);
  }

  #renderMeasureOptions() {
    const select = document.getElementById('metaMeasure');
    if (!select) return;
    const choices = TYPE_MEASURES[this.#type];
    if (!choices.some(([value]) => value === this.#measure)) this.#measure = choices[0][0];
    select.innerHTML = choices.map(([value, label]) => `<option value="${value}">${label}</option>`).join('');
    select.value = this.#measure;
  }

  #readRows() {
    const trs = document.querySelectorAll('#metaExtractionBody tr[data-id]');
    if (!trs.length) return;
    this.#rows = [...trs].map(tr => {
      const previous = this.#rows.find(r => r.id === tr.dataset.id) || { id: tr.dataset.id };
      const next = { ...previous };
      tr.querySelectorAll('[data-field]').forEach(input => next[input.dataset.field] = input.value);
      return next;
    });
  }

  #renderTable() {
    const fields = FIELD_SETS[this.#type];
    const head = document.getElementById('metaExtractionHead');
    const body = document.getElementById('metaExtractionBody');
    if (!head || !body) return;
    head.innerHTML = `<tr><th>研究</th><th>年份</th><th>结局</th><th>时间点</th><th>亚组</th><th>原文定位</th>${fields.map(([, label]) => `<th>${label}</th>`).join('')}<th>操作</th></tr>`;
    body.innerHTML = this.#rows.length ? this.#rows.map(row => `<tr data-id="${esc(row.id)}">
      <td><input data-field="study" value="${esc(row.study)}" title="${esc(row.title || row.study)}" placeholder="第一作者或研究编号"></td>
      <td><input data-field="year" value="${esc(row.year)}" inputmode="numeric"></td>
      <td><input data-field="outcome" value="${esc(row.outcome)}" placeholder="主要结局"></td>
      <td><input data-field="timepoint" value="${esc(row.timepoint)}" placeholder="如 12 周"></td>
      <td><input data-field="subgroup" value="${esc(row.subgroup)}" placeholder="可选"></td>
      <td><input data-field="sourcePage" value="${esc(row.sourcePage)}" placeholder="页码/表号"></td>
      ${fields.map(([field]) => `<td><input data-field="${field}" value="${esc(row[field])}" type="number" step="any" inputmode="decimal"></td>`).join('')}
      <td><button type="button" class="r btn-meta-remove" data-id="${esc(row.id)}">删除</button></td>
    </tr>`).join('') : `<tr><td colspan="${fields.length + 7}" class="meta-empty">还没有提取数据。可同步“最终纳入”的文献，或手动添加研究。</td></tr>`;
    this.#renderOutcomeOptions();
  }

  #renderOutcomeOptions() {
    const select = document.getElementById('metaOutcomeFilter'); if (!select) return;
    const outcomes = [...new Set(this.#rows.map(row => String(row.outcome || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh-CN'));
    if (this.#outcome && !outcomes.includes(this.#outcome)) this.#outcome = '';
    select.innerHTML = `<option value="">${outcomes.length > 1 ? '请选择一个结局' : '全部 / 未命名结局'}</option>${outcomes.map(value => `<option value="${esc(value)}">${esc(value)}</option>`).join('')}`;
    select.value = this.#outcome;
  }

  #syncIncluded() {
    this.#readRows();
    const records = (this.#getRecords?.() || []).filter(r => r.decision === '最终纳入');
    const linked = new Set(this.#rows.map(r => r.recordId).filter(Boolean));
    let added = 0;
    records.forEach(record => {
      if (linked.has(record.id)) return;
      const firstAuthor = String(record.authors || '').split(/[;,]/)[0].trim();
      this.#rows.push({ id: uid(), recordId: record.id, study: [firstAuthor || '研究', record.year].filter(Boolean).join(' '), year: record.year || '', outcome: '', timepoint: '', subgroup: '', sourcePage: '', title: record.title || '' });
      added++;
    });
    this.#renderTable(); this.#save(); this.updateIncludedCount();
    if (added) this.#invalidateAnalysis('已同步新的纳入研究，请录入原始数值后重新计算。');
    this.#setMessage(added ? `已同步 ${added} 项最终纳入研究，请录入原始数值并保留核对依据。` : '没有新的“最终纳入”研究需要同步。', false);
  }

  #validateRows() {
    this.#readRows();
    const studies = [], errors = [];
    const namedOutcomes = [...new Set(this.#rows.map(row => String(row.outcome || '').trim()).filter(Boolean))];
    if (namedOutcomes.length > 1 && !this.#outcome) return { studies: [], errors: ['检测到多个结局，请先在“分析结局”中选择一个结局，禁止混合合并。'] };
    const selectedRows = this.#outcome ? this.#rows.filter(row => String(row.outcome || '').trim() === this.#outcome) : this.#rows;
    selectedRows.forEach((row, index) => {
      const hasAnyData = FIELD_SETS[this.#type].some(([field]) => String(row[field] ?? '').trim() !== '');
      if (!hasAnyData) return;
      try { studies.push(computeStudyEffect({ ...row, study: row.study || `研究 ${index + 1}` }, this.#measure)); }
      catch (error) { errors.push(`${row.study || `第 ${index + 1} 行`}：${error.message}`); }
    });
    return { studies, errors };
  }

  #calculate() {
    const { studies, errors } = this.#validateRows();
    if (!studies.length) { this.#setMessage(errors[0] || '请先录入至少 1 项完整研究数据。', true); return; }
    try {
      const pooled = poolEffects(studies, this.#model);
      this.#lastAnalysis = { studies, pooled, measure: this.#measure };
      this.#renderSummary(studies, pooled, errors);
      this.#renderSubgroups(studies);
      this.#renderPublicationBias(studies);
      this.#drawForest(studies, pooled);
      this.#drawFunnel(studies, pooled);
      this.#renderSensitivity(studies);
      this.#switchTab('analysis');
      this.#save();
    } catch (error) { this.#setMessage(error.message, true); }
  }

  #renderSummary(studies, pooled, errors) {
    const ratio = isRatioMeasure(this.#measure);
    const estimate = toDisplay(pooled.estimate, this.#measure);
    const lower = toDisplay(pooled.lower, this.#measure);
    const upper = toDisplay(pooled.upper, this.#measure);
    const model = pooled.model === 'random' ? '随机效应（DerSimonian–Laird）' : '固定效应（逆方差）';
    const prediction = pooled.k >= 3 && pooled.model === 'random'
      ? `预测区间 ${toDisplay(pooled.predictionLower, this.#measure).toFixed(3)} ～ ${toDisplay(pooled.predictionUpper, this.#measure).toFixed(3)}`
      : '研究较少或固定效应模型，不报告预测区间';
    document.getElementById('metaResultCards').innerHTML = `
      <div class="meta-result-card"><small>合并效应 · ${esc(measureLabel(this.#measure))}</small><strong>${estimate.toFixed(3)}</strong><span>95% CI ${lower.toFixed(3)} ～ ${upper.toFixed(3)}</span></div>
      <div class="meta-result-card"><small>总体效应</small><strong>p ${formatP(pooled.p)}</strong><span>${model}<br>${prediction}</span></div>
      <div class="meta-result-card"><small>异质性</small><strong>I² ${pooled.i2.toFixed(1)}%</strong><span>Q=${pooled.q.toFixed(2)}，df=${pooled.df}，p ${formatP(pooled.qP)}</span></div>
      <div class="meta-result-card"><small>研究数量</small><strong>${studies.length}</strong><span>τ²=${pooled.tau2.toFixed(4)}${ratio ? '（对数尺度）' : ''}</span></div>`;
    this.#setMessage(errors.length ? `已纳入 ${studies.length} 项研究；另有 ${errors.length} 行未计算：${errors.slice(0, 2).join('；')}` : `计算完成：${studies.length} 项研究，结果由确定性统计内核生成。`, errors.length > 0);
  }

  #renderSubgroups(studies) {
    const result = poolSubgroups(studies, this.#model);
    const body = document.getElementById('metaSubgroupBody'); const test = document.getElementById('metaSubgroupTest');
    if (!body || !test) return;
    if (result.groups.length < 2) {
      body.innerHTML = '<tr><td colspan="5" class="meta-empty">填写至少两个亚组后生成。</td></tr>';
      test.textContent = '组间差异检验：—'; return;
    }
    body.innerHTML = result.groups.map(item => `<tr><td>${esc(item.name)}</td><td>${item.pooled.k}</td><td>${toDisplay(item.pooled.estimate, this.#measure).toFixed(3)}</td><td>${toDisplay(item.pooled.lower, this.#measure).toFixed(3)} ～ ${toDisplay(item.pooled.upper, this.#measure).toFixed(3)}</td><td>${item.pooled.i2.toFixed(1)}%</td></tr>`).join('');
    test.textContent = `组间差异：Q=${result.qBetween.toFixed(2)}，df=${result.dfBetween}，p ${formatP(result.pBetween)}`;
  }

  #renderPublicationBias(studies) {
    const el = document.getElementById('metaBiasResult'); if (!el) return;
    const result = eggerTest(studies);
    if (!result) { el.innerHTML = '研究数量或精度分布不足，无法计算 Egger 回归。'; return; }
    const caution = studies.length < 10 ? '当前少于 10 项研究，检验效能较低，仅作探索性展示。' : (result.p < 0.05 ? '截距检验提示可能存在小样本效应，需要结合漏斗图和选择模型进一步判断。' : '未发现显著的小样本效应信号，但不能据此排除发表偏倚。');
    el.innerHTML = `<b>Egger 截距 ${result.intercept.toFixed(3)}</b><span>SE=${result.se.toFixed(3)}，p ${formatP(result.p)}</span><p>${caution}</p>`;
  }

  #effectText(study) {
    return `${toDisplay(study.yi, this.#measure).toFixed(3)} [${toDisplay(study.lowerYi, this.#measure).toFixed(3)}, ${toDisplay(study.upperYi, this.#measure).toFixed(3)}]`;
  }

  #setupCanvas(canvas, cssWidth, cssHeight) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = cssWidth * dpr; canvas.height = cssHeight * dpr;
    canvas.style.width = '100%'; canvas.style.height = `${cssHeight}px`;
    const ctx = canvas.getContext('2d'); ctx.scale(dpr, dpr);
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cssWidth, cssHeight);
    ctx.font = '13px system-ui, sans-serif'; ctx.textBaseline = 'middle';
    return ctx;
  }

  #drawForest(studies, pooled) {
    const canvas = document.getElementById('metaForestCanvas');
    const width = 1120, rowH = 40, top = 88, bottom = 76, height = top + rowH * (studies.length + 1) + bottom;
    const ctx = this.#setupCanvas(canvas, width, Math.max(320, height));
    const plotLeft = 390, plotRight = 885, effectX = 905;
    const lows = studies.map(s => s.lowerYi).concat(pooled.lower), highs = studies.map(s => s.upperYi).concat(pooled.upper);
    let min = Math.min(...lows), max = Math.max(...highs);
    const ref = 0; min = Math.min(min, ref); max = Math.max(max, ref);
    const pad = Math.max(0.15, (max - min) * 0.12); min -= pad; max += pad;
    const x = value => plotLeft + (value - min) / (max - min) * (plotRight - plotLeft);
    ctx.fillStyle = '#0b4f79'; ctx.font = '700 19px system-ui, sans-serif'; ctx.fillText(`森林图 · ${measureLabel(this.#measure)}`, 24, 28);
    ctx.font = '12px system-ui, sans-serif'; ctx.fillStyle = '#64748b'; ctx.fillText('研究', 24, 62); ctx.fillText('效应值 [95% CI]', effectX, 62);
    ctx.strokeStyle = '#94a3b8'; ctx.setLineDash([5, 4]); ctx.beginPath(); ctx.moveTo(x(ref), 74); ctx.lineTo(x(ref), height - 48); ctx.stroke(); ctx.setLineDash([]);
    studies.forEach((study, i) => {
      const y = top + i * rowH;
      ctx.fillStyle = '#243547'; ctx.font = '13px system-ui, sans-serif'; ctx.fillText(String(study.study || `研究 ${i + 1}`).slice(0, 44), 24, y);
      ctx.strokeStyle = '#0f6b9e'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x(study.lowerYi), y); ctx.lineTo(x(study.upperYi), y); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x(study.lowerYi), y - 5); ctx.lineTo(x(study.lowerYi), y + 5); ctx.moveTo(x(study.upperYi), y - 5); ctx.lineTo(x(study.upperYi), y + 5); ctx.stroke();
      const size = 5 + Math.sqrt(Math.max(0, pooled.weights[i])) * 0.65; ctx.fillStyle = '#0f6b9e'; ctx.fillRect(x(study.yi) - size / 2, y - size / 2, size, size);
      ctx.fillStyle = '#334155'; ctx.fillText(this.#effectText(study), effectX, y);
    });
    const py = top + studies.length * rowH;
    ctx.fillStyle = '#0b4f79'; ctx.font = '700 13px system-ui, sans-serif'; ctx.fillText('合并效应', 24, py);
    ctx.beginPath(); ctx.moveTo(x(pooled.lower), py); ctx.lineTo(x(pooled.estimate), py - 9); ctx.lineTo(x(pooled.upper), py); ctx.lineTo(x(pooled.estimate), py + 9); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#0b4f79'; ctx.fillText(`${toDisplay(pooled.estimate, this.#measure).toFixed(3)} [${toDisplay(pooled.lower, this.#measure).toFixed(3)}, ${toDisplay(pooled.upper, this.#measure).toFixed(3)}]`, effectX, py);
    ctx.strokeStyle = '#cbd5e1'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(plotLeft, height - 42); ctx.lineTo(plotRight, height - 42); ctx.stroke();
    ctx.fillStyle = '#64748b'; ctx.font = '11px system-ui, sans-serif';
    for (let i = 0; i <= 4; i++) { const value = min + (max - min) * i / 4; const xx = x(value); ctx.fillText(toDisplay(value, this.#measure).toFixed(2), xx - 12, height - 25); }
  }

  #drawFunnel(studies, pooled) {
    const canvas = document.getElementById('metaFunnelCanvas');
    const width = 720, height = 500, left = 86, right = 675, top = 98, bottom = 425;
    const ctx = this.#setupCanvas(canvas, width, height);
    ctx.fillStyle = '#0b4f79'; ctx.font = '700 19px system-ui, sans-serif'; ctx.fillText('漏斗图', 24, 30);
    const maxSe = Math.max(...studies.map(s => s.se)) * 1.15 || 1;
    const xValues = studies.flatMap(s => [s.yi, pooled.estimate - 1.96 * s.se, pooled.estimate + 1.96 * s.se]);
    let minX = Math.min(...xValues), maxX = Math.max(...xValues); const xPad = Math.max(0.1, (maxX - minX) * 0.08); minX -= xPad; maxX += xPad;
    const x = value => left + (value - minX) / (maxX - minX) * (right - left);
    const y = se => top + se / maxSe * (bottom - top);
    ctx.strokeStyle = '#cbd5e1'; ctx.beginPath(); ctx.moveTo(left, top); ctx.lineTo(left, bottom); ctx.lineTo(right, bottom); ctx.stroke();
    ctx.strokeStyle = '#94a3b8'; ctx.setLineDash([5, 4]); ctx.beginPath(); ctx.moveTo(x(pooled.estimate), top); ctx.lineTo(x(pooled.estimate), bottom); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x(pooled.estimate), top); ctx.lineTo(x(pooled.estimate - 1.96 * maxSe), bottom); ctx.moveTo(x(pooled.estimate), top); ctx.lineTo(x(pooled.estimate + 1.96 * maxSe), bottom); ctx.stroke(); ctx.setLineDash([]);
    studies.forEach(study => { ctx.fillStyle = 'rgba(15,107,158,.78)'; ctx.beginPath(); ctx.arc(x(study.yi), y(study.se), 5, 0, Math.PI * 2); ctx.fill(); });
    ctx.fillStyle = '#64748b'; ctx.font = '12px system-ui, sans-serif'; ctx.fillText('标准误（越靠上精度越高）', 24, 62); ctx.fillText(measureLabel(this.#measure), (left + right) / 2 - 38, 468);
  }

  #renderSensitivity(studies) {
    const body = document.getElementById('metaSensitivityBody');
    const rows = leaveOneOut(studies, this.#model);
    body.innerHTML = rows.length ? rows.map(row => `<tr><td>${esc(row.omitted)}</td><td>${toDisplay(row.estimate, this.#measure).toFixed(3)}</td><td>${toDisplay(row.lower, this.#measure).toFixed(3)} ～ ${toDisplay(row.upper, this.#measure).toFixed(3)}</td><td>${row.i2.toFixed(1)}%</td></tr>`).join('') : '<tr><td colspan="4" class="meta-empty">至少 3 项研究后生成逐一剔除敏感性分析。</td></tr>';
  }

  #setMessage(text, error) {
    const el = document.getElementById('metaStatus');
    if (!el) return;
    el.textContent = text; el.classList.toggle('meta-error', Boolean(error));
  }

  #invalidateAnalysis(message) {
    if (!this.#lastAnalysis) { this.#setMessage(message, false); return; }
    this.#lastAnalysis = null;
    const cards = document.getElementById('metaResultCards');
    if (cards) cards.innerHTML = '<div class="meta-result-card meta-placeholder"><small>结果已失效</small><strong>需重新计算</strong><span>数据、效应量或模型发生了改变</span></div>';
    const sensitivity = document.getElementById('metaSensitivityBody');
    if (sensitivity) sensitivity.innerHTML = '<tr><td colspan="4" class="meta-empty">数据已改变，重新计算后更新。</td></tr>';
    const subgroup = document.getElementById('metaSubgroupBody'); if (subgroup) subgroup.innerHTML = '<tr><td colspan="5" class="meta-empty">数据已改变，重新计算后更新。</td></tr>';
    const subgroupTest = document.getElementById('metaSubgroupTest'); if (subgroupTest) subgroupTest.textContent = '组间差异检验：—';
    const bias = document.getElementById('metaBiasResult'); if (bias) bias.textContent = '数据已改变，重新计算后更新。';
    ['metaForestCanvas', 'metaFunnelCanvas'].forEach(id => {
      const canvas = document.getElementById(id); const ctx = canvas?.getContext('2d');
      if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    });
    this.#switchTab('extraction');
    this.#setMessage(message, false);
  }

  #exportCsv() {
    this.#readRows();
    const fields = [['study', '研究'], ['year', '年份'], ['outcome', '结局'], ['timepoint', '时间点'], ['subgroup', '亚组'], ['sourcePage', '原文定位'], ...FIELD_SETS[this.#type]];
    const csv = [fields.map(([, label]) => csvCell(label)).join(','), ...this.#rows.map(row => fields.map(([field]) => csvCell(row[field])).join(','))].join('\r\n');
    download(`Meta数据提取_${this.#measure}.csv`, `\ufeff${csv}`, 'text/csv;charset=utf-8');
  }

  async #importCsv(event) {
    const file = event.target.files?.[0]; if (!file) return;
    try {
      const text = await file.text(); const lines = text.replace(/^\ufeff/, '').split(/\r?\n/).filter(Boolean);
      if (lines.length < 2) throw new Error('CSV 中没有数据行');
      const headers = parseCsvLine(lines[0]).map(x => x.trim());
      const fields = [['study', '研究'], ['year', '年份'], ['subgroup', '亚组'], ...FIELD_SETS[this.#type]];
      this.#rows = lines.slice(1).map(line => { const cells = parseCsvLine(line); const row = { id: uid() }; fields.forEach(([field, label]) => { const i = headers.indexOf(label); if (i >= 0) row[field] = cells[i] || ''; }); return row; });
      this.#renderTable(); this.#invalidateAnalysis(`已导入 ${this.#rows.length} 行提取数据，请重新计算。`); this.#save();
    } catch (error) { this.#setMessage(`导入失败：${error.message}`, true); }
    event.target.value = '';
  }

  #exportCanvas(id, name) {
    const canvas = document.getElementById(id);
    if (!canvas || !this.#lastAnalysis) { this.#setMessage('请先完成统计计算再导出图片。', true); return; }
    const a = document.createElement('a'); a.download = name; a.href = canvas.toDataURL('image/png'); a.click();
  }
}
