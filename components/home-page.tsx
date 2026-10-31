"use client";

import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, BarChart3, History, Sparkles } from "lucide-react";
import { Hero } from "@/components/hero";
import { MarketOverview } from "@/components/market-overview";
import { PredictionForm } from "@/components/prediction-form";
import { PredictionCard } from "@/components/prediction-card";
import { PredictionHistory } from "@/components/prediction-history";
import { ProgressBar } from "@/components/progress-bar";
import { ErrorAlert } from "@/components/error-alert";
import { AnalysisPanel } from "@/components/analysis-panel";
import { AccuracyPanel } from "@/components/accuracy-panel";
import { PortfolioPanel } from "@/components/portfolio-panel";
import { ExportActions } from "@/components/export-actions";
import { EmptyState } from "@/components/empty-state";
import { AuthDialog } from "@/components/auth-dialog";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { UpgradeDialog } from "@/components/upgrade-dialog";
import { TAB_IDS, TabNav, type TabId } from "@/components/tab-nav";
import { Button } from "@/components/ui/button";
import { useAccount } from "@/hooks/use-account";
import { usePrediction, usePredictionHistory } from "@/hooks/use-prediction";
import type { PredictionFormValues } from "@/lib/schemas";
import type { PredictionHistoryItem } from "@/types";
import { TIMEFRAME_LABELS, cn } from "@/lib/utils";
import { SignalsPanel } from "@/components/signals-panel";
import { ListingsPanel } from "@/components/listings-panel";
import { OpportunitiesPanel } from "@/components/opportunities-panel";

