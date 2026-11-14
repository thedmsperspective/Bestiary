// Player view: a read-only screen for the table. Shows HP as stages, never numbers.
// Fed by the combat tracker running in another window on the same device.
(function () {
  const KEY = 'bestiary-player';
  const IMG_KEY = 'bestiary-player-img';
  let imgAt = 0, imgTimer = null;
  const pic = document.getElementById('pic');

  function showImg(m) {
    if (!m || m.at <= imgAt) return;
    imgAt = m.at;
    clearTimeout(imgTimer);
    const left = (m.until || 0) - Date.now();
    if (!m.data || left <= 0) { pic.hidden = true; pic.querySelector('img').removeAttribute('src'); return; }
    pic.querySelector('img').src = m.data;
    pic.querySelector('figcaption').textContent = m.name || '';
    pic.hidden = false;
    imgTimer = setTimeout(() => { pic.hidden = true; }, Math.min(left, 90000));
  }
  // Slides from Session Notes (on this same device). They stay up until Session Notes sends "back to combat";
  // a slide left up from an earlier day isn't shown when the screen opens again.
  const SLIDE_KEY = 'bestiary-player-slide';
  const slideEl = document.getElementById('slide');
  let slideAt = 0;
  function showSlide(m) {
    if (!m || m.at <= slideAt) return;
    slideAt = m.at;
    const s = m.slide;
    if (!s || Date.now() - m.at > 12 * 3600 * 1000) { slideEl.hidden = true; slideEl.querySelector('.body').innerHTML = ''; return; }
    slideEl.querySelector('h1').textContent = s.title || '';
    const img = s.img ? `<div class="simg"><img alt="" src="${esc(s.img)}"></div>` : '';
    // the text arrives as HTML Session Notes made from what you typed (already made safe there)
    const txt = s.html ? `<div class="txt">${s.html}</div>` : '';
    slideEl.querySelector('.body').innerHTML = txt + img;
    slideEl.className = `slide${img && txt ? ' both' : txt ? ' only-text' : ''}`;
    slideEl.querySelector('.count').textContent = s.of > 1 ? `${s.n} / ${s.of}` : '';
    slideEl.hidden = false;
  }
  function readSlide() { try { showSlide(JSON.parse(localStorage.getItem(SLIDE_KEY) || 'null')); } catch { /* ignore */ } }
  function readImg() { try { showImg(JSON.parse(localStorage.getItem(IMG_KEY) || 'null')); } catch { /* ignore */ } }
  const wrap = document.getElementById('wrap');
  const STAGES = {
    unhurt: ['Unhurt', 4], wounded: ['Wounded', 3], bloodied: ['Bloodied', 2], near: ['Near death', 1],
    down: ['Down', 0], dying: ['Dying', 0], stable: ['Stable', 0], dead: ['Dead', 0],
  };
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let lastAt = 0;

  function segs(stage) {
    const n = (STAGES[stage] || ['', 0])[1];
    return `<span class="segs" aria-hidden="true">${[0, 1, 2, 3].map(i => `<i class="${i < n ? 'on' : ''}"></i>`).join('')}</span>`;
  }

  function entry(r, inner = false) {
    const [word] = STAGES[r.stage] || [''];
    const conds = r.conds?.length ? `<span class="conds">${r.conds.map(c => `<span>${esc(c)}</span>`).join('')}</span>` : '';
    if (inner) return `<li class="row ${r.side} s-${r.stage}"><span class="name">${esc(r.name)}</span>
      <span class="stage"><span class="word">${word}</span></span>${conds}</li>`;
    const mark = r.status === 'current' ? '▶' : r.status === 'acted' ? '✓' : '';
    return `<li class="row ${r.side} s-${r.stage} ${r.status || ''}">
      <span class="mark" aria-hidden="true">${mark}</span>
      <span class="name">${esc(r.name)}</span>
      <span class="stage"><span class="word">${word}</span></span>${conds}</li>`;
  }

  function group(g) {
    const mark = g.status === 'current' ? '▶' : g.status === 'acted' ? '✓' : '';
    return `<li class="row foe ${g.status || ''}">
      <span class="mark" aria-hidden="true">${mark}</span>
      <span class="name">${esc(g.name)}</span><span></span>
      <ol class="members">${g.members.map(m => entry(m, true)).join('')}</ol></li>`;
  }

  function render(s) {
    if (!s || !s.rows || !s.rows.length) {
      wrap.innerHTML = '<div class="idle"><div><b>Waiting for combat</b>Start a fight in the Bestiary\'s combat tracker.</div></div>';
      return;
    }
    const header = s.started
      ? `<span class="round">Round ${s.round}</span>
         <span class="up">${s.up ? `Up now: <b>${esc(s.up)}</b>` : s.lair ? '' : (s.mode === 'active' ? 'Choosing who goes next…' : '')}</span>
         ${s.lair ? '<span class="lairban">The lair stirs…</span>' : ''}`
      : '<span class="round">Combat is starting</span><span class="up">Get ready…</span>';
    // Count rows (group members take space too) to decide on one or two columns
    const weight = s.rows.reduce((n, r) => n + (r.group ? 1 + r.members.length * 0.6 : 1), 0);
    const cols = weight > 9 ? 2 : 1;
    wrap.innerHTML = `<header>${header}</header>
      <ol class="list" style="column-count:${cols}">
        ${s.rows.map(r => (r.group ? group(r) : entry(r))).join('')}
      </ol>`;
  }

  function take(s) {
    if (!s || s.at < lastAt) return;
    lastAt = s.at;
    render(s);
  }

  function readStored() {
    try { take(JSON.parse(localStorage.getItem(KEY) || 'null')); } catch { /* storage blocked */ }
  }

  try { new BroadcastChannel(KEY).onmessage = e => (e.data?.type === 'img' ? showImg(e.data) : e.data?.type === 'slide' ? showSlide(e.data) : take(e.data)); } catch { /* fall back to storage events */ }
  window.addEventListener('storage', e => { if (e.key === KEY) readStored(); if (e.key === IMG_KEY) readImg(); if (e.key === SLIDE_KEY) readSlide(); });
  setInterval(() => { readStored(); readImg(); readSlide(); }, 1500); // safety net if a message is missed
  readStored(); readImg(); readSlide();

  // Keep the TV awake while this is open
  let lock = null;
  async function keepAwake() {
    try { if ('wakeLock' in navigator && document.visibilityState === 'visible') lock = await navigator.wakeLock.request('screen'); } catch { /* not allowed */ }
  }
  keepAwake();
  document.addEventListener('visibilitychange', keepAwake);

  // Loaded inside the installed app's own window: offer a way back to the tracker
  if (matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: fullscreen)').matches) {
    const back = document.getElementById('backBtn');
    back.hidden = false;
    back.addEventListener('click', e => e.stopPropagation());
  }

  // Tap for full screen
  const hint = document.getElementById('hint');
  setTimeout(() => hint.classList.add('gone'), 6000);
  document.addEventListener('click', () => {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {});
    else document.exitFullscreen?.();
    hint.classList.add('gone');
  });
})();
