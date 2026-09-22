import test from 'node:test';import assert from 'node:assert/strict';
import {supportedNextVersion,releaseProblems} from '../../scripts/release-check.mjs';
import {root} from './load-typescript.mjs';
test('Release gate rejects versions below the published pin, ranges, and unreviewed major lines',()=>{
 for(const version of ['16.3.4','16.3.0','16.2.99','^16.3.5','16.3.6-canary.1','17.0.0','latest',undefined])assert.equal(supportedNextVersion(version),false);
 for(const version of ['16.3.5','16.3.6','16.4.0'])assert.equal(supportedNextVersion(version),true);
});
test('Unapproved release is blocked even after a future dependency update',async()=>{const errors=await releaseProblems(root,{});assert.ok(errors.some(e=>e.includes('RELEASE_REVIEW_APPROVED')));});
