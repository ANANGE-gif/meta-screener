// main.js — 应用入口。组装所有模块，编排启动流程。

import { EventBus } from './event-bus.js?v=20260722b';
import { AppState } from './state.js?v=20260820a';
import { Renderer } from './renderer.js?v=20260722b';
import { UIManager } from './ui.js?v=20260818c';
import { AuthService } from './auth.js?v=20260722b';
import { QueryBuilder } from './query-builder.js?v=20260722b';
import { ScoringEngine } from './scoring.js?v=20260801d';
import { PrismaDiagram } from './prisma.js?v=20260722b';
import { ApiFetcher } from './api-fetcher.js?v=20260820a';
import { FileParser } from './parsers.js?v=20260723f';
import { addRecords } from './dedup.js?v=20260722b';
import { sourceLabelFor } from './record.js?v=20260722b';
import { downloadBlob, getById as $ } from './utils.js?v=20260722b';
import { getLicense } from './storage.js?v=20260818c';
import { MetaAnalysisWorkspace } from './analysis-ui.js?v=20260818b';
import { ReviewWorkflow } from './review-workflow.js?v=20260723o';

// ===== 1. Initialize Core =====
const eventBus = new EventBus();
const state = new AppState(eventBus);
const renderer = new Renderer(state, eventBus);
const authService = new AuthService(eventBus);
const metaWorkspace = new MetaAnalysisWorkspace({ getRecords: () => state.records });
const reviewWorkflow = new ReviewWorkflow({
  getRecords: () => state.records,
  getStats: () => state.getStats(),
  updateRecord: (id, partial) => {
    const changed = state.updateRecord(id, partial);
    if (changed) renderer.render();
    return changed;
  },
  getMetaReport: () => metaWorkspace.getReportData()
});

// ===== 2. Initialize UI (must come before apiFetcher — it uses ui for progress) =====
const ui = new UIManager({ eventBus, authService, state, renderer });

// ===== 3. Initialize API Fetcher =====
const liveSearchAudits = new Map();
const apiFetcher = new ApiFetcher({
  onProgress({ current, total, label }) {
    ui.updateProgress(current, total, label);
  },
  onError({ source, error }) {
    console.error(`[ApiFetcher] ${source} error:`, error);
  },
  onSourceComplete(audit) {
    liveSearchAudits.set(audit.source, audit);
    ui.renderSearchAudit([...liveSearchAudits.values()]);
  }
});

// ===== Commercial workspace routing: one task, one page =====
const PAGE_ROUTES = [
  { key: 'protocol', target: '#protocol-workspace' },
  { key: 'search', target: '#workspace' },
  { key: 'screening', target: '#screening-workspace' },
  { key: 'quality', target: '#quality-workspace' },
  { key: 'analysis', target: '#meta-analysis-workspace' },
  { key: 'report', target: '#review-report' }
];
let commercialLayoutReady = false;

function prepareCommercialLayout() {
  if (commercialLayoutReady) return;
  const main = document.getElementById('mainApp');
  if (!main) return;
  const starts = PAGE_ROUTES.slice(0, 5).map(route => document.querySelector(route.target));
  starts.forEach((start, index) => {
    if (!start) return;
    const end = starts[index + 1] || null;
    const page = document.createElement('section');
    page.className = 'commercial-stage';
    page.dataset.page = PAGE_ROUTES[index].key;
    page.hidden = true;
    main.insertBefore(page, start);
    let node = start;
    while (node && node !== end) {
      const next = node.nextSibling;
      page.appendChild(node);
      node = next;
    }
  });

  const reportPane = document.getElementById('review-report');
  if (reportPane) {
    const reportPage = document.createElement('section');
    reportPage.className = 'commercial-stage report-delivery-page';
    reportPage.dataset.page = 'report';
    reportPage.hidden = true;
    reportPage.innerHTML = '<div class="workflow-heading"><span>任务 6</span><div><b>报告交付</b><small>生成、核对并导出可复核的项目成果包</small></div></div><section class="card report-delivery-card"></section>';
    reportPage.querySelector('.report-delivery-card').appendChild(reportPane);
    main.appendChild(reportPage);
  }
  commercialLayoutReady = true;
}

