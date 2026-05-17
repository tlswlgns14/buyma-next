import { adererrorExtractor } from "./adererror";
import { humanity999Extractor } from "./humanity999";
import { musinsaExtractor } from "./musinsa";
import { sansangearExtractor } from "./sansangear";
import { saturExtractor } from "./satur";
import { thenorthfaceExtractor } from "./thenorthface";
import { youthisyoursExtractor } from "./youthisyours";
import type { ProductExtractor } from "./types";

const PRODUCT_EXTRACTORS: ProductExtractor[] = [
  musinsaExtractor,
  youthisyoursExtractor,
  sansangearExtractor,
  adererrorExtractor,
  saturExtractor,
  thenorthfaceExtractor,
  humanity999Extractor,
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
