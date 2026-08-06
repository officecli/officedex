import type { JSONContent } from "@tiptap/core";
import {
  AlignmentType,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  ImageRun,
  LevelFormat,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  type ParagraphChild,
} from "docx";

const NUMBERING_REFERENCE = "officedex-numbering";

function textAlignment(value: unknown) {
  switch (value) {
    case "center": return AlignmentType.CENTER;
    case "right": return AlignmentType.RIGHT;
    case "justify": return AlignmentType.JUSTIFIED;
    default: return undefined;
  }
}

function headingLevel(level: unknown) {
  const levels = [
    HeadingLevel.HEADING_1,
    HeadingLevel.HEADING_2,
    HeadingLevel.HEADING_3,
    HeadingLevel.HEADING_4,
    HeadingLevel.HEADING_5,
    HeadingLevel.HEADING_6,
  ];
  const index = Math.max(0, Math.min(5, Number(level || 1) - 1));
  return levels[index];
}

function halfPoints(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined;
  const match = value.trim().match(/^([\d.]+)(px|pt)?$/i);
  if (!match) return undefined;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) return undefined;
  const points = match[2]?.toLowerCase() === "px" ? amount * 0.75 : amount;
  return Math.round(points * 2);
}

function normaliseColor(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const hex = value.trim().replace(/^#/, "");
  return /^[0-9a-f]{6}$/i.test(hex) ? hex.toUpperCase() : undefined;
}

function linkHref(node: JSONContent): string | undefined {
  const link = node.marks?.find((mark) => mark.type === "link");
  return typeof link?.attrs?.href === "string" ? link.attrs.href : undefined;
}

function textRun(node: JSONContent): ParagraphChild {
  const marks = node.marks ?? [];
  const textStyle = marks.find((mark) => mark.type === "textStyle")?.attrs ?? {};
  const run = new TextRun({
    text: node.text ?? "",
    bold: marks.some((mark) => mark.type === "bold"),
    italics: marks.some((mark) => mark.type === "italic"),
    underline: marks.some((mark) => mark.type === "underline") ? {} : undefined,
    strike: marks.some((mark) => mark.type === "strike"),
    font: typeof textStyle.fontFamily === "string" ? textStyle.fontFamily : undefined,
    size: halfPoints(textStyle.fontSize),
    color: normaliseColor(textStyle.color),
  });
  const href = linkHref(node);
  return href ? new ExternalHyperlink({ link: href, children: [run] }) : run;
}

function dataUrlImage(node: JSONContent): ImageRun | null {
  const src = typeof node.attrs?.src === "string" ? node.attrs.src : "";
  const match = src.match(/^data:image\/(png|jpeg|jpg|gif|bmp);base64,(.+)$/i);
  if (!match) return null;
  const rawType = match[1].toLowerCase();
  const type = rawType === "jpeg" ? "jpg" : rawType as "png" | "jpg" | "gif" | "bmp";
  const bytes = Uint8Array.from(atob(match[2]), (character) => character.charCodeAt(0));
  const width = Math.max(32, Math.min(560, Number(node.attrs?.width) || 480));
  const height = Math.max(24, Math.min(720, Number(node.attrs?.height) || Math.round(width * 0.66)));
  return new ImageRun({
    type,
    data: bytes,
    transformation: { width, height },
    altText: {
      name: typeof node.attrs?.alt === "string" ? node.attrs.alt : "Document image",
      description: typeof node.attrs?.title === "string" ? node.attrs.title : "",
      title: typeof node.attrs?.title === "string" ? node.attrs.title : "",
    },
  });
}

function inlineChildren(nodes: JSONContent[] = []): ParagraphChild[] {
  const children: ParagraphChild[] = [];
  for (const node of nodes) {
    if (node.type === "text") children.push(textRun(node));
    else if (node.type === "hardBreak") children.push(new TextRun({ break: 1 }));
    else if (node.type === "image") {
      const image = dataUrlImage(node);
      if (image) children.push(image);
    } else if (node.content) {
      children.push(...inlineChildren(node.content));
    }
  }
  return children.length > 0 ? children : [new TextRun("")];
}

function paragraphFromNode(node: JSONContent, options: { bulletLevel?: number; orderedLevel?: number } = {}) {
  return new Paragraph({
    children: inlineChildren(node.content),
    alignment: textAlignment(node.attrs?.textAlign),
    heading: node.type === "heading" ? headingLevel(node.attrs?.level) : undefined,
    bullet: options.bulletLevel === undefined ? undefined : { level: options.bulletLevel },
    numbering: options.orderedLevel === undefined ? undefined : {
      reference: NUMBERING_REFERENCE,
      level: options.orderedLevel,
    },
    spacing: { after: node.type === "heading" ? 120 : 80, line: 276 },
  });
}

function listChildren(node: JSONContent, ordered: boolean, level = 0): Array<Paragraph | Table> {
  const result: Array<Paragraph | Table> = [];
  for (const item of node.content ?? []) {
    for (const child of item.content ?? []) {
      if (child.type === "paragraph") {
        result.push(paragraphFromNode(child, ordered ? { orderedLevel: level } : { bulletLevel: level }));
      } else if (child.type === "bulletList" || child.type === "orderedList") {
        result.push(...listChildren(child, child.type === "orderedList", Math.min(level + 1, 8)));
      } else {
        result.push(...blockChildren(child));
      }
    }
  }
  return result;
}

function tableFromNode(node: JSONContent): Table {
  const rows = (node.content ?? []).map((row) => new TableRow({
    children: (row.content ?? []).map((cell) => new TableCell({
      children: (cell.content ?? []).flatMap((content) => {
        const blocks = blockChildren(content);
        return blocks.length > 0 ? blocks : [new Paragraph("")];
      }),
      columnSpan: Number(cell.attrs?.colspan) || undefined,
      rowSpan: Number(cell.attrs?.rowspan) || undefined,
    })),
    tableHeader: row.content?.some((cell) => cell.type === "tableHeader") || undefined,
  }));
  return new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE } });
}

