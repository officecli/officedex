import type { ShopifyCatalogCleanupInput, ShopifyCatalogCleanupResult } from "../../shared/types";

export type CatalogFieldRole =
  | "ignored" | "handle" | "sku" | "title" | "description" | "vendor" | "productCategory" | "productType" | "tags"
  | "published" | "status" | "price" | "compareAtPrice" | "cost" | "chargeTax" | "inventoryTracker" | "inventory"
  | "inventoryPolicy" | "barcode" | "image" | "imagePosition" | "imageAltText" | "variantImage" | "weight" | "weightUnit"
  | "requiresShipping" | "fulfillmentService" | "giftCard" | "seoTitle" | "seoDescription" | "option1Name" | "option1Value"
  | "option2Name" | "option2Value" | "option3Name" | "option3Value";

export type CatalogImportIntent = "create" | "update" | "mixed";
export type CatalogCleanupBatch = ShopifyCatalogCleanupResult;
export type CatalogSelection = Omit<ShopifyCatalogCleanupInput, "intent" | "confirmedMapping">;
export interface CatalogInspection {
  selections: CatalogSelection[];
  advancedSelection: boolean;
}

export const CATALOG_FIELD_ROLE_OPTIONS: Array<{ value: CatalogFieldRole; label: string }> = [
  ["ignored", "Ignore"], ["handle", "URL handle"], ["sku", "SKU"], ["title", "Title"], ["description", "Description"],
  ["vendor", "Vendor / Brand"], ["productCategory", "Product category"], ["productType", "Product type"], ["tags", "Tags"],
  ["published", "Published on online store"], ["status", "Status"], ["price", "Price"], ["compareAtPrice", "Compare-at price"],
  ["cost", "Cost"], ["chargeTax", "Charge tax"], ["inventoryTracker", "Inventory tracker"], ["inventory", "Inventory"],
  ["inventoryPolicy", "Continue selling when out of stock"], ["barcode", "Barcode"], ["image", "Image URL"],
  ["imagePosition", "Image position"], ["imageAltText", "Image alt text"], ["variantImage", "Variant image URL"], ["weight", "Weight"],
  ["weightUnit", "Weight unit"], ["requiresShipping", "Requires shipping"], ["fulfillmentService", "Fulfillment service"],
  ["giftCard", "Gift card"], ["seoTitle", "SEO title"], ["seoDescription", "SEO description"], ["option1Name", "Option 1 name"],
  ["option1Value", "Option 1 value"], ["option2Name", "Option 2 name"], ["option2Value", "Option 2 value"],
  ["option3Name", "Option 3 name"], ["option3Value", "Option 3 value"],
].map(([value, label]) => ({ value: value as CatalogFieldRole, label }));

export function catalogBatchToShopifyCsv(batch: CatalogCleanupBatch): string { return batch.shopifyCsv; }
export function catalogBatchToFindingsCsv(batch: CatalogCleanupBatch): string { return batch.findingsCsv; }
