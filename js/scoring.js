// scoring.js — 关键词评分引擎 + 研究类型分类。

import { VITRO_WORDS, STRONG_EXCLUDE_TYPES } from './config.js?v=20260722b';
import { normText, escapeRegExp } from './utils.js?v=20260722b';
import { QueryBuilder } from './query-builder.js?v=20260722b';

export class ScoringEngine {
  /**
   * 生成词的变体（处理连字符变体）
   */
  static termVariants(term) {
    const t = String(term || '').toLowerCase().trim();
    if (!t) return [];
    const set = new Set([t, t.replace(/-/g, ' '), t.replace(/\s+/g, '-')]);
    return [...set].filter(Boolean);
  }

  /**
   * 全文模糊匹配一个词
   */
  static matchTerm(text, term) {
    const source = normText(text);
    const raw = String(term || '').trim();
    if (!raw) return false;
    return ScoringEngine.termVariants(raw).some(v => {
      // 英文检索词必须按完整词/短语匹配，避免 rat 命中 respiratory、
      // review 命中 preview 等导致研究类型与排除评分误判。
      if (/^[a-z0-9][a-z0-9 -]*[a-z0-9]$/i.test(v) || /^[a-z0-9]$/i.test(v)) {
        return new RegExp(`(^|[^a-z0-9])${escapeRegExp(v)}([^a-z0-9]|$)`, 'i').test(source);
      }
      return source.includes(v.toLowerCase());
    });
  }

  /**
   * 标题匹配（同全文匹配，语义分开便于区分权重）
   */
  static matchTermInTitle(title, term) {
    return ScoringEngine.matchTerm(title, term);
  }

  /**
   * 将记录所有可搜索字段拼为一个文本
   */
  static recordText(r) {
    return [
      r.title, r.abstract, r.journal, r.authors,
      (r.publicationTypes || []).join(' '),
      r.recordType, r.language, r.doi, r.pmid
    ].join(' ');
  }

  /**
   * 分类研究类型：human / animal / in_vitro / unclear
   */
  static classifyStudyType(r, advHumanPosWords, advAnimalPosWords) {
    const text = ScoringEngine.recordText(r).toLowerCase();
    const humanWords = (advHumanPosWords || []);
    const animalWords = (advAnimalPosWords || []);
    const vitroWords = VITRO_WORDS;

    let hScore = 0, aScore = 0, vScore = 0;
    humanWords.forEach(w => { if (ScoringEngine.matchTerm(text, w)) hScore++; });
    animalWords.forEach(w => { if (ScoringEngine.matchTerm(text, w)) aScore++; });
    vitroWords.forEach(w => { if (ScoringEngine.matchTerm(text, w)) vScore++; });

    if (hScore > 0 && aScore === 0 && vScore === 0) return 'human';
    if (aScore > 0 && hScore === 0 && vScore === 0) return 'animal';
    if (vScore > 0 && hScore === 0 && aScore === 0) return 'in_vitro';
    if (vScore > 0) return 'in_vitro';
    if (hScore > 0 && aScore > 0) return 'unclear';
    return 'unclear';
  }

  /**
   * 构建当前参数对应的评分规则
   */
  static getDynamicRules() {
    const rules = [];
    const studyMode = document.getElementById('studyMode')?.value || 'human';

    // 检索字段 → 规则
    QueryBuilder.getConceptGroups('pop').forEach(group => {
      rules.push({ type: '检索-疾病/人群', weight: 2, group });
    });
    QueryBuilder.getConceptGroups('expo').forEach(group => {
      rules.push({ type: '检索-暴露/基因', weight: 2, group });
    });
    if (studyMode !== 'human') {
      QueryBuilder.getConceptGroups('animalTerms').forEach(group => {
        rules.push({ type: '检索-动物模型/种属', weight: 2, group });
      });
    }

    const mode = document.getElementById('mode')?.value || 'wide';
    if (mode !== 'wide') {
      QueryBuilder.getConceptGroups('outcome').forEach(group => {
        rules.push({ type: '检索-结局', weight: 1, group });
      });
    }
    if (mode === 'strict') {
      QueryBuilder.getConceptGroups('design').forEach(group => {
        rules.push({ type: '检索-研究设计', weight: 2, group });
      });
    }

    // 纳入/排除倾向词
    QueryBuilder.getLines('incWords').forEach(word => {
      rules.push({ type: '纳入倾向词', weight: 1, word });
    });
    QueryBuilder.getLines('excWords').forEach(word => {
      rules.push({ type: '排除倾向词', weight: -2, word });
    });

    // 人群/动物正向词 & 反向惩罚
    const humanWords = ((document.getElementById('advHumanPos')?.value) || '')
      .split(/[;；,，\n]/).map(x => x.trim()).filter(Boolean);
    const animalWords = [
      ...new Set([
        ...QueryBuilder.getLines('animalTerms'),
        ...((document.getElementById('advAnimalPos')?.value) || '')
          .split(/[;；,，\n]/).map(x => x.trim()).filter(Boolean)
      ])
    ];

    if (studyMode === 'human') {
      animalWords.forEach(w => rules.push({ type: '动物词(人群模式强排除)', weight: -5, word: w }));
      humanWords.forEach(w => rules.push({ type: '人群正向词', weight: 1, word: w }));
    } else if (studyMode === 'animal') {
      animalWords.forEach(w => rules.push({ type: '动物正向词', weight: 1, word: w }));
      humanWords.forEach(w => rules.push({ type: '人群词(动物模式强排除)', weight: -5, word: w }));
    } else if (studyMode === 'in_vitro') {
      animalWords.forEach(w => rules.push({ type: '动物词(体外模式强排除)', weight: -5, word: w }));
      humanWords.forEach(w => rules.push({ type: '人群词(体外模式强排除)', weight: -5, word: w }));
      ['in vitro', 'cell line', 'cell culture', 'hela', 'hek293', 'hepg2',
       'raw264', 'pc12', 'a549', 'thp-1', 'western blot', 'rt-pcr', 'elisa',
       'sirna', 'crispr'].forEach(w => {
        rules.push({ type: '体外正向词', weight: 2, word: w });
      });
    }

    return rules;
  }

