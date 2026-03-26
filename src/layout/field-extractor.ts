/**
 * Template-based field extraction for Japanese driver's licenses.
 *
 * Strategy: classify each OCR text box into a zone based on its center
 * coordinate, then concatenate texts within each zone in reading order.
 */

import { LICENSE_ZONES, type LicenseZone } from "./zone-defs";

export interface OcrBox {
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface LicenseData {
  licenseNumber: string | null;
  name: string | null;
  birthDate: string | null;
  address: string | null;
  expiryDate: string | null;
  issueDate: string | null;
  conditions: string | null;
}

/** Labels to strip from extracted text */
const LABEL_PATTERNS = [
  /^氏\s*名\s*/,
  /^住\s*所\s*/,
  /^主\s*所\s*/, // OCR misread of 住所
  /^生年月日\s*/,
  /^交\s*付\s*/,
  /^有効期限\s*/,
  /^条\s*件\s*等?\s*/,
  /免許の条件等/,
  /^番\s*号\s*/,
];

/**
 * Classify OCR boxes into license field zones and extract structured data.
 *
 * @param boxes  OCR results with text and bounding box
 * @param imgW   Image width (for normalization)
 * @param imgH   Image height (for normalization)
 */
export function matchFieldsToZones(
  boxes: OcrBox[],
  imgW: number,
  imgH: number,
): LicenseData {
  // Pre-merge vertically adjacent short lines (e.g. "免許の" + "条件等")
  const merged = mergeAdjacentLines(boxes, imgW, imgH);

  // Group boxes by zone
  const zoneTexts = new Map<string, { text: string; cx: number; cy: number }[]>();

  for (const box of merged) {
    if (!box.text.trim()) continue;

    // Normalized center coordinates
    const cx = (box.x + box.w / 2) / imgW;
    const cy = (box.y + box.h / 2) / imgH;

    // Find the best matching zone
    const zone = findZone(cx, cy);
    if (!zone) continue;

    const field = zone.field;
    if (!zoneTexts.has(field)) zoneTexts.set(field, []);
    zoneTexts.get(field)!.push({ text: box.text.trim(), cx, cy });
  }

  // Build result by concatenating texts within each zone
  const result: LicenseData = {
    licenseNumber: null,
    name: null,
    birthDate: null,
    address: null,
    expiryDate: null,
    issueDate: null,
    conditions: null,
  };

  for (const [field, entries] of zoneTexts) {
    // Sort by Y then X (reading order)
    entries.sort((a, b) => {
      const dy = a.cy - b.cy;
      if (Math.abs(dy) > 0.02) return dy;
      return a.cx - b.cx;
    });

    let text = entries.map((e) => e.text).join(" ");

    // Strip known labels
    for (const pattern of LABEL_PATTERNS) {
      text = text.replace(pattern, "");
    }
    text = text.trim();
    if (!text) continue;

    // Post-processing per field
    switch (field) {
      case "licenseNumber":
        result.licenseNumber = extractDigits(text, 12);
        break;
      case "name":
        result.name = cleanName(text);
        break;
      case "birthDate":
        result.birthDate = cleanDate(text);
        break;
      case "address":
        result.address = text;
        break;
      case "expiryDate":
        result.expiryDate = cleanDate(text);
        break;
      case "issueDate":
        result.issueDate = cleanDate(text);
        break;
      case "conditions":
        result.conditions = text;
        break;
    }
  }

  return result;
}

/**
 * Merge vertically stacked short lines that share a similar X position.
 * Handles cases like "免許の" + "条件等" → "免許の条件等".
 */
function mergeAdjacentLines(boxes: OcrBox[], imgW: number, imgH: number): OcrBox[] {
  if (boxes.length === 0) return boxes;

  const result: OcrBox[] = [];
  const used = new Set<number>();

  for (let i = 0; i < boxes.length; i++) {
    if (used.has(i)) continue;

    const cur = boxes[i];

    // Only try to merge short narrow lines
    if (cur.w / imgW > 0.15 || cur.text.trim().length > 5) {
      result.push(cur);
      continue;
    }

    // Search ALL other boxes for a vertical neighbor with similar X
    let bestJ = -1;
    let bestGap = Infinity;
    for (let j = 0; j < boxes.length; j++) {
      if (j === i || used.has(j)) continue;
      const next = boxes[j];

      // Next must also be short
      if (next.w / imgW > 0.15 || next.text.trim().length > 5) continue;

      // Must be below cur
      const gap = next.y - (cur.y + cur.h);
      if (gap < -cur.h * 0.5 || gap > cur.h * 3) continue;

      // X positions must be close (left edges within 1 line-height)
      if (Math.abs(cur.x - next.x) > cur.h * 1.5) continue;

      if (gap < bestGap) {
        bestGap = gap;
        bestJ = j;
      }
    }

    if (bestJ >= 0) {
      const next = boxes[bestJ];
      const mx = Math.min(cur.x, next.x);
      const my = Math.min(cur.y, next.y);
      const mx2 = Math.max(cur.x + cur.w, next.x + next.w);
      const my2 = Math.max(cur.y + cur.h, next.y + next.h);

      result.push({
        text: cur.text.trim() + next.text.trim(),
        x: mx,
        y: my,
        w: mx2 - mx,
        h: my2 - my,
      });
      used.add(bestJ);
    } else {
      result.push(cur);
    }
  }

  return result;
}

/** Find the best matching zone for a normalized (cx, cy) position. */
function findZone(cx: number, cy: number): LicenseZone | null {
  // First pass: exact containment
  for (const zone of LICENSE_ZONES) {
    if (cx >= zone.x0 && cx <= zone.x1 && cy >= zone.y0 && cy <= zone.y1) {
      return zone;
    }
  }

  // Second pass: nearest zone within a small margin
  let bestZone: LicenseZone | null = null;
  let bestDist = 0.04; // max margin
  for (const zone of LICENSE_ZONES) {
    const dx = Math.max(0, zone.x0 - cx, cx - zone.x1);
    const dy = Math.max(0, zone.y0 - cy, cy - zone.y1);
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < bestDist) {
      bestDist = dist;
      bestZone = zone;
    }
  }
  return bestZone;
}

