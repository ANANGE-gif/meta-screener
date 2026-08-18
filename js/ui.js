// ui.js — UI 交互管理：弹层与事件绑定。

import { QueryBuilder } from './query-builder.js?v=20260722b';
import { esc } from './utils.js?v=20260722b';

export class UIManager {
  #eventBus;
  #authService;
  #state;
  #renderer;
  #queryBuilder;
  #scoring;
  #apiFetcher;
  #fileParser;
  #scoreTimer = null;
  #filterTimer = null;

  constructor({ eventBus, authService, state, renderer }) {
    this.#eventBus = eventBus;
    this.#authService = authService;
    this.#state = state;
    this.#renderer = renderer;
  }

  // ===== Splash Screen =====

  dismissSplash() {
    return new Promise((resolve) => {
      const splash = document.getElementById('splashScreen');
      if (!splash) { resolve(); return; }
      const done = () => {
        splash.classList.add('splash-exit');
        splash.addEventListener('animationend', () => { splash.remove(); resolve(); });
      };
      splash.addEventListener('click', done);
      document.addEventListener('keydown', done, { once: true });
      setTimeout(done, 180);
    });
  }

  // ===== Overlays =====

  showAuth() {
    const el = document.getElementById('authOverlay');
    if (el) el.style.display = '';
    const main = document.getElementById('mainApp');
    if (main) main.style.display = 'none';
  }

  hideAuth() {
    const el = document.getElementById('authOverlay');
    if (el) el.style.display = 'none';
    const main = document.getElementById('mainApp');
    if (main) main.style.display = '';
  }

