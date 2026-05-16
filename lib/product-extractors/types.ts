import type { ProductDraft, ProductSite } from "@/lib/buyma/types";

export type ProductExtractor = {
  site: ProductSite;
  supports: (url: URL) => boolean;
  extract: (url: URL) => Promise<ProductDraft>;
};
