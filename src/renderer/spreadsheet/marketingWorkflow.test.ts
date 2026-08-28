import { describe, expect, it } from "vitest";
import {
  buildMarketingPrompt,
  findMarketingHeaderRow,
  parseMarketingSelection,
  recommendedRatio,
} from "./marketingWorkflow";

const ecommerceHeaders = [
  "SKU",
  "商品名称",
  "品类",
  "品牌",
  "核心卖点",
  "商品描述",
  "目标人群",
  "使用场景",
  "价格带",
  "竞品参考",
  "合规要求",
  "参考图 / 素材链接",
  "主图结果",
  "主图提示词",
  "比例",
  "场景图结果",
  "场景图提示词",
  "比例",
  "详情图结果",
  "详情图提示词",
  "比例",
  "活动海报结果",
  "海报提示词",
  "比例",
  "社媒图结果",
  "社媒提示词",
  "比例",
  "状态",
];

function ecommerceRow(): string[] {
  const row = Array.from({ length: ecommerceHeaders.length }, () => "");
  row[0] = "EC-EL-001";
  row[1] = "主动降噪头戴耳机";
  row[4] = "40dB 主动降噪，长续航";
  row[5] = "适合通勤和差旅";
  row[11] = "/tmp/headphones.png";
  row[13] = "白底棚拍，耳机主体居中";
  row[14] = "1:1";
  row[16] = "都市通勤场景，人物佩戴耳机";
  row[17] = "4:5";
  row[22] = "活动海报提示词不应优先使用";
  row[23] = "16:9";
  row[25] = "小红书风格社媒种草图";
  row[26] = "3:4";
  return row;
}

