import mammoth from "mammoth/mammoth.browser";

export interface ImportedDocx {
  html: string;
  warnings: string[];
}

const MAX_EDITABLE_DOCX_BYTES = 50 * 1024 * 1024;

export async function importDocx(data: Uint8Array): Promise<ImportedDocx> {
  if (data.byteLength > MAX_EDITABLE_DOCX_BYTES) {
    throw new Error("DOCX 超过 50 MB，请使用版式预览或系统 Word 打开");
  }
  const arrayBuffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
  const result = await mammoth.convertToHtml(
    { arrayBuffer },
    {
      convertImage: mammoth.images.imgElement(async (image) => ({
        src: `data:${image.contentType};base64,${await image.read("base64")}`,
      })),
      styleMap: [
        "p[style-name='Title'] => h1:fresh",
        "p[style-name='Subtitle'] => p.docx-subtitle:fresh",
      ],
    },
  );

  return {
    html: result.value || "<p></p>",
    warnings: result.messages.map((message) => message.message),
  };
}
