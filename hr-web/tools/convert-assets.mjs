import { copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const webRoot = resolve(import.meta.dirname, '..');
const sourceRoot = resolve(webRoot, '..', 'HoverRace-master');
const publicRoot = join(webRoot, 'public', 'assets');
const textureRoot = join(publicRoot, 'textures');
const meshRoot = join(publicRoot, 'meshes');
const trackRoot = join(publicRoot, 'tracks');
const soundRoot = join(publicRoot, 'sounds');
const uiRoot = join(publicRoot, 'ui');

const surfaceResourceByClass = new Map([
  [1, 1], [2, 1076], [50, null], [51, 1051], [52, 1052], [53, 1053],
  [54, 1070], [55, 1071], [56, 1072], [57, 1073], [58, 1058],
  [59, 1059], [60, 1060], [61, 1061], [62, 1062], [63, 1063],
  [64, 1064], [65, 1065], [66, 1066], [67, 1067], [68, 1068],
  [69, 1069], [70, 1074], [71, 1074], [72, 1076], [73, 1077],
]);

class Reader {
  constructor(buffer, offset = 0) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    this.offset = offset;
  }

  u8() { const value = this.view.getUint8(this.offset); this.offset += 1; return value; }
  i16() { const value = this.view.getInt16(this.offset, true); this.offset += 2; return value; }
  u16() { const value = this.view.getUint16(this.offset, true); this.offset += 2; return value; }
  i32() { const value = this.view.getInt32(this.offset, true); this.offset += 4; return value; }
  u32() { const value = this.view.getUint32(this.offset, true); this.offset += 4; return value; }

  string() {
    let length = this.u8();
    if (length === 0xff) {
      length = this.u16();
      if (length === 0xffff) length = this.u32();
      if (length === 0xfffe) throw new Error('Unicode parcel strings are not supported');
    }
    const start = this.offset;
    this.offset += length;
    return new TextDecoder('windows-1252').decode(
      new Uint8Array(this.view.buffer, this.view.byteOffset + start, length),
    );
  }
}

function readRecordHeader(buffer) {
  const reader = new Reader(buffer);
  const title = reader.string();
  reader.i32();
  reader.i32();
  const checksumValid = reader.i32() !== 0;
  const checksum = reader.u32();
  const recordsUsed = reader.u32();
  const recordsMax = reader.u32();
  reader.i32();
  reader.i32();
  const records = Array.from({ length: recordsMax }, () => reader.u32());
  return { title, checksumValid, checksum, recordsUsed, records: records.slice(0, recordsUsed) };
}

function point2(reader) {
  return [reader.i32(), reader.i32()];
}

function point3(reader) {
  return [reader.i32(), reader.i32(), reader.i32()];
}

function surface(reader, textureCatalog) {
  const dllId = reader.u16();
  const classId = reader.u16();
  const resourceId = dllId === 0 ? null : surfaceResourceByClass.get(classId);
  const texture = resourceId == null ? null : textureCatalog.byId.get(resourceId)?.output ?? null;
  return { dllId, classId, resourceId: resourceId ?? null, texture };
}

function section(reader, textureCatalog) {
  const vertexCount = reader.i32();
  const floor = reader.i32();
  const ceiling = reader.i32();
  const min = point2(reader);
  const max = point2(reader);
  const vertices = Array.from({ length: vertexCount }, () => ({
    point: point2(reader),
    wallLength: reader.i32(),
  }));
  const floorSurface = surface(reader, textureCatalog);
  const ceilingSurface = surface(reader, textureCatalog);
  const wallSurfaces = Array.from({ length: vertexCount }, () => surface(reader, textureCatalog));
  return { vertexCount, floor, ceiling, min, max, vertices, floorSurface, ceilingSurface, wallSurfaces };
}

function room(reader, textureCatalog) {
  const value = section(reader, textureCatalog);
  const childCount = reader.i32();
  const visibleRoomCount = reader.i32();
  const visibleSurfaceCount = reader.i32();
  const audibleRoomCount = reader.i32();
  const neighbors = Array.from({ length: value.vertexCount }, () => reader.i32());
  const children = Array.from({ length: childCount }, () => reader.i32());
  const visibleRooms = Array.from({ length: visibleRoomCount }, () => reader.i32());
  const visibleFloors = [];
  const visibleCeilings = [];
  for (let i = 0; i < visibleSurfaceCount; i += 1) {
    visibleFloors.push({ type: reader.i32(), id: reader.i32() });
    visibleCeilings.push({ type: reader.i32(), id: reader.i32() });
  }
  const audibleRooms = [];
  for (let i = 0; i < audibleRoomCount; i += 1) {
    const sourceCount = reader.i32();
    const sources = Array.from({ length: sourceCount }, () => ({
      vertex: reader.i32(),
      coefficient: reader.u8(),
    }));
    audibleRooms.push(sources);
  }
  return { ...value, neighbors, children, visibleRooms, visibleFloors, visibleCeilings, audibleRooms };
}

