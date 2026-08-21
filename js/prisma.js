// prisma.js — PRISMA 2020 流程图 SVG 生成与导出。

import { PRISMA } from './config.js?v=20260722b';
import { esc } from './utils.js?v=20260722b';
import { sourceLabelFor } from './record.js?v=20260722b';
import { getProjectStorage } from './storage.js?v=20260820b';

export class PrismaDiagram {
  /**
   * 计算每条数据源的去重后计数
   */
  static sourceCountsForPrisma(records) {
    const counts = {};
    records.forEach(r => {
      (r.sources && r.sources.length ? r.sources : [{ source: r.source }]).forEach(s => {
        counts[s.source] = (counts[s.source] || 0) + 1;
      });
    });
    return counts;
  }

  /**
   * 获取未检索全文数（从 UI 输入或 localStorage）
   */
  static getNotRetrieved() {
    const el = document.getElementById('prismaNotRetrieved');
    if (el) {
      const v = parseInt(el.value || '0', 10);
      return isNaN(v) || v < 0 ? 0 : v;
    }
    const stored = parseInt(getProjectStorage().getItem('meta_screener_prisma') || '0', 10);
    return isNaN(stored) || stored < 0 ? 0 : stored;
  }

  /**
   * 保存未检索全文数
   */
  static setNotRetrieved(value) {
    const v = Math.max(0, value || 0);
    getProjectStorage().setItem('meta_screener_prisma', String(v));
    const el = document.getElementById('prismaNotRetrieved');
    if (el) el.value = v;
  }

