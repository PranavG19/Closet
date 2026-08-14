// Assembles the design-gallery index.html from whatever theme parts exist in ./parts.
// Pure Node, no deps. Re-run after each iteration adds/removes parts:
//   node docs/research/design-gallery/build-index.mjs
// Each part is a self-contained HTML file named <slug>.html; its metadata (title, distance,
// description) is read from gallery-manifest.json (written by the orchestrator each iteration).
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const partsDir = join(here, 'parts');
const manifestPath = join(here, 'gallery-manifest.json');

const manifest = existsSync(manifestPath)
  ? JSON.parse(readFileSync(manifestPath, 'utf8'))
  : { iteration: 0, themes: [] };

// Only include parts that actually exist on disk (a theme may have been culled).
const present = new Set(readdirSync(partsDir).filter((f) => f.endsWith('.html')).map((f) => f.replace(/\.html$/, '')));
const themes = manifest.themes.filter((t) => present.has(t.slug));

const DISTANCE_LABEL = {
  faithful: '70% · close to today',
  'one-step': '20% · a step away',
  wild: '10% · a real departure',
};
const DISTANCE_COLOR = { faithful: '#4E8A6A', 'one-step': '#9A7A38', wild: '#B62E58' };

const cards = themes
  .map(
    (t) => `
    <section class="theme" id="${t.slug}">
      <div class="theme-head">
        <div>
          <span class="badge" style="background:${DISTANCE_COLOR[t.distance] ?? '#847E76'}">${DISTANCE_LABEL[t.distance] ?? t.distance}</span>
          <h2>${t.title}</h2>
          <p class="desc">${t.description ?? ''}</p>
          ${t.signatureMove ? `<p class="sig"><strong>Signature move:</strong> ${t.signatureMove}</p>` : ''}
        </div>
        <a class="open" href="parts/${t.slug}.html" target="_blank" rel="noopener">Open full ↗</a>
      </div>
      <div class="frame-wrap">
        <iframe src="parts/${t.slug}.html" loading="lazy" title="${t.title}"></iframe>
      </div>
    </section>`,
  )
  .join('\n');

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>closet-app — design directions (iteration ${manifest.iteration})</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: #2b2622; color: #EDE6DB;
    font-family: system-ui, -apple-system, sans-serif; line-height: 1.5;
  }
  header.top {
    padding: 40px 32px 24px; border-bottom: 1px solid #4a423a;
    position: sticky; top: 0; background: #2b2622ee; backdrop-filter: blur(8px); z-index: 10;
  }
  header.top h1 { font-family: Georgia, serif; font-weight: 600; font-size: 30px; margin: 0 0 6px; letter-spacing: -0.3px; }
  header.top p { margin: 0; color: #b7afa2; font-size: 14px; }
  nav.jump { margin-top: 16px; display: flex; flex-wrap: wrap; gap: 8px; }
  nav.jump a {
    font-size: 12px; text-decoration: none; color: #EDE6DB; border: 1px solid #4a423a;
    padding: 5px 11px; border-radius: 999px; white-space: nowrap;
  }
  nav.jump a:hover { border-color: #B62E58; }
  main { padding: 24px 32px 96px; display: flex; flex-direction: column; gap: 56px; }
  .theme-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 24px; margin-bottom: 16px; }
  .badge { display: inline-block; font-size: 11px; letter-spacing: 1px; text-transform: uppercase; color: #fff; padding: 3px 9px; border-radius: 999px; margin-bottom: 8px; }
  .theme h2 { font-family: Georgia, serif; font-size: 24px; margin: 0 0 4px; }
  .desc { margin: 0; color: #cfc6bb; max-width: 70ch; }
  .sig { margin: 6px 0 0; color: #a89f95; font-size: 13px; max-width: 70ch; }
  .open { flex: none; font-size: 13px; color: #EDE6DB; text-decoration: none; border: 1px solid #4a423a; padding: 8px 14px; border-radius: 10px; }
  .open:hover { border-color: #B62E58; }
  .frame-wrap {
    background: #f6f2ec; border-radius: 16px; overflow: hidden; border: 1px solid #4a423a;
    /* the part files render their own themed page bg; the iframe just windows it */
  }
  iframe { width: 100%; height: 1000px; border: 0; display: block; background: #f6f2ec; }
  footer { padding: 24px 32px; color: #8a8177; font-size: 12px; border-top: 1px solid #4a423a; }
</style>
</head>
<body>
<header class="top">
  <h1>closet-app — design directions</h1>
  <p>Iteration ${manifest.iteration} · ${themes.length} directions · ${manifest.updated ?? ''} — 70% close to today · 20% a step away · 10% a departure. Refined by successive design-panel workflows; directions are added, culled, and improved each round.</p>
  <nav class="jump">
    ${themes.map((t) => `<a href="#${t.slug}">${t.title}</a>`).join('\n    ')}
  </nav>
</header>
<main>
${cards}
</main>
<footer>Generated gallery — each frame is a standalone mockup in <code>parts/&lt;slug&gt;.html</code>. This is design exploration, not shipped UI.</footer>
</body>
</html>`;

writeFileSync(join(here, 'index.html'), html);
console.log(`Wrote index.html with ${themes.length} themes (iteration ${manifest.iteration}).`);