function blockChildren(node: JSONContent): Array<Paragraph | Table> {
  switch (node.type) {
    case "paragraph":
    case "heading":
      return [paragraphFromNode(node)];
    case "bulletList":
      return listChildren(node, false);
    case "orderedList":
      return listChildren(node, true);
    case "blockquote":
      return (node.content ?? []).map((child) => new Paragraph({
        children: inlineChildren(child.content),
        indent: { left: 480 },
        border: { left: { color: "AAB4C3", size: 12, space: 12, style: "single" } },
      }));
    case "table":
      return [tableFromNode(node)];
    case "image": {
      const image = dataUrlImage(node);
      return image ? [new Paragraph({ children: [image] })] : [];
    }
    case "horizontalRule":
      return [new Paragraph({ thematicBreak: true })];
    default:
      return (node.content ?? []).flatMap(blockChildren);
  }
}

export async function exportDocx(content: JSONContent, title: string): Promise<Uint8Array> {
  const children = (content.content ?? []).flatMap(blockChildren);
  const document = new Document({
    title,
    creator: "OfficeDex",
    numbering: {
      config: [{
        reference: NUMBERING_REFERENCE,
        levels: Array.from({ length: 9 }, (_, level) => ({
          level,
          format: LevelFormat.DECIMAL,
          text: `%${level + 1}.`,
          alignment: AlignmentType.START,
          style: { paragraph: { indent: { left: 720 + level * 360, hanging: 360 } } },
        })),
      }],
    },
    sections: [{
      properties: {
        page: {
          margin: { top: 1134, right: 1134, bottom: 1134, left: 1134 },
        },
      },
      children: children.length > 0 ? children : [new Paragraph("")],
    }],
  });
  return new Uint8Array(await Packer.toArrayBuffer(document));
}
