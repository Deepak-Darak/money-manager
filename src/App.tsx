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

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID ?? "";
const SYNC_ENDPOINT = import.meta.env.VITE_SYNC_ENDPOINT ?? "";

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

interface GoogleJwtPayload {
  email?: string;
  name?: string;
}

function decodeJwtPayload(token: string): GoogleJwtPayload {
  try {
    const payload = token.split(".")[1];
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const json = atob(normalized);
    return JSON.parse(json) as GoogleJwtPayload;
  } catch {
    return {};
  }
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
  const [idToken, setIdToken] = useState(() => window.localStorage.getItem("mm-google-id-token") ?? "");
  const [authStatus, setAuthStatus] = useState("Sign in to continue.");
  const [isSyncing, setIsSyncing] = useState(false);
  const [gisReady, setGisReady] = useState(false);
  const [lastPulledToken, setLastPulledToken] = useState("");
  const signInRef = useRef<HTMLDivElement | null>(null);
  const skipNextAutoPush = useRef(false);

  const profile = useMemo(() => (idToken ? decodeJwtPayload(idToken) : {}), [idToken]);

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
    if (idToken) {
      window.localStorage.setItem("mm-google-id-token", idToken);
    } else {
      window.localStorage.removeItem("mm-google-id-token");
    }
  }, [idToken]);

  useEffect(() => {
    if (window.google?.accounts?.id) {
      setGisReady(true);
      return;
    }

    const scriptId = "google-identity-services";
    if (document.getElementById(scriptId)) {
      return;
    }

    const script = document.createElement("script");
    script.id = scriptId;
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.onload = () => setGisReady(true);
    document.head.appendChild(script);
  }, []);

  useEffect(() => {
    if (!gisReady || !GOOGLE_CLIENT_ID || !signInRef.current || !window.google?.accounts?.id || idToken) {
      return;
    }

    window.google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      callback: (response) => {
        if (!response.credential) {
          setAuthStatus("Google sign-in failed.");
          return;
        }
        setIdToken(response.credential);
        setAuthStatus("Signed in. Loading your data...");
      }
    });

    signInRef.current.innerHTML = "";
    window.google.accounts.id.renderButton(signInRef.current, {
      theme: "outline",
      size: "large",
      shape: "pill",
      text: "signin_with"
    });
  }, [gisReady, idToken]);

  async function syncRequest(action: "push" | "pull", token: string) {
    if (!SYNC_ENDPOINT) {
      throw new Error("Cloud sync endpoint is not configured.");
    }

    const response = await fetch(SYNC_ENDPOINT, {
      method: "POST",
      body: JSON.stringify({ action, idToken: token, payload: snapshot })
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

  async function pullFromCloud(token: string) {
    setIsSyncing(true);
    try {
      const result = await syncRequest("pull", token);
      if (result.data) {
        skipNextAutoPush.current = true;
        importSnapshot(result.data);
      }
      setAuthStatus("Data loaded from Google Sheets.");
      setLastPulledToken(token);
    } catch (error) {
      setAuthStatus(error instanceof Error ? error.message : "Failed to load cloud data.");
    } finally {
      setIsSyncing(false);
    }
  }

  async function pushToCloud(token: string) {
    if (!token || !SYNC_ENDPOINT) {
      return;
    }
    setIsSyncing(true);
    try {
      await syncRequest("push", token);
      setAuthStatus(`Synced for ${profile.email ?? "current user"}.`);
    } catch (error) {
      setAuthStatus(error instanceof Error ? error.message : "Failed to sync cloud data.");
    } finally {
      setIsSyncing(false);
    }
  }

  useEffect(() => {
    if (!idToken || !SYNC_ENDPOINT) {
      return;
    }
    if (lastPulledToken === idToken) {
      return;
    }
    void pullFromCloud(idToken);
  }, [idToken, lastPulledToken]);

  useEffect(() => {
    if (!idToken || !SYNC_ENDPOINT) {
      return;
    }
    if (lastPulledToken !== idToken) {
      return;
    }

    if (skipNextAutoPush.current) {
      skipNextAutoPush.current = false;
      return;
    }

    const timer = window.setTimeout(() => {
      void pushToCloud(idToken);
    }, 1800);

    return () => {
      window.clearTimeout(timer);
    };
  }, [snapshot, idToken, lastPulledToken]);

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

  if (!idToken) {
    return (
      <div className="auth-gate-wrap">
        <div className="auth-gate-card panel">
          <p className="eyebrow">Money Manager</p>
          <h1>Sign in to access your personal dashboard</h1>
          <p className="auth-gate-text">
            Your Google account identifies your data. Transactions and accounts are loaded from your Google Sheets data store.
          </p>

          {GOOGLE_CLIENT_ID && SYNC_ENDPOINT ? <div ref={signInRef} className="auth-btn-wrap" /> : null}
          {!GOOGLE_CLIENT_ID || !SYNC_ENDPOINT ? (
            <p className="auth-gate-note">
              App admin setup is incomplete. Missing {GOOGLE_CLIENT_ID ? "Sync Endpoint" : "Google Client ID"}.
            </p>
          ) : null}
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
          <strong>{profile.name ?? "Signed In User"}</strong>
          <p>{profile.email ?? "Unknown email"}</p>
        </div>
        <div className="session-strip-actions">
          <span>{isSyncing ? "Syncing..." : authStatus}</span>
          <button
            type="button"
            className="ghost-btn"
            onClick={() => {
              setIdToken("");
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
