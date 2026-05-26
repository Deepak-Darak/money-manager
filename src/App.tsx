import { useEffect, useMemo, useRef, useState } from "react";
import AccountsPage from "./components/AccountsPage";
import ChartsDashboard from "./components/ChartsDashboard";
import ExpenseChart from "./components/ExpenseChart";
import Navigation, { type Tab } from "./components/Navigation";
import TransactionForm, { type NewTransactionInput } from "./components/TransactionForm";
import TransactionTimeline from "./components/TransactionTimeline";
import { defaultAccountTypes } from "./data/accountGroups";
import { categories } from "./data/categories";
import { useLocalStorage } from "./hooks/useLocalStorage";
import type { Account, AccountType, AppDataSnapshot, Transaction } from "./types/finance";

const SYNC_ENDPOINT = import.meta.env.VITE_SYNC_ENDPOINT ?? "";
const APP_PASSWORD = import.meta.env.VITE_APP_PASSWORD ?? "";

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

function formatSyncError(error: unknown) {
  if (error instanceof TypeError) {
    return "Cannot reach the Google Apps Script sync endpoint. Redeploy the web app as Anyone, use the latest /exec URL, and update VITE_SYNC_ENDPOINT if it changed.";
  }

  if (error instanceof Error && /failed to fetch|load failed/i.test(error.message)) {
    return "Cannot reach the Google Apps Script sync endpoint. Redeploy the web app as Anyone, use the latest /exec URL, and update VITE_SYNC_ENDPOINT if it changed.";
  }

  return error instanceof Error ? error.message : "Cloud sync failed.";
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

interface AuthLoginFormProps {
  appPassword: string;
  syncEndpoint: string;
  onSuccess: (email: string, token: string) => void;
  onError: (message: string) => void;
}

function AuthLoginForm({ appPassword, syncEndpoint, onSuccess, onError }: AuthLoginFormProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    
    if (!email || !password) {
      onError("Email and password are required.");
      return;
    }

    if (!syncEndpoint) {
      onError("Sync endpoint is not configured.");
      return;
    }

    if (!appPassword) {
      onError("App password is not configured.");
      return;
    }

    setIsLoading(true);
    try {
      const response = await fetch(syncEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ action: "verify", email, password })
      });

      if (!response.ok) {
        onError("Authentication failed.");
        return;
      }

      const result = (await response.json()) as {
        ok: boolean;
        message?: string;
      };

      if (!result.ok) {
        onError(result.message || "Incorrect password.");
        return;
      }

      onSuccess(email, password);
    } catch (error) {
      onError(error instanceof Error ? error.message : "Authentication error.");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="auth-login-form">
      <input
        type="email"
        placeholder="Email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        disabled={isLoading}
        required
      />
      <input
        type="password"
        placeholder="Password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        disabled={isLoading}
        required
      />
      <button type="submit" disabled={isLoading}>
        {isLoading ? "Signing in..." : "Sign In"}
      </button>
    </form>
  );
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
  const [userEmail, setUserEmail] = useState(() => window.localStorage.getItem("mm-user-email") ?? "");
  const [authToken, setAuthToken] = useState(() => window.localStorage.getItem("mm-auth-token") ?? "");
  const [authStatus, setAuthStatus] = useState("Enter email and password to continue.");
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastPulledToken, setLastPulledToken] = useState("");
  const skipNextAutoPush = useRef(false);

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

  const snapshot: AppDataSnapshot = {
    version: 1,
    transactions,
    accounts,
    accountTypes
  };

  useEffect(() => {
    if (userEmail) {
      window.localStorage.setItem("mm-user-email", userEmail);
    } else {
      window.localStorage.removeItem("mm-user-email");
    }
  }, [userEmail]);

  useEffect(() => {
    if (authToken) {
      window.localStorage.setItem("mm-auth-token", authToken);
    } else {
      window.localStorage.removeItem("mm-auth-token");
    }
  }, [authToken]);

  async function syncRequest(action: "push" | "pull", email: string, token: string) {
    if (!SYNC_ENDPOINT) {
      throw new Error("Cloud sync endpoint is not configured.");
    }

    const response = await fetch(SYNC_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ action, email, password: token, payload: snapshot })
    });

    if (!response.ok) {
      throw new Error(`Sync request failed (${response.status}).`);
    }

    const result = (await response.json()) as {
      ok: boolean;
      message?: string;
      data?: AppDataSnapshot;
    };

    if (!result.ok) {
      throw new Error(result.message || "Sync rejected.");
    }

    return result;
  }

  function importSnapshot(next: AppDataSnapshot) {
    setTransactions(next.transactions ?? []);
    setAccounts(next.accounts ?? []);
    setAccountTypes(next.accountTypes?.length ? next.accountTypes : defaultAccountTypes);
    setEditingTransactionId(null);
  }

  async function pullFromCloud(email: string, token: string) {
    setIsSyncing(true);
    try {
      const result = await syncRequest("pull", email, token);
      if (result.data) {
        skipNextAutoPush.current = true;
        importSnapshot(result.data);
      }
      setAuthStatus("Data loaded from Google Sheets.");
      setLastPulledToken(token);
    } catch (error) {
      setAuthStatus(formatSyncError(error));
    } finally {
      setIsSyncing(false);
    }
  }

  async function pushToCloud(email: string, token: string) {
    if (!token || !SYNC_ENDPOINT) {
      return;
    }
    setIsSyncing(true);
    try {
      await syncRequest("push", email, token);
      setAuthStatus(`Synced for ${email}.`);
    } catch (error) {
      setAuthStatus(formatSyncError(error));
    } finally {
      setIsSyncing(false);
    }
  }

  useEffect(() => {
    if (!authToken || !userEmail || !SYNC_ENDPOINT) {
      return;
    }
    if (lastPulledToken === authToken) {
      return;
    }
    void pullFromCloud(userEmail, authToken);
  }, [authToken, userEmail, lastPulledToken]);

  useEffect(() => {
    if (!authToken || !userEmail || !SYNC_ENDPOINT) {
      return;
    }
    if (lastPulledToken !== authToken) {
      return;
    }

    if (skipNextAutoPush.current) {
      skipNextAutoPush.current = false;
      return;
    }

    const timer = window.setTimeout(() => {
      void pushToCloud(userEmail, authToken);
    }, 1800);

    return () => {
      window.clearTimeout(timer);
    };
  }, [snapshot, authToken, userEmail, lastPulledToken]);

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

  function deleteAccountType(id: string) {
    const accountIdsToRemove = accounts.filter((a) => a.group === id).map((a) => a.id);

    if (accountIdsToRemove.length > 0) {
      setAccounts((current) => current.filter((account) => account.group !== id));
      setTransactions((current) =>
        current.map((tx) => ({
          ...tx,
          accountId: tx.accountId && accountIdsToRemove.includes(tx.accountId) ? undefined : tx.accountId,
          fromAccountId:
            tx.fromAccountId && accountIdsToRemove.includes(tx.fromAccountId)
              ? undefined
              : tx.fromAccountId,
          toAccountId:
            tx.toAccountId && accountIdsToRemove.includes(tx.toAccountId) ? undefined : tx.toAccountId
        }))
      );
    }

    setAccountTypes((current) => current.filter((type) => type.id !== id));
    return true;
  }

  function deleteAccount(id: string) {
    setAccounts((current) => current.filter((a) => a.id !== id));
  }

  if (!authToken) {
    return (
      <div className="auth-gate-wrap">
        <div className="auth-gate-card panel">
          <p className="eyebrow">Money Manager</p>
          <h1>Sign in to access your personal dashboard</h1>
          <p className="auth-gate-text">
            Enter your email and password to access your money manager. Your data will be stored securely in Google Sheets.
          </p>
          <AuthLoginForm
            appPassword={APP_PASSWORD}
            syncEndpoint={SYNC_ENDPOINT}
            onSuccess={(email, token) => {
              setUserEmail(email);
              setAuthToken(token);
              setAuthStatus("Signed in. Loading your data...");
            }}
            onError={(message) => setAuthStatus(message)}
          />
          <p className="auth-gate-note">{authStatus}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <div className="background-layers" aria-hidden="true" />

      <section className="panel session-strip">
        <div>
          <strong>Money Manager</strong>
          <p>{userEmail}</p>
        </div>
        <div className="session-strip-actions">
          <span>{isSyncing ? "Syncing..." : authStatus}</span>
          <button
            type="button"
            className="ghost-btn"
            onClick={() => {
              setUserEmail("");
              setAuthToken("");
              setLastPulledToken("");
              setTransactions([]);
              setAccounts([]);
              setAccountTypes(defaultAccountTypes);
              setAuthStatus("Signed out.");
            }}
          >
            Sign Out
          </button>
        </div>
      </section>

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

          <div className="dashboard-form-section">
            <TransactionForm
              categories={categories}
              accounts={accounts}
              onAddTransaction={addTransaction}
              formTitle="Add Transaction"
            />
          </div>
        </div>
      )}

      {/* ── Transactions ──────────────────────────── */}
      {activeTab === "transactions" && (
        <div className="tab-content">
          {editingTransaction && (
            <TransactionForm
              categories={categories}
              accounts={accounts}
              onAddTransaction={updateTransaction}
              formTitle="Edit Transaction"
              submitLabel="Update Transaction"
              initialValue={editingTransaction}
              onCancel={() => setEditingTransactionId(null)}
            />
          )}

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
            onDeleteType={deleteAccountType}
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
