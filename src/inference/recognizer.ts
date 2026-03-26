/**
 * PARSeq text recognizer (autoregressive).
 *
 * Preprocessing: rotate if vertical, resize to 16×768,
 *   BGR flip, normalize to [-1, 1], HWC→CHW.
 * Inference: ONNX Runtime Web.
 * Postprocessing: argmax → stop at token 0 → map to charset.
 */

import * as ort from "onnxruntime-web";
import { resizeForParseq } from "./image-ops";
import { normalizeBgr, hwcToChw, argmaxAxis2 } from "./tensor-ops";
import { CHARSET_TRAIN } from "../settings/vocab";
import { type ModelConfig } from "../settings/presets";

export class PARSeqRecognizer {
  private session: ort.InferenceSession | null = null;
  private inputH = 0;
  private inputW = 0;

  async init(modelBuffer: ArrayBuffer, config: ModelConfig): Promise<void> {
    this.session = await ort.InferenceSession.create(modelBuffer, {
      executionProviders: ["wasm"],
      graphOptimizationLevel: "all",
    });
    this.inputH = config.inputShape[2];
    this.inputW = config.inputShape[3];
  }

  /**
   * Recognize text from a cropped text-line image.
   * Returns the recognized string.
   */
  async read(lineImage: ImageData): Promise<string> {
    if (!this.session) throw new Error("PARSeq session not initialized");

    // Rotate if vertical, resize
    const resized = resizeForParseq(lineImage, this.inputW, this.inputH, true);

    // BGR flip + normalize to [-1, 1]
    const normalized = normalizeBgr(resized.data, this.inputH, this.inputW);

    // HWC → CHW
    const chw = hwcToChw(normalized, this.inputH, this.inputW, 3);

    // Create tensor
    const inputTensor = new ort.Tensor("float32", chw, [1, 3, this.inputH, this.inputW]);

    const inputName = this.session.inputNames[0];
    const results = await this.session.run({ [inputName]: inputTensor });
    const outputName = this.session.outputNames[0];
    const output = results[outputName];

    // output shape: [1, seqLen, vocabSize]
    const seqLen = output.dims[1] as number;
    const vocabSize = output.dims[2] as number;
    const data = output.data as Float32Array;

    // argmax along axis=2
    const indices = argmaxAxis2(data, seqLen, vocabSize);

    // Decode: stop at first 0 token, map index i → charset[i-1]
    let result = "";
    for (let s = 0; s < seqLen; s++) {
      const idx = indices[s];
      if (idx === 0) break; // stop token
      if (idx - 1 >= 0 && idx - 1 < CHARSET_TRAIN.length) {
        result += CHARSET_TRAIN[idx - 1];
      }
    }

    return result;
  }

  dispose(): void {
    this.session?.release();
    this.session = null;
  }
}
