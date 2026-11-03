import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { RULES, settleRound, validateDecision, marketAnalysis } from './engine.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const colours = ['#f3b450','#58cfbd','#f47674','#8c9cf8','#bb8ce0','#6dc785','#5bb8ef','#e5a67c','#dbd35d','#b0a49b','#91e0bd','#e8a8b7'];
// Google AI Studio: a single live Node.js process owns the shared classroom state.
// No Firebase, external database, or writable filesystem is required.
// An unexpected restart clears this memory: teachers can export and restore a backup.
const rooms = Object.create(null);
const sessions = new Map();
const failedLogins = new Map();
const failedTeamJoins = new Map();

function random(n=18) { return crypto.randomBytes(n).toString('hex'); }
function roomCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do { code = Array.from({ length: 5 }, () => alphabet[crypto.randomInt(alphabet.length)]).join(''); } while (rooms[code]);
  return code;
}
function error(message, status=400) { const e = new Error(message); e.status = status; throw e; }
function cleanName(name) { return String(name ?? '').trim().replace(/[<>\x00-\x1f]/g, '').slice(0, 32); }
function requireRoom(code) { const room = rooms[String(code || '').trim().toUpperCase()]; if (!room) error('Room not found. Check your five-character code.', 404); return room; }
function authAdmin(room, token) { if (!token || sessions.get(token) !== room.code) error('Teacher authentication required.', 403); }
function authTeam(room, id, token) { const t = room.teams.find(x => x.id === id && x.token === token); if (!t) error('Your team session is not recognised. Rejoin using your original device.', 403); return t; }
function hashPassword(password, salt) { return crypto.scryptSync(password, salt, 64).toString('hex'); }
function grantAdmin(room) { const token = random(32); sessions.set(token, room.code); return token; }
function verifyAdminPassword(room, pw) {
  const calculated = Buffer.from(hashPassword(pw, room.adminSalt), 'hex');
  const expected = Buffer.from(room.adminPasswordHash, 'hex');
  return calculated.length === expected.length && crypto.timingSafeEqual(calculated, expected);
}
function stateFor(room, body) {
  const isAdmin = Boolean(body.adminToken && sessions.get(body.adminToken) === room.code);
  const team = !isAdmin && body.teamId && body.teamToken ? authTeam(room, body.teamId, body.teamToken) : null;
  if (!team && !isAdmin) error('Join the room to see this market.', 403);
  const submissions = room.teams.filter(t => !!t.decision).length;
  const latest = room.history.at(-1) || null;
  return {
    code: room.code, phase: room.phase, round: room.round, maxRounds: room.maxRounds,
    roundMode: room.roundMode, pendingMode: room.pendingMode,
    teamCount: room.teams.length, maxTeams: RULES.maxTeams, submissions,
    teams: room.teams.map(t => ({ id: t.id, name: t.name, colour: t.colour, submitted: !!t.decision,
      ...(isAdmin ? { isDemo: !!t.isDemo } : {}) })),
    results: latest, history: room.history,
    analysis: room.phase === 'finished' ? marketAnalysis(room.history) : null,
    me: team ? { id: team.id, name: team.name, colour: team.colour, joinCode: team.joinCode, inventory: team.inventory,
      cash: team.cash, totalRevenue: team.totalRevenue, totalProfit: team.totalProfit,
      totalSold: team.totalSold, decision: team.decision, submittedAt: team.submittedAt } : null,
    teacher: isAdmin ? { roomCreated: room.createdAt, storage: 'session-memory' } : null,
    rules: RULES,
  };
}
function startNext(room) {
  if (!['lobby','results'].includes(room.phase)) error('Wait until the previous round has finished.');
  if (room.round >= room.maxRounds) error('The scheduled rounds have finished. End the game or restart it.');
  if (room.teams.length < 2) error('At least two oil producers must join before starting.');
  room.round++;
  room.phase = 'decision';
  room.roundMode = room.pendingMode;
  room.teams.forEach(t => { t.decision = null; t.submittedAt = null; });
  room.updatedAt = new Date().toISOString();
}
function adminCommand(room, body) {
  authAdmin(room, body.adminToken);
  switch (body.command) {
    case 'next': startNext(room); break;
    case 'resolve':
      if (room.phase !== 'decision') error('There is no open market to settle.');
      if (!room.teams.some(t => !!t.decision)) error('No companies have submitted a decision.');
      settleRound(room); break;
    case 'mode':
      if (!['lobby','results'].includes(room.phase)) error('The next market mode can only change between rounds.');
      if (!['independent','summit'].includes(body.mode)) error('Unknown market mode.');
      room.pendingMode = body.mode; break;
    case 'finish':
      if (room.phase === 'decision') error('Settle the open market first.');
      if (!room.history.length) error('Play at least one round first.');
      room.phase = 'finished'; break;
    case 'restart':
      if (body.confirm !== 'RESTART') error('Restart confirmation missing.');
      room.phase = 'lobby'; room.round = 0; room.history = [];
      room.roundMode = 'independent'; room.pendingMode = 'independent';
      room.teams.forEach(t => { t.inventory = 0; t.cash = RULES.startingCash; t.totalRevenue = 0; t.totalProfit = 0; t.totalSold = 0; t.decision = null; t.submittedAt = null; });
      break;
    case 'remove':
      if (!['lobby','results'].includes(room.phase)) error('Companies can only leave between rounds.');
      if (room.history.length && room.teams.some(t => t.id === body.teamId && !t.isDemo)) error('Only practice firms can be removed once the simulation has begun.');
      room.teams = room.teams.filter(t => t.id !== body.teamId); break;
    case 'demo': {
      if (room.phase !== 'lobby') error('Practice firms must be added before round one.');
      const names = ['Atlas Petroleum', 'Meridian Oil', 'Boreal Energy'];
      for (const name of names) {
        if (room.teams.length >= RULES.maxTeams) break;
        if (room.teams.some(t => t.name === name)) continue;
        room.teams.push(newTeam(name, room.teams.length, true));
      }
      break;
    }
    case 'clear-demo': {
      if (room.phase !== 'lobby') error('Practice companies can only be removed before round one.');
      room.teams = room.teams.filter(t => !t.isDemo);
      break;
    }
    case 'demo-submit': {
      if (room.phase !== 'decision') error('Open a market round first.');
      for (const t of room.teams.filter(t => t.isDemo)) {
        const price = room.roundMode === 'summit' ? 92 + ((room.round + t.name.length) % 3) * 4 : 48 + ((room.round * 7 + t.name.length) % 7) * 5;
        const production = 28 + ((room.round + t.name.length) % 4) * 8;
        t.decision = validateDecision({ price, production, offer: t.inventory + production }, t.inventory);
        t.submittedAt = new Date().toISOString();
      }
      break;
    }
    default: error('Unknown teacher command.');
  }
  room.updatedAt = new Date().toISOString();
  return stateFor(room, body);
}
function newTeam(name, ix, demo=false) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const joinCode = Array.from({length:8}, () => alphabet[crypto.randomInt(alphabet.length)]).join('');
  return { id: random(8), token: random(24), joinCode, name, colour: colours[ix % colours.length], isDemo: demo,
    inventory: 0, cash: RULES.startingCash, totalRevenue: 0, totalProfit: 0, totalSold: 0,
    decision: null, submittedAt: null };
}
function toCSV(room) {
  const header = ['Round','Market mode','Company','Price ($/barrel)','Produced (barrels)','Offered (barrels)','Sold (barrels)','Market share (%)','End stock','Revenue ($)','Production cost ($)','Storage cost ($)','Fixed cost ($)','Round profit ($)','Cumulative revenue ($)','Cumulative profit ($)','World barrels sold','Total world revenue ($)','Total world profit ($)'];
  const escapeCsv = v => '"' + String(v ?? '').replaceAll('"', '""') + '"';
  const lines = [header.map(escapeCsv).join(',')];
  for (const r of room.history) for (const e of r.entries) lines.push([
    r.round, r.mode, e.teamName, e.price, e.produced, e.offered, e.sold, e.share, e.inventory,
    e.revenue, e.productionCost, e.storageCost, e.fixedCost, e.profit, e.cumulativeRevenue, e.cumulativeProfit,
    r.soldTotal, r.totalRevenue, r.totalProfit,
  ].map(escapeCsv).join(','));
  return lines.join('\r\n') + '\r\n';
}
// The encrypted teacher password hash and team access secrets are included in a
// downloadable backup. Never expose one to students or save it in source code.
function makeBackup(room) {
  return { format: 'global-oil-mogul-session', version: 1,
    exportedAt: new Date().toISOString(), room: structuredClone(room) };
}
function checkBackup(backup, password) {
  if (!backup || backup.format !== 'global-oil-mogul-session' || backup.version !== 1 ||
      !backup.room || typeof backup.room !== 'object') error('Not a Global Oil Mogul session backup.');
  const room = backup.room;
  if (!/^[A-HJ-NP-Z2-9]{5}$/.test(room.code || '') ||
      !Number.isInteger(room.maxRounds) || room.maxRounds < 2 || room.maxRounds > 12 ||
      !Number.isInteger(room.round) || room.round < 0 || room.round > room.maxRounds ||
      !['lobby','decision','results','finished'].includes(room.phase) ||
      !['independent','summit'].includes(room.roundMode) ||
      !['independent','summit'].includes(room.pendingMode) ||
      !Array.isArray(room.teams) || room.teams.length > RULES.maxTeams ||
      !Array.isArray(room.history) || room.history.length > room.maxRounds ||
      !/^[a-f0-9]{32}$/.test(room.adminSalt || '') ||
      !/^[a-f0-9]{128}$/.test(room.adminPasswordHash || '')) error('The backup is incomplete or invalid.');
  const ids = new Set();
  for (const t of room.teams) {
    if (!t || !/^[a-f0-9]{16}$/.test(t.id || '') ||
        !/^[a-f0-9]{48}$/.test(t.token || '') ||
        !/^[A-HJ-NP-Z2-9]{8}$/.test(t.joinCode || '') ||
        typeof t.name !== 'string' || t.name.length < 2 || t.name.length > 32 ||
        !Number.isSafeInteger(t.inventory) || t.inventory < 0 ||
        !['cash','totalRevenue','totalProfit','totalSold'].every(k => Number.isFinite(t[k])) ||
        ids.has(t.id)) error('The backup has an invalid company record.');
    ids.add(t.id);
    if (t.decision) validateDecision(t.decision, t.inventory);
  }
  for (const h of room.history) {
    if (!h || !Number.isInteger(h.round) || !Array.isArray(h.entries) ||
        !Number.isFinite(h.totalRevenue) || !Number.isFinite(h.totalProfit) ||
        !Number.isInteger(h.soldTotal) || h.soldTotal < 0 || h.soldTotal > 100 ||
        h.entries.length > RULES.maxTeams) error('The backup contains invalid market history.');
  }
  if (String(password || '').length < 6 || !verifyAdminPassword(room, String(password)))
    error('The backup password is incorrect.', 403);
  if (rooms[room.code]) error('This room already exists. Restore after the old session has ended or use its existing teacher login.', 409);
  return structuredClone(room);
}