/** Normalize full-width digits to half-width and extract N consecutive digits. */
function extractDigits(text: string, length: number): string | null {
  const normalized = text.replace(/[０-９]/g, (c) =>
    String.fromCharCode(c.charCodeAt(0) - 0xfee0),
  );
  const match = normalized.match(new RegExp(`\\d{${length}}`));
  return match ? match[0] : normalized.replace(/\D/g, "").slice(0, length) || null;
}

/** Clean up a name field (strip trailing date fragments, etc.) */
function cleanName(text: string): string | null {
  // Remove any date patterns that got merged
  let cleaned = text
    .replace(/[\s]*(?:昭和|平成|令和|昭|平|令).*$/, "")
    .replace(/\d{4}年.*$/, "")
    .trim();
  return cleaned.length >= 1 ? cleaned : null;
}

/** Clean up a date field — keep the Japanese era date pattern */
function cleanDate(text: string): string | null {
  // Normalize full-width digits
  const normalized = text.replace(/[０-９]/g, (c) =>
    String.fromCharCode(c.charCodeAt(0) - 0xfee0),
  );

  // Japanese era date pattern
  const jpMatch = normalized.match(
    /(?:昭和|平成|令和|昭|平|令)\s*(\d{1,2})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/,
  );
  if (jpMatch) return jpMatch[0].replace(/\s/g, "");

  // Western date pattern
  const westMatch = normalized.match(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
  if (westMatch) return `${westMatch[1]}年${westMatch[2]}月${westMatch[3]}日`;

  return text.trim() || null;
}
