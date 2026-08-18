import assert from 'node:assert/strict';

const elements = new Map();
const setValue = (id, value) => elements.set(id, { value, textContent: '' });
globalThis.document = {
  getElementById(id) { return elements.get(id) || null; },
  querySelectorAll() { return []; }
};

setValue('mode', 'wide');
setValue('studyMode', 'human');
setValue('yf', '2000');
setValue('yt', '2026');
setValue('pop', 'pneumoconiosis; silicosis\noccupational lung disease');
setValue('expo', 'IL-6; interleukin-6');
setValue('animalTerms', 'mouse; mice');
setValue('outcome', 'risk; susceptibility');
setValue('design', 'case-control; cohort');
setValue('cnPop', '尘肺; 矽肺\n职业性肺病');
setValue('cnAnimal', '小鼠; 大鼠');
setValue('cnExpo', '白细胞介素-6; IL-6');

const { QueryBuilder } = await import('../js/query-builder.js');

const pubmed = QueryBuilder.buildPubMedQuery();
assert.match(pubmed, /\("pneumoconiosis"\[Title\/Abstract\] OR "silicosis"\[Title\/Abstract\]\)/);
assert.match(pubmed, /AND \("occupational lung disease"\[Title\/Abstract\]\)/);
assert.match(pubmed, /AND \("IL-6"\[Title\/Abstract\] OR "interleukin-6"\[Title\/Abstract\]\)/);
assert.match(pubmed, /"2000"\[Date - Publication\].*"2026"\[Date - Publication\]/);

const cnki = QueryBuilder.buildCNKIQuery();
assert.equal(
  cnki,
  "(SU='尘肺' OR SU='矽肺') AND (SU='职业性肺病') AND (SU='白细胞介素-6' OR SU='IL-6')"
);

const vip = QueryBuilder.buildVIPQuery();
assert.equal(
  vip,
  '(SU="尘肺" OR SU="矽肺") AND (SU="职业性肺病") AND (SU="白细胞介素-6" OR SU="IL-6")'
);

const cbm = QueryBuilder.buildCBMQuery();
assert.equal(
  cbm,
  '("尘肺" OR "矽肺") AND ("职业性肺病") AND ("白细胞介素-6" OR "IL-6")'
);

setValue('studyMode', 'animal');
assert.match(QueryBuilder.buildCNKIQuery(), /AND \(SU='小鼠' OR SU='大鼠'\) AND/);

setValue('cnPop', "O'Brien; quoted \"term\"");
setValue('studyMode', 'human');
assert.match(QueryBuilder.buildCNKIQuery(), /SU='O''Brien'/);
assert.match(QueryBuilder.buildWanfangQuery(), /"quoted \\"term\\""/);

console.log('query-builder tests passed');
