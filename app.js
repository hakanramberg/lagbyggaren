'use strict';
const $ = s => document.querySelector(s);
const { POSITIONS, levels } = TeamStore;
const LOCAL_KEY = 'ankaret-lagbyggaren-v2';
const shared = window.LAGBYGGAREN_CONFIG?.shared === true;
let state = TeamStore.initial(), me = 'local', owner = true, token = '', draft = null, reviewId = null, busy = false, timer;
let selected = new Set(), selectionKnown = new Set();
let editorPrevious = null;
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = n => Number(n).toLocaleString('sv-SE', { maximumFractionDigits: 2 });
const uid = () => crypto.randomUUID();
function notice(message) { $('#notice').textContent = message; clearTimeout(timer); timer = setTimeout(() => $('#notice').textContent = '', 7000); }
function download(data, name) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function tab(name) {
  document.querySelectorAll('.view').forEach(el => el.hidden = el.id !== name + 'View');
  document.querySelectorAll('.tab').forEach(el => { el.classList.toggle('is-active', el.dataset.tab === name); el.setAttribute('aria-current', el.dataset.tab === name ? 'page' : 'false'); });
}
function acceptEnvelope(data) {
  state = data.state; me = data.me; owner = data.owner;
  for (const p of state.players) if (!selectionKnown.has(p.id)) { selected.add(p.id); selectionKnown.add(p.id); }
  selected = new Set([...selected].filter(id => state.players.some(p => p.id === id)));
  $('#connection').textContent = shared ? `● Delad trupp · ${state.coaches.find(c => c.id === me)?.name || 'Tränare'} · Synkroniserad` : '● Sparas i den här webbläsaren · Gemensam synkronisering är inte ansluten';
  $('#login').hidden = true; $('#appcontent').hidden = false;
  render();
}
async function api(path, body) {
  const response = await fetch('/api/' + path, { method: body ? 'POST' : 'GET', headers: { Authorization: 'Bearer ' + token, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify({ ...body, version: state.version }) } : {}), signal: AbortSignal.timeout(12000) });
  const data = await response.json();
  if (response.status === 401) { $('#login').hidden = false; $('#appcontent').hidden = true; $('#connection').textContent = 'Logga in med din personliga tränarlänk.'; }
  if (!response.ok) { if (data.state) acceptEnvelope(data); throw new Error(data.error || 'Kunde inte hämta uppgifterna.'); }
  return data;
}
async function act(type, data) {
  if (busy) { notice('Vänta tills den pågående ändringen har sparats.'); return false; }
  busy = true;
  try {
    if (shared) acceptEnvelope(await api('action', { action: { type, data } }));
    else {
      const next = TeamStore.apply(state, { type, data }, me, uid());
      localStorage.setItem(LOCAL_KEY, JSON.stringify(next));
      acceptEnvelope({ state: next, me, owner: true });
    }
    return true;
  } catch (error) { notice(error.message); return false; }
  finally { busy = false; }
}
function render() {
  renderPlayers(); renderLists(); renderCoaches();
  $('#historycount').textContent = state.proposals.filter(p => p.status === 'accepted').length;
  $('#reviewcount').textContent = state.proposals.filter(p => p.status === 'review').length;
  $('#rotationhelp').textContent = state.proposals.some(p => p.status === 'accepted') ? 'De tio senast accepterade tillfällena används. Nyliga lag väger tyngst. Positioner och nivå vägs också in.' : 'När ni har sparat accepterade lag används de här för att prioritera nya lagkamrater.';
  if (reviewId && $('#reviewdialog').open) showReview(reviewId, true);
}
function renderPlayers() {
  const active = state.players.filter(p => selected.has(p.id));
  $('#total').textContent = state.players.length; $('#selected').textContent = active.length;
  $('#keepers').textContent = active.filter(p => p.first === 'MV' || p.second === 'MV').length;
  const search = $('#search').value.toLocaleLowerCase('sv');
  const shown = state.players.filter(p => p.name.toLocaleLowerCase('sv').includes(search));
  $('#players').innerHTML = shown.length ? shown.map(p => `<div class="player"><input type="checkbox" data-active="${esc(p.id)}" ${selected.has(p.id) ? 'checked' : ''} aria-label="Välj ${esc(p.name)}"><div class="avatar">${esc(p.name.split(' ').map(x => x[0] || '').join('').slice(0, 2))}</div><div class="info"><b>${esc(p.name)}</b><small>${esc(POSITIONS[p.first])}${p.second ? ' · ' + esc(POSITIONS[p.second]) : ''}</small></div><span class="badge">${num(p.level)}</span><button data-edit="${esc(p.id)}" aria-label="Redigera ${esc(p.name)}">Ändra</button><button data-delete="${esc(p.id)}" aria-label="Ta bort ${esc(p.name)}">×</button></div>`).join('') : `<div class="empty">${state.players.length ? 'Ingen spelare matchar sökningen.' : 'Lägg till dina spelare för att komma igång.'}</div>`;
}
function options(empty = false) { return (empty ? '<option value="">Ingen andra position</option>' : '') + Object.entries(POSITIONS).map(([v, n]) => `<option value="${v}">${n} (${v})</option>`).join(''); }
$('#first').innerHTML = options(); $('#second').innerHTML = options(true);
$('#level').innerHTML = levels.map(n => `<option value="${n}">${num(n)}</option>`).join('');
function edit(id) {
  const p = state.players.find(p => p.id === id);
  editorPrevious = p ? structuredClone(p) : null;
  $('#editortitle').textContent = p ? 'Redigera spelare' : 'Ny spelare'; $('#playerid').value = p?.id || '';
  $('#name').value = p?.name || ''; $('#first').value = p?.first || 'M9'; $('#second').value = p?.second || ''; $('#level').value = p?.level || 2;
  $('#editor').showModal(); $('#name').focus();
}
function invalidate() {
  if (draft) notice('Inställningarna har ändrats. Skapa ett nytt förslag för att använda dem.');
  draft = null; $('#print').hidden = true; $('#draftactions').hidden = true;
  $('#output').className = 'empty'; $('#output').textContent = 'Välj spelare och skapa ett lagförslag.';
}
$('#add').onclick = () => edit(); $('#close').onclick = () => $('#editor').close();
$('#playerform').onsubmit = async e => {
  e.preventDefault();
  const p = { id: $('#playerid').value || uid(), name: $('#name').value.trim(), first: $('#first').value, second: $('#second').value, level: +$('#level').value };
  if (await act('player.save', { ...p, previous: editorPrevious })) { invalidate(); $('#editor').close(); }
};
$('#players').onchange = e => { const id = e.target.dataset.active; if (!id) return; e.target.checked ? selected.add(id) : selected.delete(id); renderPlayers(); invalidate(); };
$('#players').onclick = async e => {
  const { edit: id, delete: del } = e.target.dataset;
  if (id) edit(id);
  if (del) { const p = state.players.find(p => p.id === del); if (confirm(`Ta bort ${p.name} från truppen? Sparade lag bevaras.`) && await act('player.delete', { id: del })) invalidate(); }
};
$('#search').oninput = renderPlayers;
$('#all').onclick = () => { selected = new Set(state.players.map(p => p.id)); renderPlayers(); invalidate(); };
$('#none').onclick = () => { selected.clear(); renderPlayers(); invalidate(); };
function slotsRender(values) {
  const slots = values || ($('#format').value === '6' ? ['V6', 'V9', 'M9', 'H9', 'H6', 'M6'] : ['V6', 'M9', 'H6', 'M6']);
  $('#slots').innerHTML = slots.map((s, i) => `<label>Plats ${i + 1}<select class="slot">${options()}</select></label>`).join('');
  document.querySelectorAll('.slot').forEach((el, i) => { el.querySelector('[value="MV"]').remove(); el.value = slots[i]; el.onchange = invalidate; });
}
function targetsRender(values) {
  const tier = $('#mode').value === 'tiered';
  $('#targets').innerHTML = tier ? Array.from({ length: +$('#count').value }, (_, i) => `<label>Önskad snittnivå · Lag ${i + 1}<select class="target">${levels.map(n => `<option value="${n}" ${n === (values?.[i] || i + 1) ? 'selected' : ''}>${num(n)}</option>`).join('')}</select></label>`).join('') : '';
  $('#modehelp').textContent = tier ? 'Lägre siffra betyder högre utvecklingsnivå. Önskade målnivåer kan inte alltid nås med vald trupp.' : 'Lagen får så lika snittnivåer som möjligt med hänsyn till positioner och variation.';
  document.querySelectorAll('.target').forEach(el => el.onchange = invalidate);
}
$('#format').onchange = () => { slotsRender(); invalidate(); };
$('#count').onchange = $('#mode').onchange = () => { targetsRender(); invalidate(); };
$('#variation').onchange = invalidate;
for (const id of ['occasion', 'kind', 'date']) $('#' + id).oninput = () => { if (draft) { draft[id === 'occasion' ? 'name' : id] = $('#' + id).value; renderDraft(); } };
function row(p, team, pos, note, movable) {
  return `<div class="assignment"><span class="pos">${esc(pos)}</span><span class="person">${esc(p.name)}${note ? '<br><small>' + note + '</small>' : ''}</span><span>${num(p.level)}</span>${movable ? `<select data-move="${esc(p.id)}" data-from="${team}" aria-label="Flytta ${esc(p.name)} till lag">${draft.teams.map((_, i) => `<option value="${i}" ${i === team ? 'selected' : ''}>Lag ${i + 1}</option>`).join('')}</select>` : ''}</div>`;
}
function teamsHTML(p, movable = false) {
  return `<p class="hint">${esc(p.kind)}${p.date ? ' · ' + esc(p.date) : ''} · ${p.slots.length - 1} + 1 · ${p.mode === 'balanced' ? 'Jämnstarka' : 'Nivåanpassade'} lag · Snitt ${num(TeamEngine.average(p.teams.flat()))}</p><div class="teams">${p.teams.map((team, i) => {
    const a = TeamEngine.assign(team, p.slots), used = new Set(a.picks.map(x => x.index)), missing = [];
    const rows = p.slots.map((slot, j) => {
      const pick = a.picks.find(x => x.slot === j);
      if (!pick) { missing.push(slot); return `<div class="assignment"><span class="pos">${slot}</span><span class="person">Saknar spelare</span></div>`; }
      if (!pick.fit) missing.push(slot);
      return row(team[pick.index], i, slot, pick.secondary ? 'Andraposition' : !pick.fit ? 'Ovan position' : '', movable);
    }).join('');
    const bench = team.filter((_, j) => !used.has(j));
    return `<article class="team"><div class="teamhead"><h3>Lag ${i + 1}</h3><p>${team.length} spelare · Snittnivå <b>${num(TeamEngine.average(team))}</b>${p.mode === 'tiered' ? ' · Mål ' + num(p.targets[i]) : ''}</p></div><div class="teamlist">${missing.length ? `<p class="warning">Saknar positionstäckning: ${missing.join(', ')}. Kontrollera uppställningen.</p>` : ''}${rows}${bench.length ? '<p class="sub">AVBYTARE · ' + bench.length + '</p>' + bench.map(x => row(x, i, x.first, '', movable)).join('') : ''}</div></article>`;
  }).join('')}</div>`;
}
function renderDraft() {
  if (!draft) return;
  $('#drafttitle').textContent = draft.name || 'Ditt lagförslag'; $('#print').hidden = false;
  $('#output').className = ''; $('#output').innerHTML = teamsHTML(draft, true);
  $('#draftactions').hidden = false;
  $('#draftstatus').textContent = draft.id ? `Du justerar version ${draft.revision}. När du sparar skapas en ny version och tidigare röster nollställs.` : 'Utkastet är inte sparat ännu. Spara för att låta tränargruppen granska det.';
  if (draft.variation && draft.teams.length === 1) $('#draftstatus').textContent += ' Med ett lag och samma deltagare går det inte att variera lagkamrater.';
  $('#savereview').textContent = draft.id ? 'Spara ny version för granskning' : 'Spara för granskning';
}
$('#generate').onclick = () => {
  const active = state.players.filter(p => selected.has(p.id)), count = +$('#count').value;
  if (active.length < count) return notice('Välj minst en spelare per lag.');
  $('#generate').disabled = true; $('#generate').textContent = 'Beräknar lag…';
  const config = { name: $('#occasion').value.trim(), kind: $('#kind').value, date: $('#date').value, slots: ['MV', ...Array.from(document.querySelectorAll('.slot'), x => x.value)], mode: $('#mode').value, targets: Array.from(document.querySelectorAll('.target'), x => +x.value), variation: $('#variation').checked };
  const revision = draft?.id ? { id: draft.id, revision: draft.revision } : {};
  setTimeout(() => {
    try { draft = { ...config, ...revision, teams: TeamEngine.build(active, count, config.slots, config.mode, config.targets, state.proposals, config.variation) }; renderDraft(); $('#results').scrollIntoView({ behavior: 'smooth', block: 'start' }); }
    catch (error) { notice(error.message); }
    finally { $('#generate').disabled = false; $('#generate').textContent = 'Skapa lagförslag →'; }
  }, 30);
};
$('#output').onchange = e => {
  if (!e.target.dataset.move || !draft) return;
  const from = +e.target.dataset.from, to = +e.target.value, p = draft.teams[from].find(p => p.id === e.target.dataset.move);
  draft.teams[from] = draft.teams[from].filter(x => x.id !== p.id); draft.teams[to].push(p); renderDraft();
};
$('#savereview').onclick = async () => {
  if (!draft) return;
  const savedId = draft.id;
  if (await act('proposal.save', draft)) { draft = null; $('#draftactions').hidden = true; $('#output').innerHTML = '<p class="success">Förslaget är sparat under Förslag.</p>'; $('#print').hidden = true; tab('review'); notice(savedId ? 'Ny version sparad. Alla tränare behöver godkänna igen.' : 'Förslaget är sparat för granskning.'); }
};
function renderLists() {
  for (const [id, status] of [['reviews', 'review'], ['history', 'accepted']]) {
    const list = state.proposals.filter(p => p.status === status);
    $('#' + id).innerHTML = list.length ? list.map(p => {
      const approvals = state.coaches.filter(c => p.votes[c.id]?.choice === 'approve').length;
      const changes = state.coaches.filter(c => p.votes[c.id]?.choice === 'adjust').length;
      return `<article class="panel"><div class="sectionhead"><h2>${esc(p.name)}</h2><span class="badge">${status === 'accepted' ? 'Accepterat' : 'Version ' + p.revision}</span></div><p class="proposalmeta">${esc(p.kind)}${p.date ? ' · ' + esc(p.date) : ''} · ${p.teams.length} lag · ${p.teams.flat().length} spelare</p><p class="hint">${status === 'accepted' ? 'Sparat ' + new Date(p.acceptedAt).toLocaleDateString('sv-SE') + ' · Ingår i underlaget för variation.' : `${approvals}/${state.coaches.length} godkänner${changes ? ' · ' + changes + ' önskar justering' : ''}`}</p><button class="primary" data-open="${p.id}">${status === 'accepted' ? 'Visa sparade lag' : 'Granska förslaget'}</button></article>`;
    }).join('') : `<div class="panel empty">${status === 'accepted' ? 'Inga accepterade lag ännu. Godkänn och spara ett förslag för att börja bygga historik.' : 'Inga förslag väntar på granskning. Skapa ett under Bygg lag.'}</div>`;
  }
}
function showReview(id, refresh = false) {
  const p = state.proposals.find(p => p.id === id); if (!p) return;
  const previousComment = refresh ? $('#votecomment')?.value : null;
  reviewId = id; $('#reviewtitle').textContent = p.name; $('#reviewdialog').dataset.teams = p.teams.length;
  const accepted = p.status === 'accepted', approved = state.coaches.every(c => p.votes[c.id]?.choice === 'approve');
  $('#reviewdetail').innerHTML = `<p class="${accepted ? 'success' : 'hint'}">${accepted ? 'Accepterat och sparat · ' + new Date(p.acceptedAt).toLocaleDateString('sv-SE') : 'Version ' + p.revision + ' · Rösterna gäller bara denna version.'}</p><p class="hint compare-hint">Bläddra i sidled för att jämföra alla lag.</p>${teamsHTML(p)}<h3 class="sub">TRÄNARNAS BEDÖMNING</h3><ul class="votes">${(p.reviewers || state.coaches).map(c => { const vote = p.votes[c.id]; return `<li><b>${esc(c.name)}${c.id === me ? ' (du)' : ''}</b> · ${vote?.choice === 'approve' ? 'Godkänner' : vote?.choice === 'adjust' ? 'Önskar justering' : accepted ? 'Ingick inte i beslutet' : 'Inväntar svar'}${vote?.comment ? '<p>' + esc(vote.comment) + '</p>' : ''}</li>`; }).join('')}</ul>${accepted ? '' : `<label>Kommentar / föreslagen justering<textarea id="votecomment" maxlength="1000" placeholder="Till exempel: byt plats på två spelare för bättre positionstäckning."></textarea></label><div class="actions"><button id="approve" class="primary">Godkänn förslaget</button><button id="adjust">Rösta för justering</button><button id="editproposal">Justera lagen</button></div><p class="hint">Alla ${state.coaches.length} inbjudna tränare behöver godkänna. Ändringar i lagen kräver nya röster.</p><button id="acceptproposal" class="primary wide" ${approved ? '' : 'disabled'}>Spara accepterade lag</button>`}<div class="actions"><button id="printreview">Skriv ut lagen</button><button id="reuse">Använd som nytt utkast</button></div>${p.previous.length ? `<p class="hint">${p.previous.length} tidigare versioner har ersatts. Deras röster räknas inte.</p>` : ''}`;
  if (!accepted) {
    $('#votecomment').value = previousComment ?? p.votes[me]?.comment ?? '';
    const vote = choice => act('proposal.vote', { id: p.id, revision: p.revision, choice, comment: $('#votecomment').value });
    $('#approve').onclick = () => vote('approve'); $('#adjust').onclick = () => vote('adjust');
    $('#acceptproposal').onclick = async () => { if (await act('proposal.accept', { id: p.id, revision: p.revision })) { notice('Lagen är accepterade och sparade.'); tab('history'); } };
    $('#editproposal').onclick = () => loadDraft(p, true);
  }
  $('#reuse').onclick = () => loadDraft(p, false);
  $('#printreview').onclick = () => { document.body.className = 'print-review'; window.print(); };
  const comparison = $('#reviewdetail .teams'); comparison.tabIndex = 0; comparison.setAttribute('role', 'region'); comparison.setAttribute('aria-label', 'Lag sida vid sida, bläddra i sidled vid behov');
  if (!$('#reviewdialog').open) $('#reviewdialog').showModal();
}
function loadDraft(p, updating) {
  const missing = p.teams.flat().filter(x => !state.players.some(current => current.id === x.id));
  if (missing.length) return notice('Några spelare finns inte längre i truppen. Skapa ett nytt förslag med aktuella deltagare.');
  draft = { ...structuredClone(p), teams: p.teams.map(t => t.map(x => ({ ...state.players.find(current => current.id === x.id) }))) };
  if (!updating) { delete draft.id; delete draft.revision; draft.name = ''; draft.date = ''; }
  selected = new Set(draft.teams.flat().map(x => x.id));
  $('#occasion').value = draft.name; $('#kind').value = draft.kind; $('#date').value = draft.date;
  $('#count').value = draft.teams.length; $('#format').value = draft.slots.length - 1; $('#mode').value = draft.mode; $('#variation').checked = draft.variation;
  slotsRender(draft.slots.slice(1)); targetsRender(draft.targets); renderPlayers(); renderDraft();
  $('#reviewdialog').close(); reviewId = null; tab('build'); $('#results').scrollIntoView({ behavior: 'smooth' });
}
$('#closereview').onclick = () => { $('#reviewdialog').close(); reviewId = null; };
$('#reviewdialog').addEventListener('close', () => reviewId = null);
$('#reviews').onclick = $('#history').onclick = e => { if (e.target.dataset.open) showReview(e.target.dataset.open); };
$('#print').onclick = () => { document.body.className = 'print-draft'; window.print(); };
window.addEventListener('afterprint', () => document.body.className = '');
function renderCoaches() {
  $('#sharinghelp').textContent = shared ? 'Spelarregister, förslag, röster och accepterade lag sparas gemensamt. Varje tränare har en personlig åtkomstlänk.' + (['127.0.0.1', 'localhost'].includes(location.hostname) ? ' Du använder en lokal testadress. Inbjudningslänkar här fungerar bara på den här datorn. För kollegor via internet krävs den publicerade HTTPS-adressen.' : '') : 'Den här versionen sparar truppen och lagen i din webbläsare. Exportera truppen för att dela en kopia. Gemensam trupp och tränarröster mellan enheter behöver en ansluten lagringstjänst; en delad webbadress synkroniserar inte uppgifterna.';
  $('#inviteform').hidden = !shared || !owner; $('#logout').hidden = !shared;
  $('#coachlist').innerHTML = state.coaches.map(c => `<div class="coach"><span>${esc(c.name)}${c.id === me ? ' (du)' : ''}</span>${shared && owner && c.id !== me ? `<button data-revoke="${c.id}">Ta bort åtkomst</button>` : ''}</div>`).join('');
}
$('#inviteform').onsubmit = async e => {
  e.preventDefault(); if (busy) return; busy = true;
  try { const data = await api('invite', { name: $('#coachname').value.trim() }); acceptEnvelope(data); $('#invitation').hidden = false; $('#invitelink').value = location.origin + '/#key=' + data.invitation; $('#coachname').value = ''; }
  catch (error) { notice(error.message); } finally { busy = false; }
};
$('#copyinvite').onclick = async () => { try { await navigator.clipboard.writeText($('#invitelink').value); notice('Länken är kopierad.'); } catch { $('#invitelink').select(); notice('Markera och kopiera länken.'); } };
$('#coachlist').onclick = async e => {
  const id = e.target.dataset.revoke; if (!id || busy) return;
  if (!confirm('Ta bort tränarens åtkomst? Tränaren ingår då inte i kommande godkännanden.')) return;
  busy = true; try { acceptEnvelope(await api('revoke', { id })); $('#invitation').hidden = true; } catch (error) { notice(error.message); } finally { busy = false; }
};
$('#backup').onclick = () => download({ schema: 2, exportedAt: new Date().toISOString(), ...state }, 'lagbyggaren-sakerhetskopia.json');
$('#export').onclick = () => download(state.players, 'ankaret-spelare.json');
$('#import').onchange = async e => {
  const file = e.target.files[0]; if (!file) return;
  try {
    if (file.size > 1024 * 1024) throw new Error('Filen är för stor.');
    const input = JSON.parse(await file.text());
    if (!Array.isArray(input)) throw new Error('Välj en exporterad spelartrupp.');
    const players = TeamStore.validatePlayers(input.map(p => ({ ...p, id: p.id || uid() })));
    if (state.players.length && !confirm(`Ersätt den ${shared ? 'gemensamma' : 'lokala'} truppen med ${players.length} spelare? Sparade lag bevaras.`)) return;
    if (await act('players.replace', players)) { invalidate(); notice('Truppen är importerad. Spelarnas ID:n bevaras för laghistoriken.'); }
  } catch (error) { notice(error.message); } finally { e.target.value = ''; }
};
$('#demo').onclick = async () => {
  if (state.players.length && !confirm('Ersätt truppen med exempelspelare? Exportera truppen först om du vill behålla den.')) return;
  const names = ['Alex', 'Charlie', 'Elliot', 'Frankie', 'Jamie', 'Kim', 'Lou', 'Max', 'Mika', 'Noel', 'Robin', 'Sam', 'Sasha', 'Toni', 'Valle', 'Billie'];
  const pos = Object.keys(POSITIONS);
  if (await act('players.replace', names.map((name, i) => ({ id: uid(), name, first: pos[i % 7], second: i % 7 === 0 ? 'M6' : pos[(i + 2) % 7], level: levels[i % 5] })))) invalidate();
};
async function connect() { try { acceptEnvelope(await api('state')); return true; } catch (error) { $('#connection').textContent = 'Inte ansluten · Ändringar kan inte sparas gemensamt just nu.'; notice(error.message); return false; } }
$('#loginform').onsubmit = async e => { e.preventDefault(); token = $('#accesskey').value.trim(); if (await connect()) { localStorage.setItem('lagbyggaren-access', token); $('#accesskey').value = ''; } };
$('#logout').onclick = () => { localStorage.removeItem('lagbyggaren-access'); token = ''; state = TeamStore.initial(); draft = null; location.reload(); };
document.querySelectorAll('.tab').forEach(el => el.onclick = () => tab(el.dataset.tab));
async function boot() {
  slotsRender(); targetsRender();
  if (shared) {
    const incoming = new URLSearchParams(location.hash.slice(1)).get('key');
    token = incoming || localStorage.getItem('lagbyggaren-access') || '';
    if (incoming) { localStorage.setItem('lagbyggaren-access', incoming); history.replaceState(null, '', location.pathname); }
    $('#appcontent').hidden = true;
    if (token) await connect(); else { $('#login').hidden = false; $('#connection').textContent = 'Öppna din personliga tränarlänk för att ansluta.'; }
    setInterval(async () => {
      if (!token || busy || document.hidden) return;
      try { const data = await api('state'); if (data.state.version !== state.version) acceptEnvelope(data); else $('#connection').textContent = `● Delad trupp · ${state.coaches.find(c => c.id === me)?.name || 'Tränare'} · Synkroniserad`; }
      catch { $('#connection').textContent = 'Anslutningen avbröts · Försöker igen automatiskt.'; }
    }, 10000);
  } else {
    try {
      const saved = localStorage.getItem(LOCAL_KEY);
      if (saved) state = JSON.parse(saved);
      else {
        const old = JSON.parse(localStorage.getItem('ankaret-lagbyggaren-v1') || '[]');
        state.players = TeamStore.validatePlayers(old.map(p => ({ ...p, id: p.id || uid() })));
        localStorage.setItem(LOCAL_KEY, JSON.stringify(state));
      }
      acceptEnvelope({ state, me: 'local', owner: true });
    } catch (error) { $('#appcontent').hidden = true; notice('Sparade data kunde inte läsas: ' + error.message); }
  }
}
boot();
