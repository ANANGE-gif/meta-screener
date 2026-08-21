// review-workflow.js — 研究方案、全文复筛、偏倚风险、GRADE 与报告。

import { getProjectStorage } from './storage.js?v=20260820b';

const STORAGE_KEY = 'meta_review_workflow_v1';

const RISK_TOOLS = {
  rob2: {
    label: 'RoB 2',
    domains: ['随机化过程', '偏离既定干预', '结局数据缺失', '结局测量', '选择性报告'],
    options: [['low', '低风险'], ['some', '存在一些问题'], ['high', '高风险']]
  },
  robins: {
    label: 'ROBINS-I',
    domains: ['混杂', '研究对象选择', '干预分类', '偏离既定干预', '数据缺失', '结局测量', '选择性报告'],
    options: [['low', '低风险'], ['moderate', '中等风险'], ['serious', '严重风险'], ['critical', '极严重风险'], ['unclear', '信息不足']]
  },
  nos: {
    label: 'Newcastle–Ottawa Scale',
    domains: ['病例/暴露组代表性', '对照/非暴露组选择', '暴露/结局确认', '基线无结局', '可比性（主要因素）', '可比性（其他因素）', '随访/无应答充分', '结局/暴露评价充分', '随访时间充分'],
    options: [['yes', '达到（1 星）'], ['no', '未达到（0 星）']]
  },
  syrcle: {
    label: 'SYRCLE RoB',
    domains: ['随机序列', '基线特征', '分配隐藏', '随机饲养', '研究人员盲法', '随机结局评价', '评价者盲法', '不完整数据', '选择性报告', '其他偏倚'],
    options: [['low', '低风险'], ['high', '高风险'], ['unclear', '不明确']]
  }
};

const PROTOCOL_FIELDS = ['reviewTitle', 'reviewObjective', 'picosPopulation', 'picosIntervention', 'picosComparator', 'picosOutcomes', 'picosDesign', 'protocolRegistration', 'inclusionCriteria', 'exclusionCriteria'];

function esc(value) {
  return String(value ?? '').replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[c]);
}

function uid(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function download(name, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 500);
}

function lines(value) {
  return String(value || '').split(/\r?\n/).map(x => x.trim()).filter(Boolean);
}

export class ReviewWorkflow {
  #getRecords;
  #getStats;
  #updateRecord;
  #getMetaReport;
  #state = { protocol: {}, fullText: [], risk: [], grade: [] };
  #initialized = false;
  #saveTimer = null;

  constructor({ getRecords, getStats, updateRecord, getMetaReport }) {
    this.#getRecords = getRecords;
    this.#getStats = getStats;
    this.#updateRecord = updateRecord;
    this.#getMetaReport = getMetaReport;
  }

  init() {
    if (this.#initialized || !document.getElementById('reviewWorkspace')) return;
    this.#initialized = true;
    this.#load();
    this.#applyProtocol();
    this.#bind();
    this.#renderFullText();
    this.#renderRisk();
    this.#renderGrade();
  }

  reload() {
    this.#load();
    this.#applyProtocol();
    this.#renderFullText();
    this.#renderRisk();
    this.#renderGrade();
    const preview = document.getElementById('reviewReportPreview');
    if (preview) preview.innerHTML = '<div class="meta-empty">生成报告后在这里预览研究方案、筛选结果、质量评价和 Meta 分析摘要。</div>';
  }

  exportState() {
    this.#readProtocol();
    return structuredClone(this.#state);
  }

  importState(data) {
    if (!data || typeof data !== 'object') return;
    this.#state = {
      protocol: data.protocol && typeof data.protocol === 'object' ? data.protocol : {},
      fullText: Array.isArray(data.fullText) ? data.fullText : [],
      risk: Array.isArray(data.risk) ? data.risk : [],
      grade: Array.isArray(data.grade) ? data.grade : []
    };
    this.#applyProtocol(); this.#renderFullText(); this.#renderRisk(); this.#renderGrade(); this.#save();
  }

  #load() {
    try {
      const value = JSON.parse(getProjectStorage().getItem(STORAGE_KEY) || '{}');
      this.#state = { protocol: value.protocol || {}, fullText: value.fullText || [], risk: value.risk || [], grade: value.grade || [] };
    } catch {
      this.#state = { protocol: {}, fullText: [], risk: [], grade: [] };
    }
  }

