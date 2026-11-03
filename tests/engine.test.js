import test from 'node:test';
import assert from 'node:assert/strict';
import { allocateMarket, validateDecision, settleRound, RULES, marketAnalysis } from '../engine.js';

const makeTeam = (id, name) => ({ id, name, colour:'#fff', inventory:0, cash:2000, totalRevenue:0, totalProfit:0, totalSold:0, submittedAt:'now',decision:null });

test('market never allocates more than 100 barrels', () => {
  const r = allocateMarket(Array.from({length:12}, (_,i)=>({id:String(i),price:45+i*5,offer:70})));
  assert.equal(r.reduce((a,b)=>a+b,0),100);
  assert.ok(r.every(n=>Number.isInteger(n) && n>=0 && n<=70));
});

test('available supply caps sales; unfilled demand remains unfilled', () => {
  const r = allocateMarket([{id:'a',price:30,offer:10},{id:'b',price:120,offer:20}]);
  assert.deepEqual(r,[10,20]);
});

test('lower prices capture more sales when offers are equal', () => {
  const r = allocateMarket([{id:'a',price:40,offer:70},{id:'b',price:95,offer:70},{id:'c',price:95,offer:70}]);
  assert.equal(r.reduce((a,b)=>a+b,0),100);
  assert.ok(r[0]>r[1] && r[0]>r[2]);
});

test('a high-price cartel earns more combined profit than a price war', () => {
  const run = price => {
    const room={phase:'decision',round:1,roundMode:'independent',history:[],teams:['A','B','C','D'].map((name,i)=>{
      const t=makeTeam(String(i),name);t.decision={production:25,offer:25,price};return t;
    })};
    return settleRound(room);
  };
  const high=run(100), low=run(40);
  assert.equal(high.soldTotal,100);assert.equal(low.soldTotal,100);
  assert.ok(high.totalProfit>low.totalProfit);
});

test('each firm can gain individually from modest undercutting cartel prices', () => {
  const base = allocateMarket(['A','B','C','D'].map(id=>({id,price:100,offer:70})));
  const cheat = allocateMarket(['A','B','C','D'].map((id,i)=>({id,price:i===0?90:100,offer:70})));
  assert.ok(cheat[0]*90 > base[0]*100, `cheating revenues ${cheat[0]*90} versus ${base[0]*100}`);
});

test('offers cannot exceed inventory + production; bounded inputs', () => {
  assert.deepEqual(validateDecision({production:80,price:400,offer:400},4),{production:70,price:120,offer:74});
  assert.deepEqual(validateDecision({production:0,price:30,offer:99},0),{production:0,price:30,offer:0});
  assert.throws(()=>validateDecision({production:'not a number',price:50,offer:20},0));
});

test('unsold oil carries into next round; profit charges actual production', () => {
  const t=makeTeam('t','T');t.decision={production:60,price:120,offer:20};
  const room={phase:'decision',round:1,roundMode:'independent',history:[],teams:[t]};
  const r=settleRound(room);
  assert.equal(r.entries[0].sold,20);assert.equal(t.inventory,40);
  assert.equal(r.entries[0].productionCost,60*RULES.productionCost);
  assert.equal(r.entries[0].profit,20*120-60*28-40*2-RULES.fixedCost);
  assert.equal(room.phase,'results');
});

test('final analysis does not invent collusion benefits when none are observed', () => {
  assert.equal(marketAnalysis([]),null);
  const a=marketAnalysis([{round:1,mode:'independent',modeLabel:'Independent decisions',soldTotal:100,weightedAveragePrice:40,totalRevenue:4000,totalProfit:500}]);
  assert.equal(a.independent.count,1);assert.equal(a.summit.count,0);assert.equal(a.summit.avgProfit,null);
});
