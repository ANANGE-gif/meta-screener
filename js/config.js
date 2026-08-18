// config.js — 所有常量、配置和元数据表。无状态、无副作用。

// ===== Storage Keys =====
export const STORAGE_KEYS = {
  RECORDS: 'meta_screener_pro_v1',
  SETTINGS: 'meta_screener_pro_v1_settings',
  LICENSE: 'meta_screener_pro_license',
  DEVICE: 'meta_screener_device_id',
  AUTH_SESSION: 'meta_screener_auth_session',
  USED_CODES: 'meta_offline_used',
  PRISMA: 'meta_screener_prisma'
};

export const OLD_STORAGE_KEYS = [
  'meta_original_study_screener_v3',
  'meta_original_study_screener_v2'
];

// ===== Supabase Configuration =====
export const SUPABASE = {
  HOST: 'jzzxkjwvwlwzmdymwjah.supabase.co',
  KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp6enhrand2d2x3em1keW13amFoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODExMzE4OTUsImV4cCI6MjA5NjcwNzg5NX0.iQJO8p1n2p_mhrdC1GJpXHGE0WSExwIw6CcvhSHBJSk',
  PROXY_URL: ''
};

// ===== Source Database Metadata =====
export const SOURCE_META = {
  pubmed:        { label: 'PubMed',          className: 'src-pubmed',         capability: 'direct' },
  europepmc:     { label: 'Europe PMC',      className: 'src-europepmc',     capability: 'direct' },
  crossref:      { label: 'Crossref',        className: 'src-crossref',      capability: 'direct' },
  openalex:      { label: 'OpenAlex',        className: 'src-openalex',      capability: 'direct' },
  cnki:          { label: 'CNKI',            className: 'src-cnki',          capability: 'assisted', searchUrl: 'https://kns.cnki.net/kns8s/search' },
  wanfang:       { label: '万方',            className: 'src-wanfang',       capability: 'assisted', searchUrl: 'https://www.wanfangdata.com.cn/' },
  vip:           { label: '维普',            className: 'src-vip',           capability: 'assisted', searchUrl: 'https://qikan.cqvip.com/Qikan/Search/Index' },
  cbm:           { label: 'SinoMed/CBM',     className: 'src-cbm',           capability: 'assisted', searchUrl: 'https://www.sinomed.ac.cn/' },
  embase:        { label: 'Embase',          className: 'src-embase',        capability: 'manual' },
  wos:           { label: 'Web of Science',  className: 'src-wos',           capability: 'manual' },
  scopus:        { label: 'Scopus',          className: 'src-scopus',        capability: 'manual' },
  cochrane:      { label: 'Cochrane Library',className: 'src-cochrane',      capability: 'manual' },
  'google-scholar':{ label: 'Google Scholar',className: 'src-google-scholar',capability: 'manual' },
  other:         { label: '其他',            className: 'src-other',         capability: 'manual' },
  unknown:       { label: '未知来源',        className: 'src-unknown',       capability: 'manual' }
};

// ===== In Vitro Indicator Words =====
export const VITRO_WORDS = [
  'in vitro', 'cell line', 'cell culture', 'hela', 'hek293', 'hepg2',
  'raw264', 'raw 264', 'pc12', 'sh-sy5y', 'caco-2', 'ht29', 'mcf-7',
  'mda-mb', 'a549', 'beas-2b', 'thp-1', 'jurkat', 'cho cell', 'cos-7',
  'vero', '3t3', 'fibroblast', 'epithelial cell', 'primary culture',
  'mtor', 'western blot', 'rt-pcr', 'rt-qpcr', 'elisa',
  'immunohistochemistry', 'sirna', 'crispr', 'plasmid', 'luciferase',
  'flow cytometry'
];

// ===== Publication Types That Are Strongly Excluded =====
export const STRONG_EXCLUDE_TYPES = [
  'review', 'editorial', 'letter', 'case report', 'comment'
];

// ===== Source Display Labels =====
export const SOURCE_LABELS = {
  pubmed: 'PubMed', europepmc: 'Europe PMC', crossref: 'Crossref',
  openalex: 'OpenAlex', cnki: 'CNKI', wanfang: '万方', vip: '维普',
  cbm: 'SinoMed', embase: 'Embase', wos: 'WoS', scopus: 'Scopus',
  cochrane: 'Cochrane', 'google-scholar': 'Google Scholar', other: '其他'
};

// ===== Study Type Labels & Classes =====
export const STUDY_TYPE_MAP = {
  human:    { label: '人群',   cls: 'st-human' },
  animal:   { label: '动物',   cls: 'st-animal' },
  in_vitro: { label: '体外',   cls: 'st-in_vitro' },
  unclear:  { label: '不明确', cls: 'st-unclear' }
};

// ===== Pagination =====
export const DEFAULT_PAGE_SIZE = 100;

// ===== PRISMA Layout Constants =====
export const PRISMA = {
  WIDTH: 960,
  LEFT_CX: 230,
  RIGHT_CX: 690,
  LEFT_W: 380,
  RIGHT_W: 360,
  BOX_H: 60,
  GAP_H: 52
};

// ===== Chinese DB Query Step Instructions =====
export const CN_QUERY_STEPS = {
  cnki: '进入“专业检索”后粘贴；不要在普通一框式检索中运行。核对主题字段 SU 和括号后，再设置与本工具相同的年份范围。',
  wanfang: '进入“高级检索/专业检索”后按显示的 AND/OR 结构运行；若页面不接受整式，请按概念组逐行建立并保持组内 OR、组间 AND。',
  vip: '进入“专业检索/检索式检索”后粘贴。当前使用新版 SU=主题、AND/OR 语法；关闭额外的同义词扩展后再做数量核对。',
  cbm: '在高级检索中运行，并保持 AND/OR 两侧有空格。若要与本工具逐数核对，请关闭“智能检索/主题词扩展”；开启扩展时命中数会增加。'
};

// ===== Chinese DB Query Builders (function references placed here for discoverability) =====
export const CN_BUILDER_KEYS = ['cnki', 'wanfang', 'vip', 'cbm'];
