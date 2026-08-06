declare module "mammoth/mammoth.browser" {
  interface MammothImage {
    contentType: string;
    read(encoding: "base64"): Promise<string>;
  }

  interface MammothMessage {
    type: "warning" | "error";
    message: string;
  }

  interface MammothResult {
    value: string;
    messages: MammothMessage[];
  }

  const mammoth: {
    convertToHtml(
      input: { arrayBuffer: ArrayBuffer },
      options?: {
        styleMap?: string[];
        convertImage?: unknown;
      },
    ): Promise<MammothResult>;
    images: {
      imgElement(converter: (image: MammothImage) => Promise<{ src: string }>): unknown;
    };
  };

  export default mammoth;
}
