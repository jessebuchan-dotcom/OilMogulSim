'use strict';
const $ = selector => document.querySelector(selector);
const $$ = selector => Array.from(document.querySelectorAll(selector));
const money = n => '$' + Math.round(n).toLocaleString('en-NZ');
const fmt = n => Math.round(n).toLocaleString('en-NZ');
const esc = s => String(s ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const icon = (name) => `<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;
const state = { auth: null, view: null, draft: { production: 35, offer: 35, price: 70 }, lastRenderKey:'', busy:false, polling:false };
const SESSION_KEY = 'global-oil-mogul-current-v1';

async function api(endpoint, payload, blob=false) {
  const r = await fetch('/api/' + endpoint, {
    method:'POST', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify(payload), cache:'no-store'
  });
  if (!r.ok) { let msg = 'The server did not complete your request.'; try { msg = (await r.json()).error || msg; } catch {} throw new Error(msg); }
  return blob ? r.blob() : r.json();
}
function notice(text, isError=false) {
  const target = $('#toast'); target.textContent=text; target.style.background=isError?'#f0a7a0':'#f3c16f';target.hidden=false;
  clearTimeout(notice.timer); notice.timer=setTimeout(()=>target.hidden=true,3900);
}
function entryError(text) { const node=$('#entry-error'); node.hidden=!text;node.textContent=text||''; }
function setTabs(teacher) {
  $('#tab-join').classList.toggle('active', !teacher); $('#tab-teacher').classList.toggle('active',teacher);
  $('#join-form').hidden=teacher;$('#existing-team-form').hidden=true;$('#teacher-entry').hidden=!teacher;entryError('');
}
function setTeacherChoice(login) {
  $('#show-create').classList.toggle('selected',!login);$('#show-login').classList.toggle('selected',login);
  $('#create-form').hidden=login;$('#login-form').hidden=!login;$('#restore-form').hidden=true;entryError('');
}
async function signIn(auth) {
  state.auth = auth;
  localStorage.setItem(SESSION_KEY,JSON.stringify(auth));
  const view = await api('state',cred());
  state.view=view;
  $('#entry').hidden=true;$('#game').hidden=false;
  state.lastRenderKey='';
  if(view.me && view.me.decision) state.draft={...view.me.decision};
  else state.draft={production:35, offer:Math.min(35,(view.me?.inventory||0)+35),price:70};
  render(true);
}
function cred() {
  if (!state.auth) return {};
  const {code,role,teamId,teamToken,adminToken}=state.auth;
  return role === 'teacher' ? {code,adminToken} : {code,teamId,teamToken};
}
function resetSession() {
  state.auth=null;state.view=null;state.lastRenderKey='';localStorage.removeItem(SESSION_KEY);
  $('#entry').hidden=false;$('#game').hidden=true;
}
function isTeacher() { return state.auth?.role === 'teacher'; }
async function refresh(force=false) {
  if (!state.auth || state.polling) return;
  state.polling=true;
  try { state.view=await api('state',cred());render(force); }
  catch (err) {
    if(/authentication|not recognised|room not found/i.test(err.message)){resetSession();entryError('Session expired or room unavailable. Sign in again.');}
    else if(force) notice(err.message,true);
  } finally {state.polling=false;}
}
function render(force=false) {
  const v=state.view;if(!v)return;
  $('#top-code').textContent=v.code;
  $('#header-identity').textContent=isTeacher()?'TEACHER / MARKET CONTROL':v.me?.name||'COMPANY';
  $('#header-colour').style.background=isTeacher()?'#f3b450':v.me?.colour||'#f3b450';
  $('#header-phase').textContent=({lobby:'AWAITING COMPANIES',decision:'EXCHANGE OPEN',results:'ROUND SETTLED',finished:'MARKET CLOSED'})[v.phase];
  $('#header-round').textContent=`ROUND ${String(v.round).padStart(2,'0')} / ${String(v.maxRounds).padStart(2,'0')}`;
  $('#phase-dot').style.background=v.phase==='decision'?'#55d5bc':v.phase==='results'?'#f3b450':'#8da5b4';
  $('#market-message').textContent=({
    lobby:'Companies are joining the oil exchange. Your competition begins when the teacher opens trading.',
    decision:v.roundMode==='summit'?'NEGOTIATION WINDOW: companies may discuss prices and output before submitting.':'INDEPENDENT MARKET: every company sets its own price, production and export offer.',
    results:'Market cleared. View the leaderboard and compare companies before the next round.',
    finished:'The final market results are in. What did price coordination do to company profits?',
  })[v.phase];
  const key=[v.phase,v.round,v.roundMode,v.pendingMode,v.submissions,v.teamCount,v.history.length,
    v.teams.map(t=>t.name+String(t.submitted)).join(','),JSON.stringify(v.me?.decision||null),v.me?.inventory||0].join('|');
  // A student editing sliders is not interrupted when other companies submit.
  const renderKey=isTeacher()?key:[v.phase,v.round,v.roundMode,v.history.length, v.phase==='lobby'?v.teamCount:0,JSON.stringify(v.me?.decision||null),v.me?.inventory||0].join('|');
  if(!force && renderKey===state.lastRenderKey) return;
  const prev=state.lastRenderKey;
  state.lastRenderKey=renderKey;
  // Reset draft only when moving to a genuinely new decision round.
  const changingRound=force||!prev||(!isTeacher()&&state.lastDecisionRound!==v.round);
  if(v.phase==='decision'&&v.me&&changingRound){
    if(v.me.decision)state.draft={...v.me.decision};
    else state.draft={production:35,offer:Math.min(v.me.inventory+35,35),price:70};
  }
  state.lastDecisionRound=v.round;
  const showingResults=['results','finished'].includes(v.phase);
  $('#world-scene').hidden=showingResults;
  $('#results-scene').hidden=!showingResults;
  if(showingResults)renderResults(v);
  else renderWorld(v);
  if(isTeacher())renderTeacher(v);else renderStudent(v);
  renderFooter(v);
}
function renderWorld(v){
  $('#world-note').textContent=v.phase==='lobby'?`${v.teamCount} companies registered. The exchange opens when your teacher starts the round.`
    :v.roundMode==='summit'?'Negotiation permitted. Every company still submits its own confidential decision.'
    :'Competing firms cannot see one another’s prices or offers until the round closes.';
  $('#supply-caption').textContent='MARKET SHARE REVEALED AFTER EACH ROUND';
  $('#market-track').innerHTML='<span class="empty-track">100 BARRELS OF WORLD DEMAND</span>';
  paintDraft();
}
function renderStudent(v){
  const p=$('#sidepanel');
  if(v.phase==='lobby'){
    p.innerHTML=`<div class="panel-head"><div class="panel-overline">YOUR COMPANY</div><h2>${esc(v.me.name)}</h2><p>Registered and ready. The teacher will open the first trading round.</p></div>
      <div class="locked-panel"><div class="locked-icon">${icon('globe')}</div><h3>You're in the market.</h3><p>${v.teamCount} of ${v.maxTeams} available company places filled. You will compete for a total of 100 barrels of demand each round.</p><div class="company-access"><small>PRIVATE COMPANY ACCESS CODE</small><div class="invite-code">${esc(v.me.joinCode)}</div><p class="helper-note">Share this with classmates who are joining your company on another device. They will also need the classroom room code.</p></div><div class="callout">No firm can see its rivals’ decisions before the market closes. Make your own strategy.</div></div>`;
    return;
  }
  if(v.phase==='decision'){
    const d=state.draft;
    p.innerHTML=`<div class="panel-head"><div class="panel-overline">02 / YOUR TRADING DESK</div><h2>Make your move.</h2><p>Choose what to produce, what to charge and how much oil to offer the world market.</p></div>
      <div class="panel-body">
        <div class="control-group" id="production-group"><div class="control-top"><label for="production-slider">${icon('oil')} Oil production</label><span class="control-value" id="production-value">${d.production}<small> BBL</small></span></div><div class="control-hint">Barrels pumped this round. Production costs $${v.rules.productionCost} per barrel.</div><input type="range" class="range" id="production-slider" min="0" max="${v.rules.maxProduction}" step="1" value="${d.production}" aria-label="Barrels to produce"><div class="range-labels"><span>0 BARRELS</span><span>${v.rules.maxProduction} BARRELS / ROUND</span></div></div>
        <div class="control-group" id="price-group"><div class="control-top"><label for="price-slider">${icon('trend')} Selling price</label><span class="control-value" id="price-value">$${d.price}</span></div><div class="control-hint">Price per barrel. A cheaper rival may attract more buyers.</div><input type="range" class="range" id="price-slider" min="${v.rules.minPrice}" max="${v.rules.maxPrice}" step="1" value="${d.price}" aria-label="Price per barrel"><div class="range-labels"><span>$${v.rules.minPrice}</span><span>$${v.rules.maxPrice}</span></div></div>
        <div class="control-group" id="offer-group"><div class="control-top"><label for="offer-slider">${icon('ship')} Barrels offered</label><span class="control-value" id="offer-value">${d.offer}<small> BBL</small></span></div><div class="control-hint">How many barrels you are willing to sell. Sales depend on demand and rival prices.</div><input type="range" class="range" id="offer-slider" min="0" max="${v.me.inventory+d.production}" step="1" value="${d.offer}" aria-label="Barrels offered for sale"><div class="range-labels"><span>0 OFFERED</span><span id="offer-max">${v.me.inventory+d.production} AVAILABLE</span></div>
        <div class="control-detail"><span>Available stock, including new production</span><strong id="available-value">${v.me.inventory+d.production} BBL</strong></div></div>
        <div class="submit-summary"><div class="summary-tile"><span>PRODUCTION COST</span><strong id="cost-preview">${money(d.production*v.rules.productionCost)}</strong></div><div class="summary-tile"><span>MAX SALES REVENUE*</span><strong id="revenue-preview">${money(d.offer*d.price)}</strong></div></div>
        ${v.me.submittedAt?'<div class="callout">Decision submitted. You can still change it before your teacher closes the market.</div>':''}<div class="helper-note">Company access code: <strong>${esc(v.me.joinCode)}</strong> · Share privately with teammates on other devices.</div>
        <button type="button" id="submit-decision" class="primary-btn submit-btn">${v.me.submittedAt?'UPDATE YOUR DECISION':'SUBMIT TO WORLD MARKET'} <span>↗</span></button>
        <p class="helper-note">*Maximum if every barrel offered is sold. Actual sales are determined when the round closes.</p>
      </div>`;
    for(const key of ['production','price','offer']){
      const slider=$(`#${key}-slider`);
      slider.addEventListener('input',()=>{
        if(key==='production'){
          const oldMax=v.me.inventory+state.draft.production;
          const wasAll=state.draft.offer===oldMax;
          state.draft.production=Number(slider.value);
          const newMax=v.me.inventory+state.draft.production;
          state.draft.offer=wasAll?newMax:Math.min(state.draft.offer,newMax);
        } else state.draft[key]=Number(slider.value);
        paintDraft();
      });
    }
    $('#submit-decision').addEventListener('click',sendDecision);
    paintDraft();
    return;
  }
  if(v.phase==='results'){
    const mine=v.results?.entries.find(e=>e.teamId===v.me.id);
    const rank=v.results?.entries.findIndex(e=>e.teamId===v.me.id)+1;
    p.innerHTML=`<div class="panel-head"><div class="panel-overline">YOUR ROUND ${String(v.round).padStart(2,'0')} RESULT</div><h2>Your performance.</h2><p>See exactly what the world bought, and what stayed in your storage tanks.</p></div><div class="panel-body">
      <div class="panel-stat"><span>Leaderboard position</span><strong class="gold">#${rank}</strong></div>
      <div class="panel-stat"><span>Oil sold</span><strong>${mine?.sold??0} / 100 <small>BBL</small></strong></div>
      <div class="panel-stat"><span>Market share</span><strong>${mine?.share??0}%</strong></div>
      <div class="panel-stat"><span>Sales revenue</span><strong class="mint">${money(mine?.revenue??0)}</strong></div>
      <div class="panel-stat"><span>Round profit</span><strong class="${(mine?.profit??0)>=0?'mint':'red'}">${money(mine?.profit??0)}</strong></div>
      <div class="panel-stat"><span>Oil remaining in storage</span><strong>${mine?.inventory??0} BBL</strong></div>
      <div class="callout">${mine?.sold < mine?.offered?'Some of your offered oil did not sell. Consider why buyers preferred other producers.':'Your entire offer was sold. Could a different price have earned more per barrel?'}</div>
      <div class="helper-note">Production: ${money(mine?.productionCost??0)} · Holding: ${money(mine?.storageCost??0)} · Fixed costs: ${money(mine?.fixedCost??0)}.</div>
      <div class="locked-panel" style="padding:9px 0"><div class="locked-icon">${icon('lock')}</div><p>The next round begins when your teacher reopens trading.</p></div>
    </div>`;return;
  }
  p.innerHTML=`<div class="panel-head"><div class="panel-overline">FINAL PERFORMANCE</div><h2>${esc(v.me.name)}</h2><p>The game has ended. Compare your results with the entire market.</p></div><div class="panel-body">
    <div class="panel-stat"><span>Total revenue</span><strong class="mint">${money(v.me.totalRevenue)}</strong></div>
    <div class="panel-stat"><span>Total profit</span><strong class="${v.me.totalProfit>=0?'mint':'red'}">${money(v.me.totalProfit)}</strong></div>
    <div class="panel-stat"><span>Barrels sold throughout the game</span><strong>${v.me.totalSold}</strong></div>
    <div class="panel-stat"><span>Closing stock</span><strong>${v.me.inventory} BBL</strong></div>
    <div class="callout"><strong>THE BIG QUESTION</strong><p style="margin-top:7px">Did companies collectively make more money when they competed aggressively, or when they reached an understanding about prices?</p></div>
    <div class="helper-note">Collusion between competitors can harm consumers and is prohibited by competition law in many jurisdictions. This game is a classroom model.</div></div>`;
}
function paintDraft(){
  const d=state.draft;const v=state.view;
  if(!v||isTeacher()){
    $('#map-production').innerHTML='— <span>BARRELS</span>';$('#map-offer').innerHTML='— <span>OFFERED</span>';$('#map-price').innerHTML='— <span>/ BARREL</span>';return;
  }
  $('#map-production').innerHTML=`${d.production} <span>BARRELS</span>`;
  $('#map-offer').innerHTML=`${d.offer} <span>OFFERED</span>`;
  $('#map-price').innerHTML=`$${d.price} <span>/ BARREL</span>`;
  const sliders={production:$('#production-slider'),price:$('#price-slider'),offer:$('#offer-slider')};
  if(!sliders.production)return;
  const available=v.me.inventory+d.production;
  sliders.offer.max=available;
  d.offer=Math.min(d.offer,available);
  for(const [k,s] of Object.entries(sliders)){
    s.value=d[k];const min=Number(s.min),max=Number(s.max);
    s.style.setProperty('--pct',`${max>min?100*(d[k]-min)/(max-min):0}%`);
  }
  $('#production-value').innerHTML=`${d.production}<small> BBL</small>`;
  $('#price-value').textContent='$'+d.price;
  $('#offer-value').innerHTML=`${d.offer}<small> BBL</small>`;
  $('#offer-max').textContent=`${available} AVAILABLE`;
  $('#available-value').textContent=available+' BBL';
  $('#cost-preview').textContent=money(d.production*v.rules.productionCost);
  $('#revenue-preview').textContent=money(d.offer*d.price);
}
async function sendDecision(){
  if(state.busy)return;state.busy=true;
  const btn=$('#submit-decision');if(btn)btn.disabled=true;
  try {
    state.view=await api('submit',{...cred(),decision:state.draft});
    state.lastRenderKey='';render(true);notice('Decision sealed. You can revise it until trading closes.');
  }catch(err){notice(err.message,true);}finally{state.busy=false;if(btn)btn.disabled=false;}
}
function renderResults(v){
  const r=v.results;
  if(!r){$('#results-scene').innerHTML='<h2>There are no settled rounds yet.</h2>';return;}
  const mine=v.me?.id;
  const table=r.entries.map((e,i)=>`<tr class="${mine===e.teamId?'mine':''}"><td><strong style="color:${i===0?'#f3bd62':'#92a8b7'}">${String(i+1).padStart(2,'0')}</strong></td><td><div class="firm-label"><span class="team-swatch" style="background:${esc(e.colour)}"></span><span><strong>${esc(e.teamName)}</strong></span></div></td><td>${money(e.price)}</td><td>${e.sold} BBL</td><td><div class="share-cell"><strong>${e.share}%</strong><div class="share-meter"><span style="background:${esc(e.colour)};width:${e.share}%"></span></div></div></td><td><strong>${money(e.revenue)}</strong><div class="profitline">Profit: ${money(e.profit)}</div></td></tr>`).join('');
  let html=`<div class="score-title"><div><span class="section-overline">ROUND ${String(r.round).padStart(2,'0')} / MARKET CLEARED</span><h2>${v.phase==='finished'?'THE FINAL MARKET':'THE LEADERBOARD'}</h2></div><p>${r.mode==='summit'?'NEGOTIATION PERMITTED':'INDEPENDENT DECISIONS'}</p></div>
    <div class="score-metrics"><div class="score-metric"><small>BARRELS SOLD / 100</small><strong>${r.soldTotal}<span style="font-size:14px;color:#91aeba"> / 100</span></strong></div><div class="score-metric"><small>WORLD SALES REVENUE</small><strong style="color:var(--mint)">${money(r.totalRevenue)}</strong></div><div class="score-metric"><small>AVERAGE PRICE PAID</small><strong>${money(r.weightedAveragePrice)}<span style="font-size:12px;color:#91aeba"> / BBL</span></strong></div></div>
    <table class="score-table"><thead><tr><th>#</th><th>COMPANY</th><th>PRICE</th><th>BARRELS</th><th>WORLD SHARE</th><th>ROUND REVENUE</th></tr></thead><tbody>${table}</tbody></table>
    <div class="score-notes">Market demand: 100 barrels · Unfilled demand: ${r.unmetDemand} barrels · Total combined round profit: ${money(r.totalProfit)} · Ranked by round revenue</div>`;
  if(v.phase==='finished') html+=renderAnalysis(v);
  else if(v.history.length>1)html+=`<div class="analyse-heading"><h3>Previous rounds</h3><span class="section-overline">WORLD REVENUE / PRICE</span></div><div class="round-history">${v.history.map(h=>`<div class="round-bar"><small>R${h.round} · ${h.mode==='summit'?'SUMMIT':'INDEPENDENT'}</small><strong>${money(h.totalRevenue)}</strong><div class="thin-track"><span style="width:${Math.min(100,h.weightedAveragePrice/120*100)}%"></span></div></div>`).join('')}</div>`;
  $('#results-scene').innerHTML=html;
}
function renderAnalysis(v){
  const a=v.analysis;if(!a)return '';
  const independent=a.independent, summit=a.summit;
  const difference=independent.count&&summit.count?Math.round(summit.avgProfit-independent.avgProfit):null;
  const verdict=difference===null?'Your class did not play both independent and negotiation rounds, so there is no direct comparison. You can still analyse how price differences affected market share and profits.'
    :difference>0?`During negotiation-permitted rounds, combined market profit averaged ${money(difference)} MORE per round than during independent rounds.`
    :difference<0?`During negotiation-permitted rounds, combined market profit averaged ${money(-difference)} LESS per round. Negotiation alone did not create an effective cartel.`
    :'Combined profits were the same across both types of round. What strategies explain this?';
  return `<div class="analyse-heading"><h3>MARKET INTELLIGENCE / THE REVEAL</h3><span class="section-overline">${v.history.length} ROUNDS ANALYSED</span></div>
    <div class="score-metrics"><div class="score-metric"><small>INDEPENDENT / AVG PROFIT</small><strong>${independent.count?money(independent.avgProfit):'—'}</strong></div><div class="score-metric"><small>NEGOTIATION / AVG PROFIT</small><strong>${summit.count?money(summit.avgProfit):'—'}</strong></div><div class="score-metric"><small>MOST PROFITABLE ROUND</small><strong>ROUND ${a.bestRound}</strong></div></div>
    <div class="insight"><h3>THE OIL CARTEL EXPERIMENT</h3>${verdict}<p style="margin-top:8px">When competing producers agree to restrict output or maintain higher prices, their combined profits can increase at consumers’ expense. But any one producer may be tempted to undercut the others. This is why cartels can be profitable, unstable and anti-competitive.</p></div>
    <div class="end-questions"><div><span>01</span>What happened to revenue when several firms cut their prices?</div><div><span>02</span>Who benefited from high prices? Who would lose in a real economy?</div><div><span>03</span>Why might one firm secretly break a cartel agreement?</div><div><span>04</span>Why do governments investigate and prohibit price-fixing?</div></div>`;
}
function renderTeacher(v){
  const p=$('#sidepanel');const mode=v.pendingMode;
  const companies=v.teams.map(t=>`<div class="team-item"><span class="team-swatch" style="background:${esc(t.colour)}"></span><span class="team-name">${esc(t.name)}</span><span class="team-status ${t.submitted?'ready':''}">${t.submitted?'SEALED':t.isDemo?'PRACTICE':'PENDING'}</span>${v.phase==='lobby'?`<button type="button" class="remove-team" data-remove="${esc(t.id)}" aria-label="Remove ${esc(t.name)}">×</button>`:''}</div>`).join('');
  let controls='';
  if(v.phase==='lobby')controls=`<div class="callout">Invite teams using room code <strong>${esc(v.code)}</strong>. Each company joins on a single device and chooses a company name.</div><button type="button" data-command="next" class="primary-btn big">OPEN ROUND 01 <span>↗</span></button><div class="control-row"><button type="button" data-command="demo" class="secondary-btn">ADD 3 PRACTICE FIRMS</button><button type="button" data-command="clear-demo" class="secondary-btn">REMOVE PRACTICE FIRMS</button></div>`;
  if(v.phase==='decision')controls=`<div class="panel-stat"><span>Companies submitted</span><strong class="gold">${v.submissions} / ${v.teamCount}</strong></div><button type="button" data-command="resolve" class="primary-btn big">CLOSE MARKET & REVEAL RESULTS <span>↗</span></button>${v.teams.some(t=>t.isDemo)?'<button type="button" data-command="demo-submit" class="secondary-btn">SUBMIT PRACTICE FIRMS</button>':''}<div class="helper-note">Unsubmitted companies produce nothing and offer nothing this round. Submitted decisions remain hidden from competitors until settlement.</div>`;
  if(v.phase==='results')controls=`<div class="callout">Round ${v.round} has cleared. Project the leaderboard for your students, then select the next market format.</div>${v.round<v.maxRounds?`<button type="button" data-command="next" class="primary-btn big">START ROUND ${String(v.round+1).padStart(2,'0')} <span>↗</span></button>`:'<div class="helper-note">All scheduled rounds are complete. Reveal the market findings.</div>'}<button type="button" data-command="finish" class="secondary-btn">END GAME & REVEAL THE LESSON</button>`;
  if(v.phase==='finished')controls=`<div class="callout"><strong>THE TEACHING REVEAL</strong><p style="margin-top:6px">Use the market data to distinguish private incentives, collective profits and the consumer impact of price-fixing. If producers broke an agreement, discuss the incentive to cheat.</p></div><button type="button" data-command="restart" class="secondary-btn">RESTART WITH THE SAME COMPANIES</button>`;
  const chooseMode=['lobby','results'].includes(v.phase)&&v.round<v.maxRounds?
    `<div class="small-divider"></div><div class="panel-overline">NEXT ROUND / MARKET RULES</div><div class="mode-toggle"><button type="button" data-mode="independent" class="mode-option ${mode==='independent'?'selected':''}">INDEPENDENT<br>NO NEGOTIATION</button><button type="button" data-mode="summit" class="mode-option ${mode==='summit'?'selected':''}">OIL SUMMIT<br>NEGOTIATION ALLOWED</button></div><div class="helper-note">The Summit allows firms to discuss their intentions in class. The game never enforces agreements.</div>`:'';
  p.innerHTML=`<div class="panel-head"><div class="panel-overline">TEACHER / EXCHANGE CONTROL</div><h2>Control room.</h2><p>Manage participation and control when every trading round begins and ends.</p></div>
    <div class="panel-body"><div><div class="panel-overline">ROOM CODE / JOIN ANY DEVICE</div><div class="room-code-large">${esc(v.code)}</div><button id="copy-teacher-link" class="secondary-btn" type="button">COPY STUDENT JOIN LINK</button></div>
    <div class="small-divider"></div><div class="panel-overline">COMPANIES IN THE MARKET / ${v.teamCount}</div><div class="team-list">${companies||'<p class="helper-note">Waiting for the first company to join.</p>'}</div>
    ${chooseMode}${controls}<div class="small-divider"></div>
    <div class="control-row"><button type="button" id="export-csv" class="secondary-btn" ${v.history.length?'':'disabled'}>EXPORT ROUND DATA (.CSV)</button><button type="button" id="export-backup" class="secondary-btn">SAVE SESSION BACKUP</button></div>
    <div class="helper-note">AI Studio session storage is temporary. Save a private backup after every round to recover from a server restart.</div>
    ${v.phase==='lobby'?'<div class="helper-note">For a class of 28, create roughly 5–8 companies and have students work in teams.</div>':''}
    </div>`;
  p.querySelectorAll('[data-command]').forEach(el=>el.addEventListener('click',()=>teacherCommand(el.dataset.command)));
  p.querySelectorAll('[data-remove]').forEach(el=>el.addEventListener('click',()=>teacherCommand('remove',null,el.dataset.remove)));
  p.querySelectorAll('[data-mode]').forEach(el=>el.addEventListener('click',()=>teacherCommand('mode',el.dataset.mode)));
  $('#copy-teacher-link')?.addEventListener('click',copyRoom);
  $('#export-csv')?.addEventListener('click',downloadCsv);
  $('#export-backup')?.addEventListener('click',downloadBackup);
}
function renderFooter(v){
  const f=$('#footer');
  if(isTeacher()){
    f.innerHTML=`<div class="foot-stat"><small>ROOM</small><strong style="color:var(--gold)">${esc(v.code)}</strong></div><div class="footer-sep"></div><div class="foot-stat"><small>ACTIVE COMPANIES</small><strong>${v.teamCount}</strong></div><div class="footer-sep"></div><div class="foot-stat"><small>DECISIONS SUBMITTED</small><strong>${v.submissions} / ${v.teamCount}</strong></div><div class="footer-sep"></div><div class="foot-stat"><small>MARKET DEMAND</small><strong>100 BBL</strong></div><div class="footer-hint">Teacher-controlled rounds · Private bidding · Live leaderboard</div>`;
  }else{
    const m=v.me||{};
    f.innerHTML=`<div class="foot-stat"><small>YOUR STOCK</small><strong>${fmt(m.inventory||0)} BBL</strong></div><div class="footer-sep"></div><div class="foot-stat"><small>COMPANY CASH</small><strong>${money(m.cash||0)}</strong></div><div class="footer-sep"></div><div class="foot-stat"><small>GAME REVENUE</small><strong>${money(m.totalRevenue||0)}</strong></div><div class="footer-sep"></div><div class="foot-stat"><small>GAME PROFIT</small><strong style="color:${m.totalProfit>=0?'var(--mint)':'var(--red)'}">${money(m.totalProfit||0)}</strong></div><div class="footer-hint">${v.phase==='decision'?'Only your final submission counts when the teacher closes the market.':'100 barrels of world demand each round.'}</div>`;
  }
}
async function teacherCommand(command,mode,teamId) {
  if(state.busy)return;
  if(command==='restart' && !window.confirm('Restart the entire simulation and clear every round result? Companies will remain registered.'))return;
  if(command==='remove' && !window.confirm('Remove this company from the lobby?'))return;
  state.busy=true;
  try{
    const payload={...cred(),command};if(mode)payload.mode=mode;if(teamId)payload.teamId=teamId;if(command==='restart')payload.confirm='RESTART';
    state.view=await api('admin',payload);state.lastRenderKey='';render(true);
    notice(({next:'New trading round opened.',resolve:'Market settled. Leaderboard is live!',mode:'Next round setting updated.',finish:'Final debrief revealed.',restart:'New game ready.',demo:'Practice firms added.','clear-demo':'Practice firms removed.', 'demo-submit':'Practice bids submitted.',remove:'Company removed.'})[command]||'Updated.');
  }catch(err){notice(err.message,true);}finally{state.busy=false;}
}
async function downloadCsv(){
  try{
    const blob=await api('export',cred(),true);
    const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`global-oil-mogul-${state.view.code}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),2000);
  }catch(err){notice(err.message,true);}
}
async function downloadBackup(){
  try{
    const blob=await api('backup',cred(),true);
    const url=URL.createObjectURL(blob),a=document.createElement('a');
    a.href=url; a.download=`global-oil-mogul-backup-${state.view.code}.json`;
    a.click();setTimeout(()=>URL.revokeObjectURL(url),2000);
    notice('Session backup saved. Keep this private.');
  }catch(err){notice(err.message,true);}
}
async function copyRoom(){
  if(!state.view)return;
  const link=`${location.origin}${location.pathname}?code=${state.view.code}`;
  try{await navigator.clipboard.writeText(link);notice('Student join link copied.');}
  catch {notice('Room code: '+state.view.code+' · Share this code with students.');}
}
function focusFacility(which){
  const element=$(`#${which}-slider`);
  if(element){ element.focus({preventScroll:true});
    $$('.facility').forEach(f=>f.classList.remove('focused'));
    $('#facility-'+({production:'field',offer:'dock',price:'price'})[which])?.classList.add('focused');
    setTimeout(()=>$$('.facility').forEach(f=>f.classList.remove('focused')),1200);
  }else if(!isTeacher())notice('Your trading desk opens when the round begins.');
}
async function initialise() {
  $('#tab-join').addEventListener('click',()=>setTabs(false));
  $('#tab-teacher').addEventListener('click',()=>setTabs(true));
  $('#show-create').addEventListener('click',()=>setTeacherChoice(false));
  $('#show-login').addEventListener('click',()=>setTeacherChoice(true));
  $('#show-restore').addEventListener('click',()=>{$('#login-form').hidden=true;$('#restore-form').hidden=false;entryError('');});
  $('#back-to-login').addEventListener('click',()=>{$('#restore-form').hidden=true;$('#login-form').hidden=false;entryError('');});
  $('#restore-form').addEventListener('submit',async e=>{
    e.preventDefault();entryError('');const btn=e.currentTarget.querySelector('button[type=submit]');btn.disabled=true;
    try{
      const file=$('#restore-file').files?.[0];if(!file)throw new Error('Select a session backup file.');
      if(file.size>1300000)throw new Error('The backup is too large.');
      let backup;try{backup=JSON.parse(await file.text());}catch{throw new Error('The selected file is not valid JSON.');}
      const r=await api('restore',{backup,password:$('#restore-password').value});
      await signIn({...r,role:'teacher'});notice('Your saved market has been restored.');
    }catch(err){entryError(err.message);}finally{btn.disabled=false;}
  });
  $('#show-existing-team').addEventListener('click',()=>{$('#join-form').hidden=true;$('#existing-team-form').hidden=false;entryError('');});
  $('#back-to-new-team').addEventListener('click',()=>{$('#existing-team-form').hidden=true;$('#join-form').hidden=false;entryError('');});
  $('#existing-team-form').addEventListener('submit',async e=>{
    e.preventDefault();entryError('');const btn=e.currentTarget.querySelector('button[type=submit]');btn.disabled=true;
    try{const r=await api('join-existing',{code:$('#existing-room').value.toUpperCase(),accessCode:$('#existing-access').value.toUpperCase()});await signIn({...r,role:'team'});}
    catch(err){entryError(err.message);}finally{btn.disabled=false;}
  });
  $('#join-form').addEventListener('submit',async e=>{
    e.preventDefault();entryError('');
    const btn=e.currentTarget.querySelector('button[type=submit]');btn.disabled=true;
    try{
      const r=await api('join',{code:$('#join-code').value.toUpperCase(),name:$('#join-name').value});
      await signIn({...r,role:'team'});
    }catch(err){entryError(err.message);}finally{btn.disabled=false;}
  });
  $('#create-form').addEventListener('submit',async e=>{
    e.preventDefault();entryError('');const btn=e.currentTarget.querySelector('button[type=submit]');btn.disabled=true;
    try{
      const r=await api('create',{password:$('#create-password').value,maxRounds:Number($('#create-rounds').value)});
      await signIn({...r,role:'teacher'});
    }catch(err){entryError(err.message);}finally{btn.disabled=false;}
  });
  $('#login-form').addEventListener('submit',async e=>{
    e.preventDefault();entryError('');const btn=e.currentTarget.querySelector('button[type=submit]');btn.disabled=true;
    try{
      const r=await api('admin-login',{code:$('#login-code').value.toUpperCase(),password:$('#login-password').value});
      await signIn({...r,role:'teacher'});
    }catch(err){entryError(err.message);}finally{btn.disabled=false;}
  });
  $('#leave-btn').addEventListener('click',()=>{if(window.confirm('Exit this market view? Refresh this browser page to resume your saved session.')){$('#entry').hidden=false;$('#game').hidden=true;state.auth=null;state.view=null;state.lastRenderKey='';}});
  $('#copy-room').addEventListener('click',copyRoom);
  ['production','offer','price'].forEach(which=>{
    const label={production:'field',offer:'dock',price:'price'}[which],el=$('#facility-'+label);
    el.addEventListener('click',()=>focusFacility(which));
    el.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();focusFacility(which);}});
  });
  const q=new URLSearchParams(location.search).get('code');if(q){$('#join-code').value=q.toUpperCase().slice(0,5);$('#login-code').value=q.toUpperCase().slice(0,5);$('#existing-room').value=q.toUpperCase().slice(0,5);}
  let restored=null;try{restored=JSON.parse(localStorage.getItem(SESSION_KEY)||'null');}catch{}
  if(restored&&restored.code&&restored.role){try{await signIn(restored);}catch{resetSession();}}
  setInterval(()=>refresh(),1800);
}
initialise();
