import type { WorkerResponse } from "./worker/ocr.worker";
import { matchFieldsToZones, type LicenseData } from "./parser/template-matcher";
import { computeHomography, applyPerspective } from "./engine/perspective";
import type { Point } from "./engine/perspective";

// DOM elements
const dropZone = document.getElementById("drop-zone")!;
const fileInput = document.getElementById("file-input") as HTMLInputElement;
const progressSection = document.getElementById("progress-section")!;
const progressLabel = document.getElementById("progress-label")!;
const progressBar = document.getElementById("progress-bar")!;
const resultSection = document.getElementById("result-section")!;
const resultCanvas = document.getElementById("result-canvas") as HTMLCanvasElement;
const fieldsOutput = document.getElementById("fields-output")!;
const textOutput = document.getElementById("text-output")!;
const copyBtn = document.getElementById("copy-btn")!;
const resetBtn = document.getElementById("reset-btn")!;

// Edit mode DOM elements
const editSection = document.getElementById("edit-section")!;
const srcCanvas = document.getElementById("src-canvas") as HTMLCanvasElement;
const previewCanvas = document.getElementById("preview-canvas") as HTMLCanvasElement;
const btnCorrectOcr = document.getElementById("btn-correct-ocr")!;

let worker: Worker | null = null;

function createWorker(): Worker {
  return new Worker(new URL("./worker/ocr.worker.ts", import.meta.url), {
    type: "module",
  });
}

function showProgress(label: string, pct: number): void {
  progressSection.style.display = "block";
  progressLabel.textContent = label;
  progressBar.style.width = `${Math.round(pct * 100)}%`;
}

function hideProgress(): void {
  progressSection.style.display = "none";
}

function drawDetections(
  img: HTMLImageElement,
  lines: { x: number; y: number; w: number; h: number; text: string }[],
): void {
  resultCanvas.width = img.naturalWidth;
  resultCanvas.height = img.naturalHeight;
  const ctx = resultCanvas.getContext("2d")!;
  ctx.drawImage(img, 0, 0);

  const lw = Math.max(2, Math.round(img.naturalWidth / 500));
  ctx.strokeStyle = "#2563eb";
  ctx.lineWidth = lw;
  ctx.font = `${Math.max(12, Math.round(img.naturalWidth / 60))}px "Noto Sans JP", sans-serif`;
  ctx.fillStyle = "#2563eb";

  for (const line of lines) {
    ctx.strokeRect(line.x, line.y, line.w, line.h);
    if (line.text) {
      ctx.fillText(line.text, line.x, line.y - 4);
    }
  }
}

// ---- License fields rendering ----

const FIELD_LABELS: { key: keyof LicenseData; label: string }[] = [
  { key: "name", label: "氏名" },
  { key: "birthDate", label: "生年月日" },
  { key: "address", label: "住所" },
  { key: "licenseNumber", label: "免許証番号" },
  { key: "expiryDate", label: "有効期限" },
  { key: "issueDate", label: "交付日" },
];

function renderLicenseFields(data: LicenseData): void {
  fieldsOutput.replaceChildren();

  for (const { key, label } of FIELD_LABELS) {
    const row = document.createElement("div");
    row.className = "field-row";

    const labelEl = document.createElement("span");
    labelEl.className = "field-label";
    labelEl.textContent = label;

    const valueEl = document.createElement("span");
    const value = data[key];
    if (value) {
      valueEl.className = "field-value";
      valueEl.textContent = value;
    } else {
      valueEl.className = "field-value empty";
      valueEl.textContent = "---";
    }

    row.appendChild(labelEl);
    row.appendChild(valueEl);
    fieldsOutput.appendChild(row);
  }
}

// ---- Edit mode (perspective correction) ----

let editImg: HTMLImageElement | null = null;
let editImgUrl: string | null = null;
let corners: Point[] = [];
let draggingIndex = -1;
let isDragging = false;
let displayScale = 1;

const HANDLE_RADIUS = 8;
const GRAB_RADIUS = 20;

