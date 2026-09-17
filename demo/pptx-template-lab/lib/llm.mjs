import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export async function loadLabLlmConfig() {
  const configPath = path.join(os.homedir(), "Library/Application Support/officecli/config.json");
  try {
    const cfg = JSON.parse(await fs.readFile(configPath, "utf8"));
    const llm = cfg.llm || {};
    const baseUrl = String(llm.base_url || "").replace(/\/$/u, "");
    const apiKey = String(llm.api_key || "").trim();
    const model = String(llm.model || "").trim();
    return {
      ready: Boolean(baseUrl && apiKey && model),
      baseUrl,
      model,
      timeoutSec: Number(llm.timeout_sec) || 180,
      configPath,
    };
  } catch {
    return { ready: false, baseUrl: "", model: "", timeoutSec: 180, configPath };
  }
}

export async function completeJson(prompt, schemaHint = "Return JSON only.") {
  const cfg = await loadLabLlmConfig();
  if (!cfg.ready) throw new Error("LLM is not configured in officecli config.json");
  const body = await postChat(cfg, [
    { role: "system", content: schemaHint + " Do not wrap in markdown." },
    { role: "user", content: prompt },
  ], { response_format: { type: "json_object" } });
  return JSON.parse(stripFence(body));
}

export async function completeText(prompt, system = "You write PowerPoint JS-SDK programs.") {
  const cfg = await loadLabLlmConfig();
  if (!cfg.ready) throw new Error("LLM is not configured in officecli config.json");
  return stripFence(await postChat(cfg, [
    { role: "system", content: system },
    { role: "user", content: prompt },
  ]));
}

async function postChat(cfg, messages, extra = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutSec * 1000);
  try {
    const response = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${await readApiKey()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model: cfg.model, messages, ...extra }),
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`LLM HTTP ${response.status}: ${text.slice(0, 400)}`);
    const data = JSON.parse(text);
    const content = data?.choices?.[0]?.message?.content;
    if (!content) throw new Error("LLM returned empty content");
    return content;
  } finally {
    clearTimeout(timer);
  }
}

async function readApiKey() {
  const configPath = path.join(os.homedir(), "Library/Application Support/officecli/config.json");
  const cfg = JSON.parse(await fs.readFile(configPath, "utf8"));
  return String(cfg.llm?.api_key || "").trim();
}

function stripFence(text) {
  const trimmed = String(text || "").trim();
  const match = trimmed.match(/^```(?:json|javascript|js)?\n([\s\S]*?)\n```$/u);
  return match ? match[1].trim() : trimmed;
}
