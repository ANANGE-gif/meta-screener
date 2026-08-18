import assert from 'node:assert/strict';
import { ScoringEngine } from '../js/scoring.js';

assert.equal(ScoringEngine.matchTerm('rat model exposed to silica', 'rat'), true);
assert.equal(ScoringEngine.matchTerm('respiratory research', 'rat'), false);
assert.equal(ScoringEngine.matchTerm('proliferative processes', 'rat'), false);
assert.equal(ScoringEngine.matchTerm('systematic review', 'review'), true);
assert.equal(ScoringEngine.matchTerm('preview of findings', 'review'), false);
assert.equal(ScoringEngine.matchTerm('IL-6 polymorphism', 'IL-6'), true);
assert.equal(ScoringEngine.matchTerm('interleukin 6 polymorphism', 'interleukin-6'), true);
assert.equal(ScoringEngine.matchTerm('白细胞介素-6与尘肺', '尘肺'), true);

console.log('scoring tests passed');
