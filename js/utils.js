// utils.js — 纯工具函数。无 DOM 访问，无副作用。

/**
 * 获取 DOM 元素（便利函数，唯一有 DOM 访问的工具）
 */
export function getById(id) {
  return document.getElementById(id);
}

/**
 * HTML 实体转义
 */
export function esc(s) {
  return String(s || '').replace(/[&<>"']/g, m => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[m]));
}

/**
 * HTML 属性转义（仅转义单引号）
 */
export function escAttr(s) {
  return String(s || '').replace(/'/g, '&#39;');
}

/**
 * 去除 HTML 标签
 */
export function stripTags(s) {
  return String(s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * 转义正则特殊字符
 */
export function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 规范化 DOI
 */
export function normDoi(doi) {
  return String(doi || '').trim()
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, '')
    .replace(/^doi:/i, '')
    .trim()
    .toLowerCase();
}

/**
 * 规范化标题（用于比较）
 */
export function normTitle(title) {
  return String(title || '')
    .toLowerCase()
    .replace(/<[^>]*>/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 规范化文本（用于匹配）
 */
export function normText(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[‐-―]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 从字符串中提取年份
 */
export function extractYear(v) {
  const m = String(v || '').match(/(19|20)\d{2}/);
  return m ? m[0] : String(v || '').slice(0, 4);
}

/**
 * Promise-based 延时
 */
export function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * fetch 带超时
 */
export function fetchWithTimeout(url, opts, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
      reject(new Error('连接超时'));
    }, timeoutMs);
    fetch(url, { ...opts, signal: controller.signal })
      .then(r => { clearTimeout(timer); resolve(r); })
      .catch(e => { clearTimeout(timer); reject(e); });
  });
}

/**
 * 生成唯一 ID
 */
export function generateId() {
  return crypto.randomUUID ? crypto.randomUUID() : `id-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * 触发浏览器文件下载
 */
export function downloadBlob(name, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * 解析一行 CSV（处理引号转义）
 */
export function parseCSVLine(line) {
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        quoted = !quoted;
      }
    } else if (ch === ',' && !quoted) {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

/**
 * 从 CSV 行中选取第一个匹配的字段值
 */
export function pickField(row, map, names) {
  for (const name of names) {
    const idx = map[name];
    if (idx != null && row[idx] != null && String(row[idx]).trim()) {
      return String(row[idx]).trim();
    }
  }
  return '';
}

/**
 * 判断年份是否在筛选范围内
 */
export function yearInRange(year, yearFrom, yearTo) {
  const y = Number(String(year || '').slice(0, 4));
  const yf = Number(yearFrom || 0);
  const yt = Number(yearTo || 3000);
  if (!y) return true;
  return y >= yf && y <= yt;
}

/**
 * 获取文本输入字段的行数组（去空行）
 */
export function getTextareaLines(id) {
  const el = getById(id);
  if (!el) return [];
  return el.value.split(/\n+/).map(x => x.trim()).filter(Boolean);
}
