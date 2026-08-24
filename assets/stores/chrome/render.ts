#!/usr/bin/env bun
/**
 * Generate and render Lightling Chrome Web Store image assets.
 *
 * SVGs embed the raster sources as data URIs so librsvg can render them
 * without relaxing its local-file sandbox. Re-running is idempotent and
 * replaces only generated files (svg/*.svg and the rendered PNGs).
 *
 * Usage: bun run assets/stores/chrome/render.ts [--out <dir>]
 * Renders into the script directory by default; --out targets another
 * store's asset directory (e.g. assets/stores/firefox).
 * Requires: rsvg-convert, magick, identify.
 */

import { execFile } from 'node:child_process';
import {
  copyFileSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);

const HERE = fileURLToPath(new URL('.', import.meta.url));
const REPO = join(HERE, '..', '..', '..');
const RAW = join(REPO, 'assets/stores/chrome/screenshots-raw');
const LOGO = join(REPO, 'src/static/logo.png');

const COLORS = {
  paper: '#fbf7ee',
  paperDeep: '#f3eadb',
  navy: '#041335',
  ink: '#0a1030',
  muted: '#495069',
  indigo: '#1348dc',
  indigoDark: '#0f3bb7',
  indigoPale: '#dee8fd',
  amber: '#e07e03',
  amberPale: '#fdefc8',
  white: '#fffefb',
} as const;

interface Shot {
  name: string;
  source: string;
  label: string;
  headline: readonly string[];
  body: readonly string[];
  layout: 'hero' | 'selection' | 'wide';
  accent: string;
}

const SHOTS: Shot[] = [
  {
    name: '01-popup',
    source: 'Screenshot from 2026-08-24 16-59-59.png',
    label: 'PAGE TRANSLATION',
    headline: ['Translate any page,', 'in one click.'],
    body: [
      'Full-page translation with live progress.',
      '130+ languages, right where you read.',
    ],
    layout: 'hero',
    accent: COLORS.amber,
  },
  {
    name: '02-selection-popup',
    source: 'Screenshot from 2026-08-24 16-48-02.png',
    label: 'HIGHLIGHTED TEXT',
    headline: ['Select text. Get the translation.'],
    body: ['Hear it, copy it, or save it to your dictionary.'],
    layout: 'selection',
    accent: COLORS.amber,
  },
  {
    name: '03-full-page-translation',
    source: 'Screenshot from 2026-08-24 16-53-10.png',
    label: 'FULL-PAGE TRANSLATION',
    headline: ['One click translates the whole page.'],
    body: ['The layout stays intact while Lightling works through every word.'],
    layout: 'wide',
    accent: COLORS.indigo,
  },
  {
    name: '04-original-page',
    source: 'Screenshot from 2026-08-24 16-55-08.png',
    label: 'ORIGINAL VIEW',
    headline: ['Switch back whenever you need context.'],
    body: ['Move between the original and translated page without losing your place.'],
    layout: 'wide',
    accent: COLORS.amber,
  },
  {
    name: '05-settings',
    source: 'Screenshot from 2026-08-24 16-55-21.png',
    label: 'YOUR TRANSLATOR, YOUR RULES',
    headline: ['Choose how every word is translated.'],
    body: ['Use popular services, custom LLMs, or the private on-device engine.'],
    layout: 'wide',
    accent: COLORS.indigo,
  },
  {
    name: '06-dictionary',
    source: 'Screenshot from 2026-08-24 16-56-36.png',
    label: 'PERSONAL DICTIONARY',
    headline: ['Turn quick lookups into lasting vocabulary.'],
    body: ['Save words, filter by language, and keep learning even while offline.'],
    layout: 'wide',
    accent: COLORS.amber,
  },
  {
    name: '07-history',
    source: 'Screenshot from 2026-08-24 16-56-53.png',
    label: 'TRANSLATION HISTORY',
    headline: ['Every translation, remembered.'],
    body: ['Search past translations and return to useful phrases at any time.'],
    layout: 'wide',
    accent: COLORS.indigo,
  },
];

/** Matches Python's html.escape (quotes included). */
const escapeXml = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#x27;');

const dataUri = (path: string): string =>
  `data:image/png;base64,${readFileSync(path).toString('base64')}`;