function routeKeyForTarget(target) {
  if (target === '#dashboard' || target === '#projectHome') return 'dashboard';
  return PAGE_ROUTES.find(route => route.target === target)?.key || 'protocol';
}

function activateCommercialPage(target, { updateHistory = true, scroll = true } = {}) {
  if (!commercialLayoutReady) return;
  const key = routeKeyForTarget(target);
  const dashboard = key === 'dashboard';
  document.body.classList.toggle('workspace-task-mode', !dashboard);
  const home = document.getElementById('projectHome');
  const assurance = document.querySelector('.assurance-strip');
  const cockpit = document.getElementById('projectCockpit');
  if (home) home.hidden = !dashboard;
  if (assurance) assurance.hidden = !dashboard;
  if (cockpit) cockpit.hidden = dashboard;
  document.querySelectorAll('.commercial-stage').forEach(page => {
    page.hidden = dashboard || page.dataset.page !== key;
  });
  document.querySelectorAll('.workflow-nav a').forEach(link => {
    const linkKey = link.dataset.page || routeKeyForTarget(link.getAttribute('href'));
    link.classList.toggle('is-open', linkKey === key);
  });
  if (key === 'report') {
    document.querySelectorAll('.review-tab').forEach(tab => tab.classList.toggle('active', tab.dataset.reviewTab === 'report'));
    document.querySelectorAll('.review-pane').forEach(pane => { pane.hidden = pane.dataset.reviewPane !== 'report'; });
  } else if (key === 'quality' && !document.querySelector('#reviewWorkspace .review-pane:not([hidden])')) {
    document.querySelectorAll('.review-tab').forEach(tab => tab.classList.toggle('active', tab.dataset.reviewTab === 'fulltext'));
    document.querySelectorAll('.review-pane').forEach(pane => { pane.hidden = pane.dataset.reviewPane !== 'fulltext'; });
  }
  const hash = dashboard ? '#dashboard' : (PAGE_ROUTES.find(route => route.key === key)?.target || '#dashboard');
  if (updateHistory && location.hash !== hash) history.pushState({ page: key }, '', hash);
  if (scroll) document.getElementById('mainApp')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ===== Product experience: project status, progress and guided next action =====
const UX_STAGES = [
  { label: '填写研究方案', target: '#protocol-workspace', hint: '先定义研究问题、PICOS 和纳排标准。' },
  { label: '检索并获取题录', target: '#workspace', hint: '选择数据库、检查检索式并获取题录。' },
  { label: '完成文献筛选', target: '#screening-workspace', hint: '复核题录，并给出最终纳入或排除结论。' },
  { label: '完成全文与质量评价', target: '#quality-workspace', hint: '记录全文决定、偏倚风险和 GRADE。' },
  { label: '计算并生成图表', target: '#meta-analysis-workspace', hint: '提取研究数据，计算合并效应并检查图表。' },
  { label: '生成可交付报告', target: '#review-report', hint: '汇总研究方案、筛选、质量评价和统计结果。' }
];
let uxTimer = null;

function goToWorkflowTarget(target) {
  activateCommercialPage(target);
}

function refreshProductUX() {
  if (!document.getElementById('projectHome')) return;
  const review = reviewWorkflow.exportState();
  const analysis = metaWorkspace.exportState();
  const records = state.records;
  const isDemo = localStorage.getItem('meta_project_mode') === 'demo' || (records.length > 0 && records.every(r => r.importMethod === 'demo'));
  const finalCount = records.filter(r => r.decision === '最终纳入' || r.decision === '最终排除').length;
  const fullTextDecided = review.fullText.filter(row => row.status === 'included' || row.status === 'excluded').length;
  const protocol = review.protocol || {};
  const complete = [
    Boolean(protocol.reviewTitle && protocol.reviewObjective && protocol.picosPopulation && protocol.picosOutcomes),
    records.length > 0,
    records.length > 0 && finalCount > 0,
    fullTextDecided > 0 && review.risk.length > 0,
    Boolean(metaWorkspace.getReportData()),
    localStorage.getItem('meta_report_generated') === '1' || Boolean(document.querySelector('#reviewReportPreview h1'))
  ];
  const completed = complete.filter(Boolean).length;
  const progress = Math.round(completed / complete.length * 100);
  const nextIndex = complete.findIndex(value => !value);
  const activeIndex = nextIndex === -1 ? complete.length - 1 : nextIndex;
  const next = UX_STAGES[activeIndex];
  const title = protocol.reviewTitle?.trim() || '尚未命名的项目';
  const includedCount = records.filter(r => r.decision === '最终纳入').length;

  ['currentProjectName', 'cockpitProjectName'].forEach(id => { const el = document.getElementById(id); if (el) el.textContent = title; });
  const dashboardValues = {
    dashboardRecordCount: records.length,
    dashboardDecisionCount: finalCount,
    dashboardIncludedCount: includedCount,
    dashboardReportState: complete[5] ? '已生成' : '待生成'
  };
  Object.entries(dashboardValues).forEach(([id, value]) => { const el = document.getElementById(id); if (el) el.textContent = String(value); });
  const mode = document.getElementById('projectModeBadge');
  if (mode) { mode.textContent = isDemo ? '演示项目' : '真实项目'; mode.classList.toggle('is-demo', isDemo); }
  const overviewText = document.getElementById('projectProgressText'); if (overviewText) overviewText.textContent = `${completed}/6 阶段完成`;
  const overviewBar = document.getElementById('projectProgressBar'); if (overviewBar) overviewBar.style.width = `${progress}%`;
  const cockpitBar = document.getElementById('cockpitProgressBar'); if (cockpitBar) cockpitBar.style.width = `${progress}%`;
  const cockpitLabel = document.getElementById('cockpitProgressLabel'); if (cockpitLabel) cockpitLabel.textContent = `完成度 ${progress}%`;
  const hint = document.getElementById('projectNextHint'); if (hint) hint.textContent = nextIndex === -1 ? '项目核心流程已完成，可导出报告和项目备份。' : next.hint;
  const nextText = document.getElementById('nextActionText'); if (nextText) nextText.textContent = nextIndex === -1 ? '查看项目报告' : next.label;
  const overviewNext = document.getElementById('btnNextAction'); if (overviewNext) overviewNext.dataset.target = nextIndex === -1 ? '#review-report' : next.target;
  const continueButton = document.getElementById('btnContinueProject');
  if (continueButton) continueButton.dataset.target = nextIndex === -1 ? '#review-report' : next.target;
  const cockpitNext = document.getElementById('btnCockpitNext');
  if (cockpitNext) { cockpitNext.dataset.target = nextIndex === -1 ? '#review-report' : next.target; cockpitNext.textContent = nextIndex === -1 ? '查看项目报告' : `继续：${next.label}`; }
  document.querySelectorAll('.workflow-nav a[data-stage]').forEach(link => {
    const index = Number(link.dataset.stage);
    link.classList.toggle('is-complete', complete[index]);
    link.classList.toggle('is-current', index === activeIndex);
  });
}

function scheduleProductUX() {
  clearTimeout(uxTimer);
  uxTimer = setTimeout(refreshProductUX, 60);
}

function handleNewProject() {
  const hasData = state.records.length || reviewWorkflow.exportState().protocol.reviewTitle || metaWorkspace.exportState().rows.length;
  if (hasData && !confirm('新建空白项目会清除当前项目内容。建议先点击“备份 JSON”。确定继续吗？')) return;
  state.setRecords([]);
  reviewWorkflow.importState({ protocol: {}, fullText: [], risk: [], grade: [] });
  metaWorkspace.importState({ rows: [], type: 'binary', measure: 'OR', model: 'random', outcome: '' });
  localStorage.setItem('meta_project_mode', 'live');
  localStorage.removeItem('meta_report_generated');
  localStorage['meta_screener_prisma'] = '0';
  state.markPrismaDirty(); state.saveNow(); renderer.render();
  ui.setStatus('已创建空白项目，请从研究方案开始。');
  refreshProductUX();
  goToWorkflowTarget('#protocol-workspace');
  document.getElementById('reviewTitle')?.focus();
}

// ===== 4. Action Callbacks (wired to UI buttons) =====

function buildQueryAndRefresh() {
  const { pubmed, generic } = QueryBuilder.refreshAll();
  saveCurrentSettings();
}

function saveCurrentSettings() {
  const settings = state.collectSettings();
  state.saveSettings(settings);
}

async function handleFetchDatabases() {
  try {
    const chosenSources = [...document.querySelectorAll('.db-check:checked')].map(x => x.value);
    const cnChosen = [...document.querySelectorAll('.db-check-cn:checked')].map(x => x.value);

    if (!chosenSources.length && !cnChosen.length) {
      ui.setStatus('请先勾选至少一个数据库');
      return;
    }

    buildQueryAndRefresh();
    apiFetcher.reset();
    ui.showStopButton();
    liveSearchAudits.clear();
    chosenSources.forEach(source => liveSearchAudits.set(source, {
      source, label: sourceLabelFor(source), pending: true
    }));
    ui.renderSearchAudit([...liveSearchAudits.values()]);

    const messages = [];
    let allRecords = [];

    // Fetch direct databases sequentially
    if (chosenSources.length) {
      const { messages: fetchMsgs, records, audits } = await apiFetcher.fetchSelectedDatabases(chosenSources);
      messages.push(...fetchMsgs);
      if (records && records.length) allRecords = records;
      if (typeof ui.renderSearchAudit === 'function') ui.renderSearchAudit(audits || []);
    }

    ui.hideStopButton();
    ui.hideProgress();

    // Add + dedup + score
    if (allRecords.length) {
      const result = addRecords(allRecords, state.records);
      state.markPrismaDirty();
      messages.push(`新增 ${result.added}，合并 ${result.merged}`);
    }

    // Chinese database queries
    if (cnChosen.length) {
      QueryBuilder.buildCnQueries(cnChosen);
      messages.push(`已为 ${cnChosen.map(s => sourceLabelFor(s)).join('、')} 生成检索式`);
    }

    ScoringEngine.screenAll(state.records, true);
    state.saveNow();
    renderer.render();
    ui.setStatus(messages.join(' ｜ ') || '完成');
  } catch (err) {
    console.error('Fetch error:', err);
    ui.setStatus('检索失败：' + (err.message || '未知错误'));
    ui.hideStopButton();
    ui.hideProgress();
  }
}

function handleStopFetch() {
  apiFetcher.abort();
  ui.setStatus('正在停止...');
  ui.hideStopButton();
}

function handleRescore() {
  buildQueryAndRefresh();
  ScoringEngine.screenAll(state.records);
  state.markPrismaDirty();
  state.saveNow();
  renderer.render();
}

function handleFilterChange() {
  state.setFilter('query', $('#f')?.value?.toLowerCase()?.trim() || '');
  state.setFilter('decision', $('#fd')?.value || '');
  state.setFilter('source', $('#fs')?.value || '');
  state.setFilter('studyType', $('#ft')?.value || '');
  // Only re-render the table on filter change — stats and source dropdown don't change
  renderer.renderTable();
}

async function handleImportFile(e) {
  const file = e.target.files[0];
  if (!file) return;
  const source = $('#manualSource')?.value || 'other';
  try {
    const records = await FileParser.importFile(file, source);
    const result = addRecords(records, state.records);
    ScoringEngine.screenAll(state.records);
    state.markPrismaDirty();
    state.saveNow();
    renderer.render();
    ui.setStatus(`从 ${sourceLabelFor(source)} 导入 ${records.length} 条；新增 ${result.added}，合并 ${result.merged}`);
  } catch (err) {
    alert('导入失败：' + err.message);
  }
}

async function handleImportJSON(e) {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const { records, settings, analysis, review } = await FileParser.importJSON(file);
    state.setRecords(records);
    if (settings) {
      state.applySettings(settings);
    }
    if (analysis) metaWorkspace.importState(analysis);
    if (review) reviewWorkflow.importState(review);
    ScoringEngine.screenAll(state.records);
    state.markPrismaDirty();
    state.saveNow();
    renderer.render();
    localStorage.setItem('meta_project_mode', 'live');
    localStorage.removeItem('meta_report_generated');
    refreshProductUX();
    ui.setStatus(`已导入 ${records.length} 条备份记录`);
  } catch (err) {
    alert('JSON 导入失败：' + err.message);
  }
}