function enterEditMode(img: HTMLImageElement, imgUrl: string): void {
  editImg = img;
  editImgUrl = imgUrl;

  const w = img.naturalWidth;
  const h = img.naturalHeight;

  const m = 0.01;
  corners = [
    { x: w * m, y: h * m },
    { x: w * (1 - m), y: h * m },
    { x: w * (1 - m), y: h * (1 - m) },
    { x: w * m, y: h * (1 - m) },
  ];

  srcCanvas.width = w;
  srcCanvas.height = h;

  dropZone.style.display = "none";
  editSection.classList.add("visible");
  resultSection.classList.remove("visible");

  updateDisplayScale();
  drawSrcCanvas();
  updatePreview();
}

function updateDisplayScale(): void {
  const cssWidth = srcCanvas.getBoundingClientRect().width;
  displayScale = cssWidth / srcCanvas.width;
}

function drawSrcCanvas(): void {
  if (!editImg) return;
  const ctx = srcCanvas.getContext("2d")!;
  const w = srcCanvas.width;
  const h = srcCanvas.height;

  ctx.drawImage(editImg, 0, 0);

  ctx.save();
  ctx.fillStyle = "rgba(0, 0, 0, 0.4)";
  ctx.beginPath();
  ctx.rect(0, 0, w, h);
  ctx.moveTo(corners[0].x, corners[0].y);
  ctx.lineTo(corners[3].x, corners[3].y);
  ctx.lineTo(corners[2].x, corners[2].y);
  ctx.lineTo(corners[1].x, corners[1].y);
  ctx.closePath();
  ctx.fill("evenodd");
  ctx.restore();

  ctx.strokeStyle = "#2563eb";
  ctx.lineWidth = Math.max(2, Math.round(w / 400));
  ctx.beginPath();
  ctx.moveTo(corners[0].x, corners[0].y);
  for (let i = 1; i < 4; i++) {
    ctx.lineTo(corners[i].x, corners[i].y);
  }
  ctx.closePath();
  ctx.stroke();

  for (const pt of corners) {
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, HANDLE_RADIUS / displayScale, 0, Math.PI * 2);
    ctx.fillStyle = "#2563eb";
    ctx.fill();
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 2 / displayScale;
    ctx.stroke();
  }
}

function updatePreview(lowRes = false): void {
  if (!editImg) return;

  const dstW = Math.round(
    Math.max(dist(corners[0], corners[1]), dist(corners[3], corners[2])),
  );
  const dstH = Math.round(
    Math.max(dist(corners[0], corners[3]), dist(corners[1], corners[2])),
  );
  if (dstW <= 0 || dstH <= 0) return;

  const dst: Point[] = [
    { x: 0, y: 0 },
    { x: dstW, y: 0 },
    { x: dstW, y: dstH },
    { x: 0, y: dstH },
  ];

  const scale = lowRes ? 0.25 : 1;
  const sw = Math.round(editImg.naturalWidth * scale);
  const sh = Math.round(editImg.naturalHeight * scale);
  const ow = Math.round(dstW * scale);
  const oh = Math.round(dstH * scale);
  if (sw <= 0 || sh <= 0 || ow <= 0 || oh <= 0) return;

  const tmpCanvas = document.createElement("canvas");
  tmpCanvas.width = sw;
  tmpCanvas.height = sh;
  const tmpCtx = tmpCanvas.getContext("2d")!;
  tmpCtx.drawImage(editImg, 0, 0, sw, sh);
  const srcData = tmpCtx.getImageData(0, 0, sw, sh);

  const scaledCorners = corners.map((p) => ({ x: p.x * scale, y: p.y * scale }));
  const scaledDst = dst.map((p) => ({ x: p.x * scale, y: p.y * scale }));

  const matrix = computeHomography(scaledCorners, scaledDst);
  const result = applyPerspective(srcData, matrix, ow, oh);

  previewCanvas.width = ow;
  previewCanvas.height = oh;
  const pCtx = previewCanvas.getContext("2d")!;
  pCtx.putImageData(result, 0, 0);
}

function dist(a: Point, b: Point): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

function canvasToImage(e: MouseEvent | Touch): Point {
  const rect = srcCanvas.getBoundingClientRect();
  return {
    x: (e.clientX - rect.left) / displayScale,
    y: (e.clientY - rect.top) / displayScale,
  };
}

