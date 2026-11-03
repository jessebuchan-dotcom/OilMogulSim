import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function freePort() {
  const s = net.createServer();
  await new Promise(resolve => s.listen(0, '127.0.0.1', resolve));
  const port = s.address().port;
  await new Promise(resolve => s.close(resolve));
  return port;
}
async function launch(port) {
  const child = spawn(process.execPath, ['server.js'], { cwd: root, env: { ...process.env, PORT: String(port) }, stdio: 'ignore' });
  for (let i = 0; i < 70; i++) {
    if (child.exitCode !== null) throw new Error('Server crashed during launch.');
    try { const r = await fetch(`http://127.0.0.1:${port}/healthz`); if (r.ok) return child; } catch {}
    await sleep(40);
  }
  child.kill(); throw new Error('Server startup timed out.');
}
async function stop(child) {
  if (!child || child.exitCode !== null) return;
  const exited = new Promise(resolve => child.once('exit', resolve));
  child.kill('SIGTERM');
  await exited;
}
async function post(port, endpoint, body) {
  const response = await fetch(`http://127.0.0.1:${port}/api/${endpoint}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
  });
  return { status: response.status, data: await response.json(), headers: response.headers };
}

test('AI Studio memory mode: teacher can back up and restore after a complete server restart', async () => {
  const port = await freePort();
  let server;
  try {
    server = await launch(port);
    const teacher = (await post(port, 'create', { password: 'classroom-password', maxRounds: 4 })).data;
    const studentA = (await post(port, 'join', { code: teacher.code, name: 'Company A' })).data;
    const studentB = (await post(port, 'join', { code: teacher.code, name: 'Company B' })).data;
    assert.equal((await post(port, 'admin', { ...teacher, command: 'next' })).data.phase, 'decision');
    assert.equal((await post(port, 'submit', { ...studentA, decision: { production: 45, price: 60, offer: 45 } })).status, 200);
    assert.equal((await post(port, 'submit', { ...studentB, decision: { production: 65, price: 90, offer: 65 } })).status, 200);
    const afterRound = await post(port, 'admin', { ...teacher, command: 'resolve' });
    assert.equal(afterRound.data.results.soldTotal, 100);
    assert.equal((await post(port, 'backup', studentA)).status, 403, 'student must not download teacher backup');
    const backupResult = await post(port, 'backup', teacher);
    assert.equal(backupResult.status, 200);
    const backup = backupResult.data;
    assert.equal(backup.format, 'global-oil-mogul-session');
    assert.equal(backup.version, 1);
    assert.equal(backup.room.history.length, 1);
    assert.equal(backup.room.teams.length, 2);
    assert.ok(!('adminToken' in backup.room));
    await stop(server);
    server = await launch(port);
    assert.equal((await post(port, 'state', teacher)).status, 404, 'server memory is deliberately ephemeral');
    assert.equal((await post(port, 'restore', { backup, password: 'wrong-password' })).status, 403);
    const restore = await post(port, 'restore', { backup, password: 'classroom-password' });
    assert.equal(restore.status, 200);
    assert.equal(restore.data.code, teacher.code);
    assert.ok(restore.data.adminToken && restore.data.adminToken !== teacher.adminToken);
    const recoveredA = await post(port, 'state', studentA);
    assert.equal(recoveredA.status, 200, 'original student session must work after restore');
    assert.equal(recoveredA.data.phase, 'results');
    assert.equal(recoveredA.data.history[0].soldTotal, 100);
    assert.equal((await post(port, 'restore', { backup, password: 'classroom-password' })).status, 409, 'existing room cannot be overwritten');
    const secondRound = await post(port, 'admin', { code: teacher.code, adminToken: restore.data.adminToken, command: 'next' });
    assert.equal(secondRound.data.round, 2);
  } finally {
    await stop(server);
  }
});
