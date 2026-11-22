import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const [input, output, riskInput] = process.argv.slice(2);
if (!input || !output) throw new Error('Uso: npm run pack:osm -- mapa.json pacote.json [risco-autorizado.geojson]');

const defaultBounds = [-42.999, -22.897, -42.970, -22.870];
const bounds = process.env.PACK_BOUNDS ? process.env.PACK_BOUNDS.split(',').map(Number) : defaultBounds;
const region = process.env.PACK_REGION ?? 'Rio do Ouro · São Gonçalo/RJ';
if (bounds.length!==4 || !bounds.every(Number.isFinite) || bounds[0]>=bounds[2] || bounds[1]>=bounds[3]) throw Error('PACK_BOUNDS inválido.');
if (process.env.PACK_BOUNDS && !riskInput) throw Error('Informe um GeoJSON autorizado para uma nova região.');
const osm = JSON.parse(await readFile(input, 'utf8'));
const inside = ([lon, lat]) => lon >= bounds[0] && lat >= bounds[1] && lon <= bounds[2] && lat <= bounds[3];
const byId = new Map(osm.elements.filter(x => x.type === 'node').map(x => [x.id, x]));
const safe = new Set(['motorway','trunk','primary','secondary','tertiary','unclassified','residential','service','living_street','motorway_link','trunk_link','primary_link','secondary_link','tertiary_link']);
const speedFor = {motorway:80,trunk:60,primary:50,secondary:45,tertiary:40,residential:30,service:15,living_street:15};
const point = node => [Number(node.lon.toFixed(6)), Number(node.lat.toFixed(6))];
const nodes = [];
const nodeIndex = new Map();
const roads = [];
const roadIds = new Set();

for (const {nodes: ids, tags = {}, id, type} of osm.elements) {
  if (type !== 'way' || !safe.has(tags.highway)) continue;
  const access = tags.motorcar ?? tags.motor_vehicle ?? tags.vehicle ?? tags.access;
  if (['no','private','customers','destination','agricultural','forestry','delivery','permit','emergency'].includes(access) || tags.area === 'yes' || tags.service === 'driveway') continue;
  const indices = ids.map(id => {
    const node = byId.get(id);
    if (!node || !inside(point(node))) return null;
    if (!nodeIndex.has(id)) {
      nodeIndex.set(id, nodes.length);
      nodes.push(point(node));
    }
    return nodeIndex.get(id);
  });
  const direction = tags.oneway === '-1' ? -1
    : tags.oneway === 'no' ? 0
    : ['yes','1','true'].includes(tags.oneway) || tags.junction === 'roundabout' || tags.highway === 'motorway' ? 1 : 0;
  const parsedSpeed = Number(tags.maxspeed);
  const speed = parsedSpeed >= 5 && parsedSpeed <= 130 ? parsedSpeed : (speedFor[tags.highway] ?? 30);
  let path = [];
  for (const index of [...indices, null]) {
    if (index !== null) path.push(index);
    else {
      if (path.length >= 2) {
        roads.push({id, path, name: tags.name ?? tags.ref ?? '', kind: tags.highway, direction, speed});
        roadIds.add(id);
      }
      path = [];
    }
  }
}

const turns = [];
const skipped = [];
for (const {type,id,tags,members} of osm.elements) {
  if (type !== 'relation' || tags?.type !== 'restriction') continue;
  const restriction = tags['restriction:motorcar'] ?? tags['restriction:motor_vehicle'] ?? tags.restriction;
  const roles = Object.groupBy(members, member => member.role);
  if (!restriction || /(^|;)(motorcar|motor_vehicle)(;|$)/.test(tags.except ?? '')) continue;
  const from = roles.from?.[0]?.ref;
  const to = roles.to?.[0]?.ref;
  const via = roles.via?.[0];
  if (!roadIds.has(from) || !roadIds.has(to)) continue;
  if (roles.from?.length !== 1 || roles.to?.length !== 1 || roles.via?.length !== 1 || via.type !== 'node' || tags['restriction:conditional']) {
    skipped.push(id);
    continue;
  }
  const index = nodeIndex.get(via.ref);
  if (index !== undefined) turns.push({node:index, from, to, only:restriction.startsWith('only_'), uturn:restriction.endsWith('_u_turn')});
}

const addresses = [];
const areas = [];
const barriers = [...nodeIndex].filter(([id]) => {
  const tags = byId.get(id).tags ?? {};
  return ['bollard','block','bus_trap','cycle_barrier','jersey_barrier'].includes(tags.barrier)
    || (tags.barrier && ['no','private'].includes(tags.motorcar ?? tags.motor_vehicle ?? tags.access));
}).map(([, index]) => index);
for (const {type,tags = {},...entry} of osm.elements) {
  const coords = type === 'node' ? [point(entry)] : type === 'way' ? entry.nodes.map(id => byId.get(id)).filter(Boolean).map(point) : [];
  const street = tags['addr:street'];
  const number = tags['addr:housenumber'];
  if (street && number && coords.length && inside(coords[0])) addresses.push({street, number, point:coords[0]});
  if (type === 'way' && coords.length >= 2 && (tags.waterway || tags.natural === 'water' || tags.leisure === 'park' || ['forest','grass'].includes(tags.landuse))) {
    areas.push({kind: tags.waterway || tags.natural === 'water' ? 'water' : 'green', points:coords});
  }
}

const risks = riskInput ? JSON.parse(await readFile(riskInput,'utf8')) : {
  type:'FeatureCollection',
  features:[{type:'Feature',id:'qa-zone',properties:{label:'Área simulada para testes'},geometry:{type:'Polygon',coordinates:[[[-42.9942,-22.8884],[-42.9927,-22.8884],[-42.9927,-22.8872],[-42.9942,-22.8872],[-42.9942,-22.8884]]]}}]
};
if (skipped.length) console.warn('Restrições complexas não representadas:', skipped.join(', '));
if (risks?.type!=='FeatureCollection' || !Array.isArray(risks.features) || risks.features.some(feature=>!['Polygon','MultiPolygon'].includes(feature.geometry?.type))) throw Error('GeoJSON de risco inválido.');
const body = {format:1,region,bounds,nodes,roads,turns,areas,addresses,barriers,
  source:'OpenStreetMap', license:'ODbL-1.0', dataDate:new Date().toISOString().slice(0,10), unsupportedTurnRelations:skipped,
  riskMode:riskInput ? 'operational' : 'sample', risks};
const version = createHash('sha256').update(JSON.stringify(body)).digest('hex').slice(0,16);
await writeFile(output, JSON.stringify({version,...body})+'\n');
console.log(nodes.length + ' nós, ' + roads.length + ' vias, ' + turns.length + ' restrições.');
