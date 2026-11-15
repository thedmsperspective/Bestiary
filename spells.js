// Spells in stat blocks: the spell names in a Spellcasting list can be tapped to read the spell.
//
// The spells come from the Character Sheet app's Library: its SRD spells, plus every spell you've typed in there
// (read from this device, since both apps live on the same site). A name the Library doesn't have yet gets a dotted
// underline; tapping it offers to start that spell in the Character Sheet's Library.

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ORD = n => (n === 1 ? '1st' : n === 2 ? '2nd' : n === 3 ? '3rd' : `${n}th`);

// A spell name as the stat block writes it, made comparable: no capitals, notes, stars or odd dashes
export const norm = s => String(s || '').toLowerCase()
  .replace(/\([^)]*\)/g, ' ').replace(/\[[^\]]*\]/g, ' ')
  .replace(/[*†‡§]/g, '').replace(/[’‘`]/g, "'").replace(/[‐-―]/g, '-').replace(/\s*\/\s*/g, '/')
  .replace(/\s+/g, ' ').trim().replace(/[.;:]+$/, '');

let byEd = { '2014': new Map(), '2024': new Map() }, mine = new Map(), loaded = null;
const ready = () => byEd['2014'].size + byEd['2024'].size + mine.size > 0;
const listeners = new Set();
export const onSpellsLoaded = fn => listeners.add(fn);

async function libraryFromSheet() {
  // Only open the Character Sheet's storage if it exists on this device (opening it otherwise would create an empty one)
  try {
    if (indexedDB.databases) { const dbs = await indexedDB.databases(); if (!dbs.some(d => d.name === 'charsheet')) return null; }
    return await new Promise(res => {
      const r = indexedDB.open('charsheet');
      r.onupgradeneeded = () => { r.transaction.abort(); res(null); };
      r.onerror = () => res(null);
      r.onsuccess = () => {
        const db = r.result;
        if (!db.objectStoreNames.contains('meta')) { db.close(); return res(null); }
        const g = db.transaction('meta').objectStore('meta').get('library');
        g.onsuccess = () => { db.close(); res(g.result || null); };
        g.onerror = () => { db.close(); res(null); };
      };
    });
  } catch { return null; }
}

export function loadSpells(force = false) {
  if (loaded && !force) return loaded;
  loaded = (async () => {
    const files = await Promise.all(['srd.json', 'srd2024.json'].map(f => fetch(`/Char-Sheet/data/${f}`).then(r => (r.ok ? r.json() : { entries: [] })).catch(() => ({ entries: [] }))));
    const add = (map, e) => { const k = norm(e.name); if (k && !map.has(k)) map.set(k, e); };
    byEd = { '2014': new Map(), '2024': new Map() };
    files[0].entries.filter(e => e.type === 'spell').forEach(e => add(byEd['2014'], e));
    files[1].entries.filter(e => e.type === 'spell').forEach(e => add(byEd['2024'], e));
    mine = new Map();
    const lib = await libraryFromSheet();
    for (const [id, e] of Object.entries(lib?.entries || {})) {
      if (e?.type !== 'spell' || lib.deleted?.[id]) continue;
      // an edited SRD spell keeps the SRD's fields it doesn't have
      const base = [...byEd['2014'].values(), ...byEd['2024'].values()].find(x => x.id === id);
      const full = { ...(base || {}), ...e };
      mine.set(norm(full.name), full);
    }
    for (const l of listeners) l();
  })();
  return loaded;
}

/** The spell for a name, preferring your own, then the monster's edition, then the other edition */
export function findSpell(name, ed = '2014') {
  const k = norm(name); if (!k) return null;
  const other = ed === '2024' ? '2014' : '2024';
  const tries = [k, k.replace(/^(greater|lesser) /, ''), k.replace(/'s /, ' ')];
  for (const t of tries) { const e = mine.get(t) || byEd[ed]?.get(t) || byEd[other]?.get(t); if (e) return e; }
  return null;
}

// ---------- finding the spell lists in a stat block's text
// A list line looks like "1st level (4 slots): detect magic, shield" or "At Will: Mage Hand, Light" or "3/day each: fly"
const LIST_LABEL = /(cantrip|at[ -]will|level|\/\s*day|slot|each|\bdaily\b|\d\/)/i;
function splitItems(s) {
  const out = []; let depth = 0, cur = '';
  for (const ch of s) {
    if (ch === '(' || ch === '[') depth++;
    if (ch === ')' || ch === ']') depth = Math.max(0, depth - 1);
    if (ch === ',' && !depth) { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur);
  return out;
}
const linkFor = (raw, ed) => {
  const lead = /^\s*(and\s+|or\s+)?/i.exec(raw)[0], body = raw.slice(lead.length);
  const trail = /\s*[.;]?\s*$/.exec(body)[0], text = body.slice(0, body.length - trail.length);
  if (!text.trim()) return esc(raw);
  const s = findSpell(text, ed);
  if (!s && !ready()) return esc(raw); // offline with no spell list: leave the name as it was
  return `${esc(lead)}<span class="spell-link${s ? '' : ' miss'}" role="button" tabindex="0" data-spell="${esc(text.trim())}" data-ed="${ed}"${s ? '' : ' title="Not in your spell list yet"'}>${esc(text)}</span>${esc(trail)}`;
};

/** Text of a Spellcasting entry, with each spell in its lists made tappable. fmt formats a plain line. */
export function spellLines(desc, fmt, ed = '2014') {
  return String(desc || '').split('\n').map(lineText => {
    const m = /^(\s*(?:[-•*]\s*)?)([^:\n]{1,70}?):\s*(.+)$/.exec(lineText);
    if (!m || !LIST_LABEL.test(m[2]) || /spellcasting ability|spell save dc|to hit/i.test(m[2])) return fmt(lineText);
    return `${fmt(m[1] + m[2])}: ${splitItems(m[3]).map(x => linkFor(x, ed)).join(',')}`;
  }).join('\n');
}
export const isSpellEntry = e => /spellcasting|spells/i.test(e?.name || '') || /following spells|spells prepared|spells? known|innately cast/i.test(e?.desc || '');

// ---------- the spell, when a name is tapped
function card(name, ed) {
  const s = findSpell(name, ed);
  if (!s) {
    return `<h2>${esc(name)}</h2><p>This spell isn't in your spell list yet.</p>
      <p class="note">Spells come from the Character Sheet app's Library. Add it there once, and it works in every stat block that uses it.</p>
      <div class="drow"><button class="btn primary" type="button" data-spl="add" data-name="${esc(name)}">Add it in the Character Sheet</button><button class="btn" type="button" data-spl="close">Close</button></div>`;
  }
  const lv = +s.level || 0;
  const kind = lv ? `${ORD(lv)}-level ${String(s.school || '').toLowerCase()}` : `${s.school || ''} cantrip`;
  const row = (k, v) => (v ? `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>` : '');
  const para = t => (window.DMPText ? window.DMPText.textHTML(t) : `<p style="white-space:pre-wrap">${esc(t)}</p>`);
  return `<h2>${esc(s.name)}</h2><p class="dsub"><i>${esc(kind.trim())}${s.ritual ? ' (ritual)' : ''}</i>${s.src ? ` · ${esc(s.src)}` : ' · Your Library'}</p>
    <dl class="spell-facts">${row('Casting time', s.time)}${row('Range', s.range)}${row('Components', [s.components, s.material ? `(${s.material})` : ''].filter(Boolean).join(' '))}${row('Duration', `${s.conc ? 'Concentration, ' : ''}${s.duration || ''}`)}</dl>
    <div class="spell-desc">${para(s.desc || '')}</div>
    ${s.higher ? `<div class="spell-desc"><b><i>At Higher Levels.</i></b> ${para(s.higher)}</div>` : ''}
    <div class="drow"><button class="btn" type="button" data-spl="close">Close</button></div>`;
}

let dlg = null;
function open(name, ed) {
  if (!dlg) {
    dlg = document.createElement('dialog'); dlg.className = 'spell-dlg';
    dlg.addEventListener('click', e => {
      const b = e.target.closest('[data-spl]');
      if (!b) { if (e.target === dlg) dlg.close(); return; }
      if (b.dataset.spl === 'close') dlg.close();
      if (b.dataset.spl === 'add') { window.open(`/Char-Sheet/index.html#newspell=${encodeURIComponent(b.dataset.name)}`, '_blank'); dlg.close(); }
    });
    document.body.append(dlg);
  }
  dlg.innerHTML = card(name, ed);
  if (!dlg.open) dlg.showModal();
  dlg.scrollTop = 0;
}

let started = false;
export function startSpells() {
  if (started) return; started = true;
  // capture, so tapping a spell inside a button (an action in combat) only opens the spell
  const go = e => {
    const t = e.target.closest?.('.spell-link'); if (!t) return;
    if (e.type === 'keydown' && e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault(); e.stopPropagation();
    open(t.dataset.spell, t.dataset.ed);
  };
  document.addEventListener('click', go, true);
  document.addEventListener('keydown', go, true);
  // a spell you just added in the Character Sheet shows up when you come back
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') loadSpells(true); });
  loadSpells();
}
