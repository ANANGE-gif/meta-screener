// parsers.js — RIS / BibTeX / CSV / NBIB / PubMed XML 文件解析器。

import { normalizeRecord, sourceLabelFor } from './record.js?v=20260722b';
import { stripTags, extractYear, parseCSVLine, pickField } from './utils.js?v=20260722b';
import { SOURCE_META } from './config.js?v=20260722b';

export class FileParser {
  /**
   * 根据文件名和内容猜测文件格式
   */
  static guessFileType(name, text) {
    const lower = String(name || '').toLowerCase();
    if (lower.endsWith('.ris')) return 'ris';
    if (lower.endsWith('.csv')) return 'csv';
    if (lower.endsWith('.bib') || lower.endsWith('.bibtex')) return 'bibtex';
    if (lower.endsWith('.xml')) return 'pubmed-xml';
    if (lower.endsWith('.nbib')) return 'nbib';
    if (/<PubmedArticleSet/i.test(text)) return 'pubmed-xml';
    if (/(^|\n)TY  - /m.test(text) || /(^|\n)ER  - /m.test(text)) return 'ris';
    if (/(^|\n)PMID- /m.test(text)) return 'nbib';
    if (/@article\s*\{/i.test(text) || /@\w+\s*\{/i.test(text)) return 'bibtex';
    return 'csv';
  }

  /**
   * 解析 PubMed XML（来自 Entrez efetch）
   */
  static parsePubMedXML(xml, meta = {}) {
    const d = new DOMParser().parseFromString(xml, 'text/xml');
    return [...d.querySelectorAll('PubmedArticle')].map(a => {
      const pmid = (a.querySelector('PMID')?.textContent || '').trim();
      const title = (a.querySelector('ArticleTitle')?.textContent || '').trim();
      const year = (a.querySelector('PubDate Year')?.textContent || '')
        || String((a.querySelector('PubDate MedlineDate')?.textContent || '')).slice(0, 4);
      const journal = (a.querySelector('Journal Title')?.textContent || a.querySelector('ISOAbbreviation')?.textContent || '').trim();
      const abstract = [...a.querySelectorAll('AbstractText')].map(x => x.textContent.trim()).join(' ');
      const authors = [...a.querySelectorAll('Author')].slice(0, 12)
        .map(x => ((x.querySelector('LastName')?.textContent || '') + ' ' + (x.querySelector('ForeName')?.textContent || '')).trim())
        .filter(Boolean).join('; ');
      const doi = [...a.querySelectorAll('ArticleId')]
        .find(x => x.getAttribute('IdType') === 'doi')?.textContent?.trim() || '';
      const publicationTypes = [...a.querySelectorAll('PublicationType')].map(x => x.textContent.trim()).filter(Boolean);

      return normalizeRecord({
        source: meta.source || 'pubmed',
        sourceLabel: meta.sourceLabel || 'PubMed',
        sourceId: pmid,
        sourceUrl: pmid ? `https://pubmed.ncbi.nlm.nih.gov/${pmid}/` : '',
        pmid, doi, title, year, journal, authors, abstract, publicationTypes,
        queryUsed: meta.query || '',
        fetchedAt: new Date().toISOString(),
        importMethod: 'api',
        importBatch: meta.batch || ''
      });
    }).filter(r => r.title);
  }

  /**
   * 解析 Europe PMC JSON
   */
  static parseEuropePMCJson(json, meta = {}) {
    return (json?.resultList?.result || []).map(item => {
      const pmid = item.pmid || '';
      const doi = item.doi || '';
      return normalizeRecord({
        source: 'europepmc', sourceLabel: 'Europe PMC',
        sourceId: item.id || pmid || doi || '',
        sourceUrl: item.pmid ? `https://europepmc.org/article/MED/${item.pmid}` : '',
        pmid, doi,
        title: item.title || '',
        year: String(item.pubYear || ''),
        journal: item.journalTitle || '',
        authors: item.authorString || '',
        abstract: item.abstractText || '',
        recordType: item.pubType || '',
        language: item.language || '',
        queryUsed: meta.query || '',
        fetchedAt: new Date().toISOString(),
        importMethod: 'api',
        importBatch: meta.batch || ''
      });
    }).filter(r => r.title);
  }

  /**
   * 解析 Crossref JSON
   */
  static parseCrossrefJson(json, meta = {}) {
    return (json?.message?.items || []).map(item => {
      const doi = item.DOI || '';
      const title = (item.title && item.title[0]) || '';
      const year = item.issued?.['date-parts']?.[0]?.[0]
        || item.published?.['date-parts']?.[0]?.[0] || '';
      const authors = (item.author || []).slice(0, 12)
        .map(x => [x.family, x.given].filter(Boolean).join(' '))
        .filter(Boolean).join('; ');

      return normalizeRecord({
        source: 'crossref', sourceLabel: 'Crossref',
        sourceId: doi || item.URL || '',
        sourceUrl: item.URL || '',
        doi, title,
        year: String(year || ''),
        journal: (item['container-title'] && item['container-title'][0]) || '',
        authors,
        abstract: stripTags(item.abstract || ''),
        recordType: item.type || '',
        language: item.language || '',
        queryUsed: meta.query || '',
        fetchedAt: new Date().toISOString(),
        importMethod: 'api',
        importBatch: meta.batch || ''
      });
    }).filter(r => r.title);
  }

  /**
   * 还原 OpenAlex 的 inverted index 摘要
   */
  static reconstructOpenAlexAbstract(inv) {
    if (!inv || typeof inv !== 'object') return '';
    const pairs = [];
    Object.entries(inv).forEach(([word, positions]) => {
      (positions || []).forEach(pos => { pairs[pos] = word; });
    });
    return pairs.filter(Boolean).join(' ');
  }

  /**
   * 解析 OpenAlex JSON
   */
  static parseOpenAlexJson(json, meta = {}) {
    return (json?.results || []).map(item => {
      const doi = (item.doi || '').replace(/^https?:\/\/doi\.org\//i, '');
      const pmid = item.ids?.pmid
        ? String(item.ids.pmid).replace('https://pubmed.ncbi.nlm.nih.gov/', '').replace(/\/$/, '')
        : '';
      const journal = item.primary_location?.source?.display_name || '';
      const year = item.publication_year || '';
      const authors = (item.authorships || []).slice(0, 12)
        .map(x => x.author?.display_name).filter(Boolean).join('; ');

      return normalizeRecord({
        source: 'openalex', sourceLabel: 'OpenAlex',
        sourceId: item.id || doi || pmid || '',
        sourceUrl: item.id || '',
        pmid, doi,
        title: item.title || '',
        year: String(year || ''),
        journal, authors,
        abstract: FileParser.reconstructOpenAlexAbstract(item.abstract_inverted_index),
        recordType: item.type || '',
        queryUsed: meta.query || '',
        fetchedAt: new Date().toISOString(),
        importMethod: 'api',
        importBatch: meta.batch || ''
      });
    }).filter(r => r.title);
  }

  // ===== Import File Parsers =====

  /**
   * 解析 RIS 格式
   */
  static parseRIS(text, source) {
    const blocks = text.split(/\nER  -\s*/).map(x => x.trim()).filter(Boolean);
    return blocks.map(block => {
      const lines = block.split(/\r?\n/);
      const data = { AU: [] };
      let current = '';
      lines.forEach(line => {
        const m = line.match(/^([A-Z0-9]{2})  - ?(.*)$/);
        if (m) {
          current = m[1];
          if (current === 'AU' || current === 'A1') {
            (data.AU || (data.AU = [])).push(m[2].trim());
          } else {
            data[current] = m[2].trim();
          }
        } else if (current && line.startsWith('      ')) {
          if (Array.isArray(data[current])) {
            data[current][data[current].length - 1] += ' ' + line.trim();
          } else {
            data[current] = (data[current] || '') + ' ' + line.trim();
          }
        }
      });
      return normalizeRecord({
        source, sourceLabel: sourceLabelFor(source),
        sourceId: data.ID || data.DOI || data.DI || '',
        sourceUrl: '',
        pmid: data.PM || '',
        doi: data.DI || data.DO || '',
        title: data.TI || data.T1 || data.CT || '',
        year: extractYear(data.PY || data.Y1 || data.DA || ''),
        journal: data.JO || data.JF || data.T2 || data.JA || '',
        authors: (data.AU || []).join('; '),
        abstract: data.AB || data.N2 || '',
        recordType: data.TY || '',
        queryUsed: '',
        fetchedAt: new Date().toISOString(),
        importMethod: 'manual'
      });
    }).filter(r => r.title);
  }

  /**
   * 解析 BibTeX 格式
   */
  static parseBibTeX(text, source) {
    const entries = text.split(/@(?=\w+\s*\{)/).map(x => x.trim()).filter(Boolean);
    return entries.map(entry => {
      const body = entry.replace(/^\w+\s*\{[^,]*,?/, '').replace(/}\s*$/, '');
      const field = name => {
        const m = body.match(new RegExp(name + '\\s*=\\s*[{"]([\\s\\S]*?)[}"]\\s*(,|$)', 'i'));
        return m ? m[1].replace(/\s+/g, ' ').trim() : '';
      };
      const authors = field('author').split(/\s+and\s+/i).map(x => x.trim()).filter(Boolean).join('; ');
      return normalizeRecord({
        source, sourceLabel: sourceLabelFor(source),
        sourceId: field('doi') || field('url') || '',
        sourceUrl: field('url') || '',
        doi: field('doi'),
        title: field('title'),
        year: extractYear(field('year')),
        journal: field('journal') || field('booktitle'),
        authors,
        abstract: field('abstract'),
        queryUsed: '',
        fetchedAt: new Date().toISOString(),
        importMethod: 'manual'
      });
    }).filter(r => r.title);
  }

  /**
   * 解析 CSV 格式
   */
  static parseCSV(text, source) {
    const lines = text.replace(/^\xEF\xBB\xBF/, '').replace(/^﻿/, '')
      .split(/\r?\n/).filter(Boolean);
    if (lines.length < 2) return [];
    const headers = parseCSVLine(lines[0]).map(x => x.trim().toLowerCase());
    const map = {};
    headers.forEach((h, i) => { map[h] = i; });

    return lines.slice(1).map(line => parseCSVLine(line)).map(row => normalizeRecord({
      source, sourceLabel: sourceLabelFor(source),
      sourceId: pickField(row, map, ['sourceid', 'accession number', 'eid', 'ut', 'id'])
        || pickField(row, map, ['doi', 'pmid']),
      sourceUrl: pickField(row, map, ['url', 'link']),
      pmid: pickField(row, map, ['pmid']),
      doi: pickField(row, map, ['doi']),
      title: pickField(row, map, ['title', 'article title', 'document title', '题名']),
      year: extractYear(pickField(row, map, ['year', 'publication year', 'published', 'date', '年份'])),
      journal: pickField(row, map, ['journal', 'source title', 'journal title', 'publication title', '期刊']),
      authors: pickField(row, map, ['authors', 'author full names', 'author', '作者']),
      abstract: pickField(row, map, ['abstract', 'summary', '摘要']),
      queryUsed: '', fetchedAt: new Date().toISOString(), importMethod: 'manual'
    })).filter(r => r.title);
  }

  /**
   * 解析 NBIB (PubMed) 格式
   */
  static parseNBIB(text, source) {
    const records = [];
    const blocks = text.split(/\n\n(?=PMID- )/).map(x => x.trim()).filter(Boolean);
    blocks.forEach(block => {
      const obj = { AU: [], PT: [] };
      let current = '';
      block.split(/\r?\n/).forEach(line => {
        const m = line.match(/^([A-Z]{2,4})\s*-\s*(.*)$/);
        if (m) {
          current = m[1];
          if (current === 'AU') obj.AU.push(m[2].trim());
          else if (current === 'PT') obj.PT.push(m[2].trim());
          else obj[current] = m[2].trim();
        } else if (current) {
          obj[current] = (obj[current] || '') + ' ' + line.trim();
        }
      });
      records.push(normalizeRecord({
        source, sourceLabel: sourceLabelFor(source),
        sourceId: obj.PMID || '',
        sourceUrl: obj.PMID ? `https://pubmed.ncbi.nlm.nih.gov/${obj.PMID}/` : '',
        pmid: obj.PMID || '',
        doi: (obj.AID || '').split(' ')[0],
        title: obj.TI || '',
        year: extractYear(obj.DP || ''),
        journal: obj.JT || obj.TA || '',
        authors: obj.AU.join('; '),
        abstract: obj.AB || '',
        publicationTypes: obj.PT,
        queryUsed: '',
        fetchedAt: new Date().toISOString(),
        importMethod: 'manual'
      }));
    });
    return records.filter(r => r.title);
  }

  /**
   * 导入文件并解析（读取+检测+解析）
   */
  static async importFile(file, source) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const txt = String(reader.result || '');
          const type = FileParser.guessFileType(file.name, txt);
          let records = [];

          if (type === 'ris') records = FileParser.parseRIS(txt, source);
          else if (type === 'csv') records = FileParser.parseCSV(txt, source);
          else if (type === 'bibtex') records = FileParser.parseBibTeX(txt, source);
          else if (type === 'pubmed-xml') {
            records = FileParser.parsePubMedXML(txt, { query: '', batch: `import-${Date.now()}` })
              .map(r => ({ ...r, source, sourceLabel: sourceLabelFor(source), importMethod: 'manual' }));
          } else if (type === 'nbib') records = FileParser.parseNBIB(txt, source);

          resolve(records);
        } catch (err) {
          reject(err);
        }
      };
      reader.onerror = () => reject(new Error('文件读取失败'));
      reader.readAsText(file, 'utf-8');
    });
  }

  /**
   * 导入 JSON 备份文件
   */
  static async importJSON(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const data = JSON.parse(reader.result);
          const records = Array.isArray(data) ? data : (data.records || []);
          resolve({
            records: records.map(normalizeRecord),
            settings: data.settings || null,
            analysis: data.analysis || null,
            review: data.review || null
          });
        } catch (err) {
          reject(err);
        }
      };
      reader.onerror = () => reject(new Error('文件读取失败'));
      reader.readAsText(file, 'utf-8');
    });
  }
}
