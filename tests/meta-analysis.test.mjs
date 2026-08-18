import assert from 'node:assert/strict';
import { computeStudyEffect, poolEffects, poolSubgroups, eggerTest, leaveOneOut, toDisplay } from '../js/meta-analysis.js';

const close = (actual, expected, tolerance = 1e-8) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);

const or = computeStudyEffect({ study: 'A', eventsT: 10, totalT: 100, eventsC: 20, totalC: 100 }, 'OR');
close(or.yi, Math.log(4 / 9));
close(or.vi, 1 / 10 + 1 / 90 + 1 / 20 + 1 / 80);
close(toDisplay(or.yi, 'OR'), 4 / 9);

const rrZero = computeStudyEffect({ study: 'Zero', eventsT: 0, totalT: 40, eventsC: 4, totalC: 40 }, 'RR');
assert.ok(Number.isFinite(rrZero.yi) && rrZero.vi > 0, 'zero-event continuity correction failed');
const rd = computeStudyEffect({ study: 'RD', eventsT: 10, totalT: 100, eventsC: 20, totalC: 100 }, 'RD');
close(rd.yi, -0.1);
close(rd.vi, 0.0025);

const md = computeStudyEffect({ study: 'B', nT: 50, meanT: 5, sdT: 2, nC: 50, meanC: 3, sdC: 2 }, 'MD');
close(md.yi, 2);
close(md.vi, 0.16);

const smd = computeStudyEffect({ study: 'C', nT: 30, meanT: 12, sdT: 4, nC: 30, meanC: 10, sdC: 4 }, 'SMD');
assert.ok(smd.yi > 0.48 && smd.yi < 0.5);
assert.ok(smd.vi > 0);

const genericRatio = computeStudyEffect({ study: 'D', effect: 1.5, lower: 1.1, upper: 2.05 }, 'GENERIC_RATIO');
close(toDisplay(genericRatio.yi, 'GENERIC_RATIO'), 1.5);
const generic = computeStudyEffect({ study: 'E', effect: 0.3, lower: 0.1, upper: 0.5 }, 'GENERIC');
close(generic.yi, 0.3);
assert.ok(generic.vi > 0);
assert.throws(() => computeStudyEffect({ eventsT: 12, totalT: 10, eventsC: 1, totalC: 10 }, 'OR'));

const fixed = poolEffects([
  { study: 'S1', yi: 0.2, vi: 0.04 },
  { study: 'S2', yi: 0.4, vi: 0.09 }
], 'fixed');
close(fixed.estimate, (0.2 / 0.04 + 0.4 / 0.09) / (1 / 0.04 + 1 / 0.09));
close(fixed.weights.reduce((a, b) => a + b, 0), 100);
assert.equal(fixed.k, 2);
const oneStudy = poolEffects([{ study: 'Only', yi: 0.25, vi: 0.04 }], 'random');
close(oneStudy.estimate, 0.25); close(oneStudy.tau2, 0); close(oneStudy.i2, 0);
const chiA = Math.sqrt(3.841458820694124 / 2);
const chiKnown = poolEffects([{ study: 'L', yi: -chiA, vi: 1 }, { study: 'R', yi: chiA, vi: 1 }], 'fixed');
close(chiKnown.qP, 0.05, 5e-5);

const random = poolEffects([
  { study: 'S1', yi: -0.8, vi: 0.05 },
  { study: 'S2', yi: 0.1, vi: 0.06 },
  { study: 'S3', yi: 0.7, vi: 0.08 }
], 'random');
assert.ok(random.tau2 > 0 && random.i2 > 0);
close(random.qP, Math.exp(-random.q / 2), 1e-10); // df=2 时卡方上尾概率有闭式解
assert.ok(random.predictionLower < random.lower && random.predictionUpper > random.upper);
const subgroup = poolSubgroups([
  { study: 'A1', subgroup: 'A', yi: -0.4, vi: 0.1 },
  { study: 'A2', subgroup: 'A', yi: -0.2, vi: 0.1 },
  { study: 'B1', subgroup: 'B', yi: 0.5, vi: 0.1 },
  { study: 'B2', subgroup: 'B', yi: 0.7, vi: 0.1 }
], 'fixed');
assert.equal(subgroup.groups.length, 2);
assert.ok(subgroup.qBetween > 0 && subgroup.pBetween < 0.05);
const egger = eggerTest([
  { yi: 0.1, se: 0.1 }, { yi: 0.18, se: 0.15 }, { yi: 0.25, se: 0.2 }, { yi: 0.32, se: 0.25 }
]);
assert.ok(egger && Number.isFinite(egger.intercept) && Number.isFinite(egger.p));
assert.equal(leaveOneOut([
  { study: 'S1', yi: -0.8, vi: 0.05 },
  { study: 'S2', yi: 0.1, vi: 0.06 },
  { study: 'S3', yi: 0.7, vi: 0.08 }
], 'random').length, 3);

console.log('meta-analysis tests passed');