  /**
   * 生成并渲染 PRISMA 2020 SVG 到容器
   * @param {HTMLElement} container
   * @param {Array} prismaRecords - 按研究模式过滤后的记录
   */
  static render(container, prismaRecords) {
    if (!container) return;

    const W = PRISMA.WIDTH;
    const leftCX = PRISMA.LEFT_CX, rightCX = PRISMA.RIGHT_CX;
    const leftW = PRISMA.LEFT_W, rightW = PRISMA.RIGHT_W;
    const boxH = PRISMA.BOX_H;

    // 统计数据
    const identified = prismaRecords.reduce((s, r) => s + Math.max(1, Number(r.mergedCount) || 1), 0);
    const afterDedup = prismaRecords.length;
    const duplicates = identified - afterDedup;
    const autoExcluded = prismaRecords.filter(r => r.decision === '建议排除').length;
    const sought = afterDedup - autoExcluded;
    const notRetrieved = PrismaDiagram.getNotRetrieved();
    const assessed = Math.max(0, sought - notRetrieved);
    const manualExcluded = prismaRecords.filter(r => r.decision === '最终排除').length;
    const included = prismaRecords.filter(r => r.decision === '最终纳入').length;

    // 数据源行
    const sourceCounts = PrismaDiagram.sourceCountsForPrisma(prismaRecords);
    const sourceLabels = {
      pubmed: 'PubMed', europepmc: 'Europe PMC', crossref: 'Crossref', openalex: 'OpenAlex',
      cnki: 'CNKI', wanfang: '万方', vip: '维普', cbm: 'SinoMed',
      embase: 'Embase', wos: 'WoS', scopus: 'Scopus', cochrane: 'Cochrane',
      'google-scholar': 'Google Scholar', other: '其他'
    };
    const sourceEntries = Object.entries(sourceCounts)
      .filter(([, n]) => n > 0)
      .sort((a, b) => b[1] - a[1]);
    const sourceLine = sourceEntries.length
      ? sourceEntries.map(([k, n]) => `${sourceLabels[k] || k}: ${n}`).join('  ·  ')
      : '';

    const exclReasons = [...new Set(
      prismaRecords
        .filter(r => r.decision === '最终排除')
        .map(r => r.reason || '人工排除')
        .filter(Boolean)
    )];

    const pendingDecisions = Math.max(0, assessed - manualExcluded - included);
    const hasPending = pendingDecisions > 0;

    // 布局
    const identY = 12, identH = 168;
    const screenY = identY + identH, screenH = 168;
    const retY = screenY + screenH, retH = hasPending ? 340 : 280;
    const inclY = retY + retH, inclH = hasPending ? 150 : 130;
    const totalH = inclY + inclH + 10;

    const b1Y = identY + 30;
    const b2Y = screenY + 30;
    const b3Y = retY + 30;
    const b4Y = retY + 160;
    const b4bY = retY + 240;
    const b5Y = inclY + 30;

    // SVG 辅助函数
    function lbox(x, y, w, h, stroke, fill, title, count) {
      return `<rect x="${x - w / 2}" y="${y}" width="${w}" height="${h}" rx="9" fill="${fill || '#fff'}" stroke="${stroke}" stroke-width="2"/>
        <text x="${x}" y="${y + 22}" text-anchor="middle" font-size="13" font-weight="700" fill="#1e293b">${esc(title)}</text>
        <text x="${x}" y="${y + 46}" text-anchor="middle" font-size="18" font-weight="800" fill="${stroke}">n = ${count}</text>`;
    }

    function rbox(x, y, w, h, stroke, title, count, subLines) {
      let html = `<rect x="${x - w / 2}" y="${y}" width="${w}" height="${h}" rx="9" fill="#fff" stroke="${stroke}" stroke-width="1.5"/>
        <text x="${x}" y="${y + 20}" text-anchor="middle" font-size="12" fill="#64748b">${esc(title)}</text>
        <text x="${x}" y="${y + 44}" text-anchor="middle" font-size="16" font-weight="800" fill="#dc2626">n = ${count}</text>`;
      if (subLines && subLines.length) {
        const baseY = y + h + 14;
        html += `<text x="${x}" y="${baseY}" text-anchor="middle" font-size="11" fill="#991b1b">`;
        subLines.slice(0, 3).forEach((l, i) => {
          html += `<tspan x="${x}" dy="${i === 0 ? 0 : 14}">${i === 0 ? '原因：' + esc(l.length > 38 ? l.slice(0, 36) + '…' : l) : esc(l.length > 38 ? l.slice(0, 36) + '…' : l)}</tspan>`;
        });
        html += `</text>`;
      }
      return html;
    }

    function vArrow(yFrom, yTo, cx) {
      return `<line x1="${cx}" y1="${yFrom}" x2="${cx}" y2="${yTo - 6}" stroke="#94a3b8" stroke-width="1.8" marker-end="url(#arr)"/>`;
    }

    function hArrow(leftY, rightY) {
      const x1 = leftCX + leftW / 2, x2 = rightCX - rightW / 2, mid = (x1 + x2) / 2;
      return `<path d="M${x1} ${leftY + boxH / 2} L${mid} ${leftY + boxH / 2} L${mid} ${rightY + boxH / 2} L${x2 - 5} ${rightY + boxH / 2}" stroke="#94a3b8" stroke-width="1.5" fill="none" marker-end="url(#arr)"/>`;
    }

    const phaseW = W - 20;
    const phases = [
      { label: 'IDENTIFICATION', y: identY, h: identH, color: '#eff6ff', border: '#bfdbfe', lc: '#1d4ed8' },
      { label: 'SCREENING', y: screenY, h: screenH, color: '#fffbeb', border: '#fde68a', lc: '#b45309' },
      { label: 'RETRIEVAL & ELIGIBILITY', y: retY, h: retH, color: '#fdf2f8', border: '#fbcfe8', lc: '#9d174d' },
      { label: 'INCLUDED', y: inclY, h: inclH, color: '#f0fdf4', border: '#bbf7d0', lc: '#166534' }
    ];

    const afterSource = b1Y + boxH + 18;

    const svg = `<svg width="${W}" height="${totalH}" viewBox="0 0 ${W} ${totalH}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <marker id="arr" markerWidth="7" markerHeight="5" refX="7" refY="2.5" orient="auto"><polygon points="0 0, 7 2.5, 0 5" fill="#94a3b8"/></marker>
  </defs>
  <rect x="0" y="0" width="${W}" height="${totalH}" fill="#fafcff" rx="12"/>

  ${phases.map(p => `
  <rect x="8" y="${p.y}" width="${phaseW}" height="${p.h}" rx="10" fill="${p.color}" stroke="${p.border}" stroke-width="1" stroke-dasharray="5 4"/>
  <text x="28" y="${p.y + 20}" font-size="13" font-weight="800" fill="${p.lc}" letter-spacing="2.5">${p.label}</text>
  `).join('')}

  <!-- Phase 1: Identification -->
  ${lbox(leftCX, b1Y, leftW, boxH, '#3b82f6', '#eff6ff', 'Records identified from databases*', identified)}
  ${sourceLine ? `<text x="${leftCX}" y="${afterSource}" text-anchor="middle" font-size="10" fill="#64748b">${esc(sourceLine)}</text>` : ''}
  ${hArrow(b1Y, b1Y)}
  ${rbox(rightCX, b1Y, rightW, boxH, '#3b82f6', 'Records removed before screening', duplicates)}

  <!-- Phase 2: Screening -->
  ${vArrow(afterSource, b2Y, leftCX)}
  ${lbox(leftCX, b2Y, leftW, boxH, '#d97706', '#fffbeb', 'Records screened', afterDedup)}
  ${hArrow(b2Y, b2Y)}
  ${rbox(rightCX, b2Y, rightW, boxH, '#d97706', 'Records excluded (auto-screen)', autoExcluded)}

  <!-- Phase 3: Retrieval & Eligibility -->
  ${vArrow(b2Y + boxH, b3Y, leftCX)}
  ${lbox(leftCX, b3Y, leftW, boxH, '#db2777', '#fdf2f8', 'Reports sought for retrieval', sought)}
  ${hArrow(b3Y, b3Y)}
  ${rbox(rightCX, b3Y, rightW, boxH, '#db2777', 'Reports not retrieved', notRetrieved)}

  ${vArrow(b3Y + boxH, b4Y, leftCX)}
  ${lbox(leftCX, b4Y, leftW, boxH, '#db2777', '#fdf2f8', 'Reports assessed for eligibility', assessed)}
  ${hArrow(b4Y, b4Y)}
  ${rbox(rightCX, b4Y, rightW, boxH, '#db2777', 'Reports excluded (full-text review)', manualExcluded, exclReasons)}

  ${hasPending ? `
  ${hArrow(b4Y, b4bY)}
  ${rbox(rightCX, b4bY, rightW, boxH, '#d97706', 'Reports awaiting decision', pendingDecisions, [`${pendingDecisions} 条建议纳入或待人工判断`])}
  ` : ''}

  <!-- Phase 4: Included -->
  ${vArrow(b4Y + boxH + (exclReasons.length ? 50 : 0) + (hasPending ? 90 : 0), b5Y, leftCX)}
  ${lbox(leftCX, b5Y, leftW, boxH, '#16a34a', '#f0fdf4', 'Studies included in review', included)}
  ${included === 0 && hasPending ? `<text x="${leftCX}" y="${b5Y + boxH + 16}" text-anchor="middle" font-size="11" fill="#b45309">完成人工复核后，最终纳入的研究将显示在此</text>` : ''}

  <text x="18" y="${totalH - 6}" font-size="10" fill="#94a3b8">* 各数据库计数基于已去重记录 · 同一记录多来源时分别计数</text>
  </svg>`;

    container.innerHTML = svg;

    // 同步输入框
    const input = document.getElementById('prismaNotRetrieved');
    if (input && String(input.value) !== String(notRetrieved)) {
      input.value = notRetrieved;
    }
  }

  /**
   * 导出 SVG 文件
   */
  static exportSVG() {
    const svgEl = document.querySelector('#prismaContainer svg');
    if (!svgEl) return;
    const clone = svgEl.cloneNode(true);
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    const data = '<?xml version="1.0" encoding="UTF-8"?>\n' + clone.outerHTML;
    const blob = new Blob([data], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'PRISMA_flow_diagram.svg';
    a.click();
    URL.revokeObjectURL(url);
  }

  /**
   * 导出 PNG 文件
   */
  static exportPNG() {
    const svgEl = document.querySelector('#prismaContainer svg');
    if (!svgEl) return;
    const clone = svgEl.cloneNode(true);
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    const data = '<?xml version="1.0" encoding="UTF-8"?>\n' + clone.outerHTML;
    const blob = new Blob([data], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width * 2;
      canvas.height = img.height * 2;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(b => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(b);
        a.download = 'PRISMA_flow_diagram.png';
        a.click();
      }, 'image/png');
      URL.revokeObjectURL(url);
    };
    img.src = url;
  }
}
