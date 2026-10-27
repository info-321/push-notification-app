import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';

// Read raw ZIP headers: Windows archive readers can silently normalize '\' to '/',
// hiding archives that Linux/WordPress will extract as literal filenames.
test('WordPress ZIP uses portable paths in both central and local headers', () => {
  const archive = readFileSync(new URL('../../client/public/downloads/push-notifications-plugin.zip', import.meta.url));
  const end = archive.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.ok(end >= 0, 'ZIP end record exists');
  const count = archive.readUInt16LE(end + 10);
  let offset = archive.readUInt32LE(end + 16);
  const files = new Map();
  for (let index = 0; index < count; index++) {
    assert.equal(archive.readUInt32LE(offset), 0x02014b50);
    const method = archive.readUInt16LE(offset + 10);
    const size = archive.readUInt32LE(offset + 20);
    const nameLength = archive.readUInt16LE(offset + 28);
    const extraLength = archive.readUInt16LE(offset + 30);
    const commentLength = archive.readUInt16LE(offset + 32);
    const name = archive.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');
    assert.ok(!name.includes('\\'), `ZIP path uses forward slashes: ${name}`);
    assert.ok(name.startsWith('push-notifications-plugin/'), `One top-level plugin folder: ${name}`);
    assert.ok(!name.includes('push-notifications-plugin/push-notifications-plugin/'), `No duplicate plugin folder: ${name}`);
    const localOffset = archive.readUInt32LE(offset + 42);
    assert.equal(archive.readUInt32LE(localOffset), 0x04034b50);
    const localNameLength = archive.readUInt16LE(localOffset + 26);
    const localExtraLength = archive.readUInt16LE(localOffset + 28);
    const localName = archive.subarray(localOffset + 30, localOffset + 30 + localNameLength).toString('utf8');
    assert.equal(localName, name, 'Central and local paths agree');
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = archive.subarray(dataOffset, dataOffset + size);
    files.set(name, method === 8 ? inflateRawSync(compressed) : compressed);
    offset += 46 + nameLength + extraLength + commentLength;
  }
  for (const filename of ['push-notifications.php', 'push-sw.js', 'readme.txt']) {
    const expected = readFileSync(new URL(`../../wordpress/push-notifications-plugin/${filename}`, import.meta.url));
    assert.deepEqual(files.get(`push-notifications-plugin/${filename}`), expected, `${filename} matches its source`);
  }
  assert.ok(files.get('push-notifications-plugin/push-notifications.php').subarray(0, 5).equals(Buffer.from('<?php')), 'No leading PHP output');
});
