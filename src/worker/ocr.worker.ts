/**
 * Web Worker: OCR Pipeline
 *
 * Receives an image, runs detection → parse → reading order → recognition,
 * and posts results back to the main thread.
 */

import * as ort from "onnxruntime-web";

// Force single-threaded WASM to avoid SharedArrayBuffer issues on GitHub Pages
ort.env.wasm.numThreads = 1;

import { DEIMDetector, type Detection } from "../engine/deim";
import { PARSeqRecognizer } from "../engine/parseq-recognizer";
import { cropImageData, decodeImage } from "../engine/image-utils";
import {
  detectionsToPage,
  findAll,
  createElement,
} from "../parser/ndl-parser";
import { evalPage } from "../reading-order/eval";
import { fetchModel } from "../storage/model-cache";
import {
  MODEL_PRESETS,
  DEFAULT_PRESET_ID,
  type ModelPreset,
} from "../config/model-config";

// Message types
export type WorkerMessage =
  | { type: "run"; imageBlob: Blob; presetId: string; baseUrl: string }
  | { type: "init"; presetId: string; baseUrl: string };

export type WorkerResponse =
  | { type: "init-progress"; model: string; loaded: number; total: number }
  | { type: "init-done" }
  | { type: "detect-done"; numDetections: number }
  | { type: "recognize-progress"; current: number; total: number }
  | {
      type: "result";
      lines: { text: string; x: number; y: number; w: number; h: number; score: number }[];
      imgW: number;
      imgH: number;
    }
  | { type: "error"; message: string };

let detector: DEIMDetector | null = null;
let recognizer: PARSeqRecognizer | null = null;
let currentPresetId: string | null = null;

function post(msg: WorkerResponse): void {
  self.postMessage(msg);
}

function getPreset(presetId: string): ModelPreset {
  return MODEL_PRESETS.find((p) => p.id === presetId)
    ?? MODEL_PRESETS.find((p) => p.id === DEFAULT_PRESET_ID)!;
}

async function initModels(presetId: string, baseUrl: string): Promise<void> {
  const preset = getPreset(presetId);

  if (currentPresetId === preset.id && detector && recognizer) {
    post({ type: "init-done" });
    return;
  }

  detector?.dispose();
  recognizer?.dispose();
  detector = new DEIMDetector();
  recognizer = new PARSeqRecognizer();

  const deimBuffer = await fetchModel(
    baseUrl + preset.deim.url,
    preset.deim.name,
    (loaded, total) =>
      post({ type: "init-progress", model: "DEIM (検出)", loaded, total }),
  );
  await detector.init(deimBuffer, preset.deim);

  const parseqBuffer = await fetchModel(
    baseUrl + preset.parseq.url,
    preset.parseq.name,
    (loaded, total) =>
      post({ type: "init-progress", model: "PARSeq (認識)", loaded, total }),
  );
  await recognizer.init(parseqBuffer, preset.parseq);

  currentPresetId = preset.id;
  post({ type: "init-done" });
}

async function runOcr(imageBlob: Blob, presetId: string, baseUrl: string): Promise<void> {
  try {
    await initModels(presetId, baseUrl);

    const imageData = await decodeImage(imageBlob);
    const imgW = imageData.width;
    const imgH = imageData.height;

    // Detection
    const detections = await detector!.detect(imageData);
    post({ type: "detect-done", numDetections: detections.length });

    // Parse detections into element tree
    const page = detectionsToPage(imgW, imgH, "input.jpg", detections);
    const root = createElement("OCRDATASET", {}, [page]);

    // Reading order
    evalPage(root, true);

    // Collect LINE elements in reading order
    const lines = findAll(page, "LINE");
    const total = lines.length;

    const resultLines: {
      text: string;
      x: number;
      y: number;
      w: number;
      h: number;
      score: number;
    }[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const x = parseInt(line.attrs.X ?? "0");
      const y = parseInt(line.attrs.Y ?? "0");
      const w = parseInt(line.attrs.WIDTH ?? "0");
      const h = parseInt(line.attrs.HEIGHT ?? "0");
      const score = parseFloat(line.attrs.CONF ?? "0");

      if (w <= 0 || h <= 0) {
        resultLines.push({ text: "", x, y, w, h, score });
        continue;
      }

      const lineImg = cropImageData(imageData, x, y, w, h);
      const text = await recognizer!.read(lineImg);
      line.attrs.STRING = text;
      resultLines.push({ text, x, y, w, h, score });

      if ((i + 1) % 5 === 0 || i === total - 1) {
        post({ type: "recognize-progress", current: i + 1, total });
      }
    }

    post({ type: "result", lines: resultLines, imgW, imgH });
  } catch (e) {
    post({ type: "error", message: e instanceof Error ? e.message : String(e) });
  }
}

self.onmessage = async (e: MessageEvent<WorkerMessage>) => {
  const msg = e.data;
  if (msg.type === "init") {
    try {
      await initModels(msg.presetId, msg.baseUrl);
    } catch (err) {
      post({ type: "error", message: err instanceof Error ? err.message : String(err) });
    }
  } else if (msg.type === "run") {
    await runOcr(msg.imageBlob, msg.presetId, msg.baseUrl);
  }
};
