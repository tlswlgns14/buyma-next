import type { ProductDraft } from "./types";
import { cleanText } from "./text";

const SUPRA_BRAND_DESCRIPTION_JA =
  "スープラ（SUPRA）は、アメリカ・カリフォルニアのスケートカルチャーを基盤に2006年に設立されたブランドです。現代的なデザインとシルエットでサブカルチャーをリードし、ヘリテージを再解釈したアウトドアとストリートコレクションを通じて新しいライフスタイルを提案しています。";

export function getJapaneseBrandDescription(product: Pick<ProductDraft, "brand" | "brandDisplayName">) {
  const brand = cleanText(`${product.brand} ${product.brandDisplayName}`);
  return /SUPRA|スープラ|수프라/i.test(brand) ? SUPRA_BRAND_DESCRIPTION_JA : "";
}
