// dedup.js — 记录去重与合并逻辑。

import { normDoi, normTitle } from './utils.js?v=20260722b';
import { makeDedupeKey, sameTitleYear, preferLonger, mergeSourceEntries, normalizeSourceEntry } from './record.js?v=20260722b';

/**
 * 在记录数组中查找与 item 重复的记录索引
 * 匹配规则：PMID → DOI → 标题+年份 → 规范标题
 */
export function findDuplicate(records, item) {
  return records.findIndex(existing => {
    if (item.pmid && existing.pmid && String(item.pmid) === String(existing.pmid)) return true;
    if (item.doi && existing.doi && normDoi(item.doi) === normDoi(existing.doi)) return true;
    if (sameTitleYear(item, existing)) return true;
    const at = normTitle(item.title), bt = normTitle(existing.title);
    if (at && bt && at === bt) return true;
    return false;
  });
}

/**
 * 将 incoming 合并到 existing（修改 existing 并返回）
 */
export function merge(existing, incoming) {
  // 合并来源信息
  existing.sources = mergeSourceEntries([
    ...(existing.sources || []),
    ...(incoming.sources || []),
    {
      source: incoming.source,
      sourceLabel: incoming.sourceLabel,
      sourceId: incoming.sourceId,
      sourceUrl: incoming.sourceUrl
    }
  ]);

  existing.pmid = existing.pmid || incoming.pmid;
  existing.doi = existing.doi || incoming.doi;
  existing.title = preferLonger(existing.title, incoming.title);
  existing.abstract = preferLonger(existing.abstract, incoming.abstract);
  existing.journal = existing.journal || incoming.journal;
  existing.authors = preferLonger(existing.authors, incoming.authors);
  existing.year = existing.year || incoming.year;

  existing.publicationTypes = [
    ...new Set([
      ...(existing.publicationTypes || []),
      ...(incoming.publicationTypes || [])
    ].filter(Boolean))
  ];

  existing.source = existing.source || incoming.source;
  existing.sourceLabel = existing.sourceLabel || incoming.sourceLabel;
  existing.sourceId = existing.sourceId || incoming.sourceId;
  existing.sourceUrl = existing.sourceUrl || incoming.sourceUrl;
  existing.importMethod = existing.importMethod || incoming.importMethod;
  existing.fetchedAt = existing.fetchedAt || incoming.fetchedAt;
  existing.mergedCount = (Number(existing.mergedCount) || 1) + (Number(incoming.mergedCount) || 1);
  existing.dedupeKey = makeDedupeKey(existing);

  return existing;
}

/**
 * 将一批新记录添加到现有集合中（去重 + 合并）
 * @returns {{ added: number, merged: number, total: number }}
 */
export function addRecords(records, existingRecords) {
  let added = 0, merged = 0;
  for (const raw of records) {
    const idx = findDuplicate(existingRecords, raw);
    if (idx >= 0) {
      merge(existingRecords[idx], raw);
      merged++;
    } else {
      existingRecords.push(raw);
      added++;
    }
  }
  return { added, merged, total: records.length };
}
