import Link from "next/link";
import { ArrowRight, BarChart3, Check, Crosshair, Eye, LineChart, Rocket, ShieldCheck } from "lucide-react";
import { BrandMark } from "@/components/hero";
import { Button } from "@/components/ui/button";

interface LandingProps {
  /** Visitors may create an account themselves */
  signupOpen: boolean;
  /** Subscription price and period; null while payments are not set up */
  billing: { priceUsdt: number; periodDays: number } | null;
  /** Free predictions after signup */
  freePredictions: number;
  /** Where to return after signing in (keeps ?upgrade=1 and the like) */
  next: string;
}

const FEATURES = [
  {
    icon: LineChart,
    title: "Прогноз по любой монете",
    text: "Выберите монету и срок — от 15 минут до недели. Модель, обученная на истории свечей и деривативов, языковая модель и правила дают направление, вероятность и объяснение, почему так.",
  },
  {
    icon: Crosshair,
    title: "Готовый план сделки",
    text: "Вход, цель, стоп и срок, до которого держать. И строка «не входить, если…»: когда цена уже ушла и сделка потеряла смысл.",
  },
  {
    icon: Rocket,
    title: "Возможности в реальном времени",
    text: "Сканер каждые 5 минут ищет уверенные сигналы по монетам с ходом от 1%. Каждая — карточка с графиком, причинами и итогом.",
  },
  {
    icon: BarChart3,
    title: "Новые листинги OKX",
    text: "Монеты, только что вышедшие на биржу: сводка, первые 7 дней по часам и статистика, как вели себя прошлые листинги.",
  },
];

const STEPS = [
  { title: "Создайте аккаунт", text: "Email и пароль — минута. Можно включить вход с кодом из приложения." },
  { title: "Выберите монету и срок", text: "BTC, ETH, SOL и другие монеты Binance — от 15 минут до недели." },
  { title: "Получите прогноз и план", text: "Направление, уровни, риск на сделку и объяснение модели." },
];

const FAQ = [
  {
    q: "Это инвестиционная рекомендация?",
    a: "Нет. Это аналитический инструмент: решение о сделке вы принимаете сами. Прибыль не гарантируется, а торговля с плечом может привести к потере всех денег.",
  },
  {
    q: "Почему вам можно верить?",
    a: "Мы не прячем убытки. Каждая отправленная сделка закрывается по цели, стопу или времени, и её итог после комиссий и проскальзывания виден в разделе «Возможности» — включая минусовые.",
  },
  {
    q: "Как оплатить подписку?",
    a: "USDT в сети TRON (TRC20) с любого кошелька или биржи. Сайт выставляет счёт с точной суммой и сам видит перевод через 1–3 минуты. Автосписаний нет: продлеваете, когда захотите.",
  },
  {
    q: "Что будет после бесплатных прогнозов?",
    a: "Аккаунт остаётся, история прогнозов и закрытые сделки видны. Для безлимитных прогнозов и идущих сделок нужна подписка.",
  },
];

/** A static example of a prediction, drawn like the real card but clearly marked as an example. */
function ExampleCard() {
  return (
    <div className="relative rounded-2xl border border-white/10 bg-card p-5 shadow-2xl shadow-black/40">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-amber-500/15 text-sm font-bold text-amber-300">₿</span>
          <div>
            <p className="text-sm font-semibold">BTCUSDT</p>
            <p className="text-[11px] text-muted-foreground">прогноз на 4 часа</p>
          </div>
        </div>
        <span className="rounded-md bg-white/5 px-2 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">пример</span>
      </div>

      <div className="mt-5">
        <div className="flex items-baseline justify-between">
          <p className="text-2xl font-bold text-emerald-400">Рост</p>
          <p className="text-sm text-muted-foreground">
            вероятность <span className="font-semibold text-foreground">61%</span>
          </p>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/5">
          <div className="h-full w-[61%] rounded-full bg-emerald-400" />
        </div>
      </div>

      <dl className="mt-5 grid grid-cols-3 gap-2 text-center">
        {[
          { k: "Вход", v: "97 450", c: "text-foreground" },
          { k: "Цель", v: "+1,5%", c: "text-emerald-400" },
          { k: "Стоп", v: "−1,5%", c: "text-red-400" },
        ].map((x) => (
          <div key={x.k} className="rounded-xl bg-white/[0.04] px-2 py-2.5">
            <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">{x.k}</dt>
            <dd className={`mt-0.5 text-sm font-semibold tabular-nums ${x.c}`}>{x.v}</dd>
          </div>
        ))}
      </dl>

      <p className="mt-4 rounded-xl bg-amber-500/[0.08] px-3 py-2 text-[11px] leading-relaxed text-amber-200/90">
        ⛔ Не входить, если цена уже выше 98 180 или прошло больше часа
      </p>
      <ul className="mt-4 space-y-1.5 text-xs text-muted-foreground">
        <li className="flex gap-2">
          <Check className="mt-0.5 h-3 w-3 shrink-0 text-emerald-400" /> Тренд на старшем таймфрейме направлен вверх
        </li>
        <li className="flex gap-2">
          <Check className="mt-0.5 h-3 w-3 shrink-0 text-emerald-400" /> Объёмы выше среднего за неделю
        </li>
        <li className="flex gap-2">
          <Check className="mt-0.5 h-3 w-3 shrink-0 text-emerald-400" /> Новостной фон нейтральный
        </li>
      </ul>
    </div>
  );
}

