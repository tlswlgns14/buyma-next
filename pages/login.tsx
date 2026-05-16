import { type FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";

import { useAuth } from "@/contexts/AuthContext";

const inputClass =
  "h-[52px] w-full rounded-lg border border-black/10 bg-white/80 px-4 text-base font-semibold text-[#151515] outline-none transition placeholder:font-medium placeholder:text-[#8a837a] focus:border-[#151515] focus:bg-white focus:shadow-[0_0_0_4px_rgba(21,21,21,0.08)]";

function getReadableError(error: unknown) {
  if (error instanceof TypeError && error.message === "Failed to fetch") {
    return "Supabase에 연결하지 못했습니다. .env.local의 URL과 publishable key를 확인해주세요.";
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "로그인에 실패했습니다.";
}

export default function Login() {
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const { signIn } = useAuth();
  const router = useRouter();

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");
    setSubmitting(true);

    const formData = new FormData(event.currentTarget);
    const email = String(formData.get("email") ?? "").trim();
    const password = String(formData.get("password") ?? "");

    try {
      await signIn(email, password);
      setMessage("로그인되었습니다.");
      await router.push("/dashboard");
    } catch (loginError) {
      setError(getReadableError(loginError));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="grid min-h-screen place-items-center bg-[radial-gradient(circle_at_22%_18%,rgba(246,203,92,0.22),transparent_28%),linear-gradient(135deg,#fbfaf7_0%,#eef4f0_48%,#f8efe7_100%)] p-6 text-[#151515] max-[520px]:items-start max-[520px]:px-5 max-[520px]:py-12">
      <section
        className="w-full max-w-[470px] rounded-lg border border-black/10 bg-white/80 px-[34px] py-8 shadow-[0_24px_72px_rgba(61,48,35,0.14)] backdrop-blur-md max-[520px]:px-[22px] max-[520px]:py-7"
        aria-labelledby="login-title"
      >
        <div className="mb-7 text-center">
          <p className="mb-2.5 text-xs font-extrabold tracking-[0.14em] text-[#6c655b]">
            BUYMA
          </p>
          <h1
            id="login-title"
            className="m-0 text-[26px] font-extrabold leading-tight text-[#151515] max-[520px]:text-2xl"
          >
            로그인
          </h1>
        </div>

        <form className="flex flex-col gap-3.5" onSubmit={handleSubmit}>
          <label className="flex flex-col gap-[7px]">
            <span className="text-sm font-bold text-[#4c4a45]">이메일</span>
            <input
              className={inputClass}
              type="email"
              name="email"
              placeholder="Email"
              autoComplete="email"
              required
            />
          </label>

          <label className="flex flex-col gap-[7px]">
            <span className="text-sm font-bold text-[#4c4a45]">비밀번호</span>
            <input
              className={inputClass}
              type="password"
              name="password"
              placeholder="Password"
              autoComplete="current-password"
              required
            />
          </label>

          {error && (
            <p className="rounded-lg border border-[#bd4632]/20 bg-[#fff2ef] px-3 py-2 text-sm font-bold text-[#9f3323]">
              {error}
            </p>
          )}

          {message && (
            <p className="rounded-lg border border-emerald-500/20 bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-700">
              {message}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="mt-2 inline-flex min-h-[68px] w-full cursor-pointer items-center justify-center gap-3 rounded-lg border border-black/15 bg-white text-2xl font-extrabold text-[#151515] shadow-[0_1px_0_rgba(21,21,21,0.04)] transition hover:-translate-y-px hover:border-black/30 hover:shadow-[0_10px_24px_rgba(61,48,35,0.1)] active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? "로그인 중..." : "로그인"}
          </button>

          <Link
            href="/register"
            className="mt-1 inline-flex min-h-8 items-center justify-center self-center text-[15px] font-extrabold leading-snug text-[#bd4632] hover:underline"
          >
            회원가입
          </Link>
        </form>
      </section>
    </main>
  );
}
