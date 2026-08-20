import { readdir, readFile, stat } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptsDirectory = dirname(fileURLToPath(import.meta.url));
const projectDirectory = resolve(scriptsDirectory, '..');
const packagePath = resolve(projectDirectory, 'package.json');

const chromiumUpdateUrl = 'https://hewel.github.io/lightling/chromium_updates.xml';
const firefoxStandaloneId = '{33b518c2-1f65-4090-8d94-e0a432ebbfd4}';
const astryxThemeLayer = /@layer\s+astryx-theme\b/;
const astryxVividSelector = /\[data-astryx-theme\s*=\s*(?:vivid|["']vivid["'])\]/;
const astryxVividDestructiveButtonSelector =
  /\[data-astryx-theme\s*=\s*(?:vivid|["']vivid["'])\]\s+\.astryx-button\.destructive\b/;

const chromiumPermissions = ['storage', 'tabs', 'contextMenus', 'scripting', 'offscreen'];
const firefoxPermissions = ['storage', 'tabs', 'contextMenus', 'scripting', '<all_urls>'];

const variants = [
  { name: 'chrome', family: 'chromium' },
  { name: 'chromium', family: 'chromium' },
  { name: 'firefox', family: 'firefox' },
  { name: 'firefox-standalone', family: 'firefox' },
];

const sharedRuntimeAssets = [
  'static/logo.png',
  'pages/dictionary/dictionary.html',
  'pages/history/history.html',
  'pages/offscreen-documents/main/main.html',
  'pages/offscreen-documents/worker/worker.html',
  'pages/offscreen-documents/translator/translator.html',
  'thirdparty/bergamot/translator.worker.js',
  'thirdparty/bergamot/bergamot-translator-worker.js',
  'thirdparty/bergamot/bergamot-translator-worker.wasm',
];

const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

const isPlainObject = (value) =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function formatValue(value) {
  const formatted = JSON.stringify(value);
  return formatted === undefined ? String(value) : formatted;
}

async function readJson(path, label) {
  let contents;

  try {
    contents = await readFile(path, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error(`${label} is missing at ${path}`);
    }

    throw new Error(`Could not read ${label} at ${path}: ${error.message}`);
  }

  try {
    return JSON.parse(contents);
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error.message}`);
  }
}

function expectExactArray(problems, actual, expected, field) {
  if (
    !Array.isArray(actual) ||
    actual.length !== expected.length ||
    actual.some((value, index) => value !== expected[index])
  ) {
    problems.push(
      `${field} must be exactly ${JSON.stringify(expected)}, received ${formatValue(actual)}`,
    );
  }
}

function expectNonEmptyString(problems, value, field) {
  if (typeof value !== 'string' || value.trim() === '') {
    problems.push(
      `${field} must be a non-empty file path, received ${formatValue(value)}`,
    );
    return false;
  }

  return true;
}

function addIconReferences(problems, references, icons, field) {
  if (typeof icons === 'string') {
    if (expectNonEmptyString(problems, icons, field)) {
      references.push({ field, path: icons });
    }
    return;
  }

  if (!isPlainObject(icons) || Object.keys(icons).length === 0) {
    problems.push(
      `${field} must be a file path or a non-empty icon-size map, received ${formatValue(icons)}`,
    );
    return;
  }

  for (const [size, path] of Object.entries(icons)) {
    const iconField = `${field}.${size}`;
    if (expectNonEmptyString(problems, path, iconField)) {
      references.push({ field: iconField, path });
    }
  }
}

function validateAction(problems, references, action, field) {
  if (!isPlainObject(action)) {
    problems.push(`${field} must be an object, received ${formatValue(action)}`);
    return;
  }

  if (expectNonEmptyString(problems, action.default_popup, `${field}.default_popup`)) {
    references.push({
      field: `${field}.default_popup`,
      path: action.default_popup,
    });
  }

  if (typeof action.default_title !== 'string' || action.default_title.trim() === '') {
    problems.push(
      `${field}.default_title must be a non-empty string, received ${formatValue(action.default_title)}`,
    );
  }

  addIconReferences(problems, references, action.default_icon, `${field}.default_icon`);
}

function validateChromiumManifest(problems, references, manifest) {
  expectExactArray(
    problems,
    manifest.host_permissions,
    ['<all_urls>'],
    'host_permissions',
  );

  if (!isPlainObject(manifest.background)) {
    problems.push(
      `background must be a Chromium service-worker object, received ${formatValue(manifest.background)}`,
    );
  } else {
    if (
      expectNonEmptyString(
        problems,
        manifest.background.service_worker,
        'background.service_worker',
      )
    ) {
      references.push({
        field: 'background.service_worker',
        path: manifest.background.service_worker,
      });
    }

    if (manifest.background.type !== 'module') {
      problems.push(
        `background.type must be "module", received ${formatValue(manifest.background.type)}`,
      );
    }

    if (hasOwn(manifest.background, 'scripts')) {
      problems.push('background.scripts must be absent from Chromium builds');
    }
  }

  validateAction(problems, references, manifest.action, 'action');

  if (hasOwn(manifest, 'browser_action')) {
    problems.push('browser_action must be absent from Chromium builds');
  }

  if (!isPlainObject(manifest.sandbox) || !Array.isArray(manifest.sandbox.pages)) {
    problems.push(
      `sandbox.pages must be a non-empty array, received ${formatValue(manifest.sandbox?.pages)}`,
    );
  } else if (manifest.sandbox.pages.length === 0) {
    problems.push('sandbox.pages must contain at least one HTML file');
  } else {
    for (const [index, path] of manifest.sandbox.pages.entries()) {
      const field = `sandbox.pages[${index}]`;
      if (expectNonEmptyString(problems, path, field)) {
        references.push({ field, path });
      }
    }
  }
}

function validateFirefoxManifest(problems, references, manifest) {
  if (hasOwn(manifest, 'host_permissions')) {
    problems.push('host_permissions must be absent from Firefox builds');
  }
  const requiredDataCollectionPermissions =
    manifest.browser_specific_settings?.gecko?.data_collection_permissions?.required;
  expectExactArray(
    problems,
    requiredDataCollectionPermissions,
    ['none'],
    'browser_specific_settings.gecko.data_collection_permissions.required',
  );

  if (!isPlainObject(manifest.background)) {
    problems.push(
      `background must be a Firefox scripts object, received ${formatValue(manifest.background)}`,
    );
  } else {
    if (hasOwn(manifest.background, 'service_worker')) {
      problems.push('background.service_worker must be absent from Firefox builds');
    }

    if (
      !Array.isArray(manifest.background.scripts) ||
      manifest.background.scripts.length === 0
    ) {
      problems.push(
        `background.scripts must be a non-empty array, received ${formatValue(manifest.background.scripts)}`,
      );
    } else {
      for (const [index, path] of manifest.background.scripts.entries()) {
        const field = `background.scripts[${index}]`;
        if (expectNonEmptyString(problems, path, field)) {
          references.push({ field, path });
        }
      }
    }
  }

  validateAction(problems, references, manifest.browser_action, 'browser_action');

  if (hasOwn(manifest, 'action')) {
    problems.push('action must be absent from Firefox builds');
  }

  if (hasOwn(manifest, 'sandbox')) {
    problems.push('sandbox must be absent from Firefox builds');
  }
}

function validateOptions(problems, references, manifest) {
  if (!isPlainObject(manifest.options_ui)) {
    problems.push(
      `options_ui must be an object, received ${formatValue(manifest.options_ui)}`,
    );
    return;
  }

  if (expectNonEmptyString(problems, manifest.options_ui.page, 'options_ui.page')) {
    references.push({ field: 'options_ui.page', path: manifest.options_ui.page });
  }
}

function validateContentScripts(problems, references, manifest) {
  if (!Array.isArray(manifest.content_scripts) || manifest.content_scripts.length === 0) {
    problems.push(
      `content_scripts must be a non-empty array, received ${formatValue(manifest.content_scripts)}`,
    );
    return;
  }

  for (const [scriptIndex, contentScript] of manifest.content_scripts.entries()) {
    if (!isPlainObject(contentScript)) {
      problems.push(
        `content_scripts[${scriptIndex}] must be an object, received ${formatValue(contentScript)}`,
      );
      continue;
    }

    if (!Array.isArray(contentScript.js) || contentScript.js.length === 0) {
      problems.push(
        `content_scripts[${scriptIndex}].js must be a non-empty array, received ${formatValue(contentScript.js)}`,
      );
    } else {
      for (const [fileIndex, path] of contentScript.js.entries()) {
        const field = `content_scripts[${scriptIndex}].js[${fileIndex}]`;
        if (expectNonEmptyString(problems, path, field)) {
          references.push({ field, path });
        }
      }
    }

    if (contentScript.css !== undefined) {
      problems.push(
        `content_scripts[${scriptIndex}].css must be absent so extension UI styles are not injected into host pages`,
      );

      if (!Array.isArray(contentScript.css)) {
        problems.push(
          `content_scripts[${scriptIndex}].css must be an array, received ${formatValue(contentScript.css)}`,
        );
      } else {
        for (const [fileIndex, path] of contentScript.css.entries()) {
          const field = `content_scripts[${scriptIndex}].css[${fileIndex}]`;
          if (expectNonEmptyString(problems, path, field)) {
            references.push({ field, path });
          }
        }
      }
    }
  }
}

function validateWebAccessibleResources(problems, references, manifest, family) {
  const resources = manifest.web_accessible_resources;
  const resourcePaths = [];

  if (!Array.isArray(resources) || resources.length === 0) {
    problems.push(
      `web_accessible_resources must be a non-empty array, received ${formatValue(resources)}`,
    );
    return;
  }

  if (family === 'chromium') {
    for (const [entryIndex, entry] of resources.entries()) {
      if (!isPlainObject(entry) || !Array.isArray(entry.resources)) {
        problems.push(
          `web_accessible_resources[${entryIndex}] must be a Chromium resource object, received ${formatValue(entry)}`,
        );
        continue;
      }

      for (const [fileIndex, path] of entry.resources.entries()) {
        const field =
          `web_accessible_resources[${entryIndex}]` + `.resources[${fileIndex}]`;
        if (expectNonEmptyString(problems, path, field)) {
          resourcePaths.push(path);
          references.push({ field, path });
        }
      }
    }
  } else {
    for (const [index, path] of resources.entries()) {
      const field = `web_accessible_resources[${index}]`;
      if (expectNonEmptyString(problems, path, field)) {
        resourcePaths.push(path);
        references.push({ field, path });
      }
    }
  }

  const exposesShadowStyles = resourcePaths.some(
    (path) => path.endsWith('.css') || /\.css\.[^/]+\.txt$/.test(path),
  );
  if (!exposesShadowStyles) {
    problems.push(
      'web_accessible_resources must expose the generated Shadow DOM stylesheet',
    );
  }
}

function resolveBuildReference(problems, outputDirectory, reference) {
  const pathWithoutSuffix = reference.split(/[?#]/, 1)[0];
  const extensionPath = pathWithoutSuffix.replace(/^\/+/, '');

  if (extensionPath === '') {
    problems.push(`file reference ${JSON.stringify(reference)} resolves to no file`);
    return null;
  }

  if (/^[a-z][a-z\d+.-]*:/i.test(extensionPath)) {
    problems.push(
      `file reference ${JSON.stringify(reference)} must be local to the extension build`,
    );
    return null;
  }

  const absolutePath = resolve(outputDirectory, extensionPath);
  const relativePath = relative(outputDirectory, absolutePath);
  if (
    relativePath === '..' ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath)
  ) {
    problems.push(
      `file reference ${JSON.stringify(reference)} escapes the extension build directory`,
    );
    return null;
  }

  return { absolutePath, extensionPath };
}

async function validateReferencedFiles(problems, outputDirectory, references) {
  const checkedReferences = new Set();

  for (const reference of references) {
    const resolvedReference = resolveBuildReference(
      problems,
      outputDirectory,
      reference.path,
    );
    if (!resolvedReference) continue;

    const key = `${reference.field}\0${resolvedReference.absolutePath}`;
    if (checkedReferences.has(key)) continue;
    checkedReferences.add(key);

    try {
      const fileStats = await stat(resolvedReference.absolutePath);
      if (!fileStats.isFile()) {
        problems.push(
          `${reference.field} points to ${JSON.stringify(resolvedReference.extensionPath)}, but it is not a file`,
        );
      }
    } catch (error) {
      if (error.code === 'ENOENT' || error.code === 'ENOTDIR') {
        problems.push(
          `${reference.field} points to missing file ${JSON.stringify(resolvedReference.extensionPath)}`,
        );
      } else {
        problems.push(
          `could not inspect ${reference.field} file ${JSON.stringify(resolvedReference.extensionPath)}: ${error.message}`,
        );
      }
    }
  }
}

async function findCssFiles(directory) {
  const paths = [];
  const entries = await readdir(directory, { withFileTypes: true });

  for (const entry of entries) {
    const path = resolve(directory, entry.name);

    if (entry.isDirectory()) {
      paths.push(...(await findCssFiles(path)));
    } else if (entry.isFile() && entry.name.endsWith('.css')) {
      paths.push(path);
    }
  }

  return paths;
}

export async function findAstryxThemeArtifactProblems(outputDirectory) {
  let cssPaths;

  try {
    cssPaths = await findCssFiles(outputDirectory);
  } catch (error) {
    return [`could not inspect emitted CSS: ${error.message}`];
  }

  if (cssPaths.length === 0) {
    return ['build must emit at least one CSS bundle'];
  }

  const problems = [];

  const nestedCssPaths = cssPaths.filter(
    (cssPath) => dirname(cssPath) !== outputDirectory,
  );

  for (const cssPath of nestedCssPaths) {
    let css;

    try {
      css = await readFile(cssPath, 'utf8');
    } catch (error) {
      problems.push(
        `could not read emitted CSS ${JSON.stringify(relative(outputDirectory, cssPath))}: ${error.message}`,
      );
      continue;
    }

    const relativeCssPath = relative(outputDirectory, cssPath);
    if (!astryxThemeLayer.test(css)) {
      problems.push(`${relativeCssPath} is missing the Astryx vivid theme layer`);
    }
    if (!astryxVividSelector.test(css)) {
      problems.push(`${relativeCssPath} is missing the Astryx vivid theme selector`);
    }
    if (!astryxVividDestructiveButtonSelector.test(css)) {
      problems.push(`${relativeCssPath} is missing the Astryx vivid component overrides`);
    }
  }

  return problems;
}

async function validateVariant(variant, packageVersion) {
  const problems = [];
  const references = sharedRuntimeAssets.map((path) => ({
    field: 'shared runtime asset',
    path,
  }));
  const outputDirectory = resolve(projectDirectory, 'build', variant.name);
  const relativeOutputDirectory = `build/${variant.name}`;

  try {
    const outputStats = await stat(outputDirectory);
    if (!outputStats.isDirectory()) {
      return [`${relativeOutputDirectory} exists but is not a directory`];
    }
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') {
      return [
        `${relativeOutputDirectory} is missing; run "npm run build:variant -- ${variant.name}" first`,
      ];
    }

    return [`could not inspect ${relativeOutputDirectory}: ${error.message}`];
  }

  problems.push(...(await findAstryxThemeArtifactProblems(outputDirectory)));

  let manifest;
  try {
    manifest = await readJson(
      resolve(outputDirectory, 'manifest.json'),
      `${relativeOutputDirectory}/manifest.json`,
    );
  } catch (error) {
    problems.push(error.message);
    await validateReferencedFiles(problems, outputDirectory, references);
    return problems;
  }

  if (!isPlainObject(manifest)) {
    problems.push(
      `manifest.json must contain an object, received ${formatValue(manifest)}`,
    );
    await validateReferencedFiles(problems, outputDirectory, references);
    return problems;
  }

  const expectedManifestVersion = variant.family === 'chromium' ? 3 : 2;
  if (manifest.manifest_version !== expectedManifestVersion) {
    problems.push(
      `manifest_version must be ${expectedManifestVersion}, received ${formatValue(manifest.manifest_version)}`,
    );
  }

  const manifestDisplayVersion = manifest.version_name ?? manifest.version;
  if (manifestDisplayVersion !== packageVersion) {
    problems.push(
      `manifest version must represent package.json (${JSON.stringify(packageVersion)}), received ${formatValue(manifestDisplayVersion)}`,
    );
  }

  expectExactArray(
    problems,
    manifest.permissions,
    variant.family === 'chromium' ? chromiumPermissions : firefoxPermissions,
    'permissions',
  );

  if (variant.name === 'chromium') {
    if (manifest.update_url !== chromiumUpdateUrl) {
      problems.push(
        `update_url must be ${JSON.stringify(chromiumUpdateUrl)}, received ${formatValue(manifest.update_url)}`,
      );
    }
  } else if (hasOwn(manifest, 'update_url')) {
    problems.push('update_url must be present only in the chromium build');
  }

  const gecko = manifest.browser_specific_settings?.gecko;
  const hasGeckoId = isPlainObject(gecko) && hasOwn(gecko, 'id');
  if (variant.name === 'firefox-standalone') {
    if (!hasGeckoId || gecko.id !== firefoxStandaloneId) {
      problems.push(
        `browser_specific_settings.gecko.id must be ${JSON.stringify(firefoxStandaloneId)}, received ${formatValue(gecko?.id)}`,
      );
    }
  } else if (hasGeckoId) {
    problems.push(
      'browser_specific_settings.gecko.id must be present only in the firefox-standalone build',
    );
  }

  if (variant.family === 'chromium') {
    validateChromiumManifest(problems, references, manifest);
  } else {
    validateFirefoxManifest(problems, references, manifest);
  }

  addIconReferences(problems, references, manifest.icons, 'icons');
  validateOptions(problems, references, manifest);
  validateContentScripts(problems, references, manifest);
  validateWebAccessibleResources(problems, references, manifest, variant.family);
  await validateReferencedFiles(problems, outputDirectory, references);

  return problems;
}

export async function validateExtensionBuilds() {
  const packageJson = await readJson(packagePath, 'package.json');
  if (!isPlainObject(packageJson)) {
    throw new Error(
      `package.json must contain an object, received ${formatValue(packageJson)}`,
    );
  }

  if (typeof packageJson.version !== 'string' || packageJson.version === '') {
    throw new Error(
      `package.json version must be a non-empty string, received ${formatValue(packageJson.version)}`,
    );
  }

  const results = await Promise.all(
    variants.map(async (variant) => ({
      variant,
      problems: await validateVariant(variant, packageJson.version),
    })),
  );
  const failures = results.filter((result) => result.problems.length > 0);

  if (failures.length > 0) {
    const details = failures.flatMap(({ variant, problems }) =>
      problems.map((problem) => `- build/${variant.name}: ${problem}`),
    );
    throw new Error(`Extension build validation failed:\n${details.join('\n')}`);
  }

  for (const { variant } of results) {
    console.log(`Validated build/${variant.name}`);
  }
}

const isMainModule =
  process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMainModule) {
  validateExtensionBuilds().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
