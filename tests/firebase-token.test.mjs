import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPair,SignJWT} from 'jose';
import {authVerifier} from '../server/firebase-token.mjs';

test('o token Firebase precisa ser assinado, do projeto correto e com e-mail verificado',async()=>{
  const {publicKey,privateKey}=await generateKeyPair('RS256');
  const projectId='drive-fixture';
  const authenticate=authVerifier({projectId},async kid=>kid==='key1'?publicKey:undefined);
  const token=(audience,verified=true,expiry='10m',authTime=Math.floor(Date.now()/1000))=>
    new SignJWT({email:' Pessoal@Example.test ',email_verified:verified,auth_time:authTime})
      .setProtectedHeader({alg:'RS256',kid:'key1'}).setIssuedAt().setExpirationTime(expiry)
      .setIssuer('https://securetoken.google.com/'+projectId).setAudience(audience).setSubject('account').sign(privateKey);
  const authenticateToken=async(...args)=>authenticate('Bearer '+await token(...args));
  assert.deepEqual(await authenticateToken(projectId),{uid:'account',email:'pessoal@example.test'});
  await assert.rejects(authenticateToken('another'),error=>error.status===401);
  await assert.rejects(authenticateToken(projectId,false),error=>error.status===403);
  await assert.rejects(authenticateToken(projectId,true,'-1m'),error=>error.status===401);
  await assert.rejects(authenticateToken(projectId,true,'10m',Math.floor(Date.now()/1000)+60),error=>error.status===401);
});
