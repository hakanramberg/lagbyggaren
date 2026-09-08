(function (root) {
  'use strict';
  function assign(players, slots) {
    let dp = new Map([[0, { cost: 0, picks: [] }]]);
    for (let i = 0; i < players.length; i++) {
      const next = new Map(dp);
      for (const [mask, state] of dp) for (let s = 0; s < slots.length; s++) {
        if (mask & (1 << s)) continue;
        const p = players[i], costForSlot = p.first === slots[s] ? 0 : p.second === slots[s] ? 1 : 12;
        const m = mask | (1 << s), cost = state.cost + costForSlot;
        if (!next.has(m) || next.get(m).cost > cost) next.set(m, { cost, picks: [...state.picks, { index: i, slot: s, fit: costForSlot < 12, secondary: costForSlot === 1 }] });
      }
      dp = next;
    }
    let best;
    for (const state of dp.values()) {
      const cost = state.cost + (slots.length - state.picks.length) * 20;
      if (!best || cost < best.cost) best = { ...state, cost };
    }
    return best;
  }
  const average = players => players.length ? players.reduce((s, p) => s + p.level, 0) / players.length : 0;
  const pairKey = (a, b) => JSON.stringify([a, b].sort());
  function pairCounts(history) {
    const counts = new Map();
    // The most recent ten accepted occasions affect rotation; recent occasions carry more weight.
    history.filter(p => p.status === 'accepted').sort((a, b) => b.acceptedAt.localeCompare(a.acceptedAt)).slice(0, 10).forEach((p, n) => {
      for (const team of p.teams) for (let i = 0; i < team.length; i++) for (let j = i + 1; j < team.length; j++) {
        const key = pairKey(team[i].id, team[j].id);
        counts.set(key, (counts.get(key) || 0) + (10 - n) / 10);
      }
    });
    return counts;
  }
  function repetition(teams, counts) {
    let sum = 0, pairs = 0;
    for (const team of teams) for (let i = 0; i < team.length; i++) for (let j = i + 1; j < team.length; j++) {
      sum += counts.get(pairKey(team[i].id, team[j].id)) || 0; pairs++;
    }
    return pairs ? sum / pairs : 0;
  }
  function build(players, count, slots, mode, targets, history = [], variation = true, random = Math.random) {
    const overall = average(players), counts = variation ? pairCounts(history) : new Map(), cache = new Map();
    const teamScore = (team, i) => {
      const key = JSON.stringify(team.map(p => p.id).sort());
      if (!cache.has(key)) cache.set(key, assign(team, slots).cost);
      return cache.get(key) * 4 + Math.pow(average(team) - (mode === 'balanced' ? overall : targets[i]), 2) * 30;
    };
    const score = teams => teams.reduce((sum, team, i) => sum + teamScore(team, i), 0) + repetition(teams, counts) * 6;
    let best, bestScore = Infinity;
    for (let run = 0; run < 14; run++) {
      const shuffled = [...players];
      for (let i = shuffled.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]; }
      const teams = Array.from({ length: count }, () => []);
      shuffled.forEach((p, i) => teams[i % count].push(p));
      let current = score(teams);
      for (let pass = 0; pass < 20; pass++) {
        let improved = false;
        for (let a = 0; a < count; a++) for (let b = a + 1; b < count; b++) for (let i = 0; i < teams[a].length; i++) for (let j = 0; j < teams[b].length; j++) {
          [teams[a][i], teams[b][j]] = [teams[b][j], teams[a][i]];
          const candidate = score(teams);
          if (candidate < current - 1e-8) { current = candidate; improved = true; }
          else [teams[a][i], teams[b][j]] = [teams[b][j], teams[a][i]];
        }
        if (!improved) break;
      }
      if (current < bestScore) { bestScore = current; best = teams.map(t => [...t]); }
    }
    return best;
  }
  root.TeamEngine = { assign, average, build, pairCounts, repetition };
  if (typeof module !== 'undefined') module.exports = root.TeamEngine;
})(typeof window !== 'undefined' ? window : globalThis);
