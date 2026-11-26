import { readFileSync, readdirSync, lstatSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateRawSync, crc32 } from 'node:zlib';
import { createHash } from 'node:crypto';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const manifest = JSON.parse(readFileSync(join(root, 'plugin.json'), 'utf8'));
delete manifest.devUrl;
delete manifest.quickDev;
if (manifest.entry !== 'dist/index.html' || !existsSync(join(root, manifest.entry))) {
  throw new Error('Build the plugin before packaging. Expected dist/index.html.');
}
const entries = [
  { name: 'plugin.json', data: Buffer.from(JSON.stringify(manifest, null, 2) + '\n') },
  { name: 'logo.svg', data: readFileSync(join(root, 'logo.svg')) },
  { name: 'THIRD_PARTY_NOTICES.md', data: readFileSync(join(root, 'THIRD_PARTY_NOTICES.md')) },
  { name: 'licenses/otools-plugin-sdk.txt', data: readFileSync(join(root, 'node_modules/otools-plugin-sdk/LICENSE')) },
];
for (const [name, file] of [
  ['vue.txt', 'vue/LICENSE'],
  ['tauri-api-MIT.txt', '@tauri-apps/api/LICENSE_MIT'],
  ['tauri-api-Apache.txt', '@tauri-apps/api/LICENSE_APACHE-2.0'],
  ['tauri-dialog.spdx', '@tauri-apps/plugin-dialog/LICENSE.spdx'],
]) {
  entries.push({ name: `licenses/${name}`, data: readFileSync(join(root, 'node_modules', file)) });
}
function walk(dir) {
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) throw new Error(`Unexpected symlink: ${path}`);
    if (stat.isDirectory()) walk(path);
    else if (stat.isFile()) entries.push({ name: relative(root, path).split('\\').join('/'), data: readFileSync(path) });
  }
}
walk(join(root, 'dist'));
// .oplg uses the same flat ZIP layout as the puter plugins.
const chunks = [], directory = [];
let offset = 0;
for (const entry of entries) {
  const name = Buffer.from(entry.name);
  const data = deflateRawSync(entry.data, { level: 9 });
  const crc = crc32(entry.data);
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(0x0800, 6);
  header.writeUInt16LE(8, 8);
  header.writeUInt16LE(33, 12); // 1980-01-01: deterministic archive timestamp.
  header.writeUInt32LE(crc, 14);
  header.writeUInt32LE(data.length, 18);
  header.writeUInt32LE(entry.data.length, 22);
  header.writeUInt16LE(name.length, 26);
  chunks.push(header, name, data);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0x0800, 8); central.writeUInt16LE(8, 10);
  central.writeUInt16LE(33, 14);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(data.length, 20); central.writeUInt32LE(entry.data.length, 24);
  central.writeUInt16LE(name.length, 28); central.writeUInt32LE(offset, 42);
  directory.push(central, name);
  offset += header.length + name.length + data.length;
}
const central = Buffer.concat(directory);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
end.writeUInt32LE(central.length, 12); end.writeUInt32LE(offset, 16);
const archive = Buffer.concat([...chunks, central, end]);
const outputDir = join(root, 'dist-pack');
mkdirSync(outputDir, { recursive: true });
const filename = `${manifest.packid}-${manifest.version}.oplg`;
writeFileSync(join(outputDir, filename), archive);
// 发布目录采用与姐妹仓一致的扁平结构：oplg + 生产清单 + logo + 摘要 + 元信息。
writeFileSync(join(outputDir, 'plugin.json'), entries[0].data);
writeFileSync(join(outputDir, 'logo.svg'), readFileSync(join(root, 'logo.svg')));
const releaseFiles = [filename, 'plugin.json', 'logo.svg'];
writeFileSync(join(outputDir, 'SHA256SUMS'), `${releaseFiles
  .map(name => `${createHash('sha256').update(readFileSync(join(outputDir, name))).digest('hex')}  ${name}`)
  .join('\n')}\n`);
const meta = {
  packid: manifest.packid,
  uuid: manifest.uuid,
  version: manifest.version,
  output: filename,
  entries: entries.length,
  totalBytes: entries.reduce((sum, item) => sum + item.data.length, 0),
  nativeLibs: [],
};
writeFileSync(join(outputDir, 'meta.json'), `${JSON.stringify(meta, null, 2)}\n`);
console.log(`Created ${filename} (${entries.length} files, ${archive.length} bytes)`);
