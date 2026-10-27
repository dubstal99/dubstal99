// Profil-widgetek: rendszerállapot-kártya (világos és sötét) és a README blog-listája.
// Futtatás: GITHUB_TOKEN=... GH_USER=dubstal99 node scripts/widgets.mjs
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const USER = process.env.GH_USER || 'dubstal99';
const TOKEN = process.env.GITHUB_TOKEN;
const BLOG_URL = 'https://lioner.hu/blog/szerzo/farkas-peter';
const README = process.env.README_PATH || 'README.md';
const OUT_DIR = process.env.OUT_DIR || 'dist';

// Amiket életben tartunk, és mióta. Az év a lioner.hu-n is szereplő adat.
const SYSTEMS = [
    { name: 'Lioner', note: 'a cég', since: 2021 },
    { name: 'TrustPhone', note: 'ERP és CRM, 20+ felhasználó', since: 2021 },
];

const THEMES = {
    light: { bg: '#ffffff', border: '#d0d7de', text: '#1f2328', muted: '#656d76', faint: '#eaeef2', ok: '#1a7f37', bar: ['#eaeef2', '#c9b8f5', '#9f80ee', '#7b52e0', '#5b2fc4'] },
    dark: { bg: '#0d1117', border: '#30363d', text: '#e6edf3', muted: '#8b949e', faint: '#21262d', ok: '#3fb950', bar: ['#21262d', '#3b2a73', '#5a3fb0', '#7d5ce6', '#a78bfa'] },
};
const LEVEL = { NONE: 0, FIRST_QUARTILE: 1, SECOND_QUARTILE: 2, THIRD_QUARTILE: 3, FOURTH_QUARTILE: 4 };

async function fetchDays() {
    const query = `query($login: String!) {
        user(login: $login) {
            contributionsCollection {
                contributionCalendar {
                    totalContributions
                    weeks { contributionDays { date contributionCount contributionLevel } }
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
    return { total: cal.totalContributions, days: cal.weeks.flatMap(w => w.contributionDays) };
}

function stats({ total, days }) {
    const today = new Date().toISOString().slice(0, 10);
    const past = days.filter(d => d.date <= today);
    const sum = list => list.reduce((s, d) => s + d.contributionCount, 0);

    let longest = 0, run = 0;
    for (const d of past) {
        run = d.contributionCount > 0 ? run + 1 : 0;
        longest = Math.max(longest, run);
    }
    const active = past.filter(d => d.contributionCount > 0).length;

    return {
        today,
        year: Number(today.slice(0, 4)),
        total,
        last30: sum(past.slice(-30)),
        activePct: Math.round((active / past.length) * 100),
        longest,
        last90: past.slice(-90),
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
const num = n => n.toLocaleString('hu-HU').replace(/\s/g, ' ');

// Státuszoldal-kártya: a rendszerek "üzemideje", alatta 90 oszlop, ahogy a státuszoldalakon,
// csak itt minden oszlop egy nap hozzájárulása.
function statusSvg(st, t) {
    const W = 760, H = 292;
    const font = "font-family='-apple-system,BlinkMacSystemFont,Segoe UI,Helvetica,Arial,sans-serif'";
    const mono = "font-family='ui-monospace,SFMono-Regular,Menlo,Consolas,monospace'";

    let y = 78;
    const rows = SYSTEMS.map(s => {
        const years = st.year - s.since;
        const row = `<circle cx='34' cy='${y - 5}' r='6' fill='${t.ok}'/>`
            + `<text x='50' y='${y}' ${font} font-size='15' font-weight='600' fill='${t.text}'>${esc(s.name)}</text>`
            + `<text x='${50 + s.name.length * 9 + 12}' y='${y}' ${font} font-size='13' fill='${t.muted}'>${esc(s.note)}</text>`
            + `<text x='${W - 28}' y='${y}' ${font} font-size='13' fill='${t.ok}' text-anchor='end'>üzemel ${s.since} óta · ${years}. éve</text>`;
        y += 30;
        return row;
    }).join('');

    const barTop = 150, barH = 40, gap = 2;
    const barW = (W - 56 - gap * 89) / 90;
    const bars = st.last90.map((d, i) => {
        const lvl = LEVEL[d.contributionLevel] ?? 0;
        return `<rect x='${(28 + i * (barW + gap)).toFixed(2)}' y='${barTop}' width='${barW.toFixed(2)}' height='${barH}' rx='2' fill='${t.bar[lvl]}'><title>${d.date}: ${d.contributionCount}</title></rect>`;
    }).join('');

    const facts = [
        [num(st.total), 'hozzájárulás az elmúlt évben'],
        [num(st.last30), 'az elmúlt 30 napban'],
        [`${st.activePct}%`, 'aktív nap'],
        [`${st.longest} nap`, 'leghosszabb sorozat'],
    ];
    const colW = (W - 56) / facts.length;
    const factSvg = facts.map(([v, k], i) => {
        const x = 28 + i * colW;
        return `<text x='${x}' y='246' ${font} font-size='20' font-weight='700' fill='${t.text}'>${esc(v)}</text>`
            + `<text x='${x}' y='266' ${font} font-size='12' fill='${t.muted}'>${esc(k)}</text>`;
    }).join('');

    return `<svg xmlns='http://www.w3.org/2000/svg' width='${W}' height='${H}' viewBox='0 0 ${W} ${H}' role='img' aria-label='Farkas Péter rendszerállapot-kártyája: ${num(st.total)} hozzájárulás az elmúlt évben'>
<rect x='0.5' y='0.5' width='${W - 1}' height='${H - 1}' rx='12' fill='${t.bg}' stroke='${t.border}'/>
<text x='28' y='38' ${font} font-size='16' font-weight='700' fill='${t.text}'>Rendszerállapot</text>
<text x='${W - 28}' y='38' ${mono} font-size='11' fill='${t.muted}' text-anchor='end'>frissítve: ${st.today}</text>
${rows}
<text x='28' y='${barTop - 10}' ${font} font-size='12' fill='${t.muted}'>Hozzájárulások, elmúlt 90 nap</text>
${bars}
<text x='28' y='${barTop + barH + 16}' ${mono} font-size='10' fill='${t.muted}'>90 napja</text>
<text x='${W - 28}' y='${barTop + barH + 16}' ${mono} font-size='10' fill='${t.muted}' text-anchor='end'>ma</text>
<line x1='28' y1='214' x2='${W - 28}' y2='214' stroke='${t.faint}'/>
${factSvg}
</svg>
`;
}

async function updateReadme(posts) {
    const readme = await readFile(README, 'utf8');
    const list = posts.slice(0, 5).map(p => `- [${p.title}](${p.url})${p.date ? ` · ${p.date}` : ''}`).join('\n');
    const next = readme.replace(/(<!-- BLOG:START -->)[\s\S]*?(<!-- BLOG:END -->)/, `$1\n${list}\n$2`);
    if (next !== readme) await writeFile(README, next);
}

const [calendar, posts] = await Promise.all([fetchDays(), fetchPosts().catch(() => [])]);
const st = stats(calendar);
await mkdir(OUT_DIR, { recursive: true });
await writeFile(`${OUT_DIR}/status-light.svg`, statusSvg(st, THEMES.light));
await writeFile(`${OUT_DIR}/status-dark.svg`, statusSvg(st, THEMES.dark));
if (posts.length) await updateReadme(posts);
console.log(JSON.stringify({ total: st.total, last30: st.last30, activePct: st.activePct, longest: st.longest, posts: posts.length }));
