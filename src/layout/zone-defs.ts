/**
 * License zone definitions for Japanese driver's license.
 *
 * Coordinates are normalized (0-1) relative to the corrected card image.
 * Japanese licenses have a standardized layout per 国家公安委員会規則.
 *
 * Layout reference (front side):
 * ┌─────────────────────────────────────────┐
 * │ [氏名]          [生年月日]   [photo]    │
 * │ [住所]                       [photo]    │
 * │ [交付日]  [有効期限]         [photo]    │
 * │ [条件等]                                │
 * │ [免許種類]                              │
 * │ [免許証番号]                            │
 * └─────────────────────────────────────────┘
 */

export interface LicenseZone {
  /** Field identifier */
  field: string;
  /** Display label */
  label: string;
  /** Left boundary (0-1) */
  x0: number;
  /** Top boundary (0-1) */
  y0: number;
  /** Right boundary (0-1) */
  x1: number;
  /** Bottom boundary (0-1) */
  y1: number;
}

/**
 * Zone definitions calibrated from actual detection results.
 *
 * relY observed:
 *   0.06-0.07  氏名 / 生年月日
 *   0.21       住所
 *   0.29       交付日
 *   0.35       有効期限
 *   0.45-0.53  条件等
 *   0.69       免許証番号
 *   0.85       免許種類
 */
export const LICENSE_ZONES: LicenseZone[] = [
  { field: "name",         label: "氏名",       x0: 0.00, y0: 0.00, x1: 0.55, y1: 0.12 },
  { field: "birthDate",    label: "生年月日",   x0: 0.45, y0: 0.00, x1: 0.80, y1: 0.12 },
  { field: "address",      label: "住所",       x0: 0.00, y0: 0.12, x1: 0.70, y1: 0.26 },
  { field: "issueDate",    label: "交付",       x0: 0.00, y0: 0.26, x1: 0.70, y1: 0.33 },
  { field: "expiryDate",   label: "有効期限",   x0: 0.00, y0: 0.33, x1: 0.70, y1: 0.40 },
  { field: "conditions",   label: "条件等",     x0: 0.00, y0: 0.40, x1: 0.70, y1: 0.56 },
  { field: "licenseNumber",label: "免許証番号", x0: 0.00, y0: 0.60, x1: 0.70, y1: 0.78 },
];
