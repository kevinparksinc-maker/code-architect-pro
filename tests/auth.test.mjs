import test from 'node:test';
import assert from 'node:assert/strict';
import {createAppServer} from '../src/server.mjs';
import {assertSecurePublicHost, authorized} from '../src/auth.mjs';

const secret='A-really-long-test-password-47';
test('public server binding fails without a sufficiently strong password',()=>{
  assert.throws(()=>assertSecurePublicHost('0.0.0.0',{}),/Public binding requires/);
  assert.throws(()=>assertSecurePublicHost('::',{ARCHITECT_USERNAME:'architect',ARCHITECT_PASSWORD:'short'}),/Public binding requires/);
  assert.doesNotThrow(()=>assertSecurePublicHost('0.0.0.0',{ARCHITECT_USERNAME:'architect',ARCHITECT_PASSWORD:secret}));
  assert.doesNotThrow(()=>assertSecurePublicHost('127.0.0.1',{}));
});
test('authentication checks both username and password',()=>{
  const env={ARCHITECT_USERNAME:'architect',ARCHITECT_PASSWORD:secret};
  const request=credential=>({headers:{authorization:'Basic '+Buffer.from(credential).toString('base64')}});
  assert.equal(authorized(request('architect:'+secret),env),true);
  assert.equal(authorized(request('wrong:'+secret),env),false);
  assert.equal(authorized(request('architect:wrong'),env),false);
  assert.equal(authorized({headers:{}},env),false);
});
test('private endpoints require authentication, health endpoint remains available',async()=>{
  const before={u:process.env.ARCHITECT_USERNAME,p:process.env.ARCHITECT_PASSWORD,mode:process.env.NODE_ENV};
  process.env.ARCHITECT_USERNAME='architect';process.env.ARCHITECT_PASSWORD=secret;
  const server=createAppServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const base=`http://127.0.0.1:${server.address().port}`;
  try {
    let r=await fetch(base+'/api/health');assert.equal(r.status,200);
    r=await fetch(base+'/');assert.equal(r.status,401);assert.match(r.headers.get('www-authenticate'),/Basic/);
    r=await fetch(base+'/api/demo',{method:'POST'});assert.equal(r.status,401);
    r=await fetch(base+'/',{headers:{Authorization:'Basic '+Buffer.from('architect:'+secret).toString('base64')}});assert.equal(r.status,200);
  } finally {
    await new Promise(r=>server.close(r));
    for(const [key,value] of [['ARCHITECT_USERNAME',before.u],['ARCHITECT_PASSWORD',before.p],['NODE_ENV',before.mode]]){if(value===undefined)delete process.env[key];else process.env[key]=value;}
  }
});