function findNearestCorner(pt: Point): number {
  const threshold = GRAB_RADIUS / displayScale;
  let minDist = Infinity;
  let minIdx = -1;
  for (let i = 0; i < corners.length; i++) {
    const d = dist(pt, corners[i]);
    if (d < minDist) {
      minDist = d;
      minIdx = i;
    }
  }
  return minDist <= threshold ? minIdx : -1;
}

// Mouse events
srcCanvas.addEventListener("mousedown", (e) => {
  updateDisplayScale();
  const pt = canvasToImage(e);
  draggingIndex = findNearestCorner(pt);
  if (draggingIndex >= 0) isDragging = true;
});

srcCanvas.addEventListener("mousemove", (e) => {
  if (!isDragging || draggingIndex < 0) return;
  const pt = canvasToImage(e);
  corners[draggingIndex] = {
    x: Math.max(0, Math.min(pt.x, srcCanvas.width)),
    y: Math.max(0, Math.min(pt.y, srcCanvas.height)),
  };
  drawSrcCanvas();
  updatePreview(true);
});

window.addEventListener("mouseup", () => {
  if (isDragging) {
    isDragging = false;
    draggingIndex = -1;
    updatePreview(false);
  }
});

// Touch events
srcCanvas.addEventListener("touchstart", (e) => {
  e.preventDefault();
  updateDisplayScale();
  const touch = e.touches[0];
  const pt = canvasToImage(touch);
  draggingIndex = findNearestCorner(pt);
  if (draggingIndex >= 0) isDragging = true;
}, { passive: false });

srcCanvas.addEventListener("touchmove", (e) => {
  e.preventDefault();
  if (!isDragging || draggingIndex < 0) return;
  const touch = e.touches[0];
  const pt = canvasToImage(touch);
  corners[draggingIndex] = {
    x: Math.max(0, Math.min(pt.x, srcCanvas.width)),
    y: Math.max(0, Math.min(pt.y, srcCanvas.height)),
  };
  drawSrcCanvas();
  updatePreview(true);
}, { passive: false });

window.addEventListener("touchend", () => {
  if (isDragging) {
    isDragging = false;
    draggingIndex = -1;
    updatePreview(false);
  }
});

// ---- Convert corrected image to Blob ----

function correctedImageToBlob(): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const tmpCanvas = document.createElement("canvas");
    tmpCanvas.width = editImg!.naturalWidth;
    tmpCanvas.height = editImg!.naturalHeight;
    const tmpCtx = tmpCanvas.getContext("2d")!;
    tmpCtx.drawImage(editImg!, 0, 0);
    const srcData = tmpCtx.getImageData(0, 0, tmpCanvas.width, tmpCanvas.height);

    const dstW = Math.round(
      Math.max(dist(corners[0], corners[1]), dist(corners[3], corners[2])),
    );
    const dstH = Math.round(
      Math.max(dist(corners[0], corners[3]), dist(corners[1], corners[2])),
    );

    const dstPts: Point[] = [
      { x: 0, y: 0 },
      { x: dstW, y: 0 },
      { x: dstW, y: dstH },
      { x: 0, y: dstH },
    ];

    const matrix = computeHomography(corners, dstPts);
    const result = applyPerspective(srcData, matrix, dstW, dstH);

    const outCanvas = document.createElement("canvas");
    outCanvas.width = dstW;
    outCanvas.height = dstH;
    const outCtx = outCanvas.getContext("2d")!;
    outCtx.putImageData(result, 0, 0);

    outCanvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Failed to create blob"));
    }, "image/png");
  });
}

// ---- Main processing ----

