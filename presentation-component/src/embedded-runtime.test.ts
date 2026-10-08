import { describe, expect, it } from "vitest";
import {
  configureEmbeddedPresentationRuntime,
  embeddedPresentationDocumentPath,
} from "./embedded-runtime";

describe("OfficeDex embedded Presentation runtime", () => {
  it("keeps imported editor routes under the staged Presentation directory", () => {
    const runtimeEnvironment: Record<string, unknown> = {
      SLIDES_HOSTS: ["http://127.0.0.1:3100"],
    };

    const baseUrl = configureEmbeddedPresentationRuntime(
      runtimeEnvironment,
      "http://127.0.0.1:3100",
    );

    expect(baseUrl).toBe("http://127.0.0.1:3100/presentation");
    expect(runtimeEnvironment).toMatchObject({
      BASE_PATH: "/presentation",
      CDN_HOST: "http://127.0.0.1:3100/presentation/assets",
      STATIC_ASSETS_PREFIX: "http://127.0.0.1:3100/presentation",
      SLIDES_HOSTS: ["http://127.0.0.1:3100/presentation"],
    });
  });

  it("builds a safe deep-link path for the normal OfficeDex host bridge", () => {
    expect(embeddedPresentationDocumentPath("deck / 中文")).toBe(
      "/presentation/p/deck%20%2F%20%E4%B8%AD%E6%96%87",
    );
  });
});
