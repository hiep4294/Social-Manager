import assert from 'node:assert/strict';
import { shouldAutoUpdate } from '../src/runtime-auto-update.js';

assert.equal(shouldAutoUpdate('1.4.0', '1.4.0'), false);
assert.equal(shouldAutoUpdate('1.4.0', '1.4.1'), true);
assert.equal(shouldAutoUpdate('', '1.4.1'), false);
assert.equal(shouldAutoUpdate('1.4.0', ''), false);

console.log('RUNTIME AUTO UPDATE TEST PASS');
