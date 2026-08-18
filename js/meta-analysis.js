// meta-analysis.js — 确定性 Meta 分析计算内核（不依赖 AI，结果可复现）。

const Z95 = 1.959963984540054;

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : NaN;
}

function erf(x) {
  const sign = x < 0 ? -1 : 1;
  const a = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * a);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-a * a);
  return sign * y;
}

export function normalCdf(x) {
  return 0.5 * (1 + erf(x / Math.SQRT2));
}

export function isRatioMeasure(measure) {
  return ['OR', 'RR', 'GENERIC_RATIO'].includes(measure);
}

export function measureLabel(measure) {
  return ({ OR: '比值比（OR）', RR: '风险比（RR）', RD: '风险差（RD）', MD: '均数差（MD）', SMD: '标准化均数差（SMD）', GENERIC: '报告效应值', GENERIC_RATIO: '报告比值型效应' })[measure] || measure;
}

function assertPositive(value, name) {
  if (!(value > 0)) throw new Error(`${name} 必须大于 0`);
}

export function computeStudyEffect(row, measure) {
  let yi;
  let vi;

  if (measure === 'OR' || measure === 'RR' || measure === 'RD') {
    let a = num(row.eventsT), n1 = num(row.totalT), c = num(row.eventsC), n0 = num(row.totalC);
    assertPositive(n1, '试验组总例数');
    assertPositive(n0, '对照组总例数');
    if (a < 0 || c < 0 || a > n1 || c > n0) throw new Error('事件数必须介于 0 与总例数之间');

    if (measure === 'RD') {
      const p1 = a / n1, p0 = c / n0;
      yi = p1 - p0;
      vi = p1 * (1 - p1) / n1 + p0 * (1 - p0) / n0;
    } else {
      let b = n1 - a, d = n0 - c;
      if ([a, b, c, d].some(v => v === 0)) {
        a += 0.5; b += 0.5; c += 0.5; d += 0.5;
        n1 = a + b; n0 = c + d;
      }
      if (measure === 'OR') {
        yi = Math.log((a * d) / (b * c));
        vi = 1 / a + 1 / b + 1 / c + 1 / d;
      } else {
        yi = Math.log((a / n1) / (c / n0));
        vi = 1 / a - 1 / n1 + 1 / c - 1 / n0;
      }
    }
  } else if (measure === 'MD' || measure === 'SMD') {
    const n1 = num(row.nT), m1 = num(row.meanT), sd1 = num(row.sdT);
    const n0 = num(row.nC), m0 = num(row.meanC), sd0 = num(row.sdC);
    assertPositive(n1, '试验组样本量');
    assertPositive(n0, '对照组样本量');
    assertPositive(sd1, '试验组标准差');
    assertPositive(sd0, '对照组标准差');
    if (measure === 'MD') {
      yi = m1 - m0;
      vi = sd1 ** 2 / n1 + sd0 ** 2 / n0;
    } else {
      if (n1 + n0 <= 3) throw new Error('SMD 至少需要 4 个总样本');
      const pooledVar = ((n1 - 1) * sd1 ** 2 + (n0 - 1) * sd0 ** 2) / (n1 + n0 - 2);
      assertPositive(pooledVar, '合并方差');
      const d = (m1 - m0) / Math.sqrt(pooledVar);
      const correction = 1 - 3 / (4 * (n1 + n0) - 9);
      yi = correction * d;
      vi = (n1 + n0) / (n1 * n0) + yi ** 2 / (2 * (n1 + n0 - 2));
    }
  } else if (measure === 'GENERIC' || measure === 'GENERIC_RATIO') {
    const effect = num(row.effect), lower = num(row.lower), upper = num(row.upper);
    if (!(upper > lower)) throw new Error('置信区间上限必须大于下限');
    if (measure === 'GENERIC_RATIO') {
      assertPositive(effect, '效应值'); assertPositive(lower, '置信区间下限'); assertPositive(upper, '置信区间上限');
      yi = Math.log(effect);
      vi = (Math.log(upper) - Math.log(lower)) ** 2 / (4 * Z95 ** 2);
    } else {
      yi = effect;
      vi = (upper - lower) ** 2 / (4 * Z95 ** 2);
    }
  } else {
    throw new Error('不支持的效应量类型');
  }

  if (!Number.isFinite(yi) || !(vi > 0) || !Number.isFinite(vi)) throw new Error('无法从当前数据计算有效效应量');
  const se = Math.sqrt(vi);
  return { ...row, yi, vi, se, lowerYi: yi - Z95 * se, upperYi: yi + Z95 * se };
}

function logGamma(z) {
  const coefficients = [
    0.9999999999998099, 676.5203681218851, -1259.1392167224028,
    771.3234287776531, -176.6150291621406, 12.507343278686905,
    -0.13857109526572012, 9.984369578019572e-6, 1.5056327351493116e-7
  ];
  if (z < 0.5) return Math.log(Math.PI) - Math.log(Math.sin(Math.PI * z)) - logGamma(1 - z);
  z -= 1;
  let x = coefficients[0];
  for (let i = 1; i < coefficients.length; i++) x += coefficients[i] / (z + i);
  const t = z + 7.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
}

