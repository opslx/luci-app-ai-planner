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

/** Count wall crossings along segment AP → sample, skip openings approximately by loss model elsewhere */
export function segmentHitsWall(a: Point, b: Point, wall: Wall): boolean {
  return segmentsIntersect(a, b, wall.a, wall.b);
}

function orient(p: Point, q: Point, r: Point): number {
  const v = (q.y - p.y) * (r.x - q.x) - (q.x - p.x) * (r.y - q.y);
  if (Math.abs(v) < 1e-9) return 0;
  return v > 0 ? 1 : 2;
}

function onSegment(p: Point, q: Point, r: Point): boolean {
  return (
    q.x <= Math.max(p.x, r.x) &&
    q.x >= Math.min(p.x, r.x) &&
    q.y <= Math.max(p.y, r.y) &&
    q.y >= Math.min(p.y, r.y)
  );
}

export function segmentsIntersect(p1: Point, q1: Point, p2: Point, q2: Point): boolean {
  const o1 = orient(p1, q1, p2);
  const o2 = orient(p1, q1, q2);
  const o3 = orient(p2, q2, p1);
  const o4 = orient(p2, q2, q1);

  if (o1 !== o2 && o3 !== o4) return true;
  if (o1 === 0 && onSegment(p1, p2, q1)) return true;
  if (o2 === 0 && onSegment(p1, q2, q1)) return true;
  if (o3 === 0 && onSegment(p2, p1, q2)) return true;
  if (o4 === 0 && onSegment(p2, q1, q2)) return true;
  return false;
}

export function snap(value: number, grid = 10): number {
  return Math.round(value / grid) * grid;
}
