import { adererrorExtractor } from "./adererror";
import { musinsaExtractor } from "./musinsa";
import { sansangearExtractor } from "./sansangear";
import { saturExtractor } from "./satur";
import { youthisyoursExtractor } from "./youthisyours";
import type { ProductExtractor } from "./types";

const PRODUCT_EXTRACTORS: ProductExtractor[] = [
  musinsaExtractor,
  youthisyoursExtractor,
  sansangearExtractor,
  adererrorExtractor,
  saturExtractor,
];

export function parseProductUrl(value: string) {
  try {
    const url = new URL(value.trim());
    return findProductExtractor(url) ? url : null;
  } catch {
    return null;
  }
}

export function findProductExtractor(url: URL) {
  return PRODUCT_EXTRACTORS.find((extractor) => extractor.supports(url)) ?? null;
}

export function getSupportedProductSites() {
  return PRODUCT_EXTRACTORS.map((extractor) => extractor.site);
}
