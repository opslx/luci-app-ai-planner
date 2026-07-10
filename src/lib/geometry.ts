import type { Point, Wall } from '../types/floorplan';

export function dist(a: Point, b: Point): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy);
}

export function wallLength(wall: Wall): number {
  return dist(wall.a, wall.b);
}

export function pointOnWall(wall: Wall, t: number): Point {
  return {
    x: wall.a.x + (wall.b.x - wall.a.x) * t,
    y: wall.a.y + (wall.b.y - wall.a.y) * t,
  };
}

export function projectOnWall(wall: Wall, p: Point): { t: number; point: Point; distance: number } {
  const dx = wall.b.x - wall.a.x;
  const dy = wall.b.y - wall.a.y;
  const len2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((p.x - wall.a.x) * dx + (p.y - wall.a.y) * dy) / len2));
  const point = pointOnWall(wall, t);
  return { t, point, distance: dist(p, point) };
}

export function nearestWall(
  walls: Wall[],
  p: Point,
  maxDist = 24,
): { wall: Wall; t: number; point: Point } | null {
  let best: { wall: Wall; t: number; point: Point; distance: number } | null = null;
  for (const wall of walls) {
    const hit = projectOnWall(wall, p);
    if (hit.distance <= maxDist && (!best || hit.distance < best.distance)) {
      best = { wall, ...hit };
    }
  }
  return best ? { wall: best.wall, t: best.t, point: best.point } : null;
}

export function segmentWallIntersection(
  a: Point,
  b: Point,
  wall: Wall,
): { pathT: number; wallT: number } | null {
  const rx = b.x - a.x;
  const ry = b.y - a.y;
  const sx = wall.b.x - wall.a.x;
  const sy = wall.b.y - wall.a.y;
  const denominator = rx * sy - ry * sx;
  if (Math.abs(denominator) < 1e-9) return null;

  const qpx = wall.a.x - a.x;
  const qpy = wall.a.y - a.y;
  const pathT = (qpx * sy - qpy * sx) / denominator;
  const wallT = (qpx * ry - qpy * rx) / denominator;
  if (pathT <= 1e-6 || pathT >= 1 - 1e-6 || wallT < -1e-6 || wallT > 1 + 1e-6) {
    return null;
  }
  return { pathT, wallT: Math.max(0, Math.min(1, wallT)) };
}

export function snap(value: number, grid = 10): number {
  return Math.round(value / grid) * grid;
}
