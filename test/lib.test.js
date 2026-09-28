// Run: node test/lib.test.js   (no framework, no network)
import assert from 'node:assert/strict';
import { validUrl, validSlug, parseBatch } from '../src/lib.js';

// URL guard: only http/https, so a stored link can never be javascript:/data:
assert.equal(validUrl('https://a.com'), true);
assert.equal(validUrl('http://a.com'), true);
assert.equal(validUrl('javascript:alert(1)'), false);
assert.equal(validUrl('ftp://a.com'), false);
assert.equal(validUrl('not a url'), false);

// Slug guard
assert.equal(validSlug('abc-1_2'), true);
assert.equal(validSlug('has space'), false);
assert.equal(validSlug('emoji😀'), false);

// Batch parser: blank lines skipped, invalid collected, title after '|'
const { rows, skipped } = parseBatch('https://a.com\n\nhttps://b.com | Bee | 2\nftp://nope\n   \n');
assert.deepEqual(rows, [
  { target_url: 'https://a.com', title: '' },
  { target_url: 'https://b.com', title: 'Bee | 2' },
]);
assert.deepEqual(skipped, ['ftp://nope']);

// No trailing newline, whitespace-only input
assert.deepEqual(parseBatch('').rows, []);
assert.deepEqual(parseBatch('  \n \n').rows, []);

console.log('all checks passed');