function send(res, code, data, extra={}) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra });
  res.end(JSON.stringify(data));
}
async function readBody(req, limit=10000) {
  let data = '';
  for await (const part of req) {
    data += part;
    if (Buffer.byteLength(data, 'utf8') > limit) error('Request too large.', 413);
  }
  try { return data ? JSON.parse(data) : {}; } catch { error('Invalid JSON.'); }
}
const mime = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.svg':'image/svg+xml', '.png':'image/png', '.ico':'image/x-icon' };
const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'");
  const route = new URL(req.url, `http://${req.headers.host || 'localhost'}`).pathname;
  try {
    if (req.method === 'POST' && route.startsWith('/api/')) {
      const b = await readBody(req, route === '/api/restore' ? 1500000 : 10000);
      if (route === '/api/restore') {
        const recovered = checkBackup(b.backup, b.password);
        recovered.updatedAt = new Date().toISOString();
        rooms[recovered.code] = recovered;
        return send(res, 200, { code: recovered.code, adminToken: grantAdmin(recovered) });
      }
      if (route === '/api/backup') {
        const room = requireRoom(b.code); authAdmin(room, b.adminToken);
        return send(res, 200, makeBackup(room), {
          'Content-Disposition': `attachment; filename="global-oil-mogul-backup-${room.code}.json"`
        });
      }
      if (route === '/api/create') {
        if (String(b.password || '').length < 6 || String(b.password || '').length > 100) error('Teacher password must be at least 6 characters.');
        const maxRounds = Math.max(2, Math.min(12, Number.parseInt(b.maxRounds, 10) || 6));
        const code = roomCode(); const salt = random(16);
        rooms[code] = { code, maxRounds, round: 0, phase: 'lobby', roundMode: 'independent', pendingMode: 'independent',
          teams: [], history: [], adminSalt: salt, adminPasswordHash: hashPassword(b.password, salt),
          createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
              return send(res, 200, { code, adminToken: grantAdmin(rooms[code]) });
      }
      if (route === '/api/admin-login') {
        const room = requireRoom(b.code);
        const key = room.code + ':' + (req.socket.remoteAddress || 'unknown');
        const entry = failedLogins.get(key) || { count: 0, until: 0 };
        if (entry.count >= 6 && entry.until > Date.now()) error('Too many attempts. Try again in 10 minutes.', 429);
        if (!verifyAdminPassword(room, String(b.password || ''))) {
          const count = entry.until > Date.now() ? entry.count + 1 : 1;
          failedLogins.set(key, { count, until: Date.now() + 10 * 60 * 1000 });
          error('Incorrect teacher password.', 403);
        }
        failedLogins.delete(key);
        return send(res, 200, { code: room.code, adminToken: grantAdmin(room) });
      }
      if (route === '/api/join') {
        const room = requireRoom(b.code);
        if (room.phase !== 'lobby') error('This game has already started. Ask your teacher to admit your team before starting.', 409);
        if (room.teams.length >= RULES.maxTeams) error('This market is full.', 409);
        const name = cleanName(b.name);
        if (name.length < 2) error('Enter a company name (at least two characters).');
        if (room.teams.some(t => t.name.toLocaleLowerCase() === name.toLocaleLowerCase())) error('A company already has that name.');
        const team = newTeam(name, room.teams.length); room.teams.push(team);
        return send(res, 200, { code: room.code, teamId: team.id, teamToken: team.token });
      }
      if (route === '/api/join-existing') {
        const room = requireRoom(b.code);
        if (room.phase === 'finished') error('This market has already finished.', 409);
        const key = room.code + ':' + (req.socket.remoteAddress || 'unknown') + ':team';
        const attempts = failedTeamJoins.get(key) || {count:0,until:0};
        if (attempts.count >= 10 && attempts.until > Date.now()) error('Too many access-code attempts. Try later.',429);
        const accessCode = String(b.accessCode || '').trim().toUpperCase();
        const team = room.teams.find(t => !t.isDemo && t.joinCode === accessCode);
        if (!team) {
          const count = attempts.until > Date.now() ? attempts.count+1 : 1;
          failedTeamJoins.set(key,{count,until:Date.now()+10*60*1000});
          error('Company access code not recognised.', 403);
        }
        failedTeamJoins.delete(key);
        return send(res,200,{code:room.code,teamId:team.id,teamToken:team.token});
      }
      if (route === '/api/state') { const room = requireRoom(b.code); return send(res, 200, stateFor(room, b)); }
      if (route === '/api/submit') {
        const room = requireRoom(b.code);
        const team = authTeam(room, b.teamId, b.teamToken);
        if (team.isDemo) error('A practice firm is controlled by the teacher.');
        if (room.phase !== 'decision') error('Your teacher has not opened a decision round.');
        team.decision = validateDecision(b.decision, team.inventory);
        team.submittedAt = new Date().toISOString(); room.updatedAt = new Date().toISOString();
        return send(res, 200, stateFor(room, b));
      }
      if (route === '/api/admin') { const room = requireRoom(b.code); return send(res, 200, adminCommand(room,b)); }
      if (route === '/api/export') {
        const room = requireRoom(b.code); authAdmin(room, b.adminToken);
        res.writeHead(200, { 'Content-Type':'text/csv; charset=utf-8', 'Content-Disposition':`attachment; filename="oil-mogul-${room.code}.csv"`, 'Cache-Control':'no-store' });
        return res.end(toCSV(room));
      }
      return send(res, 404, { error: 'Unknown endpoint.' });
    }
    if (req.method === 'GET' && route === '/healthz') return send(res, 200, { status: 'ok' });
    if (req.method !== 'GET') return send(res, 405, { error: 'Method not allowed.' });
    const safePath = route === '/' ? '/index.html' : route;
    const target = path.resolve(__dirname, 'public', '.' + safePath);
    const root = path.resolve(__dirname, 'public');
    if (!target.startsWith(root + path.sep)) return send(res, 403, { error: 'Forbidden.' });
    fs.readFile(target, (err, buf) => {
      if (err) return send(res, 404, { error: 'Page not found.' });
      res.writeHead(200, { 'Content-Type': mime[path.extname(target)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(buf);
    });
  } catch (e) {
    if (!e.status) console.error('Server error:', e);
    return send(res, e.status || 500, { error: e.status ? e.message : 'An unexpected error occurred. Please try again.' });
  }
});
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) server.listen(PORT, '0.0.0.0', () => console.log(`Global Oil Mogul running at http://localhost:${PORT}`));
export { server };
