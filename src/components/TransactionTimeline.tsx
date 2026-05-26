import { useEffect, useState } from "react";
import { addDays, addMonths, addYears, format, parseISO, subDays, subMonths, subYears } from "date-fns";
import type { Account, Category, Transaction } from "../types/finance";

type TimeView = "day" | "month" | "year";

interface Props {
  transactions: Transaction[];
  categories: Category[];
  accounts: Account[];
  onEdit: (tx: Transaction) => void;
  onDelete: (id: string) => void;
  focusDate: string;
}

const fmt = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" });
const fmtShort = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

export default function TransactionTimeline({
  transactions,
  categories,
  accounts,
  onEdit,
  onDelete,
  focusDate,
}: Props) {
  const [view, setView]             = useState<TimeView>("day");
  const [cursorDate, setCursorDate] = useState(() => new Date(focusDate + "T00:00:00"));

  const catMap = new Map(categories.map((c) => [c.id, c]));
  const acMap  = new Map(accounts.map((a) => [a.id, a]));

  // Jump to day view at the newly-added transaction's date
  useEffect(() => {
    setCursorDate(new Date(focusDate + "T00:00:00"));
    setView("day");
  }, [focusDate]);

  // ── Single transaction row ────────────────────────
  function renderTxRow(tx: Transaction) {
    const cat = catMap.get(tx.categoryId ?? "");
    const ac  = acMap.get(tx.accountId ?? "");
    const fromAc = acMap.get(tx.fromAccountId ?? "");
    const toAc = acMap.get(tx.toAccountId ?? "");
    const subtitle =
      tx.kind === "transfer"
        ? `Transfer: ${fromAc?.name ?? "Unknown"} -> ${toAc?.name ?? "Unknown"}`
        : `${cat?.name ?? "Uncategorized"}${ac ? ` · ${ac.name}` : ""}`;
    const amountClass = tx.kind === "income" ? "plus" : tx.kind === "expense" ? "minus" : "neutral";
    const amountPrefix = tx.kind === "income" ? "+" : tx.kind === "expense" ? "−" : "";

    return (
      <article key={tx.id} className="transaction-item">
        <div className="transaction-main">
          <h3>{tx.title}</h3>
          <p>{subtitle}</p>
          {tx.note && <small>{tx.note}</small>}
        </div>
        <div className="transaction-meta">
          <strong className={amountClass}>
            {amountPrefix}
            {fmt.format(tx.amount)}
          </strong>
          <div className="transaction-actions">
            <button
              type="button"
              className="ghost-btn icon-btn"
              aria-label="Edit transaction"
              onClick={() => onEdit(tx)}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M3 21l3.8-1 11-11a2.1 2.1 0 0 0 0-3l-.8-.8a2.1 2.1 0 0 0-3 0L3 16.2 2 20.9Z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                <path d="m13.5 5.5 5 5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </button>
            <button
              type="button"
              className="ghost-btn icon-btn"
              aria-label="Delete transaction"
              onClick={() => onDelete(tx.id)}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M4 7h16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                <path d="M9 4h6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                <path d="M7 7v11a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2V7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M10 11v6M14 11v6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </div>
      </article>
    );
  }

  // ── Day totals helper ─────────────────────────────
  function DayTotals({ txs }: { txs: Transaction[] }) {
    const income  = txs.filter((t) => t.kind === "income").reduce((s, t) => s + t.amount, 0);
    const expense = txs.filter((t) => t.kind === "expense").reduce((s, t) => s + t.amount, 0);
    if (txs.length === 0) return null;
    return (
      <div className="timeline-day-totals">
        {income  > 0 && <span className="plus">+{fmtShort.format(income)}</span>}
        {expense > 0 && <span className="minus">−{fmtShort.format(expense)}</span>}
      </div>
    );
  }

  // ── DAY VIEW ──────────────────────────────────────
  function renderDayView() {
    const dateStr = format(cursorDate, "yyyy-MM-dd");
    const txs = transactions
      .filter((t) => t.date === dateStr)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    return (
      <>
        <div className="timeline-nav">
          <button type="button" className="ghost-btn timeline-arrow" onClick={() => setCursorDate((d) => subDays(d, 1))}>
            ←
          </button>
          <div className="timeline-date-label">
            <h3>{format(cursorDate, "EEEE")}</h3>
            <p>{format(cursorDate, "dd MMMM yyyy")}</p>
          </div>
          <button type="button" className="ghost-btn timeline-arrow" onClick={() => setCursorDate((d) => addDays(d, 1))}>
            →
          </button>
        </div>
        <DayTotals txs={txs} />
        {txs.length === 0 ? (
          <p className="empty-state">No transactions on this day.</p>
        ) : (
          <div className="transaction-list">{txs.map(renderTxRow)}</div>
        )}
      </>
    );
  }

  // ── MONTH VIEW ────────────────────────────────────
  function renderMonthView() {
    const monthStr = format(cursorDate, "yyyy-MM");
    const monthTxs = transactions.filter((t) => t.date.startsWith(monthStr));
    const monthIncome = monthTxs.filter((t) => t.kind === "income").reduce((s, t) => s + t.amount, 0);
    const monthExpense = monthTxs.filter((t) => t.kind === "expense").reduce((s, t) => s + t.amount, 0);
    const byDay = transactions
      .filter((t) => t.date.startsWith(monthStr))
      .reduce<Record<string, Transaction[]>>((acc, t) => {
        (acc[t.date] = acc[t.date] || []).push(t);
        return acc;
      }, {});
    const sortedDays = Object.keys(byDay).sort((a, b) => b.localeCompare(a));

    return (
      <>
        <div className="timeline-nav">
          <button type="button" className="ghost-btn timeline-arrow" onClick={() => setCursorDate((d) => subMonths(d, 1))}>
            ←
          </button>
          <div className="timeline-date-label">
            <h3>{format(cursorDate, "MMMM yyyy")}</h3>
            <p>
              {sortedDays.length} active day{sortedDays.length !== 1 ? "s" : ""}
            </p>
          </div>
          <button type="button" className="ghost-btn timeline-arrow" onClick={() => setCursorDate((d) => addMonths(d, 1))}>
            →
          </button>
        </div>
        <div className="timeline-day-totals">
          <span className="plus">+{fmtShort.format(monthIncome)}</span>
          <span className="minus">−{fmtShort.format(monthExpense)}</span>
        </div>

        {sortedDays.length === 0 ? (
          <p className="empty-state">No transactions this month.</p>
        ) : (
          sortedDays.map((dateStr) => {
            const txs = byDay[dateStr].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
            return (
              <div key={dateStr} className="month-day-group">
                <div
                  className="month-day-header"
                  onClick={() => {
                    setCursorDate(new Date(dateStr + "T00:00:00"));
                    setView("day");
                  }}
                >
                  <span className="month-day-num">{format(parseISO(dateStr), "d")}</span>
                  <span className="month-day-name">{format(parseISO(dateStr), "EEE")}</span>
                  <DayTotals txs={txs} />
                </div>
                <div className="transaction-list">{txs.map(renderTxRow)}</div>
              </div>
            );
          })
        )}
      </>
    );
  }

  // ── YEAR VIEW ─────────────────────────────────────
  function renderYearView() {
    const year = format(cursorDate, "yyyy");
    const months = Array.from({ length: 12 }, (_, i) => {
      const monthStr = `${year}-${String(i + 1).padStart(2, "0")}`;
      const txs      = transactions.filter((t) => t.date.startsWith(monthStr));
      const income   = txs.filter((t) => t.kind === "income").reduce((s, t) => s + t.amount, 0);
      const expense  = txs.filter((t) => t.kind === "expense").reduce((s, t) => s + t.amount, 0);
      return { monthStr, label: format(new Date(Number(year), i, 1), "MMMM"), income, expense, count: txs.length };
    });

    return (
      <>
        <div className="timeline-nav">
          <button type="button" className="ghost-btn timeline-arrow" onClick={() => setCursorDate((d) => subYears(d, 1))}>
            ←
          </button>
          <div className="timeline-date-label">
            <h3>{year}</h3>
            <p>{transactions.filter((t) => t.date.startsWith(year)).length} transactions</p>
          </div>
          <button type="button" className="ghost-btn timeline-arrow" onClick={() => setCursorDate((d) => addYears(d, 1))}>
            →
          </button>
        </div>

        <div className="year-grid">
          {months.map((m) => (
            <div
              key={m.monthStr}
              className={`year-month-card panel${m.count === 0 ? " dim" : ""}`}
              onClick={() => {
                setCursorDate(new Date(m.monthStr + "-01T00:00:00"));
                setView("month");
              }}
            >
              <p className="year-month-name">{m.label}</p>
              {m.count > 0 ? (
                <>
                  <span className="plus">{fmtShort.format(m.income)}</span>
                  <span className="minus">−{fmtShort.format(m.expense)}</span>
                </>
              ) : (
                <span className="year-month-empty">—</span>
              )}
            </div>
          ))}
        </div>
      </>
    );
  }

  return (
    <section className="timeline-panel panel">
      <div className="panel-header-row">
        <h2>Transactions</h2>
        <div className="view-tabs">
          {(["day", "month", "year"] as TimeView[]).map((v) => (
            <button
              key={v}
              type="button"
              className={`view-tab-btn${view === v ? " active" : ""}`}
              onClick={() => setView(v)}
            >
              {v.charAt(0).toUpperCase() + v.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {view === "day"   && renderDayView()}
      {view === "month" && renderMonthView()}
      {view === "year"  && renderYearView()}
    </section>
  );
}
