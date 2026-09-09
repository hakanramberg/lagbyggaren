(function (root) {
  'use strict';
  // The drawing layer receives only the information intended for parents.
  function publicData(proposal) {
    return {
      title: proposal.name,
      date: proposal.date || '',
      subtitle: proposal.status === 'accepted' ? 'Lagindelning' : 'Lagförslag',
      teams: proposal.teams.map((players, i) => ({
        name: `Lag ${i + 1}`,
        coaches: proposal.teamCoaches?.[i] || '',
        meeting: {time: proposal.teamMeetings?.[i]?.time || '', place: proposal.teamMeetings?.[i]?.place || ''},
        players: players.map(p => p.name).sort((a, b) => a.localeCompare(b, 'sv'))
      }))
    };
  }
  function canvas(data) {
    const image = document.createElement('canvas'), ctx = image.getContext('2d');
    if (!ctx) throw new Error('Webbläsaren saknar stöd för bildexport.');
    const margin = 48, gap = 24, column = 500, inside = column - 48;
    const width = margin * 2 + data.teams.length * column + (data.teams.length - 1) * gap;
    const font = (size, weight = 400) => { ctx.font = `${weight} ${size}px Arial, sans-serif`; };
    const wrap = (value, maxWidth, size, weight = 400) => {
      font(size, weight);
      const lines = []; let line = '';
      for (const word of String(value).split(/\s+/).filter(Boolean)) {
        if (line && ctx.measureText(line + ' ' + word).width > maxWidth) { lines.push(line); line = ''; }
        if (ctx.measureText(word).width > maxWidth) {
          if (line) { lines.push(line); line = ''; }
          for (const char of word) { if (ctx.measureText(line + char).width > maxWidth) { lines.push(line); line = ''; } line += char; }
        } else line += (line ? ' ' : '') + word;
      }
      if (line) lines.push(line);
      return lines;
    };
    const title = wrap(data.title, width - margin * 2, 42, 700);
    const start = 138 + title.length * 52;
    const layouts = data.teams.map(team => ({ ...team,
      coachLines: wrap(team.coaches || 'Ej angivet', inside, 24, 700),
      meetingLines: wrap([team.meeting.time ? 'Samling: ' + team.meeting.time : '', team.meeting.place ? 'Plats: ' + team.meeting.place : ''].filter(Boolean).join(' · '), inside, 23),
      playerLines: team.players.map(name => wrap(name, inside, 26))
    }));
    const coachHeight = Math.max(...layouts.map(t => t.coachLines.length)) * 32 + 68;
    const meetingHeight = Math.max(...layouts.map(t => t.meetingLines.length)) * 31 + (layouts.some(t => t.meetingLines.length) ? 24 : 0);
    const cardHeight = 82 + coachHeight + meetingHeight + Math.max(...layouts.map(t => t.playerLines.reduce((sum, lines) => sum + lines.length * 35 + 22, 0))) + 22;
    image.width = width; image.height = start + cardHeight + 88;
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#f5f6f8'; ctx.fillRect(0, 0, width, image.height);
    ctx.fillStyle = '#e30613'; ctx.fillRect(0, 0, width, 14);
    const text = (lines, x, y, size, weight, color, step) => {
      font(size, weight); ctx.fillStyle = color;
      lines.forEach((line, i) => ctx.fillText(line, x, y + i * step));
    };
    text(['HK ANKARET'], margin, 46, 22, 700, '#b50010', 28);
    text(title, margin, 84, 42, 700, '#151515', 52);
    text([data.subtitle + (data.date ? ' · ' + data.date : '')], margin, 96 + title.length * 52, 22, 400, '#676a72', 28);
    layouts.forEach((team, i) => {
      const x = margin + i * (column + gap);
      ctx.fillStyle = '#ffffff'; ctx.fillRect(x, start, column, cardHeight);
      ctx.fillStyle = '#e30613'; ctx.fillRect(x, start, column, 68);
      text([team.name], x + 24, start + 18, 28, 700, '#ffffff', 36);
      text(['TRÄNARE'], x + 24, start + 88, 17, 700, '#676a72', 24);
      text(team.coachLines, x + 24, start + 116, 24, 700, '#151515', 32);
      text(team.meetingLines, x + 24, start + 62 + coachHeight, 23, 400, '#151515', 31);
      let y = start + 82 + coachHeight + meetingHeight;
      team.playerLines.forEach(lines => {
        ctx.fillStyle = '#e8e8ec'; ctx.fillRect(x + 24, y - 10, inside, 1);
        text(lines, x + 24, y, 26, 400, '#151515', 35);
        y += lines.length * 35 + 22;
      });
    });
    text(['HK Ankaret · Tillsammans på planen'], margin, image.height - 48, 18, 400, '#676a72', 24);
    return image;
  }
  async function download(proposal) {
    const image = canvas(publicData(proposal));
    const blob = await new Promise(resolve => image.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('Försök igen i en annan webbläsare.');
    const url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = (proposal.name.replace(/[^a-zåäö0-9_-]+/gi, '-').replace(/^-|-$/g, '') || 'lagindelning') + '.png';
    a.click(); setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
  root.TeamImage = { publicData, canvas, download };
  if (typeof module !== 'undefined') module.exports = root.TeamImage;
})(typeof window !== 'undefined' ? window : globalThis);
