// Build-time only: npm install --prefix artifacts/tools/maps --no-package-lock --ignore-scripts d3-geo@3.1.1
// Run from the repository root. No map libraries or external tile servers run in the app.
import fs from 'node:fs';
import crypto from 'node:crypto';
import { geoNaturalEarth1, geoPath } from '../artifacts/tools/maps/node_modules/d3-geo/src/index.js';

const sourceUrl = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/9380cca83db5f9aef52d5e762765100745f84b27/geojson/ne_110m_admin_0_countries.geojson';
const response = await fetch(sourceUrl);
if (!response.ok) throw new Error('Could not fetch Natural Earth data: ' + response.status);
const source = await response.text();
const data = JSON.parse(source);
const collection = { ...data, features: data.features.filter(feature => feature.properties.ISO_A2_EH !== 'AQ') };
const projection = geoNaturalEarth1().fitExtent([[10, 8], [890, 452]], collection);
const path = geoPath(projection).digits(1);
const countries = new Map();
for (const feature of collection.features) {
  const code = feature.properties.ISO_A2_EH === '-99' ? ({ CYN: 'CY', SOL: 'SO' }[feature.properties.ADM0_A3]) : feature.properties.ISO_A2_EH;
  if (!code) throw new Error('Country code missing: ' + feature.properties.ADMIN);
  const existing = countries.get(code);
  const name = code === 'CY' ? 'Cyprus' : code === 'SO' ? 'Somalia' : feature.properties.NAME_EN || feature.properties.ADMIN;
  countries.set(code, { code, name, path: (existing?.path || '') + path(feature) });
}
const result = { width: 900, height: 460, countries: [...countries.values()].sort((a, b) => a.code.localeCompare(b.code)) };
fs.writeFileSync('client/src/components/dashboard/world-map.json', JSON.stringify(result) + '\n');
console.log('Generated country paths:', result.countries.length, 'Source SHA-256:', crypto.createHash('sha256').update(source).digest('hex'));
