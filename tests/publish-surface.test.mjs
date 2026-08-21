import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const index = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const main = await readFile(new URL('../js/main.js', import.meta.url), 'utf8');
const manual = await readFile(new URL('../manual.html', import.meta.url), 'utf8');

assert.match(index, /src="js\/main\.js\?v=20260820b"/);
assert.doesNotMatch(index, /src="app\.js/);
assert.doesNotMatch(index + manual, /试用模式每库最多 15 条|试用模式限 15|每次检索最多返回[^<]*15 条/);

for (const moduleName of ['ui', 'auth', 'api-fetcher', 'storage', 'analysis-ui', 'review-workflow', 'prisma', 'entitlement']) {
  assert.match(main, new RegExp(`\\./${moduleName}\\.js\\?v=20260820b`));
}

console.log('publish surface tests passed');
