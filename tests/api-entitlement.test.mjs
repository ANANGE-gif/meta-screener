import assert from 'node:assert/strict';
import { ApiFetcher } from '../js/api-fetcher.js';

const blocked = new ApiFetcher({ canUsePremium: () => false });
const denied = await blocked.fetchSelectedDatabases(['pubmed']);
assert.equal(denied.records.length, 0);
assert.match(denied.messages[0], /专业版/);

const allowed = new ApiFetcher({ canUsePremium: () => true });
const empty = await allowed.fetchSelectedDatabases([]);
assert.match(empty.messages[0], /勾选至少一个数据库/);

console.log('api entitlement tests passed');
