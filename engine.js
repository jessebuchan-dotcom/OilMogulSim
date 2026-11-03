/**
 * Global Oil Mogul: deterministic, server-authoritative market-clearing engine.
 * All prices are fictional USD per barrel. The global demand cap is always 100 barrels.
 */
export const RULES = Object.freeze({
  worldDemand: 100,
  maxProduction: 70,
  minPrice: 30,
  maxPrice: 120,
  productionCost: 28,
  storageCost: 2,
  fixedCost: 45,
  elasticity: 4.5,
  startingCash: 2000,
  maxTeams: 12,
});

export function clampInt(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error('Enter a valid number.');
  return Math.min(max, Math.max(min, Math.round(n)));
}

export function validateDecision(raw, inventory = 0) {
  if (!raw || typeof raw !== 'object') throw new Error('A decision is required.');
  const production = clampInt(raw.production, 0, RULES.maxProduction);
  const price = clampInt(raw.price, RULES.minPrice, RULES.maxPrice);
  const offer = clampInt(raw.offer, 0, inventory + production);
  return { production, price, offer };
}

/**
 * Allocate up to 100 barrels amongst firms using price-sensitive proportional
 * allocation, with hard caps at each firm's offer. The result is rounded to
 * whole barrels by the largest-remainder method with a deterministic tie-break.
 * This is a teaching model, not a prediction of actual crude oil markets.
 */
export function allocateMarket(offers) {
  const remaining = Math.min(RULES.worldDemand, offers.reduce((s, f) => s + f.offer, 0));
  if (!offers.length || remaining === 0) return offers.map(() => 0);
  const sales = offers.map(() => 0);
  let demandLeft = remaining;
  let active = offers.map((o, i) => ({ i, capacity: o.offer, weight: Math.pow(RULES.maxPrice / o.price, RULES.elasticity) }))
    .filter(o => o.capacity > 0);
  // Continuously allocate demand until all supply bottlenecks are satisfied.
  for (let guard = 0; active.length && demandLeft > 1e-8 && guard < offers.length + 2; guard++) {
    const totalWeight = active.reduce((s, o) => s + o.weight, 0);
    const capped = active.filter(o => demandLeft * o.weight / totalWeight >= o.capacity - 1e-8);
    if (!capped.length) {
      for (const o of active) sales[o.i] += demandLeft * o.weight / totalWeight;
      demandLeft = 0;
      break;
    }
    for (const o of capped) {
      sales[o.i] += o.capacity;
      demandLeft -= o.capacity;
    }
    const removed = new Set(capped.map(o => o.i));
    active = active.filter(o => !removed.has(o.i));
  }
  let whole = sales.map(v => Math.floor(v + 1e-8));
  let leftover = remaining - whole.reduce((s, n) => s + n, 0);
  const priorities = sales.map((v, i) => ({ i, fraction: v - whole[i], name: String(offers[i].id || i) }))
    .sort((a, b) => b.fraction - a.fraction || a.name.localeCompare(b.name));
  for (const { i } of priorities) {
    if (!leftover) break;
    if (whole[i] < offers[i].offer) { whole[i]++; leftover--; }
  }
  return whole;
}

export function settleRound(room) {
  if (room.phase !== 'decision') throw new Error('The market is not accepting decisions.');
  const roundNumber = room.round;
  const firms = room.teams.map(team => {
    const d = team.decision || { price: 70, production: 0, offer: 0 };
    return { team, decision: d, stockAvailable: team.inventory + d.production };
  });
  const allocated = allocateMarket(firms.map(f => ({ id: f.team.id, price: f.decision.price, offer: f.decision.offer })));
  const entries = firms.map(({ team, decision: d, stockAvailable }, i) => {
    const sold = allocated[i];
    const unsold = stockAvailable - sold;
    const revenue = sold * d.price;
    const productionCost = d.production * RULES.productionCost;
    const storageCost = unsold * RULES.storageCost;
    const profit = revenue - productionCost - storageCost - RULES.fixedCost;
    team.inventory = unsold;
    team.cash += profit;
    team.totalRevenue += revenue;
    team.totalProfit += profit;
    team.totalSold += sold;
    team.decision = null;
    team.submittedAt = null;
    return {
      teamId: team.id, teamName: team.name, colour: team.colour,
      price: d.price, produced: d.production, offered: d.offer,
      sold, share: sold, inventory: unsold, revenue, profit,
      productionCost, storageCost, fixedCost: RULES.fixedCost,
      cumulativeRevenue: team.totalRevenue, cumulativeProfit: team.totalProfit,
      cash: team.cash,
    };
  });
  const soldTotal = entries.reduce((s, e) => s + e.sold, 0);
  const totalRevenue = entries.reduce((s, e) => s + e.revenue, 0);
  const totalProfit = entries.reduce((s, e) => s + e.profit, 0);
  const weightedAveragePrice = soldTotal ? +(totalRevenue / soldTotal).toFixed(2) : 0;
  const roundResult = {
    round: roundNumber, mode: room.roundMode, modeLabel: room.roundMode === 'summit' ? 'Negotiation permitted' : 'Independent decisions',
    entries: entries.sort((a, b) => b.revenue - a.revenue || b.sold - a.sold || a.teamName.localeCompare(b.teamName)),
    soldTotal, unmetDemand: RULES.worldDemand - soldTotal, totalRevenue, totalProfit, weightedAveragePrice,
    resolvedAt: new Date().toISOString(),
  };
  room.history.push(roundResult);
  room.phase = 'results';
  room.updatedAt = new Date().toISOString();
  return roundResult;
}

export function marketAnalysis(history) {
  const observations = history.filter(r => r.soldTotal > 0);
  if (!observations.length) return null;
  const withModes = observations.map(r => ({ round: r.round, label: r.modeLabel, price: r.weightedAveragePrice, revenue: r.totalRevenue, profit: r.totalProfit, sold: r.soldTotal }));
  const independent = observations.filter(r => r.mode === 'independent');
  const summit = observations.filter(r => r.mode === 'summit');
  const avg = (rows, key) => rows.length ? Math.round(rows.reduce((s, r) => s + r[key], 0) / rows.length) : null;
  return {
    rounds: withModes,
    independent: { count: independent.length, avgPrice: avg(independent, 'weightedAveragePrice'), avgProfit: avg(independent, 'totalProfit') },
    summit: { count: summit.length, avgPrice: avg(summit, 'weightedAveragePrice'), avgProfit: avg(summit, 'totalProfit') },
    bestRound: [...observations].sort((a,b) => b.totalProfit - a.totalProfit)[0]?.round,
  };
}
