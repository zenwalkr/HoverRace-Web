const MAP_SIZE = 200;

function boundsFor(track) {
  const points = (track.rooms ?? []).flatMap((room) =>
    (room.vertices ?? []).map((vertex) => vertex.point));
  if (!points.length) return { minX: 0, minY: 0, span: 1 };
  const minX = Math.min(...points.map(([x]) => x));
  const maxX = Math.max(...points.map(([x]) => x));
  const minY = Math.min(...points.map(([, y]) => y));
  const maxY = Math.max(...points.map(([, y]) => y));
  const span = Math.max(maxX - minX, maxY - minY, 1);
  return {
    minX: (minX + maxX - span) / 2,
    minY: (minY + maxY - span) / 2,
    span,
  };
}

export class TrackRadar {
  constructor(canvas) {
    this.canvas = canvas;
    this.context = canvas.getContext('2d');
    this.map = document.createElement('canvas');
    this.map.width = MAP_SIZE;
    this.map.height = MAP_SIZE;
    this.mapContext = this.map.getContext('2d');
    this.bounds = { minX: 0, minY: 0, span: 1 };
    this.players = [];
    this.track = null;
    this.canvas.width = MAP_SIZE;
    this.canvas.height = MAP_SIZE;
    this.context.imageSmoothingEnabled = false;
  }

  setTrack(track) {
    this.track = track;
    this.bounds = boundsFor(track);
    this.drawMap();
    this.update();
  }

  setPlayers(players) {
    this.players = players ?? [];
  }

  update(localState = null) {
    if (!this.track || !this.context) return;
    this.context.clearRect(0, 0, MAP_SIZE, MAP_SIZE);
    this.context.drawImage(this.map, 0, 0);
    for (const player of this.players) this.drawMarker(player.state, '#ff9b31', 3.2);
    this.drawMarker(localState, '#f5ffff', 4.2, true);
  }

  point(position) {
    const [x, y] = position ?? [0, 0];
    return [
      (x - this.bounds.minX) * MAP_SIZE / this.bounds.span,
      MAP_SIZE - (y - this.bounds.minY) * MAP_SIZE / this.bounds.span,
    ];
  }

  drawMap() {
    const context = this.mapContext;
    context.clearRect(0, 0, MAP_SIZE, MAP_SIZE);
    context.fillStyle = '#020b0e';
    context.fillRect(0, 0, MAP_SIZE, MAP_SIZE);
    const finishRooms = new Set((this.track.actors ?? [])
      .filter((actor) => actor.type === 'finish')
      .map((actor) => actor.classifiedRoom));
    for (const [index, room] of (this.track.rooms ?? []).entries()) {
      const points = (room.vertices ?? []).map((vertex) => this.point(vertex.point));
      if (points.length < 3) continue;
      context.beginPath();
      context.moveTo(...points[0]);
      for (const point of points.slice(1)) context.lineTo(...point);
      context.closePath();
      context.fillStyle = finishRooms.has(index) ? '#e47731' : '#a6d5d8';
      context.globalAlpha = finishRooms.has(index) ? 0.9 : 0.72;
      context.fill();
    }
    context.globalAlpha = 1;
    context.strokeStyle = '#4fe0ef';
    context.lineWidth = 1;
    context.strokeRect(0.5, 0.5, MAP_SIZE - 1, MAP_SIZE - 1);
  }

  drawMarker(state, color, radius, local = false) {
    if (!state?.position) return;
    const [x, y] = this.point(state.position);
    const angle = (Number(state.orientation ?? 0) * Math.PI * 2) / 4096;
    const context = this.context;
    context.save();
    context.translate(x, y);
    context.fillStyle = color;
    context.strokeStyle = local ? '#061216' : '#401708';
    context.lineWidth = 1;
    context.beginPath();
    if (local) {
      context.arc(0, 0, radius, 0, Math.PI * 2);
    } else {
      context.rotate(angle);
      context.moveTo(radius, 0);
      context.lineTo(-radius * 0.7, radius * 0.6);
      context.lineTo(-radius * 0.7, -radius * 0.6);
      context.closePath();
    }
    context.fill();
    context.stroke();
    context.restore();
  }
}
