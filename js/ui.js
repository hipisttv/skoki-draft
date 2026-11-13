// Drobne elementy interfejsu: ikony, flagi, awatary, modal, powiadomienia.

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const ICONS = {
  trophy: '<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4Z"/><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/>',
  team: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><circle cx="17" cy="9" r="2.5"/><path d="M16 14.2c2.8.2 5 2.5 5 5.8"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.5 2.6 3.7 5.4 3.7 8.5s-1.2 5.9-3.7 8.5c-2.5-2.6-3.7-5.4-3.7-8.5S9.5 6.1 12 3.5Z"/>',
  draft: '<path d="M4 6h16M4 12h10M4 18h7"/><path d="m15 17 2 2 4-4"/>',
  list: '<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  logout: '<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l5-5-5-5M15 12H3"/>',
  lock: '<rect x="4.5" y="10.5" width="15" height="10" rx="2"/><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5"/>',
  unlock: '<rect x="4.5" y="10.5" width="15" height="10" rx="2"/><path d="M8 10.5V7a4 4 0 0 1 7.8-1.2"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M17 6l3 3M14 9l2 2"/>',
  back: '<path d="M15 18l-6-6 6-6"/>',
  chevron: '<path d="M9 6l6 6-6 6"/>',
  pin: '<path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21Z"/><circle cx="12" cy="9.5" r="2.5"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  ruler: '<path d="M3 17 17 3l4 4L7 21Z"/><path d="m7 13 2 2M10 10l2 2M13 7l2 2"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  shuffle: '<path d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/>',
  play: '<path d="M7 4.5v15l12-7.5Z"/>',
  download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
  upload: '<path d="M12 20V9M7 14l5-5 5 5M5 4h14"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  swap: '<path d="M7 4 3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7"/>',
  star: '<path d="m12 3.5 2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.8l-5.2 2.8 1-5.8-4.3-4.1 5.9-.8Z"/>',
  chart: '<path d="M4 20V11M10 20V5M16 20v-6M2 20h20"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 7.5v.5"/>',
  snow: '<path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9M9 4.5l3 2 3-2M9 19.5l3-2 3 2"/>',
};

export function icon(name, cls = '') {
  return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;
}

// Logo ligi (img/logo.png ma przezroczysty margines – przycinamy go w CSS, klasa .logo)
export const LOGO = '<span class="logo"><img src="img/logo.png" alt=""></span>';
export const LOGO_DARK = LOGO;

export const MOUNTAINS = `<svg class="mountains" viewBox="0 0 1200 300" preserveAspectRatio="none" aria-hidden="true">
  <path d="M0 300 L0 210 L120 150 L210 190 L330 90 L450 170 L560 120 L700 200 L820 80 L960 180 L1080 130 L1200 170 L1200 300Z" fill="rgba(255,255,255,.07)"/>
  <path d="M0 300 L0 250 L160 190 L300 240 L470 160 L620 230 L760 170 L900 240 L1050 190 L1200 230 L1200 300Z" fill="rgba(255,255,255,.1)"/>
  <path d="M330 90 L300 120 L320 115 L345 128 L362 112Z M820 80 L790 112 L812 106 L836 120 L852 102Z" fill="rgba(255,255,255,.35)"/>
</svg>`;

// Kody FIS -> ISO (do flag)
const ISO = {
  SLO: 'si', AUT: 'at', GER: 'de', POL: 'pl', NOR: 'no', JPN: 'jp', SUI: 'ch', FIN: 'fi', CZE: 'cz', ITA: 'it',
  USA: 'us', CAN: 'ca', KAZ: 'kz', BUL: 'bg', EST: 'ee', FRA: 'fr', SVK: 'sk', UKR: 'ua', TUR: 'tr', ROU: 'ro',
  CHN: 'cn', KOR: 'kr', SWE: 'se', RUS: 'ru', GBR: 'gb', ISL: 'is', LAT: 'lv', LTU: 'lt', GEO: 'ge', BLR: 'by',
  HUN: 'hu', NED: 'nl', ESP: 'es', BEL: 'be', DEN: 'dk', RSA: 'za', ISR: 'il', AND: 'ad', KGZ: 'kg', ARG: 'ar',
  AZE: 'az', KOS: 'xk', SGP: 'sg', SRB: 'rs', THA: 'th',
};
// Kody FIS -> polskie nazwy krajów (wyszukiwanie po „Polska”, „Niemcy”…)
const COUNTRY = {
  SLO: 'Słowenia', AUT: 'Austria', GER: 'Niemcy', POL: 'Polska', NOR: 'Norwegia', JPN: 'Japonia', SUI: 'Szwajcaria',
  FIN: 'Finlandia', CZE: 'Czechy', ITA: 'Włochy', USA: 'Stany Zjednoczone USA', CAN: 'Kanada', KAZ: 'Kazachstan',
  BUL: 'Bułgaria', EST: 'Estonia', FRA: 'Francja', SVK: 'Słowacja', UKR: 'Ukraina', TUR: 'Turcja', ROU: 'Rumunia',
  CHN: 'Chiny', KOR: 'Korea Południowa', SWE: 'Szwecja', RUS: 'Rosja', GBR: 'Wielka Brytania', ISL: 'Islandia',
  LAT: 'Łotwa', LTU: 'Litwa', GEO: 'Gruzja', BLR: 'Białoruś', HUN: 'Węgry', NED: 'Holandia', ESP: 'Hiszpania',
  BEL: 'Belgia', DEN: 'Dania', RSA: 'RPA', ISR: 'Izrael', AND: 'Andora', KGZ: 'Kirgistan', ARG: 'Argentyna',
  AZE: 'Azerbejdżan', KOS: 'Kosowo', SGP: 'Singapur', SRB: 'Serbia', THA: 'Tajlandia',
};
export const countryName = (nation) => COUNTRY[nation] || nation;
// tekst do wyszukiwania: małe litery bez polskich znaków („slowenia” znajdzie Słowenię)
export const fold = (t) => String(t).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l');
export function flag(nation) {
  const iso = ISO[nation];
  return iso
    ? `<img class="flag" src="https://flagcdn.com/w40/${iso}.png" alt="${esc(nation)}" title="${esc(countryName(nation))}" loading="lazy" width="20" height="14">`
    : '<span class="flag blank"></span>';
}