export function Landing({ signupOpen, billing, freePredictions, next }: LandingProps) {
  const loginHref = next === "/" ? "/login" : `/login?next=${encodeURIComponent(next)}`;
  const startHref = signupOpen ? `/login?mode=register${next === "/" ? "" : `&next=${encodeURIComponent(next)}`}` : loginHref;
  const startLabel = signupOpen ? "Начать бесплатно" : "Войти";

  return (
    <div className="min-h-[100dvh]">
      <header className="sticky top-0 z-40 border-b border-white/[0.06] bg-background/85 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2.5" aria-label="CryptoPredict">
            <BrandMark />
            <span className="text-[15px] font-semibold tracking-tight">CryptoPredict</span>
          </Link>
          <nav className="flex items-center gap-1 text-sm">
            <a href="#features" className="hidden rounded-lg px-3 py-1.5 text-muted-foreground hover:text-foreground sm:inline">
              Возможности
            </a>
            <a href="#pricing" className="hidden rounded-lg px-3 py-1.5 text-muted-foreground hover:text-foreground sm:inline">
              Цены
            </a>
            <Button asChild size="sm" variant="ghost" className="h-8 rounded-xl">
              <Link href={loginHref}>Войти</Link>
            </Button>
            {signupOpen && (
              <Button asChild size="sm" className="h-8 rounded-xl">
                <Link href={startHref}>Начать</Link>
              </Button>
            )}
          </nav>
        </div>
      </header>

      <main>
        {/* Hero */}
        <section className="mx-auto grid max-w-6xl items-center gap-12 px-4 pb-16 pt-14 sm:px-6 sm:pt-20 lg:grid-cols-[1.1fr_1fr] lg:pb-24">
          <div>
            <p className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-xs text-muted-foreground">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> Модели переобучаются каждую неделю
            </p>
            <h1 className="mt-5 font-display text-4xl font-bold leading-[1.1] tracking-tight sm:text-5xl">
              Прогнозы и готовые планы сделок по криптовалютам
            </h1>
            <p className="mt-5 max-w-xl text-base leading-relaxed text-muted-foreground sm:text-lg">
              Направление цены с вероятностью, уровни входа, цели и стопа — и честная статистика каждой сделки после комиссий.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Button asChild size="lg" className="h-12 rounded-xl px-6">
                <Link href={startHref}>
                  {startLabel} <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
              <Button asChild size="lg" variant="secondary" className="h-12 rounded-xl px-6">
                <a href="#features">Что внутри</a>
              </Button>
            </div>
            <p className="mt-4 text-xs text-muted-foreground">
              {signupOpen ? `${freePredictions} прогноза бесплатно после регистрации · без карты` : "Доступ по приглашению: аккаунты создаёт администратор"}
            </p>
          </div>
          <div className="mx-auto w-full max-w-sm lg:max-w-md">
            <ExampleCard />
          </div>
        </section>

        {/* Features */}
        <section id="features" className="scroll-mt-16 border-t border-white/[0.06]">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
            <h2 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">Что вы получаете</h2>
            <p className="mt-2 max-w-2xl text-muted-foreground">Всё, что нужно, чтобы решить, входить ли в сделку, — на одном экране.</p>
            <div className="mt-10 grid gap-4 sm:grid-cols-2">
              {FEATURES.map((f) => (
                <div key={f.title} className="rounded-2xl border border-white/[0.08] bg-card p-6">
                  <f.icon className="h-5 w-5 text-indigo-300" />
                  <h3 className="mt-4 font-semibold">{f.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{f.text}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Honesty */}
        <section className="border-t border-white/[0.06]">
          <div className="mx-auto grid max-w-6xl gap-8 px-4 py-16 sm:px-6 sm:py-20 lg:grid-cols-2">
            <div>
              <h2 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">Без красивых скриншотов</h2>
              <p className="mt-3 leading-relaxed text-muted-foreground">
                Большинство сигнальных каналов показывают только удачные сделки. Мы считаем каждую — с комиссией биржи и проскальзыванием, как
                если бы вы входили рыночным ордером.
              </p>
            </div>
            <ul className="space-y-3">
              {[
                { icon: Eye, text: "Итог каждой отправленной сделки открыт, включая убыточные" },
                { icon: ShieldCheck, text: "Модель, которая теряет деньги на живом рынке, отключается сама до переобучения" },
                { icon: BarChart3, text: "Точность каждой модели на данных, которых она не видела при обучении" },
              ].map((x) => (
                <li key={x.text} className="flex items-start gap-3 rounded-xl border border-white/[0.08] bg-card p-4 text-sm">
                  <x.icon className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                  {x.text}
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* How it works */}
        <section className="border-t border-white/[0.06]">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
            <h2 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">Как это работает</h2>
            <ol className="mt-10 grid gap-4 sm:grid-cols-3">
              {STEPS.map((s, i) => (
                <li key={s.title} className="rounded-2xl border border-white/[0.08] bg-card p-6">
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/[0.06] text-sm font-semibold">{i + 1}</span>
                  <h3 className="mt-4 font-semibold">{s.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{s.text}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Pricing */}
        <section id="pricing" className="scroll-mt-16 border-t border-white/[0.06]">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
            <h2 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">Цены</h2>
            <div className="mt-10 grid gap-4 md:grid-cols-2">
              <div className="rounded-2xl border border-white/[0.08] bg-card p-6">
                <p className="text-sm font-medium text-muted-foreground">Бесплатно</p>
                <p className="mt-2 font-display text-4xl font-bold">0</p>
                <ul className="mt-6 space-y-2.5 text-sm">
                  {[`${freePredictions} прогноза по любым монетам`, "Закрытые сделки с итогами", "Новые листинги OKX", "Точность моделей"].map((t) => (
                    <li key={t} className="flex gap-2">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" /> {t}
                    </li>
                  ))}
                </ul>
                <Button asChild variant="secondary" className="mt-8 w-full rounded-xl">
                  <Link href={startHref}>{startLabel}</Link>
                </Button>
              </div>
              <div className="relative rounded-2xl border border-indigo-400/40 bg-card p-6 ring-1 ring-indigo-400/20">
                <span className="absolute right-5 top-5 rounded-md bg-indigo-500/15 px-2 py-0.5 text-[11px] font-medium text-indigo-200">Подписка</span>
                <p className="text-sm font-medium text-muted-foreground">Полный доступ</p>
                <p className="mt-2 font-display text-4xl font-bold">
                  {billing ? billing.priceUsdt : "—"}
                  <span className="text-base font-normal text-muted-foreground"> USDT / {billing ? billing.periodDays : 30} дней</span>
                </p>
                <ul className="mt-6 space-y-2.5 text-sm">
                  {[
                    "Безлимитные прогнозы на любые сроки",
                    "Идущие сделки: план, уровни, график в реальном времени",
                    "Все карточки возможностей с причинами входа",
                    "Оплата в USDT (TRC20), без автосписаний",
                  ].map((t) => (
                    <li key={t} className="flex gap-2">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-indigo-300" /> {t}
                    </li>
                  ))}
                </ul>
                <Button asChild className="mt-8 w-full rounded-xl">
                  <Link href={signupOpen ? startHref : `/login?next=${encodeURIComponent("/?upgrade=1")}`}>
                    {signupOpen ? "Зарегистрироваться и оформить" : "Войти и оформить"}
                  </Link>
                </Button>
              </div>
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section className="border-t border-white/[0.06]">
          <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6 sm:py-20">
            <h2 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">Вопросы</h2>
            <div className="mt-8 divide-y divide-white/[0.06] rounded-2xl border border-white/[0.08] bg-card">
              {FAQ.map((f) => (
                <details key={f.q} className="group p-5">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium">
                    {f.q}
                    <span className="text-muted-foreground transition group-open:rotate-45">+</span>
                  </summary>
                  <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{f.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* Final call */}
        <section className="border-t border-white/[0.06]">
          <div className="mx-auto max-w-6xl px-4 py-16 text-center sm:px-6 sm:py-20">
            <h2 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">Посмотрите, что модель думает о вашей монете</h2>
            <Button asChild size="lg" className="mt-8 h-12 rounded-xl px-6">
              <Link href={startHref}>
                {startLabel} <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          </div>
        </section>
      </main>

      <footer className="border-t border-white/[0.06]">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-6 text-xs text-muted-foreground sm:px-6">
          <span>© {new Date().getFullYear()} CryptoPredict · Не является инвестиционной рекомендацией</span>
          <Link href="/terms" className="hover:text-foreground">
            Условия и риски
          </Link>
        </div>
      </footer>
    </div>
  );
}