const actorTypeByClass = new Map([
  [150, 'missile'], [151, 'mine'], [152, 'powerup'], [170, 'bumperGate'],
  [200, 'fuel'], [201, 'speedDoubler'], [202, 'finish'],
  [203, 'checkpoint1'], [204, 'checkpoint2'],
]);

function actorList(reader, classifiedRoom) {
  const actors = [];
  for (;;) {
    const dllId = reader.u16();
    const classId = reader.u16();
    if (dllId === 0) break;
    actors.push({
      dllId,
      classId,
      type: actorTypeByClass.get(classId) ?? 'unknown',
      classifiedRoom,
      position: point3(reader),
      orientation: reader.i16(),
    });
  }
  return actors;
}

function parseTrack(buffer, name, textureCatalog) {
  const header = readRecordHeader(buffer);
  if (header.records.length < 2) throw new Error(`${name}: missing level record`);

  const metadataReader = new Reader(buffer, header.records[0]);
  const magic = metadataReader.i32();
  const version = metadataReader.i32();
  const description = metadataReader.string();
  const regMinor = metadataReader.i32();
  const regMajor = metadataReader.i32();
  const sortingIndex = metadataReader.i32();
  const registrationMode = metadataReader.i32();

  const reader = new Reader(buffer, header.records[1]);
  const playerCount = reader.i32();
  const starts = Array.from({ length: playerCount }, () => ({
    team: reader.i32(),
    room: reader.i32(),
    position: point3(reader),
    orientation: reader.i16(),
  }));
  const roomCount = reader.i32();
  const featureCount = reader.i32();
  if (roomCount < 1 || roomCount > 10000 || featureCount < 0 || featureCount > 10000) {
    throw new Error(`${name}: implausible section counts (${roomCount}/${featureCount})`);
  }
  const rooms = Array.from({ length: roomCount }, () => room(reader, textureCatalog));
  const features = Array.from({ length: featureCount }, () => ({
    ...section(reader, textureCatalog),
    parent: reader.i32(),
  }));
  const geometryRecordEnd = reader.offset;
  const actors = actorList(reader, null);
  for (let roomIndex = 0; roomIndex < roomCount; roomIndex += 1) {
    actors.push(...actorList(reader, roomIndex));
  }
  const levelRecordEnd = header.records[2] ?? buffer.byteLength;
  if (reader.offset > levelRecordEnd) {
    throw new Error(`${name}: actor records overran level record by ${reader.offset - levelRecordEnd} bytes`);
  }

  return {
    format: 'HoverRace Classic track',
    source: name,
    title: header.title,
    metadata: { magic, version, description, regMinor, regMajor, sortingIndex, registrationMode },
    starts,
    rooms,
    features,
    actors,
    geometryRecordEnd,
    levelRecordEnd: reader.offset,
  };
}

function normalizeTextureName(token) {
  const trimmed = token.trim();
  const name = /^\d+$/.test(trimmed) ? `${trimmed}.bmp` : basename(trimmed);
  return name.toLowerCase();
}

function parseMesh(text, name, textureCatalog) {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const sequences = [];
  let sequence = null;
  let frame = null;

  for (let i = 0; i < lines.length;) {
    const command = lines[i++].toUpperCase();
    if (command === 'SEQUENCE') {
      sequence = { frames: [] };
      sequences.push(sequence);
    } else if (command === 'FRAME') {
      if (!sequence) throw new Error(`${name}: FRAME before SEQUENCE`);
      frame = { patches: [] };
      sequence.frames.push(frame);
    } else if (command === 'PATCH') {
      if (!frame) throw new Error(`${name}: PATCH before FRAME`);
      const [uRes, vRes] = lines[i++].split(/\s+/).map(Number);
      const count = uRes * vRes;
      const vertices = [];
      for (let vertex = 0; vertex < count; vertex += 1) {
        vertices.push(lines[i++].split(/\s+/).map(Number));
      }
      const sourceTexture = normalizeTextureName(lines[i++]);
      const texture = textureCatalog.byName.get(sourceTexture)?.output ?? sourceTexture.replace(/\.bmp$/i, '.png');
      frame.patches.push({ uRes, vRes, vertices, texture });
    } else {
      throw new Error(`${name}: unexpected mesh command: ${command}`);
    }
  }
  return { format: 'HoverRace patch mesh', source: name, sequences };
}

