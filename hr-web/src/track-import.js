const surfaceResourceByClass = new Map([
  [1, 1], [2, 1076], [50, null], [51, 1051], [52, 1052], [53, 1053],
  [54, 1070], [55, 1071], [56, 1072], [57, 1073], [58, 1058],
  [59, 1059], [60, 1060], [61, 1061], [62, 1062], [63, 1063],
  [64, 1064], [65, 1065], [66, 1066], [67, 1067], [68, 1068],
  [69, 1069], [70, 1074], [71, 1074], [72, 1076], [73, 1077],
]);

const textureByResource = new Map([
  [1, 'black.png'], [1051, 'metal_plate.png'], [1052, 'right_arrow_gray.png'],
  [1053, 'left_arrow_gray.png'], [1058, 'step_sign.png'], [1059, 'pass_right.png'],
  [1060, 'pass_left.png'], [1061, 'do_not_enter_small.png'],
  [1062, 'do_not_enter_large.png'], [1063, 'water.png'], [1064, 'speed_zone.png'],
  [1065, 'fuel_zone.png'], [1066, 'yellow.png'], [1067, 'checkers.png'],
  [1068, 'pit_area.png'], [1069, 'finish.png'], [1070, 'right_arrow_red_off.png'],
  [1071, 'left_arrow_red_off.png'], [1072, 'right_arrow_green_off.png'],
  [1073, 'left_arrow_green_off.png'], [1074, 'neon.png'], [1076, 'gray_wall.png'],
  [1077, 'wall_top.png'],
]);

class Reader {
  constructor(buffer, offset = 0) { this.view = new DataView(buffer); this.offset = offset; }
  ensure(bytes) { if (this.offset + bytes > this.view.byteLength) throw new Error('file ended unexpectedly'); }
  u8() { this.ensure(1); const v = this.view.getUint8(this.offset); this.offset += 1; return v; }
  i16() { this.ensure(2); const v = this.view.getInt16(this.offset, true); this.offset += 2; return v; }
  u16() { this.ensure(2); const v = this.view.getUint16(this.offset, true); this.offset += 2; return v; }
  i32() { this.ensure(4); const v = this.view.getInt32(this.offset, true); this.offset += 4; return v; }
  u32() { this.ensure(4); const v = this.view.getUint32(this.offset, true); this.offset += 4; return v; }
  string() {
    let length = this.u8();
    if (length === 0xff) {
      length = this.u16();
      if (length === 0xffff) length = this.u32();
      if (length === 0xfffe) throw new Error('Unicode parcel strings are not supported');
    }
    this.ensure(length);
    const bytes = new Uint8Array(this.view.buffer, this.view.byteOffset + this.offset, length);
    this.offset += length;
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

const point2 = (reader) => [reader.i32(), reader.i32()];
const point3 = (reader) => [reader.i32(), reader.i32(), reader.i32()];

function surface(reader) {
  const dllId = reader.u16();
  const classId = reader.u16();
  const resourceId = dllId === 0 ? null : surfaceResourceByClass.get(classId) ?? null;
  return { dllId, classId, resourceId, texture: textureByResource.get(resourceId) ?? null };
}

function section(reader) {
  const vertexCount = reader.i32();
  const floor = reader.i32();
  const ceiling = reader.i32();
  const min = point2(reader);
  const max = point2(reader);
  const vertices = Array.from({ length: vertexCount }, () => ({ point: point2(reader), wallLength: reader.i32() }));
  const floorSurface = surface(reader);
  const ceilingSurface = surface(reader);
  const wallSurfaces = Array.from({ length: vertexCount }, () => surface(reader));
  return { vertexCount, floor, ceiling, min, max, vertices, floorSurface, ceilingSurface, wallSurfaces };
}

function room(reader) {
  const value = section(reader);
  const childCount = reader.i32();
  const visibleRoomCount = reader.i32();
  const visibleSurfaceCount = reader.i32();
  const audibleRoomCount = reader.i32();
  const neighbors = Array.from({ length: value.vertexCount }, () => reader.i32());
  const children = Array.from({ length: childCount }, () => reader.i32());
  const visibleRooms = Array.from({ length: visibleRoomCount }, () => reader.i32());
  const visibleFloors = [];
  const visibleCeilings = [];
  for (let index = 0; index < visibleSurfaceCount; index += 1) {
    visibleFloors.push({ type: reader.i32(), id: reader.i32() });
    visibleCeilings.push({ type: reader.i32(), id: reader.i32() });
  }
  const audibleRooms = [];
  for (let index = 0; index < audibleRoomCount; index += 1) {
    const sourceCount = reader.i32();
    audibleRooms.push(Array.from({ length: sourceCount }, () => ({ vertex: reader.i32(), coefficient: reader.u8() })));
  }
  return { ...value, neighbors, children, visibleRooms, visibleFloors, visibleCeilings, audibleRooms };
}

const actorTypeByClass = new Map([
  [150, 'missile'], [151, 'mine'], [152, 'powerup'], [170, 'bumperGate'],
  [200, 'fuel'], [201, 'speedDoubler'], [202, 'finish'], [203, 'checkpoint1'], [204, 'checkpoint2'],
]);

function actorList(reader, classifiedRoom) {
  const actors = [];
  for (;;) {
    const dllId = reader.u16();
    const classId = reader.u16();
    if (dllId === 0) break;
    actors.push({ dllId, classId, type: actorTypeByClass.get(classId) ?? 'unknown', classifiedRoom,
      position: point3(reader), orientation: reader.i16() });
  }
  return actors;
}

function recordHeader(buffer) {
  const reader = new Reader(buffer);
  const title = reader.string();
  reader.i32(); reader.i32();
  const checksumValid = reader.i32() !== 0;
  const checksum = reader.u32();
  const recordsUsed = reader.u32();
  const recordsMax = reader.u32();
  reader.i32(); reader.i32();
  const records = Array.from({ length: recordsMax }, () => reader.u32());
  return { title, checksumValid, checksum, recordsUsed, records: records.slice(0, recordsUsed) };
}

export function parseClassicTrack(buffer, name = 'Imported track') {
  const header = recordHeader(buffer);
  if (header.records.length < 2) throw new Error('native track is missing its level record');
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
  const starts = Array.from({ length: playerCount }, () => ({ team: reader.i32(), room: reader.i32(), position: point3(reader), orientation: reader.i16() }));
  const roomCount = reader.i32();
  const featureCount = reader.i32();
  if (roomCount < 1 || roomCount > 10000 || featureCount < 0 || featureCount > 10000) {
    throw new Error('native track has implausible room or feature counts');
  }
  const rooms = Array.from({ length: roomCount }, () => room(reader));
  const features = Array.from({ length: featureCount }, () => ({ ...section(reader), parent: reader.i32() }));
  const geometryRecordEnd = reader.offset;
  const actors = actorList(reader, null);
  for (let roomIndex = 0; roomIndex < roomCount; roomIndex += 1) actors.push(...actorList(reader, roomIndex));
  const levelRecordEnd = header.records[2] ?? buffer.byteLength;
  if (reader.offset > levelRecordEnd) throw new Error('native track actor records exceed the level record');
  return { format: 'HoverRace Classic track', source: name, title: header.title,
    metadata: { magic, version, description, regMinor, regMajor, sortingIndex, registrationMode },
    starts, rooms, features, actors, geometryRecordEnd, levelRecordEnd: reader.offset };
}
