import Link from "next/link";

export default function Hero() {
  return (
    <section className="flex min-h-screen items-center justify-center bg-[radial-gradient(circle_at_78%_24%,rgba(246,203,92,0.26),transparent_29%),linear-gradient(135deg,#fbfaf7_0%,#eef4f0_46%,#f8efe7_100%)] px-[clamp(24px,6vw,96px)] py-[72px] text-[#121212] max-[860px]:min-h-0 max-[860px]:pt-[52px] max-[560px]:px-5 max-[560px]:py-10">
      <div className="flex max-w-[760px] flex-col items-center text-center">
        <p className="mb-5 text-[13px] font-bold tracking-[0.14em] text-[#6c655b]">
          BUYMA 
        </p>
        <h1 className="m-0 text-[clamp(48px,8vw,104px)] font-extrabold leading-[0.98] text-[#151515] max-[560px]:text-[44px]">
          BUYMA
          <span className="mt-2.5 block min-h-[1.08em] text-[#bd4632]">
            Premium Fashion
          </span>
        </h1>
        <p className="mt-7 max-w-[600px] break-keep text-lg leading-[1.75] text-[#4c4a45] max-[560px]:text-base">
          원하는 상품을 선명하게 찾고, 마음에 드는 아이템을 한눈에 비교하는
          BUYMA 쇼핑 경험을 준비하고 있습니다.
        </p>

        <div className="mt-[34px] flex flex-wrap justify-center gap-3 max-[560px]:w-full">
          <Link
            href="/login"
            className="inline-flex min-h-12 items-center justify-center rounded-lg border border-[#151515] bg-[#151515] px-5 text-[15px] font-bold text-white transition hover:-translate-y-0.5 max-[560px]:min-w-[132px] max-[560px]:flex-1"
          >
            시작하기
          </Link>
        </div>
      </div>
    </section>
  );
}
