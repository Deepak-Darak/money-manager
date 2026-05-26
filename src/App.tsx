import { useMemo, useState } from "react";
import AccountsPage from "./components/AccountsPage";
import ChartsDashboard from "./components/ChartsDashboard";
import ExpenseChart from "./components/ExpenseChart";
import Navigation, { type Tab } from "./components/Navigation";
import TransactionForm, { type NewTransactionInput } from "./components/TransactionForm";
import TransactionTimeline from "./components/TransactionTimeline";
import { defaultAccountTypes } from "./data/accountGroups";
import { categories } from "./data/categories";
import { useLocalStorage } from "./hooks/useLocalStorage";
import type { Account, AccountType, Transaction } from "./types/finance";

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

function slugify(input: string) {
  return input.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function applyTransactionEffect(currentAccounts: Account[], tx: Transaction, direction: 1 | -1) {
  const next = [...currentAccounts];

  function adjustBalance(accountId: string | undefined, delta: number) {
    if (!accountId) {
      return;
    }
    const index = next.findIndex((a) => a.id === accountId);
    if (index >= 0) {
      next[index] = {
        ...next[index],
        balance: next[index].balance + delta
      };
    }
  }

  if (tx.kind === "income") {
    adjustBalance(tx.accountId, tx.amount * direction);
    return next;
  }

  if (tx.kind === "expense") {
    adjustBalance(tx.accountId, -tx.amount * direction);
    return next;
  }

  if (tx.kind === "transfer") {
    adjustBalance(tx.fromAccountId, -tx.amount * direction);
    adjustBalance(tx.toAccountId, tx.amount * direction);
  }

  return next;
}

export default function App() {
  const [transactions, setTransactions] = useLocalStorage<Transaction[]>("mm-transactions", []);
  const [accounts, setAccounts] = useLocalStorage<Account[]>("mm-accounts", []);
  const [accountTypes, setAccountTypes] = useLocalStorage<AccountType[]>(
    "mm-account-types",
    defaultAccountTypes
  );
  const [activeTab, setActiveTab] = useState<Tab>("dashboard");
  const [focusDate, setFocusDate] = useState(getTodayString);
  const [editingTransactionId, setEditingTransactionId] = useState<string | null>(null);
  const [dashboardMonth, setDashboardMonth] = useState(getCurrentMonth);

  const totalAssets = accounts.filter((a) => a.type === "asset").reduce((sum, a) => sum + a.balance, 0);
  const totalLiabilities = accounts
    .filter((a) => a.type === "liability")
    .reduce((sum, a) => sum + a.balance, 0);
  const currentTotalBalance = totalAssets - totalLiabilities;

  const monthOptions = useMemo(() => {
    const allMonths = Array.from(new Set(transactions.map((t) => t.date.slice(0, 7))));
    if (!allMonths.includes(getCurrentMonth())) {
      allMonths.push(getCurrentMonth());
    }
    return allMonths.sort((a, b) => b.localeCompare(a));
  }, [transactions]);

  const dashboardExpenseTransactions = transactions.filter(
    (t) => t.kind === "expense" && t.date.startsWith(dashboardMonth)
  );

  const editingTransaction = editingTransactionId
    ? transactions.find((t) => t.id === editingTransactionId)
    : undefined;

  function addTransaction(payload: NewTransactionInput) {
    const nextTransaction: Transaction = {
      ...payload,
      id: makeId(),
      createdAt: new Date().toISOString()
    };

    setTransactions((current) => [
      nextTransaction,
      ...current
    ]);

    setAccounts((current) => applyTransactionEffect(current, nextTransaction, 1));
    setFocusDate(payload.date);
    setActiveTab("transactions");
  }

  function updateTransaction(payload: NewTransactionInput) {
    if (!editingTransactionId) {
      return;
    }

    const oldTransaction = transactions.find((t) => t.id === editingTransactionId);
    if (!oldTransaction) {
      return;
    }

    const updatedTransaction: Transaction = {
      ...oldTransaction,
      ...payload
    };

    setTransactions((current) =>
      current.map((t) => (t.id === editingTransactionId ? updatedTransaction : t))
    );

    setAccounts((current) => {
      const reverted = applyTransactionEffect(current, oldTransaction, -1);
      return applyTransactionEffect(reverted, updatedTransaction, 1);
    });

    setFocusDate(payload.date);
    setEditingTransactionId(null);
  }

  function deleteTransaction(id: string) {
    const oldTransaction = transactions.find((t) => t.id === id);
    setTransactions((current) => current.filter((transaction) => transaction.id !== id));
    if (oldTransaction) {
      setAccounts((current) => applyTransactionEffect(current, oldTransaction, -1));
    }
    if (editingTransactionId === id) {
      setEditingTransactionId(null);
    }
  }

  function addAccount(data: Omit<Account, "id" | "createdAt">) {
    setAccounts((current) => [
      ...current,
      { ...data, id: makeId(), createdAt: new Date().toISOString() },
    ]);
  }

  function addAccountType(data: Omit<AccountType, "id">) {
    setAccountTypes((current) => {
      const baseId = slugify(data.label) || "custom-type";
      let id = baseId;
      let counter = 2;
      while (current.some((t) => t.id === id)) {
        id = `${baseId}-${counter}`;
        counter += 1;
      }

      return [...current, { ...data, id }];
    });
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
          <section className="panel net-balance-card">
            <p>Current Total Balance (Assets - Liabilities)</p>
            <h2 className={currentTotalBalance >= 0 ? "plus" : "minus"}>
              ₹{Math.round(currentTotalBalance).toLocaleString("en-IN")}
            </h2>
            <div className="balance-split-row">
              <span className="plus">Assets: ₹{Math.round(totalAssets).toLocaleString("en-IN")}</span>
              <span className="minus">Liabilities: ₹{Math.round(totalLiabilities).toLocaleString("en-IN")}</span>
            </div>
          </section>

          <section className="panel budget-section">
            <label>
              Expense Month Filter
              <select value={dashboardMonth} onChange={(e) => setDashboardMonth(e.target.value)}>
                {monthOptions.map((month) => (
                  <option key={month} value={month}>
                    {month}
                  </option>
                ))}
              </select>
            </label>
          </section>

          <ExpenseChart
            transactions={dashboardExpenseTransactions}
            categories={categories}
            label={dashboardMonth}
          />

          <TransactionForm
            categories={categories}
            accounts={accounts}
            onAddTransaction={addTransaction}
            formTitle="Add Transaction"
          />
        </div>
      )}

      {/* ── Transactions ──────────────────────────── */}
      {activeTab === "transactions" && (
        <div className="tab-content">
          <TransactionForm
            categories={categories}
            accounts={accounts}
            onAddTransaction={editingTransaction ? updateTransaction : addTransaction}
            formTitle={editingTransaction ? "Edit Transaction" : "Add Transaction"}
            submitLabel={editingTransaction ? "Update Transaction" : "Save Transaction"}
            initialValue={editingTransaction}
            onCancel={editingTransaction ? () => setEditingTransactionId(null) : undefined}
          />

          <TransactionTimeline
            transactions={transactions}
            categories={categories}
            accounts={accounts}
            onEdit={(tx) => {
              setEditingTransactionId(tx.id);
              setFocusDate(tx.date);
            }}
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
            accountTypes={accountTypes}
            onAdd={addAccount}
            onAddType={addAccountType}
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
