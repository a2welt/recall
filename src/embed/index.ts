/**
 * On-device embedding engine via Transformers.js (ONNX).
 *
 * Model: all-MiniLM-L6-v2 (384-dim, Apache-2.0 license).
 *
 * Device defaults to 'cpu' via onnxruntime-node (prebuilt binaries for Win/Mac/Linux,
 * no compilation required). Set RECALL_DEVICE=dml to use Windows DirectML (GPU).
 *
 * First call downloads the model (~30 MB) to the Hugging Face cache.
 * All subsequent inference is fully offline.
 * Set RECALL_HF_CACHE to use a pre-populated cache directory.
 */

import type { FeatureExtractionPipeline } from "@huggingface/transformers";

const DEFAULT_MODEL = "Xenova/all-MiniLM-L6-v2";

export const EMBED_DIM = 384;

let _pipeline: FeatureExtractionPipeline | null = null;

async function getPipeline(): Promise<FeatureExtractionPipeline> {
  if (_pipeline) return _pipeline;

  const { pipeline, env } = await import("@huggingface/transformers");

  if (process.env.RECALL_HF_CACHE) {
    env.cacheDir = process.env.RECALL_HF_CACHE;
  }

  const modelName = process.env.RECALL_EMBED_MODEL ?? DEFAULT_MODEL;

  // 'cpu' uses onnxruntime-node (prebuilt binaries, no compilation needed).
  // Override with RECALL_DEVICE=dml to use DirectML (Windows GPU).
  const device = (process.env.RECALL_DEVICE ?? "cpu") as "cpu" | "dml";

  _pipeline = (await pipeline("feature-extraction", modelName, {
    dtype: "fp32",
    device,
  })) as FeatureExtractionPipeline;

  return _pipeline;
}

/**
 * Compute a 384-dim embedding for the given text.
 * Returns a plain number[] (mean-pooled, L2-normalised).
 */
export async function embed(text: string): Promise<number[]> {
  const pipe = await getPipeline();
  const input = text.slice(0, 4096);
  const output = await pipe(input, { pooling: "mean", normalize: true });
  return Array.from(output.data as Float32Array);
}

/**
 * Batch-embed multiple texts, with optional progress callback.
 */
export async function embedBatch(
  texts: string[],
  onProgress?: (done: number, total: number) => void
): Promise<number[][]> {
  const results: number[][] = [];
  for (let i = 0; i < texts.length; i++) {
    results.push(await embed(texts[i]));
    onProgress?.(i + 1, texts.length);
  }
  return results;
}

export function resetPipeline(): void {
  _pipeline = null;
}
