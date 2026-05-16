import { type FormEvent, useState } from "react";
import Link from "next/link";

import { useAuth } from "@/contexts/AuthContext";

const inputClass =
  "h-[52px] w-full rounded-lg border border-black/10 bg-white/80 px-4 text-base font-semibold text-[#151515] outline-none transition placeholder:font-medium placeholder:text-[#8a837a] focus:border-[#151515] focus:bg-white focus:shadow-[0_0_0_4px_rgba(21,21,21,0.08)]";

function getReadableError(error: unknown) {
  if (error instanceof TypeError && error.message === "Failed to fetch") {
    return "Supabase에 연결하지 못했습니다. .env.local의 URL과 publishable key를 확인해주세요.";
  }

  if (error instanceof Error) {
    const message = error.message.toLowerCase();

    if (
      message.includes("already registered") ||
      message.includes("already exists") ||
      message.includes("duplicate") ||
      message.includes("user already")
    ) {
      return "이미 가입된 이메일입니다. 로그인 화면에서 로그인해주세요.";
    }

    return error.message;
  }

  return "회원가입에 실패했습니다.";
}

export default function Register() {
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const { signUp } = useAuth();

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");
    setSubmitting(true);

    const formData = new FormData(event.currentTarget);
    const username = String(formData.get("username") ?? "").trim();
    const email = String(formData.get("email") ?? "").trim();
    const phone = String(formData.get("phone") ?? "").trim();
    const password = String(formData.get("password") ?? "");
    const passwordConfirm = String(formData.get("passwordConfirm") ?? "");

    if (password !== passwordConfirm) {
      setError("비밀번호가 일치하지 않습니다.");
      setSubmitting(false);
      return;
    }

    try {
      await signUp({
        email,
        password,
        username,
        phone,
      });

      setMessage(
        "회원가입이 완료되었습니다. 이메일 확인이 필요한 경우 메일함을 확인해주세요.",
      );
      setMessage(
        "회원가입 요청이 접수되었습니다. 관리자가 이메일에서 승인하면 사용할 수 있습니다.",
      );
    } catch (signUpError) {
      setError(getReadableError(signUpError));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="grid min-h-screen place-items-center bg-[radial-gradient(circle_at_22%_18%,rgba(246,203,92,0.22),transparent_28%),linear-gradient(135deg,#fbfaf7_0%,#eef4f0_48%,#f8efe7_100%)] p-6 text-[#151515] max-[520px]:items-start max-[520px]:px-5 max-[520px]:py-12">
      <section
        className="w-full max-w-[470px] rounded-lg border border-black/10 bg-white/80 px-[34px] py-8 shadow-[0_24px_72px_rgba(61,48,35,0.14)] backdrop-blur-md max-[520px]:px-[22px] max-[520px]:py-7"
        aria-labelledby="register-title"
      >
        <div className="mb-7 text-center">
          <p className="mb-2.5 text-xs font-extrabold tracking-[0.14em] text-[#6c655b]">
            BUYMA
          </p>
          <h1
            id="register-title"
            className="m-0 text-[26px] font-extrabold leading-tight text-[#151515] max-[520px]:text-2xl"
          >
            회원가입
          </h1>
        </div>

        <form className="flex flex-col gap-3.5" onSubmit={handleSubmit}>
          <label className="flex flex-col gap-[7px]">
            <span className="text-sm font-bold text-[#4c4a45]">이름</span>
            <input
              className={inputClass}
              type="text"
              name="username"
              placeholder="이름"
              autoComplete="name"
              required
            />
          </label>

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
            <span className="text-sm font-bold text-[#4c4a45]">전화번호</span>
            <input
              className={inputClass}
              type="tel"
              name="phone"
              placeholder="010-0000-0000"
              autoComplete="tel"
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
              autoComplete="new-password"
              required
              minLength={6}
            />
          </label>

          <label className="flex flex-col gap-[7px]">
            <span className="text-sm font-bold text-[#4c4a45]">
              비밀번호 확인
            </span>
            <input
              className={inputClass}
              type="password"
              name="passwordConfirm"
              placeholder="Password confirmation"
              autoComplete="new-password"
              required
              minLength={6}
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
            {submitting ? "가입 중..." : "회원가입"}
          </button>

          <Link
            href="/login"
            className="mt-1 inline-flex min-h-8 items-center justify-center self-center text-[15px] font-extrabold leading-snug text-[#bd4632] hover:underline"
          >
            로그인으로 돌아가기
          </Link>
        </form>
      </section>
    </main>
  );
}
