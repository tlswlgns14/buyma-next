import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabasePublishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const lockQueues = new Map<string, Promise<unknown>>();

type SupabaseLock = <Result>(
  name: string,
  acquireTimeout: number,
  fn: () => Promise<Result>,
) => Promise<Result>;

const browserProcessLock: SupabaseLock = async (name, _acquireTimeout, fn) => {
  const previous = lockQueues.get(name) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(fn);
  const queued = next.catch(() => undefined);

  lockQueues.set(name, queued);

  try {
    return await next;
  } finally {
    if (lockQueues.get(name) === queued) {
      lockQueues.delete(name);
    }
  }
};

export const isSupabaseConfigured = Boolean(
  supabaseUrl &&
    supabasePublishableKey &&
    supabasePublishableKey !== "your_supabase_publishable_key",
);

export function assertSupabaseConfigured() {
  if (!isSupabaseConfigured) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    );
  }
}

export const supabase = createClient(
  supabaseUrl ?? "https://placeholder.supabase.co",
  supabasePublishableKey ?? "missing-publishable-key",
  {
    auth: {
      lock: browserProcessLock,
    },
  },
);
