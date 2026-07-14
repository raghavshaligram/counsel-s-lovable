// 2D affine matrix math in pdf.js order: [a, b, c, d, e, f]
// representing:
//   | a c e |
//   | b d f |
//   | 0 0 1 |
// Pure functions, no side effects, no external deps.

import type { Matrix, Point, OrientedBox, Rect } from "./types";

export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

export function multiply(m1: Matrix, m2: Matrix): Matrix {
  const [a1, b1, c1, d1, e1, f1] = m1;
  const [a2, b2, c2, d2, e2, f2] = m2;
  return [
    a1 * a2 + c1 * b2,
    b1 * a2 + d1 * b2,
    a1 * c2 + c1 * d2,
    b1 * c2 + d1 * d2,
    a1 * e2 + c1 * f2 + e1,
    b1 * e2 + d1 * f2 + f1,
  ];
}

export function invert(m: Matrix): Matrix {
  const [a, b, c, d, e, f] = m;
  const det = a * d - b * c;
  if (!det) return [...IDENTITY];
  const inv = 1 / det;
  return [
    d * inv,
    -b * inv,
    -c * inv,
    a * inv,
    (c * f - d * e) * inv,
    (b * e - a * f) * inv,
  ];
}

export function apply(m: Matrix, p: Point): Point {
  const [a, b, c, d, e, f] = m;
  return { x: a * p.x + c * p.y + e, y: b * p.x + d * p.y + f };
}

export function translation(tx: number, ty: number): Matrix {
  return [1, 0, 0, 1, tx, ty];
}

export function rotation(theta: number): Matrix {
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  return [c, s, -s, c, 0, 0];
}

export function scale(sx: number, sy: number): Matrix {
  return [sx, 0, 0, sy, 0, 0];
}

export function skew(ax: number, ay: number): Matrix {
  return [1, Math.tan(ay), Math.tan(ax), 1, 0, 0];
}

export interface Decomposed {
  scaleX: number;
  scaleY: number;
  rotation: number; // radians, [-π, π]
  skewX: number;    // radians
}

/**
 * QR-style decomposition using Gram–Schmidt on the column vectors, so that
 * pdf.js-style shear matrices (italic simulated by non-zero `c`) surface as a
 * skewX component rather than being smeared into rotation/scale.
 */
export function decompose(m: Matrix): Decomposed {
  const [a, b, c, d] = m;
  const scaleX = Math.hypot(a, b);
  if (!scaleX) return { scaleX: 0, scaleY: Math.hypot(c, d), rotation: 0, skewX: 0 };
  const rot = Math.atan2(b, a);
  // Rotate columns back to axis-aligned frame to read shear + scaleY.
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  const cx = cos * c + sin * d;
  const cy = -sin * c + cos * d;
  // cx is the shear component (x-skew), cy is the true scaleY.
  const scaleY = cy;
  const skewX = scaleY ? Math.atan2(cx, scaleY) : 0;
  return { scaleX, scaleY, rotation: rot, skewX };
}

export function orientedAabb(box: OrientedBox): Rect {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of box.corners) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/** Half-plane test using the cross product of consecutive edges. Works for any
 *  convex quad — including rotated and moderately skewed boxes. */
export function pointInOrientedBox(p: Point, box: OrientedBox): boolean {
  const c = box.corners;
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = c[i];
    const b = c[(i + 1) % 4];
    const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
    if (cross === 0) continue;
    const s = cross > 0 ? 1 : -1;
    if (sign === 0) sign = s;
    else if (sign !== s) return false;
  }
  return true;
}

/** SAT test between an oriented convex quad and an axis-aligned rect. */
export function orientedBoxIntersectsRect(box: OrientedBox, rect: Rect): boolean {
  const rectCorners: Point[] = [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.w, y: rect.y },
    { x: rect.x + rect.w, y: rect.y + rect.h },
    { x: rect.x, y: rect.y + rect.h },
  ];
  const axes: Point[] = [
    { x: 1, y: 0 },
    { x: 0, y: 1 },
  ];
  for (let i = 0; i < 4; i++) {
    const a = box.corners[i];
    const b = box.corners[(i + 1) % 4];
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const len = Math.hypot(ex, ey) || 1;
    axes.push({ x: -ey / len, y: ex / len });
  }
  for (const axis of axes) {
    let minA = Infinity, maxA = -Infinity, minB = Infinity, maxB = -Infinity;
    for (const p of box.corners) {
      const d = p.x * axis.x + p.y * axis.y;
      if (d < minA) minA = d;
      if (d > maxA) maxA = d;
    }
    for (const p of rectCorners) {
      const d = p.x * axis.x + p.y * axis.y;
      if (d < minB) minB = d;
      if (d > maxB) maxB = d;
    }
    if (maxA < minB || maxB < minA) return false;
  }
  return true;
}

export function rectIntersectsRect(a: Rect, b: Rect): boolean {
  return !(a.x + a.w < b.x || b.x + b.w < a.x || a.y + a.h < b.y || b.y + b.h < a.y);
}