function handleExportCSV() {
  const head = ['结论', '分数', '研究类型', '主来源', '全部来源', 'PMID', 'DOI', '原因',
    '题名', '年份', '期刊', '作者', '命中词', '摘要'];
  const rows = [head, ...state.getStudyFilteredRecords().map(r => [
    r.decision, r.score, r.studyType,
    r.sourceLabel || sourceLabelFor(r.source),
    Renderer.sourceDisplayText(r),
    r.pmid || '', r.doi || '', r.reason || '',
    r.title || '', r.year || '', r.journal || '',
    r.authors || '', r.hits || '', r.abstract || ''
  ])];

  const csv = '﻿' + rows.map(row =>
    row.map(v => '"' + String(v).replaceAll('"', '""') + '"').join(',')
  ).join('\n');

  downloadBlob('Meta筛选结果_Pro.csv', csv, 'text/csv;charset=utf-8');
}

function handleExportJSON() {
  const payload = {
    version: 'pro-3',
    exportedAt: new Date().toISOString(),
    settings: state.collectSettings(),
    records: state.records,
    analysis: metaWorkspace.exportState(),
    review: reviewWorkflow.exportState()
  };
  downloadBlob('Meta筛选备份_Pro.json', JSON.stringify(payload, null, 2), 'application/json');
}