const defs = (clipW?: number, clipH?: number): string => {
  const clip =
    clipW !== undefined && clipH !== undefined
      ? `<clipPath id="screenClip"><rect width="${clipW.toFixed(2)}" height="${clipH.toFixed(2)}" rx="16"/></clipPath>`
      : '';
  return `
  <defs>
    <radialGradient id="blueWash" cx="50%" cy="50%" r="50%">
      <stop offset="0" stop-color="${COLORS.indigoPale}" stop-opacity="0.96"/>
      <stop offset="1" stop-color="${COLORS.indigoPale}" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="amberWash" cx="50%" cy="50%" r="50%">
      <stop offset="0" stop-color="${COLORS.amberPale}" stop-opacity="0.92"/>
      <stop offset="1" stop-color="${COLORS.amberPale}" stop-opacity="0"/>
    </radialGradient>
    <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
      <path d="M 40 0 L 0 0 0 40" fill="none" stroke="${COLORS.indigoDark}" stroke-width="1" stroke-opacity="0.055"/>
    </pattern>
    <pattern id="dots" width="18" height="18" patternUnits="userSpaceOnUse">
      <circle cx="2" cy="2" r="1.15" fill="${COLORS.indigo}" fill-opacity="0.13"/>
    </pattern>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="160%">
      <feDropShadow dx="0" dy="20" stdDeviation="24" flood-color="${COLORS.navy}" flood-opacity="0.18"/>
      <feDropShadow dx="0" dy="3" stdDeviation="4" flood-color="${COLORS.navy}" flood-opacity="0.12"/>
    </filter>
    <filter id="grain" x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency="0.82" numOctaves="2" stitchTiles="stitch" result="noise"/>
      <feColorMatrix in="noise" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0.58 0.58 0.58 0 0"/>
      <feComposite operator="in" in2="SourceGraphic"/>
    </filter>
    ${clip}
  </defs>`;
};

const background = (width: number, height: number, stronger = false): string => {
  const blueOpacity = stronger ? 0.94 : 0.78;
  return `
  <rect width="${width}" height="${height}" fill="${COLORS.paper}"/>
  <ellipse cx="${(width * 0.87).toFixed(0)}" cy="${(-height * 0.05).toFixed(0)}" rx="${(width * 0.52).toFixed(0)}" ry="${(height * 0.72).toFixed(0)}" fill="url(#blueWash)" opacity="${blueOpacity}"/>
  <ellipse cx="${(width * 0.07).toFixed(0)}" cy="${(height * 1.02).toFixed(0)}" rx="${(width * 0.48).toFixed(0)}" ry="${(height * 0.62).toFixed(0)}" fill="url(#amberWash)" opacity="0.72"/>
  <path d="M 0 ${(height * 0.82).toFixed(0)} L ${width} ${(height * 0.5).toFixed(0)} L ${width} ${height} L 0 ${height} Z" fill="${COLORS.white}" opacity="0.26"/>
  <rect width="${width}" height="${height}" fill="url(#grid)"/>
  <path d="M ${width - 230} 0 H ${width} V 230" fill="url(#dots)" opacity="0.72"/>
  <path d="M 0 ${height - 170} H 260 V ${height}" fill="url(#dots)" opacity="0.55"/>`;
};

const grainOverlay = (width: number, height: number): string =>
  `<rect width="${width}" height="${height}" filter="url(#grain)" opacity="0.045" pointer-events="none"/>`;

const logoLockup = (logoUri: string, x = 72, y = 44, size = 42): string => `
  <image href="${logoUri}" x="${x}" y="${y}" width="${size}" height="${size}"/>
  <text x="${x + size + 14}" y="${y + size - 8}" font-family="IBM Plex Sans" font-size="27" font-weight="600" fill="${COLORS.navy}">Lightling</text>`;

const kicker = (label: string, x: number, y: number): string => `
  <rect x="${x}" y="${y - 14}" width="26" height="4" rx="2" fill="${COLORS.indigo}"/>
  <text x="${x + 38}" y="${y - 6}" font-family="IBM Plex Mono" font-size="15" font-weight="500" letter-spacing="2.3" fill="${COLORS.indigoDark}">${escapeXml(label)}</text>`;

