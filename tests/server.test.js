import test from 'node:test';
import assert from 'node:assert/strict';
import { server } from '../server.js';

const post = async (port, route, body) => {
  const r=await fetch(`http://127.0.0.1:${port}/api/${route}`, {method:'POST', headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const data=await r.json();return {status:r.status,data};
};

test('teacher controlled multi-company lifecycle and privacy', async () => {
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const port=server.address().port;
  try{
    const {data:created}=await post(port,'create',{password:'testing-strong',maxRounds:2});
    assert.match(created.code,/^[A-Z2-9]{5}$/);
    const ac={code:created.code,adminToken:created.adminToken};
    const t1=(await post(port,'join',{code:created.code,name:'Atlas'})).data;
    const t2=(await post(port,'join',{code:created.code,name:'Boreal'})).data;
    assert.equal((await post(port,'state',{...ac})).data.teamCount,2);
    const teamView=(await post(port,'state',t1)).data;
    assert.match(teamView.me.joinCode,/^[A-Z2-9]{8}$/);
    const teammate=(await post(port,'join-existing',{code:created.code,accessCode:teamView.me.joinCode})).data;
    assert.equal(teammate.teamId,t1.teamId);
    const wrong=(await post(port,'join-existing',{code:created.code,accessCode:'FFFFFFFF'}));
    assert.equal(wrong.status,403);
    const clients=Array.from({length:28},(_,i)=>i%2?teammate:t2);
    const simultaneous=await Promise.all(clients.map(c=>post(port,'state',c)));
    assert.ok(simultaneous.every(r=>r.status===200), '28 concurrent HTTP clients should read shared market');
    assert.equal((await post(port,'admin',{...ac,command:'next'})).data.phase,'decision');
    let result=await post(port,'submit',{...t1,decision:{price:90,production:70,offer:70}});
    assert.equal(result.data.me.decision.price,90);
    const secret=(await post(port,'state',t2)).data;
    assert.equal(secret.teams[0].submitted,true);
    assert.equal(JSON.stringify(secret).includes('"price":90'),false,'rival bid must be confidential');
    result=await post(port,'submit',{...t2,decision:{price:50,production:70,offer:70}});
    assert.equal(result.status,200);
    const settled=(await post(port,'admin',{...ac,command:'resolve'})).data;
    assert.equal(settled.phase,'results');
    assert.equal(settled.results.soldTotal,100);
    assert.ok(settled.results.entries[0].sold>=settled.results.entries[1].sold);
    assert.equal((await post(port,'admin',{...ac,command:'mode',mode:'summit'})).data.pendingMode,'summit');
    assert.equal((await post(port,'admin',{...ac,command:'next'})).data.roundMode,'summit');
    await post(port,'submit',{...t1,decision:{price:100,production:40,offer:40}});
    await post(port,'submit',{...t2,decision:{price:100,production:60,offer:60}});
    await post(port,'admin',{...ac,command:'resolve'});
    const end=(await post(port,'admin',{...ac,command:'finish'})).data;
    assert.equal(end.phase,'finished');
    assert.equal(end.analysis.summit.count,1);
    const bad=(await post(port,'admin',{code:created.code,adminToken:'forged',command:'restart'}));
    assert.equal(bad.status,403);
    const login=await post(port,'admin-login',{code:created.code,password:'testing-strong'});
    assert.equal(login.status,200);assert.ok(login.data.adminToken);
  } finally { await new Promise(resolve=>server.close(resolve)); }
});