function handleDemo() {
  if (state.records.length && !confirm('载入完整示例项目会替换当前题录、质量评价和数据提取内容。建议先点击“备份 JSON”。确定继续吗？')) return;
  const demoRecords = [
    { source: 'pubmed', pmid: '99999997', title: '【演示】Zhang 2018：IL-6 多态性与尘肺风险', year: '2018', journal: 'Occupational Medicine Demo', authors: 'Zhang; Li', abstract: '演示用病例对照研究。报告 IL-6 基因型、病例组与对照组人数，可计算比值比。', importMethod: 'demo' },
    { source: 'europepmc', pmid: '99999998', title: '【演示】Liu 2020：炎症因子与职业性尘肺易感性', year: '2020', journal: 'Respiratory Research Demo', authors: 'Liu; Wang', abstract: '演示用病例对照研究。研究成年人职业粉尘暴露人群，并报告主要结局数据。', importMethod: 'demo' },
    { source: 'cnki', title: '【演示】马某 2023：白细胞介素-6与煤工尘肺易感性', year: '2023', journal: '职业卫生演示期刊', authors: '马某; 孙某', abstract: '仅供功能演示的病例对照研究，提供可提取的二分类结局数据。', importMethod: 'demo' },
    { source: 'crossref', doi: '10.1000/demo-review', title: '【演示·排除】肺病细胞因子多态性的系统综述', year: '2022', journal: 'Demo Reviews', authors: 'Chen', abstract: 'Systematic review and meta-analysis; not an original study.', importMethod: 'demo' },
    { source: 'openalex', sourceId: 'DEMO-ANIMAL', title: '【演示·排除】小鼠矽肺模型中的 IL-6 表达', year: '2021', journal: 'Demo Toxicology', authors: 'Wang', abstract: 'Mouse animal model in vivo experiment; excluded from the human review.', importMethod: 'demo' }
  ];
  state.setRecords(demoRecords);
  ScoringEngine.screenAll(state.records);
  state.records.forEach((record, index) => {
    state.updateRecord(record.id, index < 3
      ? { decision: '最终纳入', reason: '【演示】题目摘要与全文均符合预设纳入标准', manual: true }
      : { decision: '最终排除', reason: index === 3 ? '【演示】非原始研究（系统综述）' : '【演示】研究对象不符合（动物实验）', manual: true });
  });
  const [zhang, liu, ma, review, animal] = state.records;
  reviewWorkflow.importState({
    protocol: {
      reviewTitle: '【完整演示】IL-6 与尘肺易感性的系统评价和 Meta 分析',
      reviewObjective: '评价 IL-6 相关暴露与尘肺发生风险的关联，并演示从方案、检索、筛选到统计报告的完整流程。',
      picosPopulation: '存在职业性粉尘暴露的成年人群',
      picosIntervention: 'IL-6 高表达、IL-6 基因多态性或相关炎症暴露',
      picosComparator: '无尘肺或低暴露对照人群',
      picosOutcomes: '主要结局：尘肺发生；次要结局：疾病严重程度',
      picosDesign: '病例对照研究、队列研究',
      protocolRegistration: 'DEMO-PROTOCOL-v1（仅供功能演示）',
      inclusionCriteria: '1. 原始人群研究\n2. 报告 IL-6 暴露或基因型\n3. 可提取病例组与对照组数据\n4. 提供可计算效应量的数据',
      exclusionCriteria: '1. 综述、会议摘要或病例报告\n2. 动物或体外研究\n3. 重复发表\n4. 数据无法提取'
    },
    fullText: [
      { id: 'demo-full-1', recordId: zhang.id, study: zhang.title, status: 'included', reason: '', locator: 'Zhang_2018_demo.pdf，第 4 页表 2', notes: '两名复核者一致纳入；数据完整。' },
      { id: 'demo-full-2', recordId: liu.id, study: liu.title, status: 'included', reason: '', locator: 'Liu_2020_demo.pdf，第 6 页表 3', notes: '两名复核者一致纳入；结局定义符合方案。' },
      { id: 'demo-full-3', recordId: ma.id, study: ma.title, status: 'included', reason: '', locator: 'Ma_2023_demo.pdf，第 5 页表 1', notes: '中文数据库研究；两名复核者一致纳入。' },
      { id: 'demo-full-4', recordId: review.id, study: review.title, status: 'excluded', reason: '非原始研究（系统综述）', locator: 'Review_2022_demo.pdf，第 2 页研究设计', notes: '两名复核者一致排除。' },
      { id: 'demo-full-5', recordId: animal.id, study: animal.title, status: 'excluded', reason: '研究对象不符合（动物实验）', locator: 'Animal_2021_demo.pdf，第 3 页方法', notes: '两名复核者一致排除。' }
    ],
    risk: [
      { id: 'demo-risk-1', recordId: zhang.id, study: zhang.title, tool: 'nos', domains: { d0: 'yes', d1: 'yes', d2: 'yes', d3: 'yes', d4: 'yes', d5: 'yes', d6: 'yes', d7: 'yes', d8: 'no' }, notes: '【演示】NOS 8/9 星；依据见方法与结果部分。' },
      { id: 'demo-risk-2', recordId: liu.id, study: liu.title, tool: 'nos', domains: { d0: 'yes', d1: 'yes', d2: 'yes', d3: 'yes', d4: 'yes', d5: 'no', d6: 'yes', d7: 'yes', d8: 'no' }, notes: '【演示】NOS 7/9 星；部分混杂因素调整不足。' },
      { id: 'demo-risk-3', recordId: ma.id, study: ma.title, tool: 'nos', domains: { d0: 'yes', d1: 'yes', d2: 'yes', d3: 'yes', d4: 'yes', d5: 'no', d6: 'no', d7: 'yes', d8: 'no' }, notes: '【演示】NOS 6/9 星；无应答信息不充分。' }
    ],
    grade: [
      { id: 'demo-grade-1', outcome: '尘肺发生（主要结局）', initial: 'observational', risk: '0', inconsistency: '1', indirectness: '0', imprecision: '0', publication: '0', upgrade: '1' },
      { id: 'demo-grade-2', outcome: '疾病严重程度（次要结局）', initial: 'observational', risk: '1', inconsistency: '1', indirectness: '0', imprecision: '1', publication: '0', upgrade: '0' }
    ]
  });
  metaWorkspace.importState({
    type: 'binary',
    measure: 'OR',
    model: 'random',
    outcome: '尘肺发生（主要结局）',
    rows: [
      { id: 'demo-meta-1', study: 'Zhang 2018（演示）', year: '2018', outcome: '尘肺发生（主要结局）', timepoint: '基线', subgroup: '亚洲', sourcePage: '表 2', eventsT: '12', totalT: '100', eventsC: '20', totalC: '100' },
      { id: 'demo-meta-2', study: 'Liu 2020（演示）', year: '2020', outcome: '尘肺发生（主要结局）', timepoint: '基线', subgroup: '欧洲', sourcePage: '表 3', eventsT: '18', totalT: '120', eventsC: '28', totalC: '118' },
      { id: 'demo-meta-3', study: '马某 2023（演示）', year: '2023', outcome: '尘肺发生（主要结局）', timepoint: '基线', subgroup: '亚洲', sourcePage: '表 1', eventsT: '8', totalT: '80', eventsC: '15', totalC: '82' }
    ]
  });
  state.markPrismaDirty();
  state.saveNow();
  renderer.render();
  metaWorkspace.updateIncludedCount();
  metaWorkspace.calculate();
  reviewWorkflow.buildReport();
  localStorage.setItem('meta_project_mode', 'demo');
  localStorage.setItem('meta_report_generated', '1');
  state.saveNow();
  refreshProductUX();
  ui.setStatus('已载入完整示例项目：方案、筛选、质量评价、数据提取、统计图和报告均已生成');
}

