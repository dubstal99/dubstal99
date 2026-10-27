// Profil-widgetek: Lioner-arculatú rendszerállapot-kártya (világos és sötét) és a README blog-listája.
// Futtatás: GITHUB_TOKEN=... GH_USER=dubstal99 node scripts/widgets.mjs
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const USER = process.env.GH_USER || 'dubstal99';
const TOKEN = process.env.GITHUB_TOKEN;
const BLOG_URL = 'https://lioner.hu/blog/szerzo/farkas-peter';
const README = process.env.README_PATH || 'README.md';
const OUT_DIR = process.env.OUT_DIR || 'dist';
const FOUNDED = 2021;

// A Lioner arculati színei (navy #170F2B, lila #7861A8, világos kártya #F0F0EF).
const THEMES = {
    light: {
        bg: '#FFFFFF', surface: '#F0F0EF', border: '#E2DEEA', text: '#170F2B', muted: '#5E5577',
        purple: '#7861A8', line: '#7861A8', grid: '#E2DEEA', logoDark: '#170F2B',
    },
    dark: {
        bg: '#170F2B', surface: '#221A3D', border: '#342A58', text: '#FFFFFF', muted: '#B7AED0',
        purple: '#7861A8', line: '#A795D6', grid: '#2E2550', logoDark: '#FFFFFF',
    },
};

const MONTHS = ['jan', 'febr', 'márc', 'ápr', 'máj', 'jún', 'júl', 'aug', 'szept', 'okt', 'nov', 'dec'];

async function fetchCalendar() {
    const query = `query($login: String!) {
        user(login: $login) {
            contributionsCollection {
                contributionCalendar {
                    totalContributions
                    weeks { contributionDays { date contributionCount } }
                }
            }
        }
    }`;
    const res = await fetch('https://api.github.com/graphql', {
        method: 'POST',
        headers: { Authorization: `bearer ${TOKEN}`, 'Content-Type': 'application/json', 'User-Agent': USER },
        body: JSON.stringify({ query, variables: { login: USER } }),
    });
    const json = await res.json();
    if (json.errors) throw new Error(JSON.stringify(json.errors));
    const cal = json.data.user.contributionsCollection.contributionCalendar;
    return { total: cal.totalContributions, weeks: cal.weeks.map(w => w.contributionDays) };
}

function stats({ total, weeks }) {
    const today = new Date().toISOString().slice(0, 10);
    const past = weeks.flat().filter(d => d.date <= today);
    const sum = list => list.reduce((s, d) => s + d.contributionCount, 0);

    let longest = 0, run = 0;
    for (const d of past) {
        run = d.contributionCount > 0 ? run + 1 : 0;
        longest = Math.max(longest, run);
    }

    return {
        today,
        year: Number(today.slice(0, 4)),
        total,
        last30: sum(past.slice(-30)),
        activePct: Math.round((past.filter(d => d.contributionCount > 0).length / past.length) * 100),
        longest,
        // Csak a lezárt hetek, különben a folyamatban lévő hét mindig zuhanásnak látszik.
        weekly: weeks.filter(w => w.length === 7 && w[6].date < today).map(w => ({ start: w[0].date, count: sum(w) })),
    };
}

async function fetchPosts() {
    const html = await (await fetch(BLOG_URL, { headers: { 'User-Agent': USER } })).text();
    const cards = [...html.matchAll(/<a href="(https:\/\/lioner\.hu\/blog\/[^"]+)" class="blog-card[^"]*">([\s\S]*?)<\/a>/g)];
    return cards
        .map(([, url, body]) => {
            const title = body.match(/blog-title">([^<]+)</)?.[1]?.trim();
            const date = body.match(/(\d{4}\. [a-zá-ű]+ \d{1,2}\.)/i)?.[1];
            return title ? { url, title: decodeEntities(title), date } : null;
        })
        .filter(Boolean);
}

