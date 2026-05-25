import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import type { UserMetadata } from "@supabase/supabase-js";

import CompetitorPriceChecker from "@/components/CompetitorPriceChecker";
import ProductManager from "@/components/ProductManager";
import { useAuth } from "@/contexts/AuthContext";
import { formatAccessDate, isAccessExpired } from "@/lib/access";

type DashboardMenuKey =
  | "product-management"
  | "competitor-prices"
  | "sourcing-sites"
  | "image-server-guide";

type DashboardMenu = {
  key: DashboardMenuKey;
  label: string;
  title: string;
};

const dashboardMenus: DashboardMenu[] = [
  {
    key: "product-management",
    label: "상품관리",
    title: "상품관리",
  },
  {
    key: "competitor-prices",
    label: "경쟁가격확인",
    title: "경쟁가격확인",
  },
  {
    key: "sourcing-sites",
    label: "소싱사이트내역",
    title: "소싱사이트내역",
  },
  {
    key: "image-server-guide",
    label: "이미지 서버 설정가이드",
    title: "이미지 서버 설정가이드",
  },
];

const sourcingSites = [
  {
    name: "MUSINSA",
    domain: "musinsa.com",
    status: "지원중",
    urls: [
      "https://www.musinsa.com/products/{상품번호}",
      "https://www.musinsa.com/app/goods/{상품번호}",
    ],
  },
  {
    name: "Youthisyours",
    domain: "youthisyours.net",
    status: "지원중",
    urls: [
      "https://youthisyours.net/product/detail.html?product_no={상품번호}",
    ],
  },
  {
    name: "SAN SAN GEAR",
    domain: "sansangear.com",
    status: "지원중",
    urls: [
      "https://sansangear.com/product/detail.html?product_no={상품번호}",
    ],
  },
  {
    name: "ADERERROR",
    domain: "adererror.com",
    status: "지원중",
    urls: [
      "https://adererror.com/kr/shop/{상품번호}",
      "https://adererror.com/kr/shop/{상품번호}?header_idx={헤더번호}",
    ],
  },
  {
    name: "SATUR",
    domain: "satur.co.kr",
    status: "지원중",
    urls: [
      "https://www.satur.co.kr/product/{상품명}/{상품번호}/category/{카테고리번호}/display/1/",
      "https://satur.co.kr/product/{상품명}/{상품번호}/",
    ],
  },
  {
    name: "THE NORTH FACE",
    domain: "thenorthfacekorea.co.kr",
    status: "지원중",
    urls: [
      "https://www.thenorthfacekorea.co.kr/product/{상품코드}",
    ],
  },
  {
    name: "999HUMANITY",
    domain: "999humanity.kr",
    status: "지원중",
    urls: [
      "https://999humanity.kr/product/detail.html?product_no={상품번호}",
      "https://999humanity.kr/product/{상품명}/{상품번호}/",
    ],
  },
];