describe("parseMarketingSelection", () => {
  it("rejects sheets that do not already provide image and status columns", () => {
    expect(() =>
      parseMarketingSelection({
        sheetId: "sheet-1",
        sheetName: "商品",
        headers: ["商品名称", "核心卖点", "商品描述", "参考图"],
        rows: [["便携咖啡杯", "防漏；保温", "适合通勤", "/tmp/cup.png"]],
        firstRowIndex: 1,
        existingColumnCount: 4,
        headerRowIndex: 0,
        assetKind: "marketplace-main",
      }),
    ).toThrow("图片结果列");
  });

  it("recognizes existing image and status columns without reserving new columns", () => {
    const result = parseMarketingSelection({
      sheetId: "sheet-1",
      sheetName: "商品",
      headers: [
        "商品名称",
        "核心卖点",
        "商品描述",
        "参考图",
        "主图结果",
        "状态",
      ],
      rows: [
        ["便携咖啡杯", "防漏；保温", "适合通勤", "/tmp/cup.png", "", "待生成"],
      ],
      firstRowIndex: 1,
      existingColumnCount: 6,
      headerRowIndex: 0,
      assetKind: "marketplace-main",
    });

    expect(result.outputColumn).toBe(4);
    expect(result.statusColumn).toBe(5);
    expect(result.headerRowIndex).toBe(0);
    expect(result.outputTitle).toBe("OfficeDex主图");
    expect(result.rows).toEqual([
      expect.objectContaining({
        rowIndex: 1,
        productName: "便携咖啡杯",
        referenceImages: ["/tmp/cup.png"],
      }),
    ]);
    expect(result.rows[0].prompt).toContain("核心卖点：防漏；保温");
  });

  it("does not send reference-image instructions as file paths", () => {
    const result = parseMarketingSelection({
      sheetId: "sheet-1",
      sheetName: "电商营销素材",
      headers: [
        "商品名称",
        "参考图 / 素材链接",
        "主图结果",
        "主图提示词",
        "比例",
        "状态",
      ],
      rows: [
        [
          "主动降噪头戴耳机",
          "请插入：正面白底图、45° 图、侧面佩戴图、Logo 矢量文件",
          "",
          "白底棚拍，耳机主体居中",
          "3:4",
          "待生成",
        ],
      ],
      firstRowIndex: 4,
      existingColumnCount: 6,
      headerRowIndex: 3,
      assetKind: "marketplace-main",
    });

    expect(result.rows[0].referenceImages).toEqual([]);
  });

  it("keeps valid local and remote reference-image locations", () => {
    const result = parseMarketingSelection({
      sheetId: "sheet-1",
      sheetName: "Products",
      headers: [
        "Product",
        "Reference image",
        "Generated image",
        "Prompt",
        "Status",
      ],
      rows: [
        [
          "Travel mug",
          "/tmp/front.png；https://example.com/side.webp\nC:\\assets\\logo.png",
          "",
          "Create a clean ecommerce hero image",
          "Queued",
        ],
      ],
      firstRowIndex: 1,
      existingColumnCount: 5,
      headerRowIndex: 0,
      assetKind: "marketplace-main",
    });

    expect(result.rows[0].referenceImages).toEqual([
      "/tmp/front.png",
      "https://example.com/side.webp",
      "C:\\assets\\logo.png",
    ]);
  });

  it("uses an explicit prompt and existing workflow columns", () => {
    const result = parseMarketingSelection({
      sheetId: "sheet-1",
      sheetName: "Products",
      headers: ["Product", "Prompt", "Generated image", "OfficeDex Status"],
      rows: [["Lamp", "Create a warm studio hero image", "", ""]],
      firstRowIndex: 4,
      existingColumnCount: 4,
      headerRowIndex: 0,
      assetKind: "lifestyle",
    });

    expect(result.outputColumn).toBe(2);
    expect(result.statusColumn).toBe(3);
    expect(result.rows[0].prompt).toBe("Create a warm studio hero image");
  });

  it("recognizes a generic generated-image column for marketplace output", () => {
    const result = parseMarketingSelection({
      sheetId: "sheet-1",
      sheetName: "Products",
      headers: [
        "Product",
        "Selling points",
        "Description",
        "Reference image",
        "Generated image",
        "Status",
      ],
      rows: [
        [
          "Travel mug",
          "Leak proof",
          "For commuters",
          "/tmp/mug.png",
          "",
          "Queued",
        ],
      ],
      firstRowIndex: 1,
      existingColumnCount: 6,
      headerRowIndex: 0,
      assetKind: "marketplace-main",
    });
    expect(result.outputColumn).toBe(4);
    expect(result.statusColumn).toBe(5);
  });

  it("skips completely empty rows", () => {
    const result = parseMarketingSelection({
      sheetId: "sheet-1",
      sheetName: "商品",
      headers: ["商品名称", "卖点", "社媒图结果", "状态"],
      rows: [
        ["", "", "", ""],
        ["香薰蜡烛", "木质香调", "", "待生成"],
      ],
      firstRowIndex: 1,
      existingColumnCount: 2,
      headerRowIndex: 0,
      assetKind: "social-poster",
    });

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].rowIndex).toBe(2);
  });

  it("maps the ecommerce batch template prompts and adjacent ratios by asset kind", () => {
    const base = {
      sheetId: "sheet-1",
      sheetName: "电商营销素材",
      headers: ecommerceHeaders,
      rows: [ecommerceRow()],
      firstRowIndex: 4,
      existingColumnCount: 37,
      headerRowIndex: 3,
    };

    const main = parseMarketingSelection({
      ...base,
      assetKind: "marketplace-main",
    });
    expect(main.rows[0]).toEqual(
      expect.objectContaining({
        productName: "主动降噪头戴耳机",
        prompt: "白底棚拍，耳机主体居中",
        ratio: "square",
        referenceImages: ["/tmp/headphones.png"],
      }),
    );
    expect(main.outputTitle).toBe("OfficeDex主图");
    expect(main.outputColumn).toBe(12);
    expect(main.statusColumn).toBe(27);
    expect(main.headerRowIndex).toBe(3);

    const lifestyle = parseMarketingSelection({
      ...base,
      assetKind: "lifestyle",
    });
    expect(lifestyle.rows[0]).toEqual(
      expect.objectContaining({
        prompt: "都市通勤场景，人物佩戴耳机",
        ratio: "portrait",
      }),
    );
    expect(lifestyle.outputColumn).toBe(15);

    const social = parseMarketingSelection({
      ...base,
      assetKind: "social-poster",
    });
    expect(social.rows[0]).toEqual(
      expect.objectContaining({
        prompt: "小红书风格社媒种草图",
        ratio: "portrait",
      }),
    );
    expect(social.outputColumn).toBe(24);
  });

  it("finds the real header after title, instructions, and grouped headings", () => {
    expect(
      findMarketingHeaderRow(
        [
          ["电商营销素材批量生图需求模板"],
          ["填写说明：一行一个商品"],
          ["基础信息", "", "", "", "", "", "", "", "", "", "", "素材", "主图"],
          ecommerceHeaders,
        ],
        "marketplace-main",
      ),
    ).toBe(3);
  });
});

describe("marketing prompts", () => {
  it("adds reference fidelity and ecommerce constraints", () => {
    const prompt = buildMarketingPrompt(
      { productName: "运动鞋", sellingPoints: "轻量缓震" },
      "lifestyle",
    );
    expect(prompt).toContain("真实使用场景");
    expect(prompt).toContain("保持商品外形、颜色、材质、Logo");
    expect(prompt).toContain("轻量缓震");
  });

  it("recommends portrait for social posters", () => {
    expect(recommendedRatio("social-poster")).toBe("portrait");
    expect(recommendedRatio("marketplace-main")).toBe("square");
  });
});
