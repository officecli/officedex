import mammoth from "mammoth/mammoth.browser";

export interface ImportedDocx {
  html: string;
  warnings: string[];
}

const MAX_EDITABLE_DOCX_BYTES = 50 * 1024 * 1024;

function assertDocxPackage(data: Uint8Array) {
  const isZipPackage = data.byteLength >= 4
    && data[0] === 0x50
    && data[1] === 0x4b
    && data[2] === 0x03
    && data[3] === 0x04;
  if (!isZipPackage) {
    throw new Error("文件不是有效的 DOCX 文档，可能只是使用了 .docx 扩展名");
  }
}

export async function importDocx(data: Uint8Array): Promise<ImportedDocx> {
  if (data.byteLength > MAX_EDITABLE_DOCX_BYTES) {
    throw new Error("DOCX 超过 50 MB，请使用版式预览或系统 Word 打开");
  }
  assertDocxPackage(data);
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