  #save() {
    getProjectStorage().setItem(STORAGE_KEY, JSON.stringify(this.#state));
    const el = document.getElementById('protocolSaveState');
    if (el) { el.textContent = '已保存'; clearTimeout(this.#saveTimer); this.#saveTimer = setTimeout(() => { el.textContent = '自动保存'; }, 1300); }
  }

  #readProtocol() {
    PROTOCOL_FIELDS.forEach(id => { this.#state.protocol[id] = document.getElementById(id)?.value || ''; });
  }

  #applyProtocol() {
    PROTOCOL_FIELDS.forEach(id => { const el = document.getElementById(id); if (el) el.value = this.#state.protocol[id] || ''; });
  }

  #bind() {
    PROTOCOL_FIELDS.forEach(id => document.getElementById(id)?.addEventListener('input', () => { this.#readProtocol(); this.#save(); }));
    document.querySelectorAll('.review-tab').forEach(btn => btn.addEventListener('click', () => this.#switchTab(btn.dataset.reviewTab)));
    document.querySelector('.workflow-nav a[href="#review-report"]')?.addEventListener('click', e => {
      e.preventDefault(); this.#switchTab('report'); document.getElementById('reviewWorkspace')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    document.getElementById('btnSyncFullText')?.addEventListener('click', () => this.#syncFullText());
    document.getElementById('fullTextBody')?.addEventListener('input', e => this.#updateFullText(e));
    document.getElementById('fullTextBody')?.addEventListener('change', e => this.#updateFullText(e));
    document.getElementById('btnSyncRisk')?.addEventListener('click', () => this.#syncRisk());
    document.getElementById('btnAddRiskStudy')?.addEventListener('click', () => this.#addRisk());
    document.getElementById('riskAssessmentList')?.addEventListener('change', e => this.#updateRisk(e));
    document.getElementById('riskAssessmentList')?.addEventListener('input', e => this.#updateRisk(e));
    document.getElementById('riskAssessmentList')?.addEventListener('click', e => { const btn = e.target.closest('.btn-risk-remove'); if (btn) { this.#state.risk = this.#state.risk.filter(x => x.id !== btn.dataset.id); this.#renderRisk(); this.#save(); } });
    document.getElementById('btnAddGradeOutcome')?.addEventListener('click', () => { this.#state.grade.push({ id: uid('grade'), outcome: '', initial: 'rct', risk: '0', inconsistency: '0', indirectness: '0', imprecision: '0', publication: '0', upgrade: '0' }); this.#renderGrade(); this.#save(); });
    document.getElementById('gradeBody')?.addEventListener('input', e => this.#updateGrade(e));
    document.getElementById('gradeBody')?.addEventListener('change', e => this.#updateGrade(e));
    document.getElementById('gradeBody')?.addEventListener('click', e => { const btn = e.target.closest('.btn-grade-remove'); if (btn) { this.#state.grade = this.#state.grade.filter(x => x.id !== btn.dataset.id); this.#renderGrade(); this.#save(); } });
    document.getElementById('btnBuildReport')?.addEventListener('click', () => this.buildReport());
    document.getElementById('btnExportReportHtml')?.addEventListener('click', () => this.#exportReport());
    document.getElementById('btnPrintReport')?.addEventListener('click', () => window.print());
  }

  #switchTab(name) {
    document.querySelectorAll('.review-tab').forEach(btn => { const active = btn.dataset.reviewTab === name; btn.classList.toggle('active', active); btn.setAttribute('aria-selected', String(active)); });
    document.querySelectorAll('.review-pane').forEach(pane => pane.hidden = pane.dataset.reviewPane !== name);
  }

  #syncFullText() {
    const records = this.#getRecords?.() || [];
    const recordIds = new Set(records.map(r => r.id));
    this.#state.fullText = this.#state.fullText.filter(row => !row.recordId || recordIds.has(row.recordId));
    const candidates = records.filter(r => ['建议纳入', '待人工判断', '最终纳入', '最终排除'].includes(r.decision));
    const linked = new Set(this.#state.fullText.map(x => x.recordId));
    candidates.forEach(record => {
      if (!linked.has(record.id)) this.#state.fullText.push({ id: uid('full'), recordId: record.id, study: record.title || record.pmid || record.doi || '未命名研究', status: record.decision === '最终纳入' ? 'included' : record.decision === '最终排除' ? 'excluded' : 'pending', reason: '', locator: '', notes: '' });
    });
    this.#renderFullText(); this.#save();
  }

  #renderFullText() {
    const body = document.getElementById('fullTextBody'); if (!body) return;
    body.innerHTML = this.#state.fullText.length ? this.#state.fullText.map(row => `<tr data-id="${esc(row.id)}">
      <td><b title="${esc(row.study)}">${esc(String(row.study).slice(0, 72))}</b></td>
      <td><select data-field="status"><option value="pending"${row.status === 'pending' ? ' selected' : ''}>待获取全文</option><option value="obtained"${row.status === 'obtained' ? ' selected' : ''}>已获取·待复筛</option><option value="included"${row.status === 'included' ? ' selected' : ''}>全文纳入</option><option value="excluded"${row.status === 'excluded' ? ' selected' : ''}>全文排除</option></select></td>
      <td><textarea data-field="reason" placeholder="全文排除时必填">${esc(row.reason)}</textarea></td>
      <td><textarea data-field="locator" placeholder="PDF 文件名、页码、表格编号">${esc(row.locator)}</textarea></td>
      <td><textarea data-field="notes" placeholder="两名复核者意见或证据摘录">${esc(row.notes)}</textarea></td>
    </tr>`).join('') : '<tr><td colspan="5" class="meta-empty">点击“同步待复核文献”开始全文复筛。</td></tr>';
  }

  #updateFullText(event) {
    const tr = event.target.closest('tr[data-id]'); const field = event.target.dataset.field;
    if (!tr || !field) return;
    const row = this.#state.fullText.find(x => x.id === tr.dataset.id); if (!row) return;
    row[field] = event.target.value;
    if (field === 'status' || field === 'reason') {
      if (row.status === 'included') this.#updateRecord?.(row.recordId, { decision: '最终纳入', reason: row.notes ? `全文纳入：${row.notes}` : '全文复筛纳入' });
      if (row.status === 'excluded') this.#updateRecord?.(row.recordId, { decision: '最终排除', reason: `全文排除：${row.reason || '待补充理由'}` });
    }
    this.#save();
  }

  #syncRisk() {
    const allRecords = this.#getRecords?.() || [];
    const recordIds = new Set(allRecords.map(r => r.id));
    this.#state.risk = this.#state.risk.filter(row => !row.recordId || recordIds.has(row.recordId));
    const records = allRecords.filter(r => r.decision === '最终纳入');
    const linked = new Set(this.#state.risk.map(x => x.recordId));
    const tool = document.getElementById('riskDefaultTool')?.value || 'rob2';
    records.forEach(record => { if (!linked.has(record.id)) this.#state.risk.push(this.#newRisk(record.id, record.title || record.pmid || record.doi || '未命名研究', tool)); });
    this.#renderRisk(); this.#save();
  }

  #addRisk() {
    const tool = document.getElementById('riskDefaultTool')?.value || 'rob2';
    this.#state.risk.push(this.#newRisk('', `研究 ${this.#state.risk.length + 1}`, tool)); this.#renderRisk(); this.#save();
  }

  #newRisk(recordId, study, tool) {
    return { id: uid('risk'), recordId, study, tool, domains: {}, notes: '' };
  }

  #riskOverall(row) {
    const values = Object.values(row.domains || {});
    const expected = (RISK_TOOLS[row.tool] || RISK_TOOLS.rob2).domains.length;
    const complete = values.filter(Boolean).length === expected;
    if (!values.length) return { key: 'unclear', label: '待评价' };
    if (row.tool === 'nos') {
      if (!complete) return { key: 'unclear', label: '待完成 NOS 评价' };
      const score = values.filter(v => v === 'yes').length;
      return score >= 7 ? { key: 'low', label: `${score}/9 星 · 高质量` } : score >= 5 ? { key: 'some', label: `${score}/9 星 · 中等质量` } : { key: 'high', label: `${score}/9 星 · 低质量` };
    }
    if (row.tool === 'robins') {
      if (values.includes('critical') || values.includes('serious')) return { key: 'high', label: values.includes('critical') ? '极严重偏倚风险' : '严重偏倚风险' };
      if (!complete) return { key: 'unclear', label: '待完成评价' };
      if (values.includes('moderate') || values.includes('unclear')) return { key: 'some', label: '中等/信息不足' };
      return { key: 'low', label: '低偏倚风险' };
    }
    if (values.includes('high')) return { key: 'high', label: '高偏倚风险' };
    if (!complete) return { key: 'unclear', label: '待完成评价' };
    if (values.includes('some') || values.includes('unclear')) return { key: 'some', label: row.tool === 'rob2' ? '存在一些问题' : '部分领域不明确' };
    return { key: 'low', label: '低偏倚风险' };
  }

  #renderRisk() {
    const list = document.getElementById('riskAssessmentList'); if (!list) return;
    list.innerHTML = this.#state.risk.length ? this.#state.risk.map(row => {
      const tool = RISK_TOOLS[row.tool] || RISK_TOOLS.rob2; const overall = this.#riskOverall(row);
      return `<details class="risk-card" data-id="${esc(row.id)}"><summary><span>${esc(row.study)}</span><span class="risk-overall risk-${overall.key}">${esc(overall.label)}</span></summary><div class="risk-card-content">
        <div class="risk-card-top"><label>研究名称<input data-field="study" value="${esc(row.study)}"></label><label>评价工具<select data-field="tool">${Object.entries(RISK_TOOLS).map(([key, value]) => `<option value="${key}"${row.tool === key ? ' selected' : ''}>${esc(value.label)}</option>`).join('')}</select></label><button type="button" class="r btn-risk-remove" data-id="${esc(row.id)}">删除</button></div>
        <div class="risk-domains">${tool.domains.map((domain, index) => `<label class="risk-domain">${esc(domain)}<select data-domain="d${index}"><option value="">待评价</option>${tool.options.map(([value, label]) => `<option value="${value}"${row.domains?.[`d${index}`] === value ? ' selected' : ''}>${esc(label)}</option>`).join('')}</select></label>`).join('')}</div>
        <label class="risk-notes">判断依据 / 原文定位<textarea data-field="notes" placeholder="记录页码、段落、表格或评价者说明">${esc(row.notes)}</textarea></label>
      </div></details>`;
    }).join('') : '<div class="meta-empty">尚未添加质量评价。</div>';
    const counts = { low: 0, some: 0, high: 0, unclear: 0 };
    this.#state.risk.forEach(row => counts[this.#riskOverall(row).key]++);
    const summary = document.getElementById('riskSummary');
    if (summary) summary.innerHTML = this.#state.risk.length ? `<span class="risk-low">低风险/高质量 ${counts.low}</span><span class="risk-some">一些问题/中等 ${counts.some}</span><span class="risk-high">高风险/低质量 ${counts.high}</span><span class="risk-unclear">待评价 ${counts.unclear}</span>` : '';
  }

  #updateRisk(event) {
    const card = event.target.closest('.risk-card[data-id]'); if (!card) return;
    const row = this.#state.risk.find(x => x.id === card.dataset.id); if (!row) return;
    if (event.target.dataset.field) {
      row[event.target.dataset.field] = event.target.value;
      if (event.target.dataset.field === 'tool') row.domains = {};
    }
    if (event.target.dataset.domain) row.domains[event.target.dataset.domain] = event.target.value;
    const shouldRender = Boolean(event.target.dataset.domain) || event.target.dataset.field === 'tool' || (event.type === 'change' && event.target.dataset.field === 'study');
    this.#save();
    if (shouldRender) {
      const activeId = row.id;
      this.#renderRisk();
      const refreshed = document.querySelector(`.risk-card[data-id="${CSS.escape(activeId)}"]`);
      if (refreshed) refreshed.open = true;
    }
  }

  #gradeScore(row) {
    const base = row.initial === 'rct' ? 4 : 2;
    const downgrade = ['risk', 'inconsistency', 'indirectness', 'imprecision', 'publication'].reduce((sum, key) => sum + Number(row[key] || 0), 0);
    const score = Math.max(1, Math.min(4, base - downgrade + Number(row.upgrade || 0)));
    return ({ 4: ['high', '高'], 3: ['moderate', '中等'], 2: ['low', '低'], 1: ['very-low', '极低'] })[score];
  }

  #gradeSelect(field, value, choices) {
    return `<select data-field="${field}">${choices.map(([v, label]) => `<option value="${v}"${String(value) === String(v) ? ' selected' : ''}>${label}</option>`).join('')}</select>`;
  }

  #renderGrade() {
    const body = document.getElementById('gradeBody'); if (!body) return;
    const down = [['0', '不降级'], ['1', '严重 −1'], ['2', '非常严重 −2']];
    body.innerHTML = this.#state.grade.length ? this.#state.grade.map(row => { const certainty = this.#gradeScore(row); return `<tr data-id="${esc(row.id)}"><td><input data-field="outcome" value="${esc(row.outcome)}" placeholder="结局名称"></td><td>${this.#gradeSelect('initial', row.initial, [['rct', 'RCT：高'], ['observational', '观察性：低']])}</td><td>${this.#gradeSelect('risk', row.risk, down)}</td><td>${this.#gradeSelect('inconsistency', row.inconsistency, down)}</td><td>${this.#gradeSelect('indirectness', row.indirectness, down)}</td><td>${this.#gradeSelect('imprecision', row.imprecision, down)}</td><td>${this.#gradeSelect('publication', row.publication, down)}</td><td>${this.#gradeSelect('upgrade', row.upgrade, [['0', '不升级'], ['1', '+1'], ['2', '+2']])}</td><td><span class="grade-certainty grade-${certainty[0]}">${certainty[1]}</span></td><td><button type="button" class="r btn-grade-remove" data-id="${esc(row.id)}">删除</button></td></tr>`; }).join('') : '<tr><td colspan="10" class="meta-empty">添加主要或次要结局后进行 GRADE 评价。</td></tr>';
  }

  #updateGrade(event) {
    const tr = event.target.closest('tr[data-id]'); const field = event.target.dataset.field; if (!tr || !field) return;
    const row = this.#state.grade.find(x => x.id === tr.dataset.id); if (!row) return;
    row[field] = event.target.value; this.#save();
    if (event.type === 'change') this.#renderGrade();
  }

  buildReport() {
    this.#readProtocol();
    const p = this.#state.protocol, stats = this.#getStats?.() || {};
    const meta = this.#getMetaReport?.() || null;
    const forestImage = meta ? document.getElementById('metaForestCanvas')?.toDataURL('image/png') : '';
    const funnelImage = meta ? document.getElementById('metaFunnelCanvas')?.toDataURL('image/png') : '';
    const riskCounts = { low: 0, some: 0, high: 0, unclear: 0 };
    this.#state.risk.forEach(row => riskCounts[this.#riskOverall(row).key]++);
    const searchAudit = document.getElementById('searchAuditPanel')?.innerText?.trim() || '尚未执行本次数据库检索，或检索审计未保存在当前会话。';
    const includedFullText = this.#state.fullText.filter(x => x.status === 'included').length;
    const excludedFullText = this.#state.fullText.filter(x => x.status === 'excluded');
    const report = `<h1>${esc(p.reviewTitle || '系统评价与 Meta 分析项目报告')}</h1><p><b>生成时间：</b>${new Date().toLocaleString('zh-CN')}</p>
      <h2>1. 研究方案</h2><p>${esc(p.reviewObjective || '未填写研究目标')}</p><table><tbody><tr><th>P 人群</th><td>${esc(p.picosPopulation || '—')}</td></tr><tr><th>I/E 干预或暴露</th><td>${esc(p.picosIntervention || '—')}</td></tr><tr><th>C 对照</th><td>${esc(p.picosComparator || '—')}</td></tr><tr><th>O 结局</th><td>${esc(p.picosOutcomes || '—')}</td></tr><tr><th>S 设计</th><td>${esc(p.picosDesign || '—')}</td></tr><tr><th>注册</th><td>${esc(p.protocolRegistration || '未注册/未填写')}</td></tr></tbody></table>
      <h3>纳入标准</h3>${this.#listHtml(lines(p.inclusionCriteria))}<h3>排除标准</h3>${this.#listHtml(lines(p.exclusionCriteria))}
      <h2>2. 检索与筛选</h2><div class="report-kpi"><div><b>${Number(stats.fetched || 0)}</b><span>获取题录</span></div><div><b>${Number(stats.total || 0)}</b><span>去重后</span></div><div><b>${includedFullText || Number(stats.finalIncluded || 0)}</b><span>全文纳入</span></div><div><b>${excludedFullText.length || Number(stats.finalExcluded || 0)}</b><span>全文排除</span></div></div><pre>${esc(searchAudit)}</pre>
      ${excludedFullText.length ? `<h3>全文排除理由</h3><ul>${excludedFullText.map(x => `<li>${esc(x.study)}：${esc(x.reason || '未填写')}</li>`).join('')}</ul>` : ''}
      <h2>3. 偏倚风险与证据确定性</h2><p>已评价 ${this.#state.risk.length} 项研究：低风险/高质量 ${riskCounts.low}，一些问题/中等 ${riskCounts.some}，高风险/低质量 ${riskCounts.high}，待评价 ${riskCounts.unclear}。</p>${this.#gradeReportHtml()}
      <h2>4. 统计分析</h2>${meta ? `<p><b>${esc(meta.measureLabel)}</b>，${esc(meta.modelLabel)}；合并效应 ${esc(meta.estimate)}（95% CI ${esc(meta.lower)}～${esc(meta.upper)}），p ${esc(meta.p)}；I²=${esc(meta.i2)}%，τ²=${esc(meta.tau2)}，纳入 ${esc(meta.k)} 项研究。</p>${forestImage ? `<figure class="report-figure"><img src="${forestImage}" alt="Meta 分析森林图"><figcaption>图 1　森林图</figcaption></figure>` : ''}${funnelImage ? `<figure class="report-figure"><img src="${funnelImage}" alt="Meta 分析漏斗图"><figcaption>图 2　漏斗图</figcaption></figure>` : ''}` : '<p>尚未完成或当前数据改变后尚未重新计算 Meta 分析。</p>'}
      <h2>5. 方法学说明</h2><p>效应量与合并结果由确定性统计公式计算。自动化结果必须由具备系统评价方法学和临床专业知识的研究者复核；偏倚风险、GRADE 和发表偏倚判断不得仅依赖单一自动指标。</p>`;
    document.getElementById('reviewReportPreview').innerHTML = report;
    this.#switchTab('report');
    return report;
  }

  #listHtml(items) { return items.length ? `<ul>${items.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : '<p>未填写</p>'; }

  #gradeReportHtml() {
    if (!this.#state.grade.length) return '<p>尚未进行 GRADE 评价。</p>';
    return `<table><thead><tr><th>结局</th><th>证据确定性</th></tr></thead><tbody>${this.#state.grade.map(row => `<tr><td>${esc(row.outcome || '未命名结局')}</td><td>${this.#gradeScore(row)[1]}</td></tr>`).join('')}</tbody></table>`;
  }

  #exportReport() {
    const report = this.buildReport();
    const title = this.#state.protocol.reviewTitle || 'Meta分析项目报告';
    const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${esc(title)}</title><style>body{font-family:Arial,'Microsoft YaHei',sans-serif;max-width:960px;margin:40px auto;padding:0 24px;color:#243b48;line-height:1.65}h1{color:#0b4f79}h2{color:#145f83;border-bottom:2px solid #dceaf0;padding-bottom:6px;margin-top:28px}table{border-collapse:collapse;width:100%;margin:12px 0}th,td{border:1px solid #d6e2e8;padding:8px;text-align:left;vertical-align:top}th{background:#f1f7f9}pre{white-space:pre-wrap;background:#f6f9fa;padding:12px;border-radius:8px}.report-kpi{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}.report-kpi div{background:#f1f7f9;padding:12px;text-align:center}.report-kpi b,.report-kpi span{display:block}.report-kpi b{font-size:22px;color:#0f6b9e}.report-kpi span{font-size:11px}.report-figure{margin:18px 0;text-align:center}.report-figure img{max-width:100%;height:auto}.report-figure figcaption{font-size:12px;color:#64748b}</style></head><body>${report}</body></html>`;
    download(`${title.replace(/[\\/:*?"<>|]/g, '_')}.html`, html, 'text/html;charset=utf-8');
  }
}