export const COLORS = ['#1f6feb', '#e5484d', '#12a594', '#f59e0b', '#8e4ec6', '#e54d9e', '#0ea5e9', '#65a30d'];

export function initials(name) {
  const parts = String(name || '?').trim().split(/\s+/);
  return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase() || '?';
}

export function avatar(p, cls = '') {
  if (!p) return '';
  const label = p.team || p.name;
  if (p.photo) return `<span class="av ${cls} has-photo" style="--c:${p.color}" title="${esc(label)}"><img src="${p.photo}" alt=""></span>`;
  return `<span class="av ${cls}" style="background:${p.color}" title="${esc(label)}">${esc(initials(label))}</span>`;
}

// ---------------------------------------------------------------- powiadomienia

export function toast(msg, kind = '') {
  const box = document.getElementById('toasts');
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.innerHTML = (kind === 'err' ? icon('info') : kind === 'ok' ? icon('check') : '') + `<span>${esc(msg)}</span>`;
  el.querySelector('svg')?.setAttribute('width', '18');
  box.appendChild(el);
  // najwyżej 3 naraz – przy szybkim drafcie starsze znikają
  while (box.children.length > 3) box.firstElementChild.remove();
  setTimeout(() => el.remove(), kind === 'err' ? 5000 : 3000);
}

// Modal potwierdzenia albo prosty formularz. Zwraca Promise<false | {wartości pól}>.
export function modal({ title, text = '', fields = [], ok = 'OK', cancel = 'Anuluj', danger = false }) {
  return new Promise((resolve) => {
    const bg = document.createElement('div');
    bg.className = 'modal-bg';
    bg.innerHTML = `<form class="modal" autocomplete="off">
      <h3>${esc(title)}</h3>${text ? `<p>${text}</p>` : ''}
      ${fields.map((f) => `<label class="field" style="margin-top:1rem"><span>${esc(f.label)}</span>
        <input name="${f.name}" type="${f.type || 'text'}" value="${esc(f.value || '')}" ${f.attrs || ''}></label>`).join('')}
      <div class="formerr"></div>
      <div class="actions">${cancel ? `<button type="button" data-x>${esc(cancel)}</button>` : ''}
        <button type="submit" class="${danger ? 'danger solid' : 'primary'}">${esc(ok)}</button></div>
    </form>`;
    const close = (v) => { bg.remove(); resolve(v); };
    bg.addEventListener('click', (e) => { if (e.target === bg || e.target.closest('[data-x]')) close(false); });
    bg.querySelector('form').addEventListener('submit', (e) => {
      e.preventDefault();
      close(Object.fromEntries(new FormData(e.target)));
    });
    document.body.appendChild(bg);
    (bg.querySelector('input') || bg.querySelector('button[type=submit]')).focus();
  });
}

export const confirmModal = (title, text, ok = 'Tak', danger = false) => modal({ title, text, ok, danger }).then((v) => v !== false);

// Wybór jednej z opcji (duże przyciski). options: [{ value, html }]. Zwraca Promise<value | false>.
export function choose({ title, text = '', options }) {
  return new Promise((resolve) => {
    const bg = document.createElement('div');
    bg.className = 'modal-bg';
    bg.innerHTML = `<div class="modal">
      <h3>${esc(title)}</h3>${text ? `<p>${text}</p>` : ''}
      <div class="choices">${options.map((o, i) => `<button type="button" class="choice" data-i="${i}">${o.html}</button>`).join('')}</div>
      <div class="actions"><button type="button" data-x>Anuluj</button></div>
    </div>`;
    const close = (v) => { bg.remove(); resolve(v); };
    bg.addEventListener('click', (e) => {
      const c = e.target.closest('.choice');
      if (c) close(options[+c.dataset.i].value);
      else if (e.target === bg || e.target.closest('[data-x]')) close(false);
    });
    document.body.appendChild(bg);
  });
}

// ---------------------------------------------------------------- hasła

export async function hash(salt, secret) {
  const data = new TextEncoder().encode(`${salt}:${secret}`);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export const randomId = (n = 8) => [...crypto.getRandomValues(new Uint8Array(n))].map((b) => (b % 36).toString(36)).join('');