  /**
   * 对单条记录评分并设置 decision / reason / studyType
   */
  static scoreRecord(r) {
    // 读取评分参数
    const incCut = +(document.getElementById('incCut')?.value || 4);
    const excCut = +(document.getElementById('excCut')?.value || -2);
    const titleMul = +(document.getElementById('advTitleMul')?.value || 2);
    const synergyBonus = +(document.getElementById('advSynergy')?.value || 2);
    const excPenalty = +(document.getElementById('advExcPenalty')?.value || -1);
    const pubTypeExc = +(document.getElementById('advPubTypeExc')?.value || -5);

    const text = ScoringEngine.recordText(r);
    const title = r.title || '';
    const rules = ScoringEngine.getDynamicRules();

    let score = 0;
    const details = [];
    const exclusionHits = [];
    let groupsHit = 0;

    for (const rule of rules) {
      if (rule.group) {
        const hitInTitle = rule.group.find(term => ScoringEngine.matchTermInTitle(title, term));
        const hit = hitInTitle || rule.group.find(term => ScoringEngine.matchTerm(text, term));
        if (hit) {
          const w = hitInTitle ? rule.weight * titleMul : rule.weight;
          score += w;
          details.push({ type: rule.type, token: hit, weight: w });
          groupsHit++;
        }
      } else if (rule.word && ScoringEngine.matchTerm(text, rule.word)) {
        const hitTitle = ScoringEngine.matchTermInTitle(title, rule.word);
        const w = hitTitle && rule.weight > 0 ? rule.weight * titleMul : rule.weight;
        score += w;
        details.push({ type: rule.type, token: rule.word, weight: w });
        if (rule.weight < 0) exclusionHits.push(rule.word);
      }
    }

    // 协同加分（命中 ≥3 组概念）
    if (groupsHit >= 3) score += synergyBonus;
    // 连续排除惩罚
    if (exclusionHits.length > 1) score += excPenalty * (exclusionHits.length - 1);

    // 出版类型排除
    const pubTypes = (r.publicationTypes || []).map(x => x.toLowerCase());
    if (pubTypes.some(pt => STRONG_EXCLUDE_TYPES.some(ex => pt.includes(ex)))) {
      score += pubTypeExc;
      details.push({ type: '出版类型强排除', token: pubTypes.join(', '), weight: pubTypeExc });
    }

    // 研究类型分类
    const advHumanPos = ((document.getElementById('advHumanPos')?.value) || '')
      .split(/[;；,，\n]/).map(x => x.trim()).filter(Boolean);
    const advAnimalPos = [...new Set([
      ...QueryBuilder.getLines('animalTerms'),
      ...((document.getElementById('advAnimalPos')?.value) || '')
        .split(/[;；,，\n]/).map(x => x.trim()).filter(Boolean)
    ])];

    r.studyType = ScoringEngine.classifyStudyType(r, advHumanPos, advAnimalPos);
    r.score = score;
    r.humanScore = r.studyType === 'human' ? score : 0;
    r.animalScore = r.studyType === 'animal' ? score : 0;
    r.scoreDetails = details;
    r.hits = details.map(x => `${x.weight > 0 ? '+' : ''}${x.weight} ${x.type}:${x.token}`).join('; ');

    // 决策
    if (score >= incCut) {
      r.decision = '建议纳入';
      r.reason = '命中检索词与研究特征，建议阅读全文';
    } else if (score <= excCut) {
      r.decision = '建议排除';
      r.reason = exclusionHits.length
        ? `命中排除词：${exclusionHits.join('; ')}`
        : '相关性偏低';
    } else {
      r.decision = '待人工判断';
      r.reason = '信息不足，建议人工查看';
    }
  }

  /**
   * 对全部或新增记录执行评分
   */
  static screenAll(records, incremental = false) {
    if (incremental) {
      for (const r of records) {
        if (r.hits) continue; // 已评分跳过
        ScoringEngine.scoreRecord(r);
      }
    } else {
      for (const r of records) {
        if (r.decision === '最终纳入' || r.decision === '最终排除') {
          r.manual = true;
          continue;
        }
        ScoringEngine.scoreRecord(r);
        r.manual = false;
      }
    }
  }
}