export default function Dashboard() {
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [activeMenu, setActiveMenu] =
    useState<DashboardMenuKey>("product-management");
  const { authUser, loading, signOut, user } = useAuth();
  const router = useRouter();
  const displayName = getDisplayName(user?.username, authUser?.user_metadata);
  const weekRange = getCurrentWeekRange();
  const canUseCompetitorPrices = Boolean(user?.can_use_competitor_prices);
  const visibleDashboardMenus = canUseCompetitorPrices
    ? dashboardMenus
    : dashboardMenus.filter((menu) => menu.key !== "competitor-prices");
  const effectiveActiveMenu =
    !canUseCompetitorPrices && activeMenu === "competitor-prices"
      ? "product-management"
      : activeMenu;
  const activeMenuItem = visibleDashboardMenus.find(
    (menu) => menu.key === effectiveActiveMenu,
  );
  const approvalStatus = user?.approval_status ?? "pending";
  const accessExpired = isAccessExpired(user?.access_expires_at);
  const accessExpiresDate = formatAccessDate(user?.access_expires_at);

  useEffect(() => {
    if (!loading && !authUser) {
      void router.replace("/login");
    }
  }, [authUser, loading, router]);

  async function handleSignOut() {
    setSigningOut(true);

    try {
      await signOut();
      await router.replace("/");
    } finally {
      setSigningOut(false);
    }
  }

  if (loading || !authUser) {
    return (
      <main className="grid min-h-screen place-items-center bg-[#f7f5ef] text-[#151515]">
        <p className="text-sm font-bold text-[#6c655b]">Loading...</p>
      </main>
    );
  }

  if (approvalStatus !== "approved") {
    const isRejected = approvalStatus === "rejected";

    return (
      <main className="grid min-h-screen place-items-center bg-[#f7f5ef] px-6 text-[#151515]">
        <section className="w-full max-w-[460px] rounded-lg border border-black/10 bg-white px-7 py-8 text-center shadow-[0_24px_72px_rgba(61,48,35,0.14)]">
          <p className="mb-2.5 text-xs font-extrabold tracking-[0.14em] text-[#6c655b]">
            BUYMA
          </p>
          <h1 className="text-2xl font-extrabold leading-tight">
            {isRejected ? "가입이 거절되었습니다." : "관리자 승인 대기 중입니다."}
          </h1>
          <p className="mt-3 text-sm font-semibold leading-6 text-[#6c655b]">
            {isRejected
              ? "관리자에게 문의한 뒤 다시 가입을 진행해주세요."
              : "관리자가 이메일 가입 요청을 승인하면 사용할 수 있습니다."}
          </p>
          <button
            type="button"
            disabled={signingOut}
            onClick={() => void handleSignOut()}
            className="mt-6 inline-flex min-h-11 items-center justify-center rounded-lg border border-black/15 bg-white px-5 text-sm font-extrabold text-[#151515] transition hover:border-black/30 disabled:cursor-not-allowed disabled:opacity-60"
          >
            로그아웃
          </button>
        </section>
      </main>
    );
  }

  if (accessExpired) {
    return (
      <main className="grid min-h-screen place-items-center bg-[#f7f5ef] px-6 text-[#151515]">
        <section className="w-full max-w-[460px] rounded-lg border border-black/10 bg-white px-7 py-8 text-center shadow-[0_24px_72px_rgba(61,48,35,0.14)]">
          <p className="mb-2.5 text-xs font-extrabold tracking-[0.14em] text-[#6c655b]">
            BUYMA
          </p>
          <h1 className="text-2xl font-extrabold leading-tight">
            사용 기간이 만료되었습니다.
          </h1>
          <p className="mt-3 text-sm font-semibold leading-6 text-[#6c655b]">
            이 계정의 기본 사용 기간은 가입일로부터 7일입니다.
            {accessExpiresDate ? ` 만료일: ${accessExpiresDate}` : ""}
          </p>
          <button
            type="button"
            disabled={signingOut}
            onClick={() => void handleSignOut()}
            className="mt-6 inline-flex min-h-11 items-center justify-center rounded-lg border border-black/15 bg-white px-5 text-sm font-extrabold text-[#151515] transition hover:border-black/30 disabled:cursor-not-allowed disabled:opacity-60"
          >
            로그아웃
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="grid min-h-screen grid-cols-[170px_minmax(0,1fr)] bg-[#f7f5ef] text-[#151515] max-[760px]:grid-cols-1">
      <aside className="min-h-screen border-r border-black/10 bg-white max-[760px]:min-h-0 max-[760px]:border-b max-[760px]:border-r-0">
        <div className="flex h-[52px] items-center border-b border-black/10 px-5">
          <p className="text-sm font-extrabold tracking-[0.14em] text-[#6c655b]">
            BUYMA
          </p>
        </div>

        <nav aria-label="Dashboard navigation" className="grid gap-2 px-4 py-6">
          {visibleDashboardMenus.map((menu) => (
            <button
              key={menu.key}
              type="button"
              onClick={() => setActiveMenu(menu.key)}
              className={`flex min-h-11 w-full items-center rounded-lg px-4 text-left text-sm font-extrabold transition ${
                effectiveActiveMenu === menu.key
                  ? "bg-[#151515] text-white"
                  : "bg-white text-[#151515] hover:bg-black/[0.04]"
              }`}
            >
              {menu.label}
            </button>
          ))}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-col">
        <header className="relative flex h-[52px] w-full shrink-0 items-center border-b border-black/10 bg-white px-5">
          <div className="relative ml-auto">
            <button
              type="button"
              aria-expanded={accountMenuOpen}
              aria-controls="account-menu"
              onClick={() => setAccountMenuOpen((open) => !open)}
              className="inline-flex h-10 items-center justify-center gap-1 rounded-lg bg-white px-2 text-sm font-extrabold text-[#2d73ff] transition hover:bg-[#f4f7ff]"
            >
              {displayName}
              <span
                aria-hidden="true"
                className="mt-0.5 h-0 w-0 border-x-[4px] border-t-[5px] border-x-transparent border-t-current"
              />
            </button>

            {accountMenuOpen && (
              <div
                id="account-menu"
                className="absolute right-0 top-[41px] z-10 w-[294px] overflow-hidden rounded-lg border border-black/10 bg-white shadow-[0_16px_40px_rgba(61,48,35,0.14)]"
              >
                <div className="flex min-h-10 items-center justify-center border-b border-black/10 px-4 text-xs font-bold text-[#6c655b]">
                  {accessExpiresDate ? `사용 만료일 ${accessExpiresDate}` : weekRange}
                </div>
                <button
                  type="button"
                  disabled={signingOut}
                  onClick={() => void handleSignOut()}
                  className="flex min-h-10 w-full items-center justify-center px-3 text-sm font-bold text-[#151515] transition hover:bg-[#fff2ef] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  로그아웃
                </button>
              </div>
            )}
          </div>
        </header>

        <section className="flex-1 px-8 py-8 max-[760px]:px-5">
          <div className="mb-7">
            <p className="text-xs font-extrabold tracking-[0.14em] text-[#6c655b]">
              DASHBOARD
            </p>
            <h1 className="mt-2 text-3xl font-extrabold leading-tight">
              {activeMenuItem?.title}
            </h1>
          </div>

          {renderDashboardContent(effectiveActiveMenu, canUseCompetitorPrices)}
        </section>
      </div>
    </main>
  );
}

function renderDashboardContent(
  activeMenu: DashboardMenuKey,
  canUseCompetitorPrices: boolean,
) {
  switch (activeMenu) {
    case "product-management":
      return <ProductManager />;
    case "competitor-prices":
      return canUseCompetitorPrices ? <CompetitorPriceChecker /> : null;
    case "sourcing-sites":
      return <SourcingSitesPanel />;
    case "image-server-guide":
      return <ImageServerGuidePanel />;
    default:
      return null;
  }
}

function ImageServerGuidePanel() {
  return (
    <section className="grid gap-4">
      <div className="rounded-lg border border-black/10 bg-white p-5 shadow-[0_12px_32px_rgba(61,48,35,0.08)]">
        <div className="border-b border-black/10 pb-4">
          <h2 className="text-lg font-extrabold text-[#151515]">
            이미지 서버 설정 순서
          </h2>
          <p className="mt-1 text-sm font-semibold text-[#6c655b]">
            상품관리 설정 탭의 이미지 서버 설정에 아래 값을 입력한 뒤 연결 테스트를 진행하세요.
          </p>
        </div>

        <div className="mt-4 grid gap-3">
          <article className="rounded-lg border border-black/10 bg-[#fbfaf7] p-4">
            <h3 className="text-base font-extrabold text-[#151515]">
              1. imgBB API Key 입력
            </h3>
            <p className="mt-2 text-sm font-semibold leading-6 text-[#6c655b]">
              imgBB 계정에서 API Key를 발급받아 상품관리의 imgBB API Key 칸에 입력합니다.
            </p>
          </article>

          <article className="rounded-lg border border-black/10 bg-[#fbfaf7] p-4">
            <h3 className="text-base font-extrabold text-[#151515]">
              2. Worker URL 입력
            </h3>
            <p className="mt-2 text-sm font-semibold leading-6 text-[#6c655b]">
              Cloudflare Worker 배포 주소를 Worker URL에 입력합니다. 예시는
              {" "}
              <span className="font-mono text-[#2f3742]">
                https://buyma-image-worker.your-account.workers.dev
              </span>
              입니다.
            </p>
          </article>

          <article className="rounded-lg border border-black/10 bg-[#fbfaf7] p-4">
            <h3 className="text-base font-extrabold text-[#151515]">
              3. Worker API Key 입력
            </h3>
            <p className="mt-2 text-sm font-semibold leading-6 text-[#6c655b]">
              Worker에서 검사하는 API Key와 상품관리 화면의 Worker API Key 값이 같아야 합니다.
            </p>
          </article>

          <article className="rounded-lg border border-black/10 bg-[#fbfaf7] p-4">
            <h3 className="text-base font-extrabold text-[#151515]">
              4. 이미지 업로드 사용 체크
            </h3>
            <p className="mt-2 text-sm font-semibold leading-6 text-[#6c655b]">
              이미지 업로드 사용을 체크하면 CSV 생성 전에 이미지 URL을 서버 업로드 URL로 교체합니다.
            </p>
          </article>

          <article className="rounded-lg border border-black/10 bg-[#fbfaf7] p-4">
            <h3 className="text-base font-extrabold text-[#151515]">
              5. 이미지 서버 연결 테스트 실행
            </h3>
            <p className="mt-2 text-sm font-semibold leading-6 text-[#6c655b]">
              연결 테스트에서 Worker 상태, Worker API Key, imgBB API Key 확인이 모두 통과해야 실제 업로드에 사용할 수 있습니다.
            </p>
          </article>
        </div>

        <div className="mt-5 rounded-lg border border-[#2d73ff]/20 bg-[#f4f7ff] p-4">
          <h3 className="text-base font-extrabold text-[#151515]">
            계정별 설정
          </h3>
          <p className="mt-2 text-sm font-semibold leading-6 text-[#476072]">
            이미지 서버 설정값은 계정별로 저장됩니다. 다른 계정에서도 이미지 업로드를 사용하려면 그 계정으로 로그인해서 같은 값을 저장해야 합니다.
          </p>
        </div>
      </div>
    </section>
  );
}

function SourcingSitesPanel() {
  return (
    <section className="grid gap-4">
      <div className="rounded-lg border border-black/10 bg-white p-5 shadow-[0_12px_32px_rgba(61,48,35,0.08)]">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-black/10 pb-4">
          <div>
            <h2 className="text-lg font-extrabold text-[#151515]">현재 취급 URL 목록</h2>
            <p className="mt-1 text-sm font-semibold text-[#6c655b]">
              상품관리에서 수집 가능한 소싱 사이트와 URL 형식입니다.
            </p>
          </div>
          <span className="rounded-full bg-[#151515] px-3 py-1 text-xs font-extrabold text-white">
            {sourcingSites.length}개 사이트
          </span>
        </div>

        <div className="mt-4 grid gap-3">
          {sourcingSites.map((site) => (
            <article
              key={site.domain}
              className="rounded-lg border border-black/10 bg-[#fbfaf7] p-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-base font-extrabold text-[#151515]">{site.name}</h3>
                  <p className="mt-0.5 text-sm font-bold text-[#6c655b]">{site.domain}</p>
                </div>
                <span className="rounded-full border border-[#2d73ff]/20 bg-[#f4f7ff] px-3 py-1 text-xs font-extrabold text-[#2d73ff]">
                  {site.status}
                </span>
              </div>

              <ul className="mt-3 grid gap-2">
                {site.urls.map((url) => (
                  <li
                    key={url}
                    className="break-all rounded-md border border-black/10 bg-white px-3 py-2 font-mono text-sm font-bold text-[#2f3742]"
                  >
                    {url}
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function getDisplayName(
  username: string | null | undefined,
  metadata: UserMetadata | undefined,
) {
  const metadataName =
    typeof metadata?.username === "string" ? metadata.username : null;

  return username ?? metadataName ?? "계정";
}

function getCurrentWeekRange() {
  const today = new Date();
  const weekStart = new Date(today);
  weekStart.setDate(today.getDate() - today.getDay());

  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);

  return `${formatDate(weekStart)} ~ ${formatDate(weekEnd)}`;
}

function formatDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}
