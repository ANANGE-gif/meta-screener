// storage.js — localStorage 持久化层。抽象键名和序列化。

import { STORAGE_KEYS, OLD_STORAGE_KEYS } from './config.js?v=20260722b';
import { normalizeRecord } from './record.js?v=20260722b';

const SESSION_SECRETS_KEY = 'meta_screener_session_secrets_v1';
const SESSION_SECRET_IDS = ['openAlexApiKey', 'pubMedApiKey', 'apiContactEmail'];

function readSessionSecrets() {
  try {
    const value = JSON.parse(sessionStorage.getItem(SESSION_SECRETS_KEY) || '{}');
    return value && typeof value === 'object' ? value : {};
  } catch {
    return {};
  }
}

function writeSessionSecrets(secrets) {
  const clean = {};
  SESSION_SECRET_IDS.forEach(id => {
    if (typeof secrets[id] === 'string' && secrets[id]) clean[id] = secrets[id];
  });
  if (Object.keys(clean).length) sessionStorage.setItem(SESSION_SECRETS_KEY, JSON.stringify(clean));
  else sessionStorage.removeItem(SESSION_SECRETS_KEY);
}

// ===== Records =====

/** 加载记录（自动尝试旧键名迁移） */
export function loadRecords() {
  let raw = localStorage[STORAGE_KEYS.RECORDS];
  if (!raw) {
    for (const k of OLD_STORAGE_KEYS) {
      if (localStorage[k]) { raw = localStorage[k]; break; }
    }
  }
  let parsed = [];
  try { parsed = JSON.parse(raw || '[]'); } catch { parsed = []; }
  if (!Array.isArray(parsed)) parsed = parsed.records || [];
  return parsed.map(normalizeRecord);
}

let saveTimer = null;

/** 延迟保存（防抖 800ms） */
export function saveRecords(records) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    localStorage[STORAGE_KEYS.RECORDS] = JSON.stringify(records);
  }, 800);
}

/** 立即保存（不清除防抖定时器） */
export function saveNow(records) {
  clearTimeout(saveTimer);
  localStorage[STORAGE_KEYS.RECORDS] = JSON.stringify(records);
}

// ===== Settings =====

/** 从 DOM 读取当前设置值并保存 */
export function saveSettings(settings) {
  const safeSettings = { ...(settings || {}) };
  SESSION_SECRET_IDS.forEach(id => delete safeSettings[id]);
  localStorage[STORAGE_KEYS.SETTINGS] = JSON.stringify(safeSettings);
}

/** 加载设置 */
export function loadSettings() {
  try {
    const settings = JSON.parse(localStorage[STORAGE_KEYS.SETTINGS] || '{}');
    if (!settings || typeof settings !== 'object') return {};

    // Migrate old releases that persisted API keys/email in localStorage.
    const secrets = readSessionSecrets();
    let migrated = false;
    SESSION_SECRET_IDS.forEach(id => {
      if (typeof settings[id] === 'string' && settings[id]) secrets[id] = settings[id];
      if (Object.prototype.hasOwnProperty.call(settings, id)) {
        delete settings[id];
        migrated = true;
      }
    });
    if (migrated) {
      writeSessionSecrets(secrets);
      localStorage[STORAGE_KEYS.SETTINGS] = JSON.stringify(settings);
    }
    return settings;
  } catch {
    return {};
  }
}

/** 从 DOM 收集所有设置字段 */
export function collectSettings() {
  const ids = [
    'mode', 'studyMode', 'pop', 'animalTerms', 'expo', 'outcome', 'design',
    'yf', 'yt', 'max', 'sort', 'incWords', 'excWords', 'incCut', 'excCut',
    'manualSource', 'advTitleMul', 'advSynergy', 'advExcPenalty',
    'advPubTypeExc', 'advHumanPos', 'advAnimalPos',
    'cnPop', 'cnAnimal', 'cnExpo'
  ];
  const settings = {};
  ids.forEach(id => {
    const el = document.getElementById(id);
    if (el) settings[id] = el.value || '';
  });
  // Database checkboxes
  settings.sources = [...document.querySelectorAll('.db-check:checked')].map(x => x.value);
  settings.cnSources = [...document.querySelectorAll('.db-check-cn:checked')].map(x => x.value);
  const secrets = {};
  SESSION_SECRET_IDS.forEach(id => {
    const el = document.getElementById(id);
    if (el) secrets[id] = el.value || '';
  });
  writeSessionSecrets(secrets);
  return settings;
}

/** 将设置对象回填到 DOM */
export function applySettings(settings) {
  if (!settings) return;
  Object.entries(settings).forEach(([k, v]) => {
    if (SESSION_SECRET_IDS.includes(k)) {
      return;
    } else if (k === 'sources' && Array.isArray(v)) {
      document.querySelectorAll('.db-check').forEach(box => {
        box.checked = v.includes(box.value);
      });
    } else if (k === 'cnSources' && Array.isArray(v)) {
      document.querySelectorAll('.db-check-cn').forEach(box => {
        box.checked = v.includes(box.value);
      });
    } else {
      const el = document.getElementById(k);
      if (el && typeof v === 'string') el.value = v;
    }
  });
  const secrets = readSessionSecrets();
  SESSION_SECRET_IDS.forEach(id => {
    const el = document.getElementById(id);
    if (el && typeof secrets[id] === 'string') el.value = secrets[id];
  });
}

// ===== Auth =====

export function getStoredAuth() {
  try {
    return JSON.parse(localStorage[STORAGE_KEYS.AUTH_SESSION] || 'null');
  } catch {
    return null;
  }
}

export function setStoredAuth(session) {
  if (session) {
    localStorage[STORAGE_KEYS.AUTH_SESSION] = JSON.stringify(session);
  } else {
    localStorage.removeItem(STORAGE_KEYS.AUTH_SESSION);
  }
}

export function clearAuth() {
  localStorage.removeItem(STORAGE_KEYS.AUTH_SESSION);
}

// ===== License =====

export function getLicense() {
  return localStorage[STORAGE_KEYS.LICENSE] || null;
}

export function setLicense(code) {
  localStorage[STORAGE_KEYS.LICENSE] = code;
}

export function clearLicense() {
  localStorage.removeItem(STORAGE_KEYS.LICENSE);
}

export function isTrialMode() {
  return getLicense() === 'trial';
}

// ===== Device ID =====

export function getDeviceId() {
  let id = localStorage[STORAGE_KEYS.DEVICE];
  if (!id) {
    id = crypto.randomUUID ? crypto.randomUUID() : `dev-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    localStorage[STORAGE_KEYS.DEVICE] = id;
  }
  return id;
}

// ===== PRISMA =====

export function getPrismaNotRetrieved() {
  const v = parseInt(localStorage[STORAGE_KEYS.PRISMA] || '0', 10);
  return isNaN(v) || v < 0 ? 0 : v;
}

export function setPrismaNotRetrieved(value) {
  localStorage[STORAGE_KEYS.PRISMA] = String(Math.max(0, value || 0));
}

// ===== Offline Used Codes =====

export function getOfflineUsedCodes() {
  try {
    return JSON.parse(localStorage[STORAGE_KEYS.USED_CODES] || '{}');
  } catch {
    return {};
  }
}

export function setOfflineUsedCode(code, deviceId) {
  const used = getOfflineUsedCodes();
  used[code] = deviceId;
  localStorage[STORAGE_KEYS.USED_CODES] = JSON.stringify(used);
}