export function HomePage() {
  const { loading, error, result, progress, step, stepMessage, predict } = usePrediction();
  const { user, quota, refresh, register, login, logout } = useAccount();
  const { history, saveToHistory, clearHistory } = usePredictionHistory(!!user);
  const [tab, setTabState] = useState<TabId>("predict");
  // The tab lives in the URL (?tab=…), so a link or the back button from a card returns to it.
  const setTab = useCallback((next: TabId) => {
    setTabState(next);
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (next === "predict") url.searchParams.delete("tab");
    else url.searchParams.set("tab", next);
    window.history.replaceState(null, "", url.pathname + url.search + url.hash);
  }, []);
  // The tab content waits for the URL to be read, so a link to ?tab=… shows that tab at once
  // instead of the prediction tab animating out first.
  const [tabReady, setTabReady] = useState(false);
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("tab");
    if (t && (TAB_IDS as string[]).includes(t)) setTabState(t as TabId);
    setTabReady(true);
  }, []);
  const [repeatSymbol, setRepeatSymbol] = useState<string>();
  const [viewedHistoryItem, setViewedHistoryItem] = useState<PredictionHistoryItem | null>(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [authTab, setAuthTab] = useState<"login" | "register">("register");
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [confirmPredictOpen, setConfirmPredictOpen] = useState(false);
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);
  const [pendingForm, setPendingForm] = useState<PredictionFormValues | null>(null);

  const openRegister = useCallback(() => {
    setAuthTab("register");
    setAuthOpen(true);
  }, []);

  const openLogin = useCallback(() => {
    setAuthTab("login");
    setAuthOpen(true);
  }, []);

  const openUpgrade = useCallback(() => setUpgradeOpen(true), []);

  const runPrediction = useCallback(
    async (data: PredictionFormValues) => {
      setTab("predict");
      setViewedHistoryItem(null);
      const prediction = await predict(data);
      await refresh();
      if (prediction) {
        saveToHistory(prediction);
      }
    },
    [predict, saveToHistory, refresh]
  );

  const handleSubmit = useCallback(
    async (data: PredictionFormValues) => {
      if (quota && quota.remaining <= 0 && quota.tier !== "paid") {
        if (quota.requiresAuth) openRegister();
        else if (quota.requiresPayment) openUpgrade();
        return;
      }
      setPendingForm(data);
      setConfirmPredictOpen(true);
    },
    [quota, openRegister, openUpgrade]
  );

  // Admin pages redirect here with ?admin=required when nobody (or a non-admin) is signed in.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("admin") === "required" && !user) openLogin();
  }, [user, openLogin]);

  // ?upgrade=1 (from an opportunity card or a link) opens the subscription window.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("upgrade") === "1") setUpgradeOpen(true);
  }, []);

  useEffect(() => {
    if (error?.code === "QUOTA_EXCEEDED") {
      if (quota?.requiresPayment) openUpgrade();
      else if (quota?.requiresAuth) openRegister();
    }
  }, [error, quota, openUpgrade, openRegister]);

  const handleViewHistory = useCallback((item: PredictionHistoryItem) => {
    setViewedHistoryItem(item);
  }, []);

  const displayPrediction =
    viewedHistoryItem ?? (result && !loading ? result : null) ?? (!loading && !error && history[0] ? history[0] : null);
  const isFromHistoryOnly = !viewedHistoryItem && !result && !!history[0] && displayPrediction === history[0];
  const displayAnalysis = displayPrediction?.analysis ?? null;

  return (
    <main className="flex min-h-[100dvh] flex-col">
      <Hero
        user={user}
        quota={quota}
        onLogin={openLogin}
        onRegister={openRegister}
        onLogout={logout}
        onUpgrade={openUpgrade}
        nav={<TabNav active={tab} onChange={setTab} historyCount={history.length} />}
      />

      <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-4 py-5 sm:px-6 sm:py-6">
        {tab === "predict" && (
          <div className="mb-5">
            <MarketOverview />
          </div>
        )}
        <div className={cn("flex flex-1 flex-col gap-5", tab === "predict" && "lg:grid lg:grid-cols-[340px_minmax(0,1fr)] lg:items-start lg:gap-6")}>
          {tab === "predict" && (
            <div className="space-y-4 lg:sticky lg:top-28">
              <PredictionForm
                onSubmit={handleSubmit}
                loading={loading}
                defaultSymbol={repeatSymbol}
                quota={quota}
                onNeedAuth={openRegister}
                onNeedUpgrade={openUpgrade}
              />
            </div>
          )}

          <section className="flex min-h-0 flex-1 flex-col">
            {tabReady && (
            <AnimatePresence mode="wait" initial={false}>
              {tab === "predict" && (
                <motion.div
                  key="predict"
                  initial={{ opacity: 0, x: 12 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -12 }}
                  transition={{ duration: 0.25 }}
                  className="flex flex-1 flex-col gap-4"
                >
                  {loading ? (
                    <ProgressBar
                      variant="hero"
                      progress={progress}
                      step={step}
                      message={stepMessage}
                    />
                  ) : displayPrediction ? (
                    <>
                      {(viewedHistoryItem || isFromHistoryOnly) && (
                        <div className="flex items-center gap-3">
                          {viewedHistoryItem && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="rounded-xl"
                              onClick={() => {
                                setViewedHistoryItem(null);
                                setTab("history");
                              }}
                            >
                              <ArrowLeft className="h-4 w-4" /> К истории
                            </Button>
                          )}
                          <span className="text-xs text-muted-foreground">
                            {viewedHistoryItem ? "Сохранённый прогноз" : "Последний прогноз"}
                            {" · "}
                            {TIMEFRAME_LABELS[displayPrediction.timeframe]}
                          </span>
                        </div>
                      )}
                      <PredictionCard prediction={displayPrediction} />
                      <ExportActions prediction={displayPrediction} />
                    </>
                  ) : error ? (
                    <ErrorAlert
                      error={error}
                      onAction={
                        error.code === "QUOTA_EXCEEDED"
                          ? quota?.requiresPayment
                            ? openUpgrade
                            : openRegister
                          : undefined
                      }
                      actionLabel={
                        error.code === "QUOTA_EXCEEDED"
                          ? quota?.requiresPayment
                            ? "Купить доступ"
                            : "Зарегистрироваться"
                          : undefined
                      }
                    />
                  ) : (
                    <EmptyState
                      icon={Sparkles}
                      title="Готов к анализу"
                      description="Выберите монету, рынок и таймфрейм — AI проанализирует 18+ индикаторов и сформирует прогноз."
                      action="Выберите монету в форме"
                    />
                  )}
                </motion.div>
              )}

              {tab === "analysis" && (
                <motion.div key="analysis" initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} className="flex-1 min-h-[40vh]">
                  {displayAnalysis && displayPrediction ? (
                    <AnalysisPanel analysis={displayAnalysis} prediction={displayPrediction} />
                  ) : (
                    <EmptyState icon={BarChart3} title="Данные анализа" description="Здесь отобразятся все индикаторы и рыночные данные, переданные в AI." action="Сначала получите прогноз" />
                  )}
                </motion.div>
              )}

              {tab === "history" && (
                <motion.div key="history" initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} className="flex-1 min-h-[40vh]">
                  {history.length > 0 ? (
                    <PredictionHistory
                      history={history}
                      onView={(item) => {
                        handleViewHistory(item);
                        setTab("predict");
                      }}
                      onRepeat={(item) => {
                        setViewedHistoryItem(null);
                        setRepeatSymbol(item.symbol);
                        handleSubmit({ coinSymbol: item.symbol, market: item.market, timeframe: item.timeframe });
                      }}
                      onClear={() => setConfirmClearOpen(true)}
                    />
                  ) : (
                    <EmptyState icon={History} title="История пуста" description="Последние прогнозы сохраняются автоматически. Можно повторить любой из них." />
                  )}
                </motion.div>
              )}

              {tab === "accuracy" && (
                <motion.div key="accuracy" initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} className="flex flex-1 flex-col gap-4 min-h-[40vh]">
                  <PortfolioPanel history={history} />
                  <AccuracyPanel history={history} />
                </motion.div>
              )}

              {tab === "opportunities" && (
                <motion.div key="opportunities" initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} className="flex flex-1 flex-col gap-4 min-h-[40vh]">
                  <OpportunitiesPanel onUpgrade={openUpgrade} />
                </motion.div>
              )}

              {tab === "signals" && (
                <motion.div key="signals" initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} className="flex flex-1 flex-col gap-4 min-h-[40vh]">
                  <SignalsPanel />
                </motion.div>
              )}

              {tab === "listings" && (
                <motion.div key="listings" initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} className="flex flex-1 flex-col gap-4 min-h-[40vh]">
                  <ListingsPanel />
                </motion.div>
              )}
            </AnimatePresence>
            )}
          </section>
        </div>
      </div>

      <AuthDialog
        open={authOpen}
        onOpenChange={setAuthOpen}
        defaultTab={authTab}
        onLogin={login}
        onRegister={register}
      />

      <UpgradeDialog open={upgradeOpen} onOpenChange={setUpgradeOpen} onNeedAuth={openRegister} onPaid={() => void refresh()} />

      <ConfirmDialog
        open={confirmPredictOpen}
        onOpenChange={setConfirmPredictOpen}
        title="Запустить прогноз?"
        description={`Будет использован 1 прогноз. Осталось: ${quota?.remaining ?? "?"}`}
        confirmLabel="Запустить"
        onConfirm={() => pendingForm && runPrediction(pendingForm)}
      />
      <ConfirmDialog
        open={confirmClearOpen}
        onOpenChange={setConfirmClearOpen}
        title="Очистить историю?"
        description="История будет удалена локально и на сервере. Точность и итог P&L тоже очистятся."
        confirmLabel="Очистить"
        variant="destructive"
        onConfirm={() => {
          void clearHistory();
          setViewedHistoryItem(null);
        }}
      />

      <footer className="relative mt-auto shrink-0 border-t border-white/[0.06] py-5 text-center text-xs text-muted-foreground">
        CryptoPredict © {new Date().getFullYear()} · Аналитика, а не финансовая рекомендация
      </footer>
    </main>
  );
}
