import {
  BUYMA_SHIPPING_METHODS_VERSION,
  BUYMA_STORAGE_KEYS,
  DEFAULT_BUYMA_SETTINGS,
  DEFAULT_BUYMA_SHIPPING_METHODS,
} from "./data";
import type { BuymaSettings, BuymaShippingMethod } from "./types";

export function clearStoredProducts() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(BUYMA_STORAGE_KEYS.products);
}

export function loadStoredSettings() {
  const storedSettings = readJson<Partial<BuymaSettings>>(BUYMA_STORAGE_KEYS.settings, {});
  const settings = {
    ...DEFAULT_BUYMA_SETTINGS,
    ...storedSettings,
  };

  if (
    storedSettings.shippingMethodsInitialized &&
    storedSettings.shippingMethodsVersion === BUYMA_SHIPPING_METHODS_VERSION
  ) {
    return settings;
  }

  return {
    ...settings,
    shippingMethods: mergeShippingMethods([
      ...DEFAULT_BUYMA_SHIPPING_METHODS,
      ...(storedSettings.shippingMethods ?? []),
    ]),
    shippingMethodsInitialized: true,
    shippingMethodsVersion: BUYMA_SHIPPING_METHODS_VERSION,
  };
}

export function saveStoredSettings(settings: BuymaSettings) {
  window.localStorage.setItem(BUYMA_STORAGE_KEYS.settings, JSON.stringify(settings));
}

function readJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;

  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function mergeShippingMethods(methods: BuymaShippingMethod[]) {
  const merged = new Map<string, BuymaShippingMethod>();
  methods.forEach((method) => {
    const id = normalizeShippingMethodId(method.id);
    if (!id) return;
    merged.set(id, { id, label: method.label || id.replace(/^J/i, "") });
  });
  return [...merged.values()];
}

function normalizeShippingMethodId(value: unknown) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  return /^J/i.test(text) ? `J${text.slice(1)}` : `J${text}`;
}
