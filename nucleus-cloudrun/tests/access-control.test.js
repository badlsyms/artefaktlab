import test from 'node:test';
import assert from 'node:assert/strict';
import { createPinGuard } from '../access-control.js';
function invoke(config,provided) {
 const result={next:false};
 const res={status(value){result.status=value;return this},json(value){result.body=value;return this}};
 createPinGuard(config)({get:()=>provided},res,()=>{result.next=true});return result;
}
test('missing configuration blocks private operations',()=>{
 for(const value of [undefined,'','   ']) {const r=invoke(value,'anything');assert.equal(r.status,503);assert.equal(r.next,false);assert.equal(r.body.code,'ACCESS_NOT_CONFIGURED')}
});
test('wrong or missing credentials cannot reach the operation',()=>{
 for(const value of [undefined,'','wrong','a'.repeat(10000)]) {const r=invoke('test-only-pin',value);assert.equal(r.status,401);assert.equal(r.next,false)}
});
test('only the exact configured PIN permits the operation',()=>{
 assert.equal(invoke('test-only-pin','test-only-pin').next,true);
 assert.equal(invoke('test-only-pin','test-only-pin ').status,401);
});