async function loadTextureCatalog() {
  const input = await readFile(join(sourceRoot, 'res', 'ObjFac1.24bit.in'), 'utf8');
  const byId = new Map();
  const byName = new Map();
  for (const line of input.split(/\r?\n/)) {
    const match = line.match(/^BITMAP\s+(\S+)\s+(\d+)\s+([\d.]+)\s+([\d.]+)\s+(\d+)/);
    if (!match) continue;
    const [, relativePath, id, width, height, antiAlias] = match;
    const sourceName = basename(relativePath).toLowerCase();
    const entry = {
      id: Number(id),
      source: relativePath,
      sourceName,
      output: sourceName.replace(/\.bmp$/i, '.png'),
      width: Number(width),
      height: Number(height),
      antiAlias: Number(antiAlias),
    };
    byId.set(entry.id, entry);
    byName.set(sourceName, entry);
  }
  return { byId, byName };
}

async function convertTexture(entry) {
  const source = join(sourceRoot, 'res', entry.source);
  const destination = join(textureRoot, entry.output);
  // The classic resource compiler reads BMP rows as raw bottom-up storage.
  // Browser decoders normalize BMP orientation, so restore the exact pixels
  // the native renderer consumed before writing PNG.
  const filter = entry.sourceName === 'finish.bmp'
    ? 'vflip,pad=128:256:0:96:color=white,crop=128:128:0:0'
    : 'vflip';
  const filterArgs = ['-vf', filter];
  const converted = spawnSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', source, ...filterArgs, destination], { encoding: 'utf8' });
  if (converted.status !== 0) {
    throw new Error(`Texture conversion failed for ${entry.source}: ${converted.stderr}`);
  }
}

async function main() {
  await Promise.all([textureRoot, meshRoot, trackRoot, soundRoot, uiRoot].map((dir) => mkdir(dir, { recursive: true })));
  const textureCatalog = await loadTextureCatalog();

  for (const entry of textureCatalog.byId.values()) await convertTexture(entry);
  await writeFile(join(textureRoot, 'catalog.json'), `${JSON.stringify([...textureCatalog.byId.values()], null, 2)}\n`);

  const meshSource = join(sourceRoot, 'res', 'meshes');
  const meshFiles = (await readdir(meshSource)).filter((name) => extname(name).toLowerCase() === '.msh').sort();
  for (const name of meshFiles) {
    const parsed = parseMesh(await readFile(join(meshSource, name), 'utf8'), name, textureCatalog);
    await writeFile(join(meshRoot, name.replace(/\.msh$/i, '.json')), `${JSON.stringify(parsed)}\n`);
  }

  const trackSource = join(sourceRoot, 'share', 'tracks');
  const trackFiles = (await readdir(trackSource)).filter((name) => extname(name).toLowerCase() === '.trk').sort();
  const trackIndex = [];
  for (const name of trackFiles) {
    const parsed = parseTrack(await readFile(join(trackSource, name)), name, textureCatalog);
    const output = name.replace(/\.trk$/i, '.json');
    await writeFile(join(trackRoot, output), `${JSON.stringify(parsed)}\n`);
    trackIndex.push({ name: basename(name, extname(name)), file: output, description: parsed.metadata.description });
  }
  await writeFile(join(trackRoot, 'index.json'), `${JSON.stringify(trackIndex, null, 2)}\n`);

  const soundSource = join(sourceRoot, 'res', 'sounds');
  for (const name of await readdir(soundSource)) {
    if (extname(name).toLowerCase() === '.wav') await copyFile(join(soundSource, name), join(soundRoot, name));
  }
  await copyFile(join(sourceRoot, 'license.txt'), join(webRoot, 'HOVERRACE-LICENSE.txt'));
  await copyFile(join(sourceRoot, 'share', 'ui', 'bg', 'practice.png'), join(uiRoot, 'practice.png'));

  console.log(`Converted ${textureCatalog.byId.size} textures, ${meshFiles.length} meshes, and ${trackFiles.length} tracks.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
