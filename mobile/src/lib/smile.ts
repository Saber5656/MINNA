export interface SmilePoint {
  x: number;
  y: number;
}

export function makeSmileTargets(count: number) {
  const safeCount = Math.max(32, Math.min(500, Math.floor(count || 32)));
  const points: SmilePoint[] = [];
  const eyeCount = Math.max(4, Math.floor(safeCount * 0.12));
  const mouthCount = Math.max(8, Math.floor(safeCount * 0.24));
  const outlineCount = safeCount - eyeCount * 2 - mouthCount;
  addArc(points, 0.5, 0.5, 0.4, 0, Math.PI * 2, outlineCount, false);
  addArc(points, 0.36, 0.43, 0.04, 0, Math.PI * 2, eyeCount, false);
  addArc(points, 0.64, 0.43, 0.04, 0, Math.PI * 2, eyeCount, false);
  addArc(points, 0.5, 0.53, 0.19, Math.PI * 0.15, Math.PI * 0.85, mouthCount, false);
  return points;
}

function addArc(
  points: SmilePoint[],
  centerX: number,
  centerY: number,
  radius: number,
  start: number,
  end: number,
  count: number,
  invertY: boolean,
) {
  if (count <= 0) return;
  for (let index = 0; index < count; index += 1) {
    const denominator = end - start === Math.PI * 2 ? count : Math.max(1, count - 1);
    const angle = start + ((end - start) * index) / denominator;
    points.push({
      x: centerX + Math.cos(angle) * radius,
      y: centerY + Math.sin(angle) * radius * (invertY ? -1 : 1),
    });
  }
}
