#!/usr/bin/env bun
/**
 * Generate and render Lightling Chrome Web Store image assets.
 *
 * SVGs embed the raster sources as data URIs. Re-running is transactional:
 * only the manifest-owned outputs are replaced after the complete staged set
 * has rendered and passed metadata validation.
 *
 * Usage: bun run assets/stores/chrome/render.ts [--out <dir>]
 * Renders into the script directory by default; --out targets another
 * store's asset directory (e.g. assets/stores/firefox).
 * Rendering uses the pinned Sharp dependency and locally installed fonts.
 */

// cspell:ignore colourspace

import { lstat, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, parse, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const moduleUrl = new URL(import.meta.url);
const modulePath = moduleUrl.protocol === 'file:' ? fileURLToPath(moduleUrl) : undefined;
const HERE =
  modulePath === undefined
    ? resolve(process.cwd(), 'assets/stores/chrome')
    : dirname(modulePath);
const REPO = resolve(HERE, '..', '..', '..');
const DEFAULT_RAW = resolve(REPO, 'assets/stores/chrome/screenshots-raw');
const DEFAULT_LOGO = resolve(REPO, 'src/res/logo.png');
const DEFAULT_PACKAGE = resolve(REPO, 'package.json');

const COLORS = {
  paper: '#fbf7ee',
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

const FONT_FAMILIES = {
  sans: 'IBM Plex Sans, IBM Plex Sans SC',
  mono: 'IBM Plex Mono, IBM Plex Sans SC',
} as const;

interface Shot {
  name: string;
  source: string;
  label: string;
  headline: readonly string[];
  body: readonly string[];
  layout: 'hero' | 'selection' | 'wide';
  wideVariant?: 'compact';
  accent: string;
  primaryUploadOrder?: number;
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
    primaryUploadOrder: 1,
  },
  {
    name: '02-selection-popup',
    source: 'Screenshot from 2026-08-24 16-48-02.png',
    label: 'HIGHLIGHTED TEXT',
    headline: ['Select text. Get the translation.'],
    body: ['Hear it, copy it, or save it to your dictionary.'],
    layout: 'selection',
    accent: COLORS.amber,
    primaryUploadOrder: 2,
  },
  {
    name: '03-full-page-translation',
    source: 'Screenshot from 2026-08-24 16-53-10.png',
    label: 'FULL-PAGE TRANSLATION',
    headline: ['One click translates the whole page.'],
    body: ['The layout stays intact while Lightling works through every word.'],
    layout: 'wide',
    accent: COLORS.indigo,
    primaryUploadOrder: 3,
  },
  {
    name: '04-original-page',
    source: 'Screenshot from 2026-08-24 16-55-08.png',
    label: 'ORIGINAL VIEW',
    headline: ['Switch back whenever you need context.'],
    body: ['Move between the original and translated page without losing your place.'],
    layout: 'wide',
    wideVariant: 'compact',
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
    primaryUploadOrder: 4,
  },
  {
    name: '06-dictionary',
    source: 'Screenshot from 2026-08-24 16-56-36.png',
    label: 'PERSONAL DICTIONARY',
    headline: ['Turn quick lookups into lasting vocabulary.'],
    body: ['Save words, filter by language, and keep learning even while offline.'],
    layout: 'wide',
    wideVariant: 'compact',
    accent: COLORS.amber,
    primaryUploadOrder: 5,
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

const dataUri = (contents: Uint8Array): string =>
  `data:image/png;base64,${Buffer.from(contents).toString('base64')}`;

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
  <text x="${x + size + 14}" y="${y + size - 8}" font-family="${FONT_FAMILIES.sans}" font-size="27" font-weight="600" fill="${COLORS.navy}">Lightling</text>`;

const kicker = (label: string, x: number, y: number): string => `
  <rect x="${x}" y="${y - 14}" width="26" height="4" rx="2" fill="${COLORS.indigo}"/>
  <text x="${x + 38}" y="${y - 6}" font-family="${FONT_FAMILIES.mono}" font-size="15" font-weight="500" letter-spacing="2.3" fill="${COLORS.indigoDark}">${escapeXml(label)}</text>`;

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
  return `<text x="${x}" y="${y}" font-family="${FONT_FAMILIES.sans}" font-size="${size}" font-weight="${weight}" letter-spacing="-0.7" fill="${COLORS.ink}">${tspans}</text>`;
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
  return `<text x="${x}" y="${y}" font-family="${FONT_FAMILIES.sans}" font-size="${size}" font-weight="400" fill="${COLORS.muted}">${tspans}</text>`;
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
    <text x="29" y="17" dominant-baseline="central" font-family="${FONT_FAMILIES.mono}" font-size="12" font-weight="500" letter-spacing="0.7" fill="${COLORS.ink}">${escapeXml(text)}</text>
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

const shotSvg = (
  shot: Shot,
  position: number,
  logoUri: string,
  imageUri: string,
): string => {
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
${screenCard(imageUri, 180, 208, cardW, cardH, -0.75, shot.accent)}`;
    clipW = cardW;
    clipH = cardH;
  } else {
    const compact = shot.wideVariant === 'compact';
    const cardW = compact ? 860.0 : 980.0;
    const cardH = (cardW * 2004) / 3736;
    const angle = position % 2 ? -0.55 : 0.55;
    const cardX = compact ? 210 : 150;
    const cardY = compact ? 242 : 216;
    const titleY = compact ? 159 : 145;
    const bodyY = compact ? 195 : 180;
    content = `
${logoLockup(logoUri, 72, compact ? 42 : 32, 36)}
${kicker(shot.label, 72, compact ? 107 : 97)}
${multilineText(shot.headline, 72, titleY, compact ? 44 : 47, 54)}
${bodyText(shot.body, 74, bodyY, 18)}
${screenCard(imageUri, cardX, cardY, cardW, cardH, angle, shot.accent)}`;
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
  <image href="${logoUri}" x="32" y="30" width="54" height="54"/>
  <text x="100" y="69" font-family="${FONT_FAMILIES.sans}" font-size="33" font-weight="600" letter-spacing="-0.5" fill="${COLORS.navy}">Lightling</text>
  <text x="32" y="130" font-family="${FONT_FAMILIES.sans}" font-size="25" font-weight="600" letter-spacing="-0.4" fill="${COLORS.ink}">Translate the web.</text>
  <text x="32" y="161" font-family="${FONT_FAMILIES.sans}" font-size="25" font-weight="600" letter-spacing="-0.4" fill="${COLORS.ink}">Keep your privacy.</text>
  <g transform="translate(32 204)">
    <rect width="184" height="44" rx="22" fill="${COLORS.white}" stroke="${COLORS.indigo}" stroke-opacity="0.28"/>
    <text x="20" y="22" dominant-baseline="central" font-family="${FONT_FAMILIES.mono}" font-size="13" font-weight="500" fill="${COLORS.ink}">ENGLISH</text>
    <path d="M 117 22 H 133 M 128 17 L 133 22 L 128 27" fill="none" stroke="${COLORS.indigo}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    <text x="147" y="22" dominant-baseline="central" font-family="${FONT_FAMILIES.sans}" font-size="18" font-weight="600" fill="${COLORS.ink}">译</text>
  </g>
  <path d="M 333 20 L 417 20 L 417 104" fill="url(#dots)" opacity="0.75"/>
${grainOverlay(440, 280)}
</svg>
`;

const promoMarqueeSvg = (
  logoUri: string,
  displayVersion: string,
): string => `<svg xmlns="http://www.w3.org/2000/svg" width="1400" height="560" viewBox="0 0 1400 560">
${defs()}
${background(1400, 560, true)}
  <image href="${logoUri}" x="64" y="54" width="58" height="58"/>
  <text x="140" y="96" font-family="${FONT_FAMILIES.sans}" font-size="35" font-weight="600" fill="${COLORS.navy}">Lightling</text>
  <rect x="64" y="139" width="34" height="5" rx="2.5" fill="${COLORS.indigo}"/>
  <text x="112" y="149" font-family="${FONT_FAMILIES.mono}" font-size="14" font-weight="500" letter-spacing="2.1" fill="${COLORS.indigoDark}">WEB TRANSLATOR · ${escapeXml(displayVersion)}</text>
  <text x="62" y="230" font-family="${FONT_FAMILIES.sans}" font-size="61" font-weight="600" letter-spacing="-1" fill="${COLORS.ink}">
    <tspan x="62">Translate the web.</tspan>
    <tspan x="62" dy="68">Keep your privacy.</tspan>
  </text>
  <text x="64" y="345" font-family="${FONT_FAMILIES.sans}" font-size="20" font-weight="400" fill="${COLORS.muted}">
    <tspan x="64">Pages, highlighted text and speech in 130+ languages.</tspan>
    <tspan x="64" dy="30">Free, open-source, and private by design.</tspan>
  </text>
${chip(64, 427, 'FULL PAGES')}
${chip(218, 427, 'ON-DEVICE')}

  <g transform="translate(805 58) rotate(-3.2 220 180)">
    <rect x="13" y="16" width="440" height="360" rx="28" fill="${COLORS.amberPale}" stroke="${COLORS.amber}" stroke-opacity="0.42" stroke-width="2"/>
    <rect width="440" height="360" rx="28" fill="${COLORS.white}" filter="url(#shadow)" stroke="${COLORS.navy}" stroke-opacity="0.16" stroke-width="1.5"/>
    <text x="38" y="57" font-family="${FONT_FAMILIES.mono}" font-size="13" font-weight="500" letter-spacing="1.6" fill="${COLORS.indigoDark}">ORIGINAL · ENGLISH</text>
    <text x="38" y="139" font-family="${FONT_FAMILIES.sans}" font-size="58" font-weight="600" fill="${COLORS.ink}">Good morning.</text>
    <path d="M 38 177 H 402" stroke="${COLORS.navy}" stroke-opacity="0.13"/>
    <text x="38" y="218" font-family="${FONT_FAMILIES.mono}" font-size="13" font-weight="500" letter-spacing="1.6" fill="${COLORS.amber}">TRANSLATED · 中文</text>
    <text x="38" y="297" font-family="${FONT_FAMILIES.sans}" font-size="62" font-weight="600" fill="${COLORS.ink}">早上好。</text>
    <circle cx="383" cy="294" r="21" fill="${COLORS.indigo}"/>
    <path d="M 374 294 H 390 M 384 287 L 391 294 L 384 301" fill="none" stroke="${COLORS.white}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
  </g>
  <g transform="translate(1124 320) rotate(4.4 94 74)">
    <rect width="188" height="148" rx="22" fill="${COLORS.navy}" filter="url(#shadow)"/>
    <image href="${logoUri}" x="18" y="18" width="46" height="46"/>
    <text x="77" y="48" font-family="${FONT_FAMILIES.sans}" font-size="21" font-weight="600" fill="${COLORS.amberPale}">Lightling</text>
    <text x="18" y="91" font-family="${FONT_FAMILIES.mono}" font-size="11" font-weight="500" letter-spacing="1.1" fill="${COLORS.indigoPale}">PRIVATE BY DEFAULT</text>
    <text x="18" y="120" font-family="${FONT_FAMILIES.sans}" font-size="15" font-weight="400" fill="${COLORS.white}">Your words stay yours.</text>
  </g>
${grainOverlay(1400, 560)}
</svg>
`;

type SharpFactory = typeof import('sharp');

interface RasterArtifact {
  svgPath: string;
  pngPath: string;
  width: number;
  height: number;
}

interface PngContract {
  relativePath: string;
  width: number;
  height: number;
  hasAlpha: boolean;
}

export interface RenderStoreAssetsOptions {
  outputDirectory: string;
  projectDirectory?: string;
}

export interface RenderStoreAssetsDependencies {
  renameFile?: typeof rename;
  removeFile?: typeof rm;
}

const RASTER_ARTIFACTS: readonly RasterArtifact[] = [
  ...SHOTS.map((shot) => ({
    svgPath: `svg/${shot.name}.svg`,
    pngPath: `screenshots/${shot.name}.png`,
    width: 1280,
    height: 800,
  })),
  {
    svgPath: 'svg/promo-tile-small.svg',
    pngPath: 'promo-tile-small.png',
    width: 440,
    height: 280,
  },
  {
    svgPath: 'svg/promo-tile-marquee.svg',
    pngPath: 'promo-tile-marquee.png',
    width: 1400,
    height: 560,
  },
];

const PNG_CONTRACTS: readonly PngContract[] = [
  ...RASTER_ARTIFACTS.map(({ pngPath, width, height }) => ({
    relativePath: pngPath,
    width,
    height,
    hasAlpha: false,
  })),
  { relativePath: 'icon-128.png', width: 128, height: 128, hasAlpha: true },
  { relativePath: 'icon-300.png', width: 300, height: 300, hasAlpha: true },
];

const MANAGED_ARTIFACTS = [
  ...RASTER_ARTIFACTS.map(({ svgPath }) => svgPath),
  ...PNG_CONTRACTS.map(({ relativePath }) => relativePath),
] as const;

const isErrnoException = (error: unknown): error is NodeJS.ErrnoException =>
  error instanceof Error && 'code' in error;

const lstatOrNull = async (path: string) => {
  try {
    return await lstat(path);
  } catch (error) {
    if (isErrnoException(error) && error.code === 'ENOENT') return null;
    throw error;
  }
};

const validateManifest = (): void => {
  const managedPaths = new Set(MANAGED_ARTIFACTS);
  if (managedPaths.size !== MANAGED_ARTIFACTS.length) {
    throw new Error('Store asset manifest contains duplicate output paths');
  }
  if (MANAGED_ARTIFACTS.length !== 20) {
    throw new Error(
      `Store asset manifest must contain 20 outputs, found ${MANAGED_ARTIFACTS.length}`,
    );
  }

  const uploadOrder = SHOTS.flatMap(({ primaryUploadOrder }) =>
    primaryUploadOrder === undefined ? [] : [primaryUploadOrder],
  ).sort((left, right) => left - right);
  if (uploadOrder.join(',') !== '1,2,3,4,5') {
    throw new Error('Primary screenshot upload order must be exactly 1 through 5');
  }
};

const readDisplayVersion = async (packagePath: string): Promise<string> => {
  const packageJson = JSON.parse(await readFile(packagePath, 'utf8')) as {
    version?: unknown;
  };
  if (typeof packageJson.version !== 'string') {
    throw new Error(`package.json at ${packagePath} has no string version`);
  }
  const match = /^(\d+)\.(\d+)\./.exec(packageJson.version);
  if (!match) {
    throw new Error(`Unsupported package version ${JSON.stringify(packageJson.version)}`);
  }
  return `v${match[1]}.${match[2]}`;
};

const createRoundedLogo = async (
  sharp: SharpFactory,
  sourcePath: string,
  artworkSize: number,
  canvasSize: number,
): Promise<Buffer> => {
  const padding = (canvasSize - artworkSize) / 2;
  if (!Number.isInteger(padding) || padding < 0) {
    throw new Error(
      `Logo canvas ${canvasSize} must allow even non-negative padding around ${artworkSize}`,
    );
  }
  const cornerRadius = Math.round(artworkSize * 0.22);
  const mask = Buffer.from(
    `<svg width="${artworkSize}" height="${artworkSize}" xmlns="http://www.w3.org/2000/svg">` +
      `<rect width="${artworkSize}" height="${artworkSize}" rx="${cornerRadius}" fill="white"/>` +
      '</svg>',
  );
  let output = await sharp(sourcePath)
    .resize(artworkSize, artworkSize, { fit: 'cover' })
    .composite([{ input: mask, blend: 'dest-in' }])
    .png({ compressionLevel: 9, palette: false })
    .toBuffer();

  if (padding > 0) {
    output = await sharp(output)
      .extend({
        top: padding,
        right: padding,
        bottom: padding,
        left: padding,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .png({ compressionLevel: 9, palette: false })
      .toBuffer();
  }
  return output;
};

const generateSvgArtifacts = async (
  payloadDirectory: string,
  rawDirectory: string,
  displayLogo: Buffer,
  displayVersion: string,
): Promise<void> => {
  const svgDirectory = join(payloadDirectory, 'svg');
  await mkdir(svgDirectory, { recursive: true });
  const logoUri = dataUri(displayLogo);

  await Promise.all(
    SHOTS.map(async (shot, index) => {
      const imageUri = dataUri(await readFile(join(rawDirectory, shot.source)));
      await writeFile(
        join(svgDirectory, `${shot.name}.svg`),
        shotSvg(shot, index + 1, logoUri, imageUri),
        'utf8',
      );
    }),
  );
  await Promise.all([
    writeFile(join(svgDirectory, 'promo-tile-small.svg'), promoSmallSvg(logoUri), 'utf8'),
    writeFile(
      join(svgDirectory, 'promo-tile-marquee.svg'),
      promoMarqueeSvg(logoUri, displayVersion),
      'utf8',
    ),
  ]);
};

const renderRasterArtifacts = async (
  sharp: SharpFactory,
  payloadDirectory: string,
): Promise<void> => {
  await Promise.all(
    RASTER_ARTIFACTS.map(async (artifact) => {
      const outputPath = join(payloadDirectory, artifact.pngPath);
      await mkdir(dirname(outputPath), { recursive: true });
      await sharp(join(payloadDirectory, artifact.svgPath), { density: 96 })
        .resize(artifact.width, artifact.height, { fit: 'fill' })
        .flatten({ background: COLORS.paper })
        .toColourspace('srgb')
        .png({ compressionLevel: 9, palette: false })
        .toFile(outputPath);
    }),
  );
};

const validatePayload = async (
  sharp: SharpFactory,
  payloadDirectory: string,
): Promise<void> => {
  for (const relativePath of MANAGED_ARTIFACTS) {
    const stats = await lstat(join(payloadDirectory, relativePath));
    if (!stats.isFile() || stats.isSymbolicLink()) {
      throw new Error(`Generated artifact is not a regular file: ${relativePath}`);
    }
  }

  for (const contract of PNG_CONTRACTS) {
    const metadata = await sharp(
      join(payloadDirectory, contract.relativePath),
    ).metadata();
    if (metadata.format !== 'png') {
      throw new Error(`${contract.relativePath} is ${metadata.format}, expected PNG`);
    }
    if (metadata.width !== contract.width || metadata.height !== contract.height) {
      throw new Error(
        `${contract.relativePath} is ${metadata.width}x${metadata.height}, ` +
          `expected ${contract.width}x${contract.height}`,
      );
    }
    if (metadata.hasAlpha !== contract.hasAlpha) {
      throw new Error(
        `${contract.relativePath} alpha=${metadata.hasAlpha}, expected ${contract.hasAlpha}`,
      );
    }
    if (metadata.space !== 'srgb') {
      throw new Error(`${contract.relativePath} is ${metadata.space}, expected sRGB`);
    }
  }
};

const preflightOutput = async (outputDirectory: string): Promise<void> => {
  const outputStats = await lstatOrNull(outputDirectory);
  if (
    outputStats !== null &&
    (!outputStats.isDirectory() || outputStats.isSymbolicLink())
  ) {
    throw new Error(`Output path must be a real directory: ${outputDirectory}`);
  }

  for (const directory of ['svg', 'screenshots']) {
    const path = join(outputDirectory, directory);
    const stats = await lstatOrNull(path);
    if (stats !== null && (!stats.isDirectory() || stats.isSymbolicLink())) {
      throw new Error(`Managed output directory must not be a symlink: ${path}`);
    }
  }

  for (const relativePath of MANAGED_ARTIFACTS) {
    const path = join(outputDirectory, relativePath);
    const stats = await lstatOrNull(path);
    if (stats !== null && (!stats.isFile() || stats.isSymbolicLink())) {
      throw new Error(`Managed output must be a regular file or absent: ${path}`);
    }
  }
};

class IncompletePublicationRollbackError extends AggregateError {
  constructor(errors: unknown[], stagingDirectory: string) {
    super(
      errors,
      `Store asset publication failed and rollback was incomplete. ` +
        `Recovery files were preserved at ${stagingDirectory}`,
    );
    this.name = 'IncompletePublicationRollbackError';
  }
}

const publishPayload = async (
  stagingDirectory: string,
  payloadDirectory: string,
  outputDirectory: string,
  { renameFile = rename, removeFile = rm }: RenderStoreAssetsDependencies,
): Promise<void> => {
  await preflightOutput(outputDirectory);
  await mkdir(outputDirectory, { recursive: true });
  await Promise.all([
    mkdir(join(outputDirectory, 'svg'), { recursive: true }),
    mkdir(join(outputDirectory, 'screenshots'), { recursive: true }),
  ]);

  const backupDirectory = join(stagingDirectory, 'backup');
  const backedUp: string[] = [];
  const published: string[] = [];

  try {
    for (const relativePath of MANAGED_ARTIFACTS) {
      const destination = join(outputDirectory, relativePath);
      if ((await lstatOrNull(destination)) === null) continue;
      const backup = join(backupDirectory, relativePath);
      await mkdir(dirname(backup), { recursive: true });
      await renameFile(destination, backup);
      backedUp.push(relativePath);
    }

    for (const relativePath of MANAGED_ARTIFACTS) {
      const source = join(payloadDirectory, relativePath);
      const destination = join(outputDirectory, relativePath);
      await renameFile(source, destination);
      published.push(relativePath);
    }
  } catch (error) {
    const rollbackErrors: unknown[] = [];
    for (const relativePath of published.reverse()) {
      try {
        await removeFile(join(outputDirectory, relativePath), { force: true });
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError);
      }
    }
    for (const relativePath of backedUp.reverse()) {
      try {
        await renameFile(
          join(backupDirectory, relativePath),
          join(outputDirectory, relativePath),
        );
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError);
      }
    }
    if (rollbackErrors.length > 0) {
      throw new IncompletePublicationRollbackError(
        [error, ...rollbackErrors],
        stagingDirectory,
      );
    }
    throw error;
  }
};

export async function renderStoreAssets(
  {
    outputDirectory: requestedOutputDirectory,
    projectDirectory = REPO,
  }: RenderStoreAssetsOptions,
  dependencies: RenderStoreAssetsDependencies = {},
): Promise<void> {
  validateManifest();
  const outputDirectory = resolve(requestedOutputDirectory);
  const resolvedProjectDirectory = resolve(projectDirectory);
  if (outputDirectory === parse(outputDirectory).root) {
    throw new Error('Refusing to render store assets into the filesystem root');
  }
  await preflightOutput(outputDirectory);

  const rawDirectory =
    resolvedProjectDirectory === REPO
      ? DEFAULT_RAW
      : resolve(resolvedProjectDirectory, 'assets/stores/chrome/screenshots-raw');
  const logoPath =
    resolvedProjectDirectory === REPO
      ? DEFAULT_LOGO
      : resolve(resolvedProjectDirectory, 'src/res/logo.png');
  const packagePath =
    resolvedProjectDirectory === REPO
      ? DEFAULT_PACKAGE
      : resolve(resolvedProjectDirectory, 'package.json');

  await mkdir(dirname(outputDirectory), { recursive: true });
  const stagingDirectory = await mkdtemp(
    join(dirname(outputDirectory), '.lightling-store-assets-'),
  );
  const payloadDirectory = join(stagingDirectory, 'payload');
  let preserveStagingDirectory = false;

  try {
    await mkdir(payloadDirectory, { recursive: true });
    const sharp = (await import('sharp')).default;
    const displayVersion = await readDisplayVersion(packagePath);
    const [displayLogo, storeIcon, largeIcon] = await Promise.all([
      createRoundedLogo(sharp, logoPath, 128, 128),
      createRoundedLogo(sharp, logoPath, 96, 128),
      createRoundedLogo(sharp, logoPath, 300, 300),
    ]);

    await generateSvgArtifacts(
      payloadDirectory,
      rawDirectory,
      displayLogo,
      displayVersion,
    );
    await Promise.all([
      renderRasterArtifacts(sharp, payloadDirectory),
      writeFile(join(payloadDirectory, 'icon-128.png'), storeIcon),
      writeFile(join(payloadDirectory, 'icon-300.png'), largeIcon),
    ]);
    await validatePayload(sharp, payloadDirectory);
    await publishPayload(
      stagingDirectory,
      payloadDirectory,
      outputDirectory,
      dependencies,
    );
  } catch (error) {
    preserveStagingDirectory = error instanceof IncompletePublicationRollbackError;
    throw error;
  } finally {
    if (!preserveStagingDirectory) {
      await rm(stagingDirectory, { recursive: true, force: true });
    }
  }

  console.log(
    `Rendered and verified ${MANAGED_ARTIFACTS.length} store assets in ${outputDirectory}`,
  );
}

export const parseRenderArgs = (argumentsList: string[], cwd: string): string => {
  if (argumentsList.length === 0) return HERE;
  if (
    argumentsList.length !== 2 ||
    argumentsList[0] !== '--out' ||
    argumentsList[1] === '' ||
    argumentsList[1].startsWith('-')
  ) {
    throw new Error('Usage: bun assets/stores/chrome/render.ts [--out <dir>]');
  }
  return resolve(cwd, argumentsList[1]);
};

const isMainModule =
  modulePath !== undefined && process.argv[1] && resolve(process.argv[1]) === modulePath;

if (isMainModule) {
  try {
    await renderStoreAssets({
      outputDirectory: parseRenderArgs(process.argv.slice(2), process.cwd()),
    });
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
