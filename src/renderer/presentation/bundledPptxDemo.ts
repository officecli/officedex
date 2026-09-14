import type { VibeOp } from "../../shared/types";
import { uint8ArrayToBase64 } from "../bridge/codec";
import opsUrl from "./demos/nexaedge/ops.json?url";
import imageUrl from "./demos/nexaedge/1293cd0a730dd66e96e13e2d26eed4938226f3b9e5088f7c57b177289dade608.png?url";

export const NEXAEDGE_DEMO_ID = "builtin-nexaedge";
const imageDigest = "1293cd0a730dd66e96e13e2d26eed4938226f3b9e5088f7c57b177289dade608";

async function fetchAsset(url: string): Promise<Response> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Unable to load bundled NexaEdge demo (${response.status})`);
  return response;
}

export async function loadNexaEdgeOps(): Promise<VibeOp[]> {
  return (await fetchAsset(opsUrl)).json();
}

export async function readNexaEdgeImage(digest: string): Promise<string> {
  if (digest !== imageDigest) throw new Error(`Unknown NexaEdge image: ${digest}`);
  const response = await fetchAsset(imageUrl);
  return uint8ArrayToBase64(new Uint8Array(await response.arrayBuffer()));
}