function handleClearAll() {
  if (confirm('确定清空所有题录？请先备份。')) {
    state.setRecords([]);
    localStorage['meta_screener_prisma'] = '0';
    state.markPrismaDirty();
    state.saveNow();
    renderer.render();
    localStorage.setItem('meta_project_mode', 'live');
    localStorage.removeItem('meta_report_generated');
    refreshProductUX();
    ui.setStatus('已清空');
  }
}

function handlePrismaNotRetrievedChange() {
  const input = $('#prismaNotRetrieved');
  const v = Math.max(0, parseInt(input?.value || '0', 10) || 0);
  PrismaDiagram.setNotRetrieved(v);
  renderer.renderPRISMA();
}

// ===== 4. Boot Sequence =====

async function boot() {
  prepareCommercialLayout();
  try {
    metaWorkspace.init();
    reviewWorkflow.init();
    // Dismiss splash first, then check auth
    await ui.dismissSplash();

    // Ensure auth overlay is visible by default (hidden behind splash until now)
    ui.showAuth();

    // Check auth
    const result = await authService.checkAuth();

    if (result.authenticated) {
      // Load data
      state.load();
      const savedSettings = state.loadSettings();
      state.applySettings(savedSettings);

      // Build query and score
      buildQueryAndRefresh();
      ScoringEngine.screenAll(state.records);

      // Render and switch to main app
      renderer.render();
      if (metaWorkspace.exportState().rows.length >= 2) metaWorkspace.calculate();
      if (localStorage.getItem('meta_report_generated') === '1') reviewWorkflow.buildReport();
      ui.hideAuth();
    } else if (result.mode === 'need-license') {
      // Logged in but no license bound
      ui.resetAuthUI();
      ui.showLicenseBinding(result.user);
    } else {
      // Not authenticated — auth overlay already showing
      ui.resetAuthUI();
    }
  } catch (err) {
    console.error('Boot error:', err);
    // Fallback: show auth overlay
    ui.resetAuthUI();
    ui.showAuth();
  }

  // Bind all UI events
  ui.bindLive({
    onBuildQuery: buildQueryAndRefresh,
    onFetchDatabases: handleFetchDatabases,
    onStopFetch: handleStopFetch,
    onCopyPubMedQuery: () => {
      const t = $('#pubmedQuery')?.textContent?.trim();
      navigator.clipboard?.writeText(t);
      ui.setStatus('已复制检索式');
    },
    onCopyEuropePMCQuery: () => {
      const t = $('#europePmcQuery')?.textContent?.trim();
      navigator.clipboard?.writeText(t);
      ui.setStatus('已复制 Europe PMC 检索式');
    },
    onCopyGenericQuery: () => {
      const t = $('#genericQuery')?.textContent?.trim();
      navigator.clipboard?.writeText(t);
      ui.setStatus('已复制检索式');
    },
    onRescore: handleRescore,
    onFilterChange: handleFilterChange,
    onImportFile: handleImportFile,
    onImportJSON: handleImportJSON,
    onExportCSV: handleExportCSV,
    onExportJSON: handleExportJSON,
    onDemo: handleDemo,
    onClearAll: handleClearAll,
    onExportPRISMASVG: () => PrismaDiagram.exportSVG(),
    onExportPRISMAPNG: () => PrismaDiagram.exportPNG(),
    onPrismaNotRetrievedChange: handlePrismaNotRetrievedChange
  });

  // Table event delegation
  renderer.setupTableDelegation();

  // Navbar + overlay buttons: use body-level delegation (robust against timing)
  document.body.addEventListener('click', async (e) => {
    // Logout
    if (e.target.closest('#btnLogout')) {
      await authService.logout();
      ui.resetAuthUI();
      ui.showAuth();
      return;
    }
    // Help
    if (e.target.closest('#btnHelp')) { ui.showHelp(); return; }
    // About
    if (e.target.closest('#btnAbout')) { ui.showAbout(); return; }
    // Full workflow demo
    if (e.target.closest('#btnFullDemo') || e.target.closest('#btnHomeDemo')) { handleDemo(); return; }
    if (e.target.closest('#btnNewProject')) { handleNewProject(); return; }
    const guidedButton = e.target.closest('#btnContinueProject, #btnNextAction, #btnCockpitNext');
    if (guidedButton) { goToWorkflowTarget(guidedButton.dataset.target || '#protocol-workspace'); return; }
    // Manual link
    if (e.target.closest('#lnkManual') || e.target.closest('#lnkManualAuth') || e.target.closest('#lnkManualHelp')) {
      e.preventDefault();
      ui.showManual();
      return;
    }
    // Hide overlays
    if (e.target.closest('#btnHideHelp')) { ui.hideHelp(); return; }
    if (e.target.closest('#btnHideAbout')) { ui.hideAbout(); return; }
    if (e.target.closest('#btnHideManual')) { ui.hideManual(); return; }
  });

  // EventBus subscriptions
  eventBus.on('auth:changed', ({ state: authState }) => {
    if (authState === 'logged-out') {
      return;
    }
    setTimeout(() => {
      const blankProject = state.records.length === 0
        && !reviewWorkflow.exportState().protocol.reviewTitle
        && metaWorkspace.exportState().rows.length === 0;
      if (authState === 'trial' && blankProject) handleDemo();
      refreshProductUX();
      activateCommercialPage('#dashboard', { updateHistory: false, scroll: false });
    }, 0);
  });

  eventBus.on('study-mode:changed', () => {
    ScoringEngine.screenAll(state.records);
    state.markPrismaDirty();
    state.saveNow();
    renderer.render();
  });

  eventBus.on('records:changed', () => {
    metaWorkspace.updateIncludedCount();
    localStorage.removeItem('meta_report_generated');
    scheduleProductUX();
  });

  // Sync study mode filter with study type on initial load
  const studyMode = $('#studyMode')?.value;
  if (studyMode && studyMode !== 'both') {
    const ft = $('#ft');
    if (ft) {
      if (studyMode === 'human') ft.value = 'human';
      else if (studyMode === 'animal') ft.value = 'animal';
      else if (studyMode === 'in_vitro') ft.value = 'in_vitro';
    }
  }
  const invalidateGeneratedReport = () => {
    localStorage.removeItem('meta_report_generated');
    scheduleProductUX();
  };
  document.addEventListener('input', invalidateGeneratedReport);
  document.addEventListener('change', invalidateGeneratedReport);
  document.addEventListener('click', e => {
    if (e.target.closest('#btnBuildReport')) {
      localStorage.setItem('meta_report_generated', '1');
      scheduleProductUX();
      return;
    }
    if (e.target.closest('#btnMetaCalculate, #btnSyncFullText, #btnSyncRisk, #btnAddGradeOutcome')) invalidateGeneratedReport();
    else if (e.target.closest('.review-tab, .meta-tab')) scheduleProductUX();
  });
  document.querySelectorAll('.workflow-nav a').forEach(link => {
    link.addEventListener('click', e => {
      e.preventDefault();
      activateCommercialPage(link.getAttribute('href'));
    });
  });
  document.querySelector('.review-tab[data-review-tab="report"]')?.addEventListener('click', () => {
    activateCommercialPage('#review-report');
  });
  window.addEventListener('popstate', () => {
    const target = PAGE_ROUTES.some(route => route.target === location.hash) ? location.hash : '#dashboard';
    activateCommercialPage(target, { updateHistory: false, scroll: false });
  });
  refreshProductUX();
  const initialTarget = PAGE_ROUTES.some(route => route.target === location.hash) ? location.hash : '#dashboard';
  activateCommercialPage(initialTarget, { updateHistory: false, scroll: false });
}

// ===== 5. Start =====
document.addEventListener('DOMContentLoaded', boot);
