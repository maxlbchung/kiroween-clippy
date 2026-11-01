// Pure geometry: where panels go relative to Clippy, and keeping Clippy on screen.
import { PET, PANEL_PAD, PANEL_TAIL } from '../shared/layout.js';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** Clippy's visible body rect in screen coordinates. */
export function bodyRect(bounds, scale) {
  return {
    x: bounds.x + PET.body.x * scale,
    y: bounds.y + PET.body.y * scale,
    width: PET.body.width * scale,
    height: PET.body.height * scale,
  };
}

/** Window position that keeps Clippy's body inside the work area. */
export function clampPet(pos, scale, workArea, margin = 4) {
  const bx = pos.x + PET.body.x * scale;
  const by = pos.y + PET.body.y * scale;
  const bw = PET.body.width * scale;
  const bh = PET.body.height * scale;
  const nx = clamp(bx, workArea.x + margin, workArea.x + workArea.width - bw - margin);
  const ny = clamp(by, workArea.y + margin, workArea.y + workArea.height - bh - margin);
  return { x: Math.round(pos.x + (nx - bx)), y: Math.round(pos.y + (ny - by)) };
}

/** Window position that keeps the whole radial menu on screen. */
export function clampRing(pos, scale, workArea, margin = 6) {
  const r = PET.ring;
  const ext = r.button / 2 + 4;
  const left = pos.x + (r.cx - r.rx - ext) * scale;
  const right = pos.x + (r.cx + r.rx + ext) * scale;
  const top = pos.y + (r.cy - r.ry - ext) * scale;
  const bottom = pos.y + (r.cy + r.ry * 0.87 + ext) * scale;
  let dx = 0;
  let dy = 0;
  if (left < workArea.x + margin) dx = workArea.x + margin - left;
  else if (right > workArea.x + workArea.width - margin) dx = workArea.x + workArea.width - margin - right;
  if (top < workArea.y + margin) dy = workArea.y + margin - top;
  else if (bottom > workArea.y + workArea.height - margin) dy = workArea.y + workArea.height - margin - bottom;
  return { x: Math.round(pos.x + dx), y: Math.round(pos.y + dy) };
}

/** Default spot: bottom-right corner of the work area. */
export function defaultPetPosition(scale, workArea) {
  return {
    x: Math.round(workArea.x + workArea.width - 36 - (PET.body.x + PET.body.width) * scale),
    y: Math.round(workArea.y + workArea.height - 12 - (PET.body.y + PET.body.height) * scale),
  };
}

/**
 * Place a panel beside Clippy. Returns window bounds plus where the bubble tail
 * (or window "zoom" origin) should point, in panel-content coordinates.
 */
export function placePanel({ petBounds, scale, panel, workArea, preferSide }) {
  const body = bodyRect(petBounds, scale);
  const anchorY = petBounds.y + PET.eyeY * scale;
  const gap = panel.kind === 'bubble' ? PANEL_TAIL + 6 : 16;
  const w = panel.width;
  const h = panel.height;
  const right = workArea.x + workArea.width - 6;
  const left = workArea.x + 6;

  const rightX = body.x + body.width + gap;
  const leftX = body.x - gap - w;
  const fitsRight = rightX + w <= right;
  const fitsLeft = leftX >= left;

  let side;
  if (preferSide === 'left' && fitsLeft) side = 'left';
  else if (preferSide === 'right' && fitsRight) side = 'right';
  else if (fitsRight) side = 'right';
  else if (fitsLeft) side = 'left';
  else side = right - (body.x + body.width) >= body.x - left ? 'right' : 'left';

  const contentX = clamp(side === 'right' ? rightX : leftX, left, right - w);
  const lead = panel.kind === 'bubble' ? 64 : 96;
  const contentY = clamp(anchorY - lead, workArea.y + 6, workArea.y + workArea.height - 6 - h);
  const tailY = clamp(anchorY - contentY, 24, h - 24);
  const originX = side === 'right' ? -gap : w + gap;

  return {
    bounds: {
      x: Math.round(contentX - PANEL_PAD),
      y: Math.round(contentY - PANEL_PAD),
      width: w + PANEL_PAD * 2,
      height: h + PANEL_PAD * 2,
    },
    side,
    tailY: Math.round(tailY),
    originX: Math.round(originX),
    originY: Math.round(tailY),
  };
}