  #openWorkspace() {
    this.#state.load();
    this.#state.applySettings(this.#state.loadSettings());
    QueryBuilder.refreshAll();
    this.#renderer.render();
    this.hideAuth();
  }

  /** 重置 Auth 弹层到初始登录状态 */
  resetAuthUI() {
    const loginForm = document.getElementById('loginForm');
    const registerForm = document.getElementById('registerForm');
    const tabLogin = document.getElementById('tabLoginBtn');
    const tabRegister = document.getElementById('tabRegisterBtn');
    const titleEl = document.querySelector('#authOverlay .auth-box h2');
    const bindDiv = document.getElementById('licenseBindDiv');

    if (loginForm) loginForm.style.display = '';
    if (registerForm) registerForm.style.display = 'none';
    if (tabLogin) { tabLogin.style.display = ''; tabLogin.classList.add('active'); }
    if (tabRegister) { tabRegister.style.display = ''; tabRegister.classList.remove('active'); }
    if (titleEl) titleEl.textContent = '进入研究工作台';
    if (bindDiv) bindDiv.style.display = 'none';

    // Clear error messages
    const loginError = document.getElementById('loginError');
    const registerError = document.getElementById('registerError');
    if (loginError) loginError.textContent = '';
    if (registerError) registerError.textContent = '';
  }

  showHelp() { this.#showOverlay('helpOverlay'); }
  hideHelp() { this.#hideOverlay('helpOverlay'); }
  showAbout() {
    this.#showOverlay('aboutOverlay');
    const el = document.getElementById('aboutLicense');
    if (el) {
      const lic = localStorage['meta_screener_pro_license'];
      if (lic === 'trial') el.textContent = '当前：试用模式（每次获取限 15 条）';
      else if (lic) el.textContent = '已激活：' + lic;
      else el.textContent = '';
    }
  }
  hideAbout() { this.#hideOverlay('aboutOverlay'); }
  showManual() { this.#showOverlay('manualOverlay'); }
  hideManual() { this.#hideOverlay('manualOverlay'); }

  #showOverlay(id) {
    const el = document.getElementById(id);
    if (el) el.style.display = '';
  }
  #hideOverlay(id) {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  }

  // ===== Navbar & Overlay Static Bindings =====

  bindOverlayButtons() {
    // Navbar
    const btnHelp = document.getElementById('btnHelp');
    if (btnHelp) btnHelp.addEventListener('click', () => this.showHelp());
    const btnAbout = document.getElementById('btnAbout');
    if (btnAbout) btnAbout.addEventListener('click', () => this.showAbout());

    // Manual links
    const lnkManual = document.getElementById('lnkManual');
    if (lnkManual) lnkManual.addEventListener('click', (e) => { e.preventDefault(); this.showManual(); });
    const lnkManualAuth = document.getElementById('lnkManualAuth');
    if (lnkManualAuth) lnkManualAuth.addEventListener('click', (e) => { e.preventDefault(); this.showManual(); });
    const lnkManualHelp = document.getElementById('lnkManualHelp');
    if (lnkManualHelp) lnkManualHelp.addEventListener('click', (e) => { e.preventDefault(); this.showManual(); });

    // Close buttons
    const btnHideHelp = document.getElementById('btnHideHelp');
    if (btnHideHelp) btnHideHelp.addEventListener('click', () => this.hideHelp());
    const btnHideAbout = document.getElementById('btnHideAbout');
    if (btnHideAbout) btnHideAbout.addEventListener('click', () => this.hideAbout());
    const btnHideManual = document.getElementById('btnHideManual');
    if (btnHideManual) btnHideManual.addEventListener('click', () => this.hideManual());
  }

  // ===== Debounced Actions =====

  scheduleRescore(callback) {
    clearTimeout(this.#scoreTimer);
    this.#scoreTimer = setTimeout(() => {
      if (callback) callback();
    }, 400);
  }

  debouncedFilter(callback) {
    clearTimeout(this.#filterTimer);
    this.#renderer.resetPage();
    this.#filterTimer = setTimeout(() => {
      if (callback) callback();
    }, 200);
  }

  // ===== Event Binding =====

  bindLive({
    onBuildQuery,
    onFetchDatabases,
    onStopFetch,
    onCopyPubMedQuery,
    onCopyEuropePMCQuery,
    onCopyGenericQuery,
    onRescore,
    onFilterChange,
    onImportFile,
    onImportJSON,
    onExportCSV,
    onExportJSON,
    onDemo,
    onClearAll,
    onExportPRISMASVG,
    onExportPRISMAPNG,
    onPrismaNotRetrievedChange
  } = {}) {
    // Retrieval actions
    this.#bindClick('btnBuildQuery', onBuildQuery);
    this.#bindClick('btnFetch', onFetchDatabases);
    this.#bindClick('btnStop', onStopFetch);
    this.#bindClick('btnCopyPubMedQuery', onCopyPubMedQuery);
    this.#bindClick('btnCopyEuropePMCQuery', onCopyEuropePMCQuery);
    this.#bindClick('btnCopyGenericQuery', onCopyGenericQuery);
    this.#bindClick('btnRescore', onRescore);

    // Export / Demo / Clear
    this.#bindClick('btnExportCSV', onExportCSV);
    this.#bindClick('btnExportJSON', onExportJSON);
    this.#bindClick('btnDemo', onDemo);
    this.#bindClick('btnClear', onClearAll);

    // PRISMA export
    this.#bindClick('btnExportSVG', onExportPRISMASVG);
    this.#bindClick('btnExportPNG', onExportPRISMAPNG);

    // PRISMA not retrieved
    const prismaInput = document.getElementById('prismaNotRetrieved');
    if (prismaInput) {
      prismaInput.addEventListener('change', onPrismaNotRetrievedChange);
    }

    // File imports
    const recordFileEl = document.getElementById('recordFile');
    if (recordFileEl) recordFileEl.addEventListener('change', onImportFile);
    const backupFileEl = document.getElementById('backupFile');
    if (backupFileEl) backupFileEl.addEventListener('change', onImportJSON);

    // Settings inputs (debounced rescore + build query)
    const settingIds = [
      'mode', 'studyMode', 'pop', 'animalTerms', 'expo', 'outcome', 'design',
      'yf', 'yt', 'max', 'sort', 'incWords', 'excWords', 'incCut', 'excCut',
      'manualSource', 'advTitleMul', 'advSynergy', 'advExcPenalty',
      'advPubTypeExc', 'advHumanPos', 'advAnimalPos',
      'cnPop', 'cnAnimal', 'cnExpo'
    ];
    settingIds.forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('input', () => this.scheduleRescore(onRescore));
      el.addEventListener('change', () => this.scheduleRescore(onRescore));
    });

    // Filter inputs (re-render only, no rescore)
    const filterIds = ['f', 'fd', 'fs', 'ft'];
    const filterHandler = onFilterChange || onRescore;
    filterIds.forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      const isSelect = el.tagName === 'SELECT';
      if (isSelect) {
        el.addEventListener('change', filterHandler);
      } else {
        el.addEventListener('input', () => this.debouncedFilter(filterHandler));
      }
    });

    // Study mode sync: when switching single-type modes, auto-set the study type filter
    const studyModeEl = document.getElementById('studyMode');
    if (studyModeEl) {
      studyModeEl.addEventListener('change', () => {
        const v = studyModeEl.value;
        const ftEl = document.getElementById('ft');
        if (ftEl) {
          if (v === 'human') ftEl.value = 'human';
          else if (v === 'animal') ftEl.value = 'animal';
          else if (v === 'in_vitro') ftEl.value = 'in_vitro';
          else ftEl.value = '';
        }
      });
    }

    // Database checkboxes: persist selections
    document.querySelectorAll('.db-check,.db-check-cn').forEach(box => {
      box.addEventListener('change', () => {
        const settings = this.#state.collectSettings();
        this.#state.saveSettings(settings);
      });
    });

    // Chinese query card delegation
    const cnPanel = document.getElementById('cnQueryPanel');
    if (cnPanel) {
      cnPanel.addEventListener('click', (e) => {
        const copyBtn = e.target.closest('.btn-copy-cn');
        const openBtn = e.target.closest('.btn-open-cn');
        if (copyBtn) {
          const src = copyBtn.dataset.src;
          const query = QueryBuilder.getQueryForSource(src);
          navigator.clipboard?.writeText(query);
          const statusEl = document.getElementById('status');
          if (statusEl) statusEl.textContent = `已复制检索式`;
        }
        if (openBtn) {
          const url = openBtn.dataset.url;
          const label = openBtn.dataset.label;
          window.open(url, '_blank');
        }
      });
    }

    // Auth overlay events
    this.#bindAuthEvents();
  }

  #bindAuthEvents() {
    // Tab switching
    this.#bindClick('tabLoginBtn', () => this.switchAuthTab('login'));
    this.#bindClick('tabRegisterBtn', () => this.switchAuthTab('register'));

    // Login form
    const loginForm = document.getElementById('loginForm');
    if (loginForm) loginForm.addEventListener('submit', (e) => {
      e.preventDefault();
      this.#handleLogin();
    });

    // Register form
    const registerForm = document.getElementById('registerForm');
    if (registerForm) registerForm.addEventListener('submit', (e) => {
      e.preventDefault();
      this.#handleRegister();
    });

    // Offline activation toggle
    const offlineLink = document.querySelector('.auth-offline-link');
    if (offlineLink) {
      offlineLink.addEventListener('click', (e) => {
        e.preventDefault();
        const box = document.getElementById('offlineActivationBox');
        if (box) box.style.display = box.style.display === 'none' ? '' : 'none';
      });
    }

    // Offline activate button
    const offlineBtn = document.getElementById('btnOfflineActivate');
    if (offlineBtn) {
      offlineBtn.addEventListener('click', () => this.#handleOfflineActivate());
    }

    // Trial link
    const trialLink = document.getElementById('lnkTrial');
    if (trialLink) {
      trialLink.addEventListener('click', (e) => {
        e.preventDefault();
        this.#authService.enterTrial();
        this.#openWorkspace();
      });
    }
  }

  #bindClick(id, handler) {
    if (!handler) return;
    const el = document.getElementById(id);
    if (el) el.addEventListener('click', handler);
  }

  // ===== Auth UI =====

  switchAuthTab(tab) {
    const isLogin = tab === 'login';
    const loginForm = document.getElementById('loginForm');
    const registerForm = document.getElementById('registerForm');
    const tabLogin = document.getElementById('tabLoginBtn');
    const tabRegister = document.getElementById('tabRegisterBtn');

    if (loginForm) loginForm.style.display = isLogin ? '' : 'none';
    if (registerForm) registerForm.style.display = isLogin ? 'none' : '';
    if (tabLogin) tabLogin.classList.toggle('active', isLogin);
    if (tabRegister) tabRegister.classList.toggle('active', !isLogin);

    const loginError = document.getElementById('loginError');
    const registerError = document.getElementById('registerError');
    if (loginError) loginError.textContent = '';
    if (registerError) registerError.textContent = '';
  }

  async #handleLogin() {
    const email = document.getElementById('loginEmail')?.value?.trim();
    const password = document.getElementById('loginPassword')?.value;
    const errorEl = document.getElementById('loginError');
    const btn = document.getElementById('loginBtn');

    if (!email || !password) { if (errorEl) errorEl.textContent = '请填写邮箱和密码'; return; }
    if (btn) { btn.disabled = true; btn.textContent = '登录中…'; }
    if (errorEl) errorEl.textContent = '';

    const result = await this.#authService.login(email, password);

    if (btn) { btn.disabled = false; btn.textContent = '登录'; }

    if (result.error) {
      if (errorEl) errorEl.textContent = result.error;
      return;
    }

    if (!result.hasLicense) {
      this.showLicenseBinding(result.session.user);
      return;
    }

    this.#openWorkspace();
  }

  async #handleRegister() {
    const email = document.getElementById('regEmail')?.value?.trim();
    const password = document.getElementById('regPassword')?.value;
    const passwordConfirm = document.getElementById('regPasswordConfirm')?.value;
    const licenseCode = document.getElementById('regLicense')?.value?.trim()?.toUpperCase();
    const errorEl = document.getElementById('registerError');
    const btn = document.getElementById('registerBtn');

    if (!email || !password || !licenseCode) { if (errorEl) errorEl.textContent = '请填写所有字段'; return; }
    if (password !== passwordConfirm) { if (errorEl) errorEl.textContent = '两次密码输入不一致'; return; }
    if (password.length < 6) { if (errorEl) errorEl.textContent = '密码至少需要6位'; return; }

    if (btn) { btn.disabled = true; btn.textContent = '注册中…'; }
    if (errorEl) errorEl.textContent = '正在验证激活码…';

    const result = await this.#authService.register(email, password, licenseCode);

    if (result.error) {
      if (errorEl) errorEl.textContent = result.error;
      if (btn) { btn.disabled = false; btn.textContent = '注册'; }
      return;
    }

    if (result.autoLogin) {
      this.#openWorkspace();
    } else if (result.needEmailConfirm) {
      alert('注册成功！请检查邮箱（含垃圾邮件）点击确认链接后，再返回此页面登录。');
      this.switchAuthTab('login');
    }
    if (btn) { btn.disabled = false; btn.textContent = '注册'; }
  }

  async #handleOfflineActivate() {
    const codeInput = document.getElementById('licenseInput');
    const errorEl = document.getElementById('activateError');
    const code = (codeInput?.value || '').trim().toUpperCase();

    if (!code) { if (errorEl) errorEl.textContent = '请输入激活码'; return; }
    if (errorEl) errorEl.textContent = '';

    if (!this.#authService.isValidOfflineCode(code)) {
      if (errorEl) errorEl.textContent = '无效的激活码，请检查后重试';
      return;
    }

    const result = await this.#authService.activateOffline(code);

    if (result.error) {
      if (errorEl) errorEl.textContent = result.error;
      return;
    }

    this.#openWorkspace();
  }

  showLicenseBinding(user) {
    this.showAuth();
    const loginForm = document.getElementById('loginForm');
    const registerForm = document.getElementById('registerForm');
    const tabLogin = document.getElementById('tabLoginBtn');
    const tabRegister = document.getElementById('tabRegisterBtn');
    const titleEl = document.querySelector('#authOverlay .auth-box h2');

    if (loginForm) loginForm.style.display = 'none';
    if (registerForm) registerForm.style.display = 'none';
    if (tabLogin) tabLogin.style.display = 'none';
    if (tabRegister) tabRegister.style.display = 'none';
    if (titleEl) titleEl.textContent = '绑定专业版授权';

    let bindDiv = document.getElementById('licenseBindDiv');
    if (!bindDiv) {
      bindDiv = document.createElement('div');
      bindDiv.id = 'licenseBindDiv';
      bindDiv.innerHTML = `
        <div class="auth-input-wrap"><input type="text" id="bindLicenseInput" placeholder="请输入激活码"></div>
        <div id="bindLicenseError" class="auth-error"></div>
        <div class="auth-form-actions">
          <button class="auth-btn-primary" id="btnBindLicense">绑定激活码</button>
        </div>
      `;
      const trialLink = document.querySelector('.auth-trial-link');
      const authBox = document.querySelector('#authOverlay .auth-box');
      if (authBox && trialLink) {
        authBox.insertBefore(bindDiv, trialLink);
      }
    }
    if (bindDiv) bindDiv.style.display = '';

    // Bind the button
    const bindBtn = document.getElementById('btnBindLicense');
    if (bindBtn) {
      bindBtn.onclick = async () => {
        const codeInput = document.getElementById('bindLicenseInput');
        const code = (codeInput?.value || '').trim().toUpperCase();
        const errorEl = document.getElementById('bindLicenseError');

        if (!code) { if (errorEl) errorEl.textContent = '请输入激活码'; return; }

        const current = await this.#authService.getCurrentUser();
        if (!current || !current.user) { if (errorEl) errorEl.textContent = '登录已过期，请重新登录'; return; }

        const result = await this.#authService.bindLicense(current.user.id, code);
        if (result.error) { if (errorEl) errorEl.textContent = result.error; return; }

        this.#openWorkspace();
      };
    }
  }

  // ===== Progress Bar =====

  updateProgress(current, total, label) {
    const bar = document.getElementById('progressBar');
    const fill = document.getElementById('progressFill');
    const status = document.getElementById('status');
    if (bar) bar.style.display = '';
    if (fill) {
      const pct = total > 0 ? Math.min(100, Math.round(current / total * 100)) : 0;
      fill.style.width = pct + '%';
    }
    if (status) status.textContent = label;
  }

  hideProgress() {
    const bar = document.getElementById('progressBar');
    if (bar) bar.style.display = 'none';
  }

  // ===== Status Message =====

  setStatus(msg) {
    const el = document.getElementById('status');
    if (el) el.textContent = msg;
  }

  renderSearchAudit(audits) {
    const panel = document.getElementById('searchAuditPanel');
    if (!panel) return;
    if (!Array.isArray(audits) || !audits.length) {
      panel.innerHTML = '';
      panel.style.display = 'none';
      return;
    }
    panel.style.display = '';
    panel.innerHTML = '<div class="audit-title"><b>本次检索审计</b><span>命中数 ≠ 实际返回数 ≠ 去重后数</span></div>' + audits.map(item => {
      if (item.pending) {
        return `<div class="audit-row audit-pending"><b>${esc(item.label)}</b><span>正在检索并下载…</span><small>并行处理中</small></div>`;
      }
      if (!item.ok) {
        const elapsed = Number(item.elapsedMs || 0) > 0 ? `${(Number(item.elapsedMs) / 1000).toFixed(1)} 秒` : '';
        return `<div class="audit-row audit-error"><b>${esc(item.label)}</b><span>请求失败</span><small>${esc(item.error)}${elapsed ? ` · ${elapsed}` : ''}</small></div>`;
      }
      const time = item.completedAt ? new Date(item.completedAt).toLocaleString('zh-CN', { hour12: false }) : '';
      const elapsed = Number(item.elapsedMs || 0) > 0 ? `${(Number(item.elapsedMs) / 1000).toFixed(1)} 秒` : '';
      return `<details class="audit-row">
        <summary><b>${esc(item.label)}</b><span>数据库命中 ${Number(item.available).toLocaleString()} · 接口返回 ${Number(item.rawDownloaded).toLocaleString()} · 成功解析 ${Number(item.downloaded).toLocaleString()}</span><small>${esc(elapsed)}${elapsed && time ? ' · ' : ''}${esc(time)}</small></summary>
        <div class="audit-query">${esc(item.query || '未记录检索式')}</div>
      </details>`;
    }).join('');
  }

  showStopButton() {
    const btn = document.getElementById('btnStop');
    if (btn) btn.style.display = '';
  }

  hideStopButton() {
    const btn = document.getElementById('btnStop');
    if (btn) btn.style.display = 'none';
  }
}
