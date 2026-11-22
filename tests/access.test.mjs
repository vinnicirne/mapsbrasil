import test from 'node:test';
import assert from 'node:assert/strict';
import {openAccess,demoCompanies} from '../server/access.mjs';

test('e-mail terceirizado, aprovação, vínculo por empresa e revogação',async()=>{
  const access=openAccess(':memory:',{demo:true,companies:demoCompanies});
  const [admin,driver,guest]=await Promise.all(['admin','driver','guest'].map(async role=>access.authenticate('Bearer '+access.demoToken(role).token)));
  assert.equal(access.request(driver,'rio-demo').memberships[0].status,'pending');
  assert.throws(()=>access.requireApproved(driver,'piloto'),error=>error.status===403);
  assert.throws(()=>access.members(driver,'piloto'),error=>error.status===403);
  assert.throws(()=>access.members(admin,'outra'),error=>error.status===403);
  assert.throws(()=>access.depart(guest,'piloto',driver.uid,'approved'),error=>error.status===403);

  access.depart(admin,'piloto',driver.uid,'approved');
  assert.equal(access.me(driver).memberships[0].status,'approved');
  assert.ok(access.lease(driver,'piloto','p1').signature);
  assert.throws(()=>access.requireApproved(driver,'outra'),error=>error.status===403);

  const {token}=access.invite(admin,'piloto',guest.email);
  assert.throws(()=>access.acceptInvite(driver,token),error=>error.status===403);
  assert.equal(access.acceptInvite(guest,token).memberships[0].status,'approved');
  assert.throws(()=>access.acceptInvite(guest,token),error=>error.status===404);
  access.depart(admin,'piloto',driver.uid,'revoked');
  assert.throws(()=>access.lease(driver,'piloto','p1'),error=>error.status===403);
  assert.equal(access.request(driver,'rio-demo').memberships[0].status,'revoked');
  await assert.rejects(()=>access.authenticate('Bearer forged'),error=>error.status===401);
});
