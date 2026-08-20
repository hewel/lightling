/* cspell:disable */
const { createHash, createPublicKey } = require('node:crypto');
const { readFileSync } = require('node:fs');

const { version } = require(__dirname + '/../package.json');

const publicKey = createPublicKey(readFileSync('./crx.pem')).export({
  format: 'der',
  type: 'spki',
});
const appid = createHash('sha256')
  .update(publicKey)
  .digest('hex')
  .slice(0, 32)
  .replace(/[0-9a-f]/g, (character) =>
    String.fromCharCode('a'.charCodeAt(0) + Number.parseInt(character, 16)),
  );
const codebase = `https://github.com/hewel/lightling/releases/download/v${version}/lightling.crx`;

// Generate XML file
// For more info see https://developer.chrome.com/docs/apps/autoupdate/#update_manifest
const result = `<?xml version='1.0' encoding='UTF-8'?>
<gupdate xmlns='http://www.google.com/update2/response' protocol='2.0'>
  <app appid='${appid}'>
    <updatecheck codebase='${codebase}' version='${version}' />
  </app>
</gupdate>`;

// Output
console.log(result);
