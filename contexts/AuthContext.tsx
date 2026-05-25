import {
  createContext,
  type PropsWithChildren,
  useContext,
  useEffect,
  useState,
} from "react";
import type { Session, User } from "@supabase/supabase-js";

import {
  assertSupabaseConfigured,
  isSupabaseConfigured,
  supabase,
} from "@/lib/supabase";

export type AppUser = {
  id: string;
  email: string;
  username: string | null;
  phone: string | null;
  approval_status: "pending" | "approved" | "rejected";
  approved_at: string | null;
  access_expires_at: string;
  can_use_competitor_prices: boolean;
  created_at: string;
  updated_at: string;
};

type SignUpInput = {
  email: string;
  password: string;
  username: string;
  phone: string;
};

type AuthContextValue = {
  session: Session | null;
  authUser: User | null;
  user: AppUser | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (input: SignUpInput) => Promise<void>;
  signOut: () => Promise<void>;
  refreshUser: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

async function fetchAppUser(userId: string) {
  assertSupabaseConfigured();

  const { data, error } = await supabase
    .from("users")
    .select(
      "id,email,username,phone,approval_status,approved_at,access_expires_at,can_use_competitor_prices,created_at,updated_at",
    )
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data as AppUser | null;
}

export function AuthProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState<Session | null>(null);
  const [authUser, setAuthUser] = useState<User | null>(null);
  const [user, setUser] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);

  async function refreshUser() {
    assertSupabaseConfigured();

    const { data, error } = await supabase.auth.getUser();

    if (error || !data.user) {
      setUser(null);
      return;
    }

    setUser(await fetchAppUser(data.user.id));
  }

  useEffect(() => {
    let ignore = false;

    async function loadSession() {
      try {
        if (!isSupabaseConfigured) {
          setLoading(false);
          return;
        }

        const { data, error } = await supabase.auth.getSession();

        if (ignore) {
          return;
        }

        if (error) {
          setSession(null);
          setAuthUser(null);
          setUser(null);
          setLoading(false);
          return;
        }

        const nextSession = data.session;
        setSession(nextSession);
        setAuthUser(nextSession?.user ?? null);

        if (nextSession?.user) {
          setUser(await fetchAppUser(nextSession.user.id));
        } else {
          setUser(null);
        }

        setLoading(false);
      } catch {
        setUser(null);
        setSession(null);
        setAuthUser(null);
        setLoading(false);
      }
    }

    void loadSession();

    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setAuthUser(nextSession?.user ?? null);

      if (!nextSession?.user) {
        setUser(null);
        setLoading(false);
        return;
      }

      void fetchAppUser(nextSession.user.id)
        .then(setUser)
        .catch(() => setUser(null))
        .finally(() => setLoading(false));
    });

    return () => {
      ignore = true;
      data.subscription.unsubscribe();
    };
  }, []);

  async function signIn(email: string, password: string) {
    assertSupabaseConfigured();

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      throw error;
    }
  }

  async function signUp({ email, password, username, phone }: SignUpInput) {
    assertSupabaseConfigured();

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          username,
          phone,
        },
      },
    });

    if (error) {
      throw error;
    }

    if (data.user) {
      try {
        const response = await fetch("/api/approval/request", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            userId: data.user.id,
            email,
            username,
            phone,
          }),
        });

        if (!response.ok) {
          const body = (await response.json().catch(() => null)) as {
            error?: string;
          } | null;

          throw new Error(
            body?.error ??
          "회원가입은 완료되었지만 관리자 승인 요청 메일 발송에 실패했습니다.",
          );
        }
      } finally {
        await signOut();
      }
    }
  }

  async function signOut() {
    assertSupabaseConfigured();

    const { error } = await supabase.auth.signOut();

    if (error) {
      throw error;
    }

    setSession(null);
    setAuthUser(null);
    setUser(null);
  }

  return (
    <AuthContext.Provider
      value={{
        session,
        authUser,
        user,
        loading,
        signIn,
        signUp,
        signOut,
        refreshUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }

  return context;
}