function decodeEntities(s) {
    return s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#039;|&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const num = n => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

// Catmull-Rom görbe Bézier-szakaszokra bontva, hogy a heti görbe ne legyen szögletes.
function smoothPath(pts, top, bottom) {
    const clamp = y => Math.min(bottom, Math.max(top, y));
    let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
    for (let i = 0; i < pts.length - 1; i++) {
        const [p0, p1, p2, p3] = [pts[i - 1] || pts[i], pts[i], pts[i + 1], pts[i + 2] || pts[i + 1]];
        const c1 = [p1[0] + (p2[0] - p0[0]) / 6, clamp(p1[1] + (p2[1] - p0[1]) / 6)];
        const c2 = [p2[0] - (p3[0] - p1[0]) / 6, clamp(p2[1] - (p3[1] - p1[1]) / 6)];
        d += ` C${c1[0].toFixed(1)},${c1[1].toFixed(1)} ${c2[0].toFixed(1)},${c2[1].toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
    }
    return d;
}

function statusSvg(st, t, assets) {
    const W = 840, H = 400;
    const fontCss = Object.entries(assets.fonts)
        .map(([family, b64]) => `@font-face{font-family:'${family}';src:url(data:font/woff2;base64,${b64}) format('woff2');}`)
        .join('');
    const logo = assets.logo.replace(/class="st0"/g, `fill="${t.logoDark}"`).replace(/class="st1"/g, `fill="${t.purple}"`);

    // Heti görbe az elmúlt egy évre.
    const cx = 336, cy = 104, cw = 472, ch = 120;
    const max = Math.max(...st.weekly.map(w => w.count), 1);
    const pts = st.weekly.map((w, i) => [cx + (i / (st.weekly.length - 1)) * cw, cy + ch - (w.count / max) * ch]);
    const line = smoothPath(pts, cy, cy + ch);
    const area = `${line} L${cx + cw},${cy + ch} L${cx},${cy + ch} Z`;
    const peak = st.weekly.findIndex(w => w.count === max);
    const last = pts[pts.length - 1];

    let lastMonth = -1;
    const monthLabels = st.weekly.map((w, i) => {
        const m = Number(w.start.slice(5, 7)) - 1;
        if (m === lastMonth || i === 0 || i > st.weekly.length - 3) { lastMonth = m; return ''; }
        lastMonth = m;
        return `<text x='${pts[i][0].toFixed(1)}' y='${cy + ch + 20}' class='p' font-size='10' fill='${t.muted}' text-anchor='middle'>${MONTHS[m]}</text>`;
    }).join('');

    const tiles = [
        [num(st.last30), 'az elmúlt 30 napban'],
        [`${st.activePct}%`, 'a napoknak aktív'],
        [`${st.longest} nap`, 'leghosszabb sorozat'],
        [`${st.year - FOUNDED}. éve`, `üzemel a Lioner, ${FOUNDED} óta`],
    ];
    const tw = (W - 64 - 3 * 16) / 4;
    const tileSvg = tiles.map(([v, k], i) => {
        const x = 32 + i * (tw + 16);
        return `<rect x='${x}' y='274' width='${tw}' height='78' rx='14' fill='${t.surface}' stroke='${t.border}'/>`
            + `<rect x='${x + 18}' y='292' width='22' height='4' rx='2' fill='${t.purple}'/>`
            + `<text x='${x + 18}' y='326' class='m' font-size='22' fill='${t.text}'>${esc(v)}</text>`
            + `<text x='${x + 18}' y='343' class='p' font-size='10.5' fill='${t.muted}'>${esc(k)}</text>`;
    }).join('');

    const gridLines = [0, 0.5, 1].map(f => `<line x1='${cx}' x2='${cx + cw}' y1='${(cy + ch * f).toFixed(1)}' y2='${(cy + ch * f).toFixed(1)}' stroke='${t.grid}' stroke-dasharray='3 5'/>`).join('');

    return `<svg xmlns='http://www.w3.org/2000/svg' width='${W}' height='${H}' viewBox='0 0 ${W} ${H}' role='img' aria-label='Farkas Péter rendszerállapot-kártyája: ${num(st.total)} hozzájárulás az elmúlt évben'>
<style>${fontCss}
.m{font-family:'Montserrat',-apple-system,'Segoe UI',sans-serif;font-weight:700}
.pb{font-family:'PoppinsB',-apple-system,'Segoe UI',sans-serif;font-weight:700}
.p{font-family:'Poppins',-apple-system,'Segoe UI',sans-serif}
.draw{stroke-dasharray:1;stroke-dashoffset:1;animation:draw 2.4s ease-out forwards}
.fade{opacity:0;animation:fade 1.2s ease-out .8s forwards}
.pulse{transform-origin:${last[0].toFixed(1)}px ${last[1].toFixed(1)}px;animation:pulse 2.2s ease-out 2.4s infinite}
@keyframes draw{to{stroke-dashoffset:0}}
@keyframes fade{to{opacity:1}}
@keyframes pulse{0%{transform:scale(1);opacity:.6}100%{transform:scale(3.2);opacity:0}}
</style>
<defs>
<linearGradient id='fill' x1='0' y1='0' x2='0' y2='1'><stop offset='0' stop-color='${t.purple}' stop-opacity='.55'/><stop offset='1' stop-color='${t.purple}' stop-opacity='0'/></linearGradient>
<radialGradient id='glow' cx='1' cy='0' r='1'><stop offset='0' stop-color='${t.purple}' stop-opacity='.22'/><stop offset='1' stop-color='${t.purple}' stop-opacity='0'/></radialGradient>
</defs>
<rect x='0.5' y='0.5' width='${W - 1}' height='${H - 1}' rx='20' fill='${t.bg}' stroke='${t.border}'/>
<rect x='0.5' y='0.5' width='${W - 1}' height='${H - 1}' rx='20' fill='url(#glow)'/>

<svg x='32' y='26' width='86' height='32' viewBox='92.01 174.5 657.86 246.27'>${logo}</svg>
<line x1='134' y1='30' x2='134' y2='54' stroke='${t.border}'/>
<text x='150' y='47' class='pb' font-size='11' letter-spacing='2.2' fill='${t.purple}'>RENDSZERÁLLAPOT</text>

<rect x='${W - 232}' y='27' width='200' height='30' rx='15' fill='${t.purple}'/>
<circle cx='${W - 212}' cy='42' r='4' fill='#FFFFFF'><animate attributeName='opacity' values='1;.3;1' dur='2s' repeatCount='indefinite'/></circle>
<text x='${W - 200}' y='46.5' class='pb' font-size='10' letter-spacing='1.2' fill='#FFFFFF'>MINDEN RENDSZER ÜZEMEL</text>

<text x='32' y='112' class='pb' font-size='10.5' letter-spacing='2' fill='${t.purple}'>AZ ELMÚLT 12 HÓNAPBAN</text>
<text x='30' y='172' class='m' font-size='56' fill='${t.text}'>${num(st.total)}</text>
<text x='32' y='200' class='p' font-size='13' fill='${t.muted}'>hozzájárulás GitHubon,</text>
<text x='32' y='219' class='p' font-size='13' fill='${t.muted}'>a privát ügyfélmunkával együtt</text>

<text x='${cx}' y='${cy - 14}' class='p' font-size='11' fill='${t.muted}'>Heti aktivitás</text>
<text x='${cx + cw}' y='${cy - 14}' class='p' font-size='11' fill='${t.muted}' text-anchor='end'>csúcs: ${num(max)} / hét</text>
${gridLines}
<path d='${area}' fill='url(#fill)' class='fade'/>
<path d='${line}' fill='none' stroke='${t.line}' stroke-width='2.5' stroke-linecap='round' pathLength='1' class='draw'/>
<circle cx='${pts[peak][0].toFixed(1)}' cy='${pts[peak][1].toFixed(1)}' r='3.5' fill='${t.bg}' stroke='${t.line}' stroke-width='2' class='fade'/>
<circle cx='${last[0].toFixed(1)}' cy='${last[1].toFixed(1)}' r='5' fill='${t.line}' class='pulse'/>
<circle cx='${last[0].toFixed(1)}' cy='${last[1].toFixed(1)}' r='5' fill='${t.line}' stroke='${t.bg}' stroke-width='2'/>
${monthLabels}

${tileSvg}

<text x='32' y='380' class='p' font-size='10.5' fill='${t.muted}'>lioner.hu · Kecskemét</text>
<text x='${W - 32}' y='380' class='p' font-size='10.5' fill='${t.muted}' text-anchor='end'>frissítve: ${st.today}</text>
</svg>
`;
}

async function loadAssets() {
    const b64 = async f => (await readFile(new URL(`../assets/fonts/${f}`, import.meta.url))).toString('base64');
    return {
        logo: await readFile(new URL('../assets/brand/lioner-logo-body.svg', import.meta.url), 'utf8'),
        fonts: { Montserrat: await b64('Montserrat-Bold.woff2'), PoppinsB: await b64('Poppins-Bold.woff2'), Poppins: await b64('Poppins-Regular.woff2') },
    };
}

async function updateReadme(posts) {
    const readme = await readFile(README, 'utf8');
    const list = posts.slice(0, 5).map(p => `- [${p.title}](${p.url})${p.date ? ` · ${p.date}` : ''}`).join('\n');
    const next = readme.replace(/(<!-- BLOG:START -->)[\s\S]*?(<!-- BLOG:END -->)/, `$1\n${list}\n$2`);
    if (next !== readme) await writeFile(README, next);
}

const [calendar, posts, assets] = await Promise.all([fetchCalendar(), fetchPosts().catch(() => []), loadAssets()]);
const st = stats(calendar);
await mkdir(OUT_DIR, { recursive: true });
await writeFile(`${OUT_DIR}/status-light.svg`, statusSvg(st, THEMES.light, assets));
await writeFile(`${OUT_DIR}/status-dark.svg`, statusSvg(st, THEMES.dark, assets));
if (posts.length) await updateReadme(posts);
console.log(JSON.stringify({ total: st.total, last30: st.last30, activePct: st.activePct, longest: st.longest, posts: posts.length }));