const multilineText = (
  lines: readonly string[],
  x: number,
  y: number,
  size: number,
  lineHeight: number,
  weight = 600,
): string => {
  const tspans = lines
    .map(
      (line, index) =>
        `<tspan x="${x}" dy="${index === 0 ? 0 : lineHeight}">${escapeXml(line)}</tspan>`,
    )
    .join('');
  return `<text x="${x}" y="${y}" font-family="IBM Plex Sans" font-size="${size}" font-weight="${weight}" letter-spacing="-0.7" fill="${COLORS.ink}">${tspans}</text>`;
};

const bodyText = (
  lines: readonly string[],
  x: number,
  y: number,
  size = 20,
  lineHeight = 30,
): string => {
  const tspans = lines
    .map(
      (line, index) =>
        `<tspan x="${x}" dy="${index === 0 ? 0 : lineHeight}">${escapeXml(line)}</tspan>`,
    )
    .join('');
  return `<text x="${x}" y="${y}" font-family="IBM Plex Sans" font-size="${size}" font-weight="400" fill="${COLORS.muted}">${tspans}</text>`;
};

const chip = (
  x: number,
  y: number,
  text: string,
  accent: string = COLORS.indigo,
): string => {
  const width = Math.max(116, text.length * 8.8 + 36);
  return `
  <g transform="translate(${x} ${y})">
    <rect width="${width.toFixed(0)}" height="34" rx="17" fill="${COLORS.white}" stroke="${accent}" stroke-opacity="0.35"/>
    <circle cx="17" cy="17" r="4" fill="${accent}"/>
    <text x="29" y="22" font-family="IBM Plex Mono" font-size="12" font-weight="500" letter-spacing="0.7" fill="${COLORS.ink}">${escapeXml(text)}</text>
  </g>`;
};

const screenCard = (
  imageUri: string,
  x: number,
  y: number,
  width: number,
  height: number,
  angle: number,
  accent: string,
): string => {
  const accentFill = accent === COLORS.amber ? COLORS.amberPale : COLORS.indigoPale;
  return `
  <g transform="translate(${(x + 10).toFixed(2)} ${(y + 13).toFixed(2)}) rotate(${(-angle * 1.8).toFixed(2)} ${(width / 2).toFixed(2)} ${(height / 2).toFixed(2)})">
    <rect width="${width.toFixed(2)}" height="${height.toFixed(2)}" rx="18" fill="${accentFill}" stroke="${accent}" stroke-opacity="0.30" stroke-width="2"/>
  </g>
  <g transform="translate(${x.toFixed(2)} ${y.toFixed(2)}) rotate(${angle.toFixed(2)} ${(width / 2).toFixed(2)} ${(height / 2).toFixed(2)})">
    <rect width="${width.toFixed(2)}" height="${height.toFixed(2)}" rx="16" fill="${COLORS.white}" filter="url(#shadow)"/>
    <image href="${imageUri}" width="${width.toFixed(2)}" height="${height.toFixed(2)}" preserveAspectRatio="xMidYMid meet" clip-path="url(#screenClip)"/>
    <rect x="0.75" y="0.75" width="${(width - 1.5).toFixed(2)}" height="${(height - 1.5).toFixed(2)}" rx="15.25" fill="none" stroke="${COLORS.navy}" stroke-opacity="0.18" stroke-width="1.5"/>
  </g>`;
};

