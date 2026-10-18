import assert from 'node:assert/strict';
import test from 'node:test';
import { hashPassword, validPassword, verifyPassword } from '../server/passwords.js';

test('password policy accepts 6–256 characters and rejects values outside the limits', async () => {
  for (const password of [undefined, null, 123456, '', 'abcde', 'x'.repeat(257)]) {
    assert.equal(validPassword(password), false);
    await assert.rejects(hashPassword(password), /between 6 and 256 characters/);
  }
  for (const password of ['Six!42', 'existing-longer-password', 'x'.repeat(256)]) {
    assert.equal(validPassword(password), true);
    const hash = await hashPassword(password);
    assert.notEqual(hash, password);
    assert.ok(await verifyPassword(password, hash));
    assert.equal(await verifyPassword('incorrect-password', hash), false);
  }
});