function regularizedGammaQ(a, x) {
  if (!(a > 0) || x < 0) return NaN;
  if (x === 0) return 1;
  const epsilon = 1e-14;
  const maxIterations = 1000;
  if (x < a + 1) {
    let sum = 1 / a, term = sum, ap = a;
    for (let n = 1; n <= maxIterations; n++) {
      ap += 1; term *= x / ap; sum += term;
      if (Math.abs(term) < Math.abs(sum) * epsilon) break;
    }
    const p = sum * Math.exp(-x + a * Math.log(x) - logGamma(a));
    return Math.max(0, Math.min(1, 1 - p));
  }
  let b = x + 1 - a;
  let c = 1 / Number.MIN_VALUE;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i <= maxIterations; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b; if (Math.abs(d) < Number.MIN_VALUE) d = Number.MIN_VALUE;
    c = b + an / c; if (Math.abs(c) < Number.MIN_VALUE) c = Number.MIN_VALUE;
    d = 1 / d;
    const delta = d * c; h *= delta;
    if (Math.abs(delta - 1) < epsilon) break;
  }
  return Math.max(0, Math.min(1, Math.exp(-x + a * Math.log(x) - logGamma(a)) * h));
}

function chiSquareUpper(q, df) {
  if (!(df > 0) || !(q >= 0)) return 1;
  return regularizedGammaQ(df / 2, q / 2);
}

export function poolEffects(studies, model = 'random') {
  if (!studies.length) throw new Error('至少需要 1 项有效研究');
  const fixedWeights = studies.map(s => 1 / s.vi);
  const sumW = fixedWeights.reduce((a, b) => a + b, 0);
  const fixed = studies.reduce((sum, s, i) => sum + fixedWeights[i] * s.yi, 0) / sumW;
  const q = studies.reduce((sum, s, i) => sum + fixedWeights[i] * (s.yi - fixed) ** 2, 0);
  const df = Math.max(0, studies.length - 1);
  const c = sumW - fixedWeights.reduce((sum, w) => sum + w * w, 0) / sumW;
  const tau2 = df > 0 && c > 0 ? Math.max(0, (q - df) / c) : 0;
  const weights = model === 'fixed' ? fixedWeights : studies.map(s => 1 / (s.vi + tau2));
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  const estimate = studies.reduce((sum, s, i) => sum + weights[i] * s.yi, 0) / totalWeight;
  const se = Math.sqrt(1 / totalWeight);
  const z = estimate / se;
  const predictionSe = Math.sqrt(tau2 + se ** 2);
  return {
    k: studies.length,
    model,
    estimate,
    se,
    lower: estimate - Z95 * se,
    upper: estimate + Z95 * se,
    predictionLower: estimate - Z95 * predictionSe,
    predictionUpper: estimate + Z95 * predictionSe,
    z,
    p: Math.max(0, Math.min(1, 2 * (1 - normalCdf(Math.abs(z))))),
    q,
    df,
    qP: chiSquareUpper(q, df),
    tau2,
    i2: q > 0 && df > 0 ? Math.max(0, (q - df) / q) * 100 : 0,
    weights: weights.map(w => w / totalWeight * 100)
  };
}

export function poolSubgroups(studies, model = 'random') {
  const groups = new Map();
  studies.forEach(study => {
    const key = String(study.subgroup || '').trim() || '未分组';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(study);
  });
  const results = [...groups.entries()].map(([name, rows]) => ({ name, studies: rows, pooled: poolEffects(rows, model) }));
  if (results.length < 2) return { groups: results, qBetween: 0, dfBetween: 0, pBetween: 1 };
  const total = poolEffects(studies, 'fixed');
  const qWithin = results.reduce((sum, item) => sum + poolEffects(item.studies, 'fixed').q, 0);
  const qBetween = Math.max(0, total.q - qWithin);
  const dfBetween = results.length - 1;
  return { groups: results, qBetween, dfBetween, pBetween: chiSquareUpper(qBetween, dfBetween) };
}

export function eggerTest(studies) {
  const k = studies.length;
  if (k < 3) return null;
  const points = studies.map(s => ({ x: 1 / s.se, y: s.yi / s.se }));
  const meanX = points.reduce((sum, p) => sum + p.x, 0) / k;
  const meanY = points.reduce((sum, p) => sum + p.y, 0) / k;
  const sxx = points.reduce((sum, p) => sum + (p.x - meanX) ** 2, 0);
  if (!(sxx > 0)) return null;
  const slope = points.reduce((sum, p) => sum + (p.x - meanX) * (p.y - meanY), 0) / sxx;
  const intercept = meanY - slope * meanX;
  const sse = points.reduce((sum, p) => sum + (p.y - intercept - slope * p.x) ** 2, 0);
  const residualVariance = sse / Math.max(1, k - 2);
  const interceptSe = Math.sqrt(residualVariance * (1 / k + meanX ** 2 / sxx));
  if (!(interceptSe > 0)) return null;
  const statistic = intercept / interceptSe;
  return { k, intercept, se: interceptSe, statistic, p: Math.max(0, Math.min(1, 2 * (1 - normalCdf(Math.abs(statistic))))) };
}

export function leaveOneOut(studies, model = 'random') {
  if (studies.length < 3) return [];
  return studies.map((study, index) => ({
    omitted: study.study || `研究 ${index + 1}`,
    ...poolEffects(studies.filter((_, i) => i !== index), model)
  }));
}

export function toDisplay(value, measure) {
  return isRatioMeasure(measure) ? Math.exp(value) : value;
}

export function formatP(p) {
  if (!Number.isFinite(p)) return '—';
  return p < 0.001 ? '<0.001' : p.toFixed(3);
}
