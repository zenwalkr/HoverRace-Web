function parcel(writer, value) {
  const bytes = new TextEncoder().encode(value);
  if (bytes.length >= 255) throw new Error('Track text is too long for .trk export');
  writer.u8(bytes.length); writer.bytes(bytes);
}

class Writer {
  constructor() { this.values = []; }
  u8(value) { this.values.push(value & 255); }
  u16(value) { this.u8(value); this.u8(value >> 8); }
  i16(value) { this.u16(value); }
  i32(value) { const n = Number(value) | 0; this.u8(n); this.u8(n >> 8); this.u8(n >> 16); this.u8(n >> 24); }
  u32(value) { const n = Number(value) >>> 0; this.u8(n); this.u8(n >> 8); this.u8(n >> 16); this.u8(n >> 24); }
  bytes(values) { for (const value of values) this.u8(value); }
  get length() { return this.values.length; }
  buffer() { return Uint8Array.from(this.values).buffer; }
}

function nativeSurface(writer, classId) { writer.u16(1); writer.u16(classId); }
const nativeClass = { missile: 150, mine: 151, powerup: 152, bumperGate: 170, fuel: 200,
  speedDoubler: 201, finish: 202, checkpoint1: 203, checkpoint2: 204 };

export function encodeClassicTrack(track) {
  const metadata = new Writer(); metadata.i32(82617); metadata.i32(1);
  parcel(metadata, track.title ?? 'HoverRace procedural track'); metadata.i32(0); metadata.i32(0); metadata.i32(30); metadata.i32(1);
  const level = new Writer(); level.i32(track.starts.length);
  for (const start of track.starts) { level.i32(start.team ?? 1); level.i32(start.room ?? 0); for (const value of start.position) level.i32(value); level.i16(start.orientation ?? 0); }
  level.i32(track.rooms.length); level.i32(track.features?.length ?? 0);
  for (const room of track.rooms) {
    level.i32(room.vertices.length); level.i32(room.floor); level.i32(room.ceiling);
    level.i32(room.min[0]); level.i32(room.min[1]); level.i32(room.max[0]); level.i32(room.max[1]);
    for (const vertex of room.vertices) { level.i32(vertex.point[0]); level.i32(vertex.point[1]); level.i32(vertex.wallLength ?? 0); }
    nativeSurface(level, room.floorSurface?.classId ?? 51); nativeSurface(level, room.ceilingSurface?.classId ?? 50);
    for (const wall of room.wallSurfaces) nativeSurface(level, wall?.classId ?? 72);
    level.i32(0); level.i32(0); level.i32(0); level.i32(0); for (const neighbor of room.neighbors) level.i32(neighbor ?? -1);
  }
  for (const feature of track.features ?? []) {
    level.i32(feature.vertices.length); level.i32(feature.floor); level.i32(feature.ceiling);
    level.i32(feature.min[0]); level.i32(feature.min[1]); level.i32(feature.max[0]); level.i32(feature.max[1]);
    for (const vertex of feature.vertices) { level.i32(vertex.point[0]); level.i32(vertex.point[1]); level.i32(vertex.wallLength ?? 0); }
    nativeSurface(level, feature.floorSurface?.classId ?? 51); nativeSurface(level, feature.ceilingSurface?.classId ?? 50);
    for (const wall of feature.wallSurfaces) nativeSurface(level, wall?.classId ?? 72); level.i32(feature.parent ?? 0);
  }
  const globalActors = (track.actors ?? []).filter((entry) => entry.classifiedRoom == null);
  const actorsForRoom = (room) => (track.actors ?? []).filter((entry) => entry.classifiedRoom === room);
  for (const entries of [globalActors, ...track.rooms.map((_, index) => actorsForRoom(index))]) {
    for (const item of entries) { level.u16(1); level.u16(nativeClass[item.type] ?? 152); for (const value of item.position) level.i32(value); level.i16(item.orientation ?? 0); }
    level.u16(0); level.u16(0);
  }
  const header = new Writer(); parcel(header, track.title ?? 'HoverRace procedural track');
  header.i32(0); header.i32(0); header.i32(1); header.u32(0); header.u32(2); header.u32(2); header.i32(0); header.i32(0);
  const metadataOffset = header.length + 8; const levelOffset = metadataOffset + metadata.length;
  header.u32(metadataOffset); header.u32(levelOffset);
  return new Blob([header.buffer(), metadata.buffer(), level.buffer()], { type: 'application/octet-stream' });
}

export function downloadTrack(track, format = 'json') {
  const slug = (track.title ?? 'procedural-track').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const blob = format === 'trk' ? encodeClassicTrack(track) : new Blob([JSON.stringify(track, null, 2)], { type: 'application/json' });
  const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `${slug}.${format}`; link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}