function runOcr(imageBlob: Blob, img: HTMLImageElement, imgUrl: string): void {
  if (!worker) {
    worker = createWorker();
  }

  editSection.classList.remove("visible");
  resultSection.classList.remove("visible");
  fieldsOutput.replaceChildren();
  textOutput.textContent = "";
  showProgress("モデルを初期化中...", 0);

  worker.onerror = (e) => {
    console.error("[Worker error]", e);
    hideProgress();
    alert(`Worker エラー: ${e.message}`);
    resetToUpload();
  };

  worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
    const msg = e.data;
    switch (msg.type) {
      case "init-progress": {
        const pct = msg.total > 0 ? Math.min(msg.loaded / msg.total, 1) : 0;
        showProgress(`${msg.model} ダウンロード中... ${Math.round(pct * 100)}%`, pct);
        break;
      }
      case "init-done":
        showProgress("検出中...", 0);
        break;
      case "detect-done":
        showProgress(`${msg.numDetections} 領域を検出。認識中...`, 0);
        break;
      case "recognize-progress": {
        const pct = msg.current / msg.total;
        showProgress(`認識中... ${msg.current}/${msg.total} 行`, pct);
        break;
      }
      case "result": {
        hideProgress();
        drawDetections(img, msg.lines);

        console.log("[OCR lines]", msg.lines.map((l, i) =>
          `${i}: "${l.text}" (x=${l.x}, y=${l.y}, w=${l.w}, h=${l.h}, relY=${(l.y / msg.imgH).toFixed(2)})`
        ).join("\n"));
        const fields = matchFieldsToZones(msg.lines, msg.imgW, msg.imgH);
        console.log("[Extracted fields]", fields);
        renderLicenseFields(fields);

        const text = msg.lines.map((l) => l.text).join("\n");
        textOutput.textContent = text;

        resultSection.classList.add("visible");
        URL.revokeObjectURL(imgUrl);
        break;
      }
      case "error":
        hideProgress();
        alert(`エラー: ${msg.message}`);
        URL.revokeObjectURL(imgUrl);
        break;
    }
  };

  const raw = import.meta.env.BASE_URL;
  const baseUrl = raw.endsWith("/") ? raw : raw + "/";
  worker.postMessage({ type: "run", imageBlob, presetId: "standard", baseUrl });
}

function resetToUpload(): void {
  editSection.classList.remove("visible");
  resultSection.classList.remove("visible");
  progressSection.style.display = "none";
  dropZone.style.display = "";
  fileInput.value = "";
  editImg = null;
  if (editImgUrl) {
    URL.revokeObjectURL(editImgUrl);
    editImgUrl = null;
  }
}

async function processFile(file: File): Promise<void> {
  const imgUrl = URL.createObjectURL(file);
  const img = new Image();
  img.src = imgUrl;
  await img.decode();

  enterEditMode(img, imgUrl);
}

// Button handlers
btnCorrectOcr.addEventListener("click", async () => {
  if (!editImg || !editImgUrl) return;
  btnCorrectOcr.setAttribute("disabled", "true");

  try {
    const correctedBlob = await correctedImageToBlob();
    const correctedUrl = URL.createObjectURL(correctedBlob);
    const correctedImg = new Image();
    correctedImg.src = correctedUrl;
    await correctedImg.decode();

    if (editImgUrl) URL.revokeObjectURL(editImgUrl);
    runOcr(correctedBlob, correctedImg, correctedUrl);
  } catch (err) {
    alert(`補正エラー: ${err}`);
  } finally {
    btnCorrectOcr.removeAttribute("disabled");
  }
});

resetBtn.addEventListener("click", resetToUpload);

// File upload handlers
dropZone.addEventListener("click", () => fileInput.click());

fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0];
  if (file) processFile(file);
});

dropZone.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropZone.classList.add("dragover");
});

dropZone.addEventListener("dragleave", () => {
  dropZone.classList.remove("dragover");
});

dropZone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropZone.classList.remove("dragover");
  const file = e.dataTransfer?.files[0];
  if (file && file.type.startsWith("image/")) {
    processFile(file);
  }
});

copyBtn.addEventListener("click", () => {
  const rows = fieldsOutput.querySelectorAll(".field-row");
  const lines: string[] = [];
  rows.forEach((row) => {
    const label = row.querySelector(".field-label")?.textContent ?? "";
    const valueEl = row.querySelector(".field-value");
    if (valueEl && !valueEl.classList.contains("empty")) {
      lines.push(`${label}: ${valueEl.textContent}`);
    }
  });
  const text = lines.join("\n");
  navigator.clipboard.writeText(text).then(() => {
    copyBtn.textContent = "コピー済";
    setTimeout(() => {
      copyBtn.textContent = "コピー";
    }, 2000);
  });
});
