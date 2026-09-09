(function (root) {
  'use strict';
  const POSITIONS = { MV: 'Målvakt', V6: 'Vänstersexa', M6: 'Mittsexa', H6: 'Högersexa', V9: 'Vänsternia', M9: 'Mittnia', H9: 'Högernia' };
  const levels = [1, 1.5, 2, 2.5, 3];
  const check = (ok, message) => { if (!ok) throw new Error(message); };
  const text = (s, max) => typeof s === 'string' && s.trim().length > 0 && s.length <= max;
  const validPlayer = p => p && text(p.id, 100) && text(p.name, 70) && Object.hasOwn(POSITIONS, p.first) && (p.second === '' || Object.hasOwn(POSITIONS, p.second)) && p.first !== p.second && levels.includes(p.level);
  function validatePlayers(players) {
    check(Array.isArray(players) && players.length <= 200 && players.every(validPlayer), 'Ogiltiga spelaruppgifter.');
    check(new Set(players.map(p => p.id)).size === players.length, 'Spelarna måste ha unika ID:n.');
    return players.map(p => ({ id: p.id, name: p.name.trim(), first: p.first, second: p.second, level: p.level }));
  }
  function initial(coachId = 'local', name = 'Jag') {
    return { version: 0, players: [], proposals: [], coaches: [{ id: coachId, name }] };
  }
  function validateTeamCoaches(value, count) {
    const names = value === undefined ? Array(count).fill('') : value;
    check(Array.isArray(names) && names.length === count && names.every(n => typeof n === 'string' && n.length <= 200), 'Ange tränare för varje lag, högst 200 tecken per lag.');
    return names.map(n => n.trim());
  }
  function validateMeetings(value, count) {
    const meetings = value === undefined ? Array.from({length: count}, () => ({time: '', place: ''})) : value;
    check(Array.isArray(meetings) && meetings.length === count && meetings.every(m => m && typeof m.time === 'string' && (m.time === '' || /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(m.time)) && typeof m.place === 'string' && m.place.length <= 200), 'Ange giltig samlingstid och en plats med högst 200 tecken för varje lag.');
    return meetings.map(m => ({time: m.time, place: m.place.trim()}));
  }
  function proposalData(data) {
    check(data && text(data.name, 80), 'Ge tillfället ett namn, till exempel Vikingaspelen 2026.');
    check(['Träning', 'Match', 'Turnering'].includes(data.kind), 'Välj typ av tillfälle.');
    check(typeof data.date === 'string' && (!data.date || /^\d{4}-\d{2}-\d{2}$/.test(data.date)), 'Ogiltigt datum.');
    check(Array.isArray(data.teams) && data.teams.length >= 1 && data.teams.length <= 3 && data.teams.every(t => Array.isArray(t) && t.length), 'Varje lag behöver minst en spelare.');
    validatePlayers(data.teams.flat());
    check(Array.isArray(data.slots) && [5, 7].includes(data.slots.length) && data.slots[0] === 'MV' && data.slots.slice(1).every(s => s !== 'MV' && Object.hasOwn(POSITIONS, s)), 'Ogiltig uppställning.');
    check(['balanced', 'tiered'].includes(data.mode), 'Ogiltig lagfördelning.');
    check(Array.isArray(data.targets) && (data.mode === 'balanced' || (data.targets.length === data.teams.length && data.targets.every(x => levels.includes(x)))), 'Ogiltiga målnivåer.');
    return { name: data.name.trim(), kind: data.kind, date: data.date, teams: data.teams.map(validatePlayers), teamCoaches: validateTeamCoaches(data.teamCoaches, data.teams.length), teamMeetings: validateMeetings(data.teamMeetings, data.teams.length), slots: [...data.slots], mode: data.mode, targets: [...data.targets], variation: !!data.variation };
  }
  function apply(state, action, actor, id, now = new Date().toISOString()) {
    check(state.coaches.some(c => c.id === actor), 'Tränaren saknar åtkomst.');
    const next = structuredClone(state), d = action.data;
    const find = () => { const p = next.proposals.find(p => p.id === d.id); check(p, 'Förslaget finns inte.'); return p; };
    switch (action.type) {
      case 'player.save': {
        const p = validatePlayers([d])[0], i = next.players.findIndex(x => x.id === p.id);
        if (i >= 0) check(JSON.stringify(d.previous) === JSON.stringify(next.players[i]), 'Spelaren har ändrats. Stäng formuläret och öppna spelaren igen.');
        if (i < 0) { check(next.players.length < 200, 'Max 200 spelare.'); next.players.push(p); } else next.players[i] = p;
        break;
      }
      case 'player.delete': next.players = next.players.filter(p => p.id !== d.id); break;
      case 'players.replace': next.players = validatePlayers(d); break;
      case 'proposal.save': {
        const clean = proposalData(d);
        // Snapshots always use current roster values, and historical snapshots never change.
        check(clean.teams.flat().every(p => next.players.some(x => x.id === p.id && ['name', 'first', 'second', 'level'].every(k => x[k] === p[k]))), 'Truppen har ändrats. Skapa om förslaget med aktuella spelare.');
        if (d.id) {
          const p = find(); check(p.status === 'review', 'Accepterade lag är låsta. Skapa ett nytt förslag.');
          check(d.revision === p.revision, 'Förslaget har ändrats. Öppna senaste versionen.');
          p.previous.push({ revision: p.revision, votes: p.votes, updatedAt: p.updatedAt });
          Object.assign(p, clean, { revision: p.revision + 1, votes: {}, updatedAt: now });
        } else {
          next.proposals.unshift({ ...clean, id, revision: 1, status: 'review', votes: {}, previous: [], createdBy: actor, updatedAt: now, createdAt: now });
        }
        break;
      }
      case 'proposal.staff': {
        const p = find();
        check(p.status === 'review' && d.revision === p.revision, 'Förslaget har ändrats eller är accepterat. Öppna senaste versionen.');
        const names = validateTeamCoaches(d.teamCoaches, p.teams.length);
        const meetings = validateMeetings(d.teamMeetings === undefined ? p.teamMeetings : d.teamMeetings, p.teams.length);
        check(JSON.stringify(names) !== JSON.stringify(p.teamCoaches || Array(p.teams.length).fill('')) || JSON.stringify(meetings) !== JSON.stringify(validateMeetings(p.teamMeetings, p.teams.length)), 'Inga laguppgifter har ändrats.');
        p.previous.push({ revision: p.revision, votes: p.votes, updatedAt: p.updatedAt });
        p.teamCoaches = names; p.teamMeetings = meetings; p.revision++; p.votes = {}; p.updatedAt = now;
        break;
      }
      case 'proposal.vote': {
        const p = find(); check(p.status === 'review' && d.revision === p.revision, 'Den här versionen kan inte längre bedömas. Öppna förslaget igen.');
        check(['approve', 'adjust'].includes(d.choice), 'Ogiltig röst.');
        check(typeof d.comment === 'string' && d.comment.length <= 1000 && (d.choice !== 'adjust' || d.comment.trim().length), 'Beskriv vilken justering du föreslår.');
        p.votes[actor] = { choice: d.choice, comment: d.comment.trim(), at: now, revision: p.revision };
        break;
      }
      case 'proposal.accept': {
        const p = find(); check(p.status === 'review' && d.revision === p.revision, 'Förslaget är inte längre aktuellt.');
        check(next.coaches.every(c => p.votes[c.id]?.choice === 'approve'), 'Alla inbjudna tränare måste godkänna den aktuella versionen först.');
        p.reviewers = structuredClone(next.coaches); p.status = 'accepted'; p.acceptedAt = now; p.acceptedBy = actor;
        break;
      }
      default: throw new Error('Okänd åtgärd.');
    }
    next.version++;
    return next;
  }
  root.TeamStore = { POSITIONS, levels, validPlayer, validatePlayers, proposalData, initial, apply };
  if (typeof module !== 'undefined') module.exports = root.TeamStore;
})(typeof window !== 'undefined' ? window : globalThis);