const shotSvg = (shot: Shot, number: number, logoUri: string): string => {
  const imageUri = dataUri(join(RAW, shot.source));
  const index = String(number).padStart(2, '0');

  let content: string;
  let clipW: number;
  let clipH: number;

  if (shot.layout === 'hero') {
    const cardW = 590.0;
    const cardH = (cardW * 655) / 781;
    content = `
${logoLockup(logoUri)}
${kicker(shot.label, 72, 144)}
${multilineText(shot.headline, 72, 228, 58, 68)}
${bodyText(shot.body, 74, 404, 20, 30)}
${chip(74, 497, '130+ LANGUAGES')}
${chip(74, 543, 'ON-DEVICE PRIVACY', COLORS.amber)}
  <text x="70" y="735" font-family="IBM Plex Sans" font-size="96" font-weight="600" fill="none" stroke="${COLORS.indigo}" stroke-width="1.5" stroke-opacity="0.16">${index}</text>
${screenCard(imageUri, 648, 152, cardW, cardH, 1.1, shot.accent)}`;
    clipW = cardW;
    clipH = cardH;
  } else if (shot.layout === 'selection') {
    const cardW = 920.0;
    const cardH = (cardW * 729) / 1240;
    content = `
${logoLockup(logoUri, 72, 34, 36)}
${kicker(shot.label, 72, 100)}
${multilineText(shot.headline, 72, 148, 48, 56)}
${bodyText(shot.body, 74, 181, 18)}
  <text x="1122" y="152" font-family="IBM Plex Sans" font-size="86" font-weight="600" fill="none" stroke="${COLORS.indigo}" stroke-width="1.5" stroke-opacity="0.16">${index}</text>
${screenCard(imageUri, 180, 208, cardW, cardH, -0.75, shot.accent)}`;
    clipW = cardW;
    clipH = cardH;
  } else {
    const cardW = 980.0;
    const cardH = (cardW * 2004) / 3736;
    const angle = number % 2 ? -0.55 : 0.55;
    content = `
${logoLockup(logoUri, 72, 32, 36)}
${kicker(shot.label, 72, 97)}
${multilineText(shot.headline, 72, 145, 47, 54)}
${bodyText(shot.body, 74, 180, 18)}
  <text x="1122" y="151" font-family="IBM Plex Sans" font-size="86" font-weight="600" fill="none" stroke="${COLORS.indigo}" stroke-width="1.5" stroke-opacity="0.16">${index}</text>
${screenCard(imageUri, 150, 216, cardW, cardH, angle, shot.accent)}`;
    clipW = cardW;
    clipH = cardH;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="800" viewBox="0 0 1280 800">
${defs(clipW, clipH)}
${background(1280, 800)}
${content}
${grainOverlay(1280, 800)}
</svg>
`;
};

const promoSmallSvg = (
  logoUri: string,
): string => `<svg xmlns="http://www.w3.org/2000/svg" width="440" height="280" viewBox="0 0 440 280">
${defs()}
${background(440, 280, true)}
  <image href="${logoUri}" x="30" y="26" width="70" height="70"/>
  <text x="116" y="73" font-family="IBM Plex Sans" font-size="39" font-weight="600" letter-spacing="-0.6" fill="${COLORS.navy}">Lightling</text>
  <text x="32" y="144" font-family="IBM Plex Sans" font-size="27" font-weight="600" letter-spacing="-0.4" fill="${COLORS.ink}">Translate the web.</text>
  <text x="32" y="177" font-family="IBM Plex Sans" font-size="27" font-weight="600" letter-spacing="-0.4" fill="${COLORS.ink}">Keep your privacy.</text>
  <g transform="translate(31 205)">
    <rect width="166" height="38" rx="19" fill="${COLORS.white}" stroke="${COLORS.indigo}" stroke-opacity="0.28"/>
    <text x="18" y="25" font-family="IBM Plex Mono" font-size="13" font-weight="500" fill="${COLORS.ink}">ENGLISH</text>
    <text x="109" y="25" font-family="IBM Plex Sans" font-size="18" font-weight="600" fill="${COLORS.indigo}">&#8594;</text>
    <text x="137" y="25" font-family="IBM Plex Sans" font-size="16" font-weight="600" fill="${COLORS.ink}">译</text>
  </g>
  <text x="217" y="230" font-family="IBM Plex Mono" font-size="11" font-weight="500" letter-spacing="0.8" fill="${COLORS.indigoDark}">130+ LANGUAGES · OPEN SOURCE</text>
  <path d="M 333 20 L 417 20 L 417 104" fill="url(#dots)" opacity="0.75"/>
${grainOverlay(440, 280)}
</svg>
`;

const promoMarqueeSvg = (
  logoUri: string,
): string => `<svg xmlns="http://www.w3.org/2000/svg" width="1400" height="560" viewBox="0 0 1400 560">
${defs()}
${background(1400, 560, true)}
  <image href="${logoUri}" x="64" y="54" width="58" height="58"/>
  <text x="140" y="96" font-family="IBM Plex Sans" font-size="35" font-weight="600" fill="${COLORS.navy}">Lightling</text>
  <rect x="64" y="139" width="34" height="5" rx="2.5" fill="${COLORS.indigo}"/>
  <text x="112" y="149" font-family="IBM Plex Mono" font-size="14" font-weight="500" letter-spacing="2.1" fill="${COLORS.indigoDark}">WEB TRANSLATOR · v7.2</text>
  <text x="62" y="230" font-family="IBM Plex Sans" font-size="61" font-weight="600" letter-spacing="-1" fill="${COLORS.ink}">
    <tspan x="62">Translate the web.</tspan>
    <tspan x="62" dy="68">Keep your privacy.</tspan>
  </text>
  <text x="64" y="345" font-family="IBM Plex Sans" font-size="20" font-weight="400" fill="${COLORS.muted}">
    <tspan x="64">Pages, highlighted text and speech in 130+ languages.</tspan>
    <tspan x="64" dy="30">Free, open-source, and private by design.</tspan>
  </text>
${chip(64, 427, 'FULL PAGES')}
${chip(218, 427, 'SELECTED TEXT', COLORS.amber)}
${chip(407, 427, 'ON-DEVICE')}

  <g transform="translate(805 58) rotate(-3.2 220 180)">
    <rect x="13" y="16" width="440" height="360" rx="28" fill="${COLORS.amberPale}" stroke="${COLORS.amber}" stroke-opacity="0.42" stroke-width="2"/>
    <rect width="440" height="360" rx="28" fill="${COLORS.white}" filter="url(#shadow)" stroke="${COLORS.navy}" stroke-opacity="0.16" stroke-width="1.5"/>
    <text x="38" y="57" font-family="IBM Plex Mono" font-size="13" font-weight="500" letter-spacing="1.6" fill="${COLORS.indigoDark}">ORIGINAL · ENGLISH</text>
    <text x="38" y="139" font-family="IBM Plex Sans" font-size="58" font-weight="600" fill="${COLORS.ink}">Good morning.</text>
    <path d="M 38 177 H 402" stroke="${COLORS.navy}" stroke-opacity="0.13"/>
    <text x="38" y="218" font-family="IBM Plex Mono" font-size="13" font-weight="500" letter-spacing="1.6" fill="${COLORS.amber}">TRANSLATED · 中文</text>
    <text x="38" y="297" font-family="IBM Plex Sans" font-size="62" font-weight="600" fill="${COLORS.ink}">早上好。</text>
    <circle cx="383" cy="294" r="21" fill="${COLORS.indigo}"/>
    <path d="M 374 294 H 390 M 384 287 L 391 294 L 384 301" fill="none" stroke="${COLORS.white}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
  </g>
  <g transform="translate(1124 320) rotate(4.4 94 74)">
    <rect width="188" height="148" rx="22" fill="${COLORS.navy}" filter="url(#shadow)"/>
    <image href="${logoUri}" x="18" y="18" width="46" height="46"/>
    <text x="77" y="48" font-family="IBM Plex Sans" font-size="21" font-weight="600" fill="${COLORS.amberPale}">Lightling</text>
    <text x="18" y="91" font-family="IBM Plex Mono" font-size="11" font-weight="500" letter-spacing="1.1" fill="${COLORS.indigoPale}">PRIVATE BY DEFAULT</text>
    <text x="18" y="120" font-family="IBM Plex Sans" font-size="15" font-weight="400" fill="${COLORS.white}">Your words stay yours.</text>
  </g>
${grainOverlay(1400, 560)}
</svg>
`;

const generateSvgs = (svgDir: string): string[] => {
  mkdirSync(svgDir, { recursive: true });
  for (const stale of readdirSync(svgDir)) {
    if (stale.endsWith('.svg')) unlinkSync(join(svgDir, stale));
  }
  const logoUri = dataUri(LOGO);
  const names: string[] = [];
  SHOTS.forEach((shot, index) => {
    writeFileSync(
      join(svgDir, `${shot.name}.svg`),
      shotSvg(shot, index + 1, logoUri),
      'utf8',
    );
    names.push(shot.name);
  });
  writeFileSync(join(svgDir, 'promo-tile-small.svg'), promoSmallSvg(logoUri), 'utf8');
  names.push('promo-tile-small');
  writeFileSync(join(svgDir, 'promo-tile-marquee.svg'), promoMarqueeSvg(logoUri), 'utf8');
  names.push('promo-tile-marquee');
  console.log(`Generated ${names.length} SVG compositions in ${svgDir}`);
  return names;
};

const PAPER = '#fbf7ee';

const renderOpaque = async (
  svg: string,
  output: string,
  width: number,
  height: number,
): Promise<void> => {
  const tmp = output.replace(/\.png$/, '.rendering.png');
  await run('rsvg-convert', [
    '--width',
    String(width),
    '--height',
    String(height),
    svg,
    '--output',
    tmp,
  ]);
  await run('magick', [
    tmp,
    '-background',
    PAPER,
    '-alpha',
    'remove',
    '-alpha',
    'off',
    '-colorspace',
    'sRGB',
    '-define',
    'png:color-type=2',
    output,
  ]);
  rmSync(tmp, { force: true });
};

const identifyField = async (file: string, format: string): Promise<string> =>
  (await run('identify', ['-format', format, file])).stdout.trim();

const checkPng = async (file: string, expected: string): Promise<void> => {
  const dims = await identifyField(file, '%wx%h');
  const alpha = await identifyField(file, '%A');
  const colorspace = await identifyField(file, '%[colorspace]');
  if (dims !== expected)
    throw new Error(`ERROR: ${file} is ${dims}, expected ${expected}`);
  if (alpha !== 'Undefined')
    throw new Error(`ERROR: ${file} retains an alpha channel (${alpha})`);
  if (colorspace !== 'sRGB')
    throw new Error(`ERROR: ${file} is ${colorspace}, expected sRGB`);
};

const main = async (): Promise<void> => {
  for (const tool of ['rsvg-convert', 'magick', 'identify']) {
    try {
      await run('which', [tool]);
    } catch {
      throw new Error(`Required tool not found in PATH: ${tool}`);
    }
  }

  const outFlag = process.argv.indexOf('--out');
  const outDir =
    outFlag >= 0 && process.argv[outFlag + 1] !== undefined
      ? join(process.cwd(), process.argv[outFlag + 1])
      : HERE;
  const svgDir = join(outDir, 'svg');
  const shotDir = join(outDir, 'screenshots');

  const names = generateSvgs(svgDir);
  mkdirSync(shotDir, { recursive: true });
  for (const stale of readdirSync(shotDir)) {
    if (stale.endsWith('.png')) unlinkSync(join(shotDir, stale));
  }
  rmSync(join(outDir, 'promo-tile-small.png'), { force: true });
  rmSync(join(outDir, 'promo-tile-marquee.png'), { force: true });

  const shotNames = names.filter((name) => !name.startsWith('promo-'));
  for (const name of shotNames) {
    await renderOpaque(
      join(svgDir, `${name}.svg`),
      join(shotDir, `${name}.png`),
      1280,
      800,
    );
  }
  await renderOpaque(
    join(svgDir, 'promo-tile-small.svg'),
    join(outDir, 'promo-tile-small.png'),
    440,
    280,
  );
  await renderOpaque(
    join(svgDir, 'promo-tile-marquee.svg'),
    join(outDir, 'promo-tile-marquee.png'),
    1400,
    560,
  );
  copyFileSync(LOGO, join(outDir, 'icon-128.png'));

  const shots = readdirSync(shotDir).filter((file) => file.endsWith('.png'));
  if (shots.length !== 7)
    throw new Error(`ERROR: expected exactly 7 screenshots, found ${shots.length}`);
  for (const shot of shots) await checkPng(join(shotDir, shot), '1280x800');
  await checkPng(join(outDir, 'promo-tile-small.png'), '440x280');
  await checkPng(join(outDir, 'promo-tile-marquee.png'), '1400x560');

  const iconDims = await identifyField(join(outDir, 'icon-128.png'), '%wx%h');
  if (iconDims !== '128x128')
    throw new Error(`ERROR: icon is ${iconDims}, expected 128x128`);

  console.log('Rendered and verified 7 screenshots, 2 promo tiles, and icon-128.png');
};

await main();
