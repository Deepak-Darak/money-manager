import { useMemo, useState } from "react";
import AccountsPage from "./components/AccountsPage";
import ChartsDashboard from "./components/ChartsDashboard";
import Navigation, { type Tab } from "./components/Navigation";
import SummaryCards from "./components/SummaryCards";
import TransactionForm, { type NewTransactionInput } from "./components/TransactionForm";
import TransactionTimeline from "./components/TransactionTimeline";
import { categories } from "./data/categories";
import { useLocalStorage } from "./hooks/useLocalStorage";
import type { Account, Transaction } from "./types/finance";

function makeId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function getTodayString() {
  return new Date().toISOString().slice(0, 10);
}

function getCurrentMonth() {
  return new Date().toISOString().slice(0, 7);
}

export default function App() {
  const [transactions, setTransactions] = useLocalStorage<Transaction[]>("mm-transactions", []);
  const [accounts, setAccounts]         = useLocalStorage<Account[]>("mm-accounts", []);
  const [monthBudget, setMonthBudget]   = useLocalStorage<number>("mm-month-budget", 0);
  const [activeTab, setActiveTab]       = useState<Tab>("dashboard");
  const [focusDate, setFocusDate]       = useState(getTodayString);

  const totals = useMemo(() => {
    const income  = transactions.filter((t) => t.kind === "income").reduce((s, t) => s + t.amount, 0);
    const expense = transactions.filter((t) => t.kind === "expense").reduce((s, t) => s + t.amount, 0);
    return { income, expense, balance: income - expense };
  }, [transactions]);

  const monthExpense = transactions
    .filter((t) => t.kind === "expense" && t.date.startsWith(getCurrentMonth()))
    .reduce((s, t) => s + t.amount, 0);

  function addTransaction(payload: NewTransactionInput) {
    setTransactions((current) => [
      {
        ...payload,
        id: makeId(),
        createdAt: new Date().toISOString(),
      },
      ...current
    ]);
    setFocusDate(payload.date);
    setActiveTab("transactions");
  }

  function deleteTransaction(id: string) {
    setTransactions((current) => current.filter((transaction) => transaction.id !== id));
  }

  function addAccount(data: Omit<Account, "id" | "createdAt">) {
    setAccounts((current) => [
      ...current,
      { ...data, id: makeId(), createdAt: new Date().toISOString() },
    ]);
  }

  function deleteAccount(id: string) {
    setAccounts((current) => current.filter((a) => a.id !== id));
  }

  return (
    <div className="app-shell">
      <div className="background-layers" aria-hidden="true" />

      <Navigation activeTab={activeTab} onChange={setActiveTab} />

      {/* ── Dashboard ─────────────────────────────── */}
      {activeTab === "dashboard" && (
        <div className="tab-content">
          <header className="hero">
            <p className="eyebrow">Money Manager</p>
            <h1>Track every rupee, steer your future.</h1>
            <p>Add a transaction below — it will appear instantly in your timeline.</p>
          </header>

          <SummaryCards
            income={totals.income}
            expense={totals.expense}
            balance={totals.balance}
            monthBudget={monthBudget}
            monthExpense={monthExpense}
          />

          <section className="panel budget-section">
            <label>
              Monthly Budget (₹)
              <input
                type="number"
                min={0}
                step="100"
                value={monthBudget}
                onChange={(e) => setMonthBudget(Number(e.target.value) || 0)}
              />
            </label>
          </section>

          <TransactionForm
            categories={categories}
            accounts={accounts}
            onAddTransaction={addTransaction}
          />
        </div>
      )}

      {/* ── Transactions ──────────────────────────── */}
      {activeTab === "transactions" && (
        <div className="tab-content">
          <TransactionTimeline
            transactions={transactions}
            categories={categories}
            accounts={accounts}
            onDelete={deleteTransaction}
            focusDate={focusDate}
          />
        </div>
      )}

      {/* ── Accounts ──────────────────────────────── */}
      {activeTab === "accounts" && (
        <div className="tab-content">
          <AccountsPage
            accounts={accounts}
            onAdd={addAccount}
            onDelete={deleteAccount}
          />
        </div>
      )}

      {/* ── Charts ────────────────────────────────── */}
      {activeTab === "charts" && (
        <div className="tab-content">
          <ChartsDashboard transactions={transactions} categories={categories} />
        </div>
      )}
    </div>
  );
}
