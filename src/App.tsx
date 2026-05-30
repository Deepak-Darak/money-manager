import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { onIdTokenChanged, signInWithPopup, signInWithRedirect, signOut as firebaseSignOut } from "firebase/auth";
import AccountsPage from "./components/AccountsPage";
import ChartsDashboard from "./components/ChartsDashboard";
import ExpenseChart from "./components/ExpenseChart";
import Navigation, { type Tab } from "./components/Navigation";
import SplitsPage from "./components/SplitsPage";
import StatementImport, { type ImportedTx } from "./components/StatementImport";
import TransactionForm, { type NewTransactionInput } from "./components/TransactionForm";
import TransactionTimeline from "./components/TransactionTimeline";
import { defaultAccountTypes } from "./data/accountGroups";
import { categories as builtinCategories } from "./data/categories";
import { useLocalStorage } from "./hooks/useLocalStorage";
import { auth, firebaseAuthConfigured, googleProvider } from "./lib/firebase";
import type { Account, AccountType, AppDataSnapshot, Category, SplitGroup, Transaction } from "./types/finance";

const SYNC_ENDPOINT = import.meta.env.VITE_SYNC_ENDPOINT ?? "";

function normalizeEmail(input: string) {
  return input.trim().toLowerCase();
}

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

function isStandaloneDisplay() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function isIosSafari() {
  const userAgent = window.navigator.userAgent;
  const isIosDevice = /iPhone|iPad|iPod/i.test(userAgent);
  const isSafariBrowser = /WebKit/i.test(userAgent) && !/CriOS|FxiOS|EdgiOS|OPiOS/i.test(userAgent);
  return isIosDevice && isSafariBrowser;
}

function applyTransactionEffect(currentAccounts: Account[], tx: Transaction, direction: 1 | -1) {
  const next = [...currentAccounts];

  function normalizeAccountTypeByBalance(account: Account): Account {
    if (account.type === "asset" && account.balance < 0) {
      return {
        ...account,
        type: "liability"
      };
    }

    if (account.type === "liability" && account.balance > 0) {
      return {
        ...account,
        type: "asset"
      };
    }

    return account;
  }

  function adjustBalance(accountId: string | undefined, delta: number) {
    if (!accountId) {
      return;
    }
    const index = next.findIndex((a) => a.id === accountId);
    if (index >= 0) {
      const account = next[index];

      next[index] = {
        ...account,
        balance: account.balance + delta
      };

      next[index] = normalizeAccountTypeByBalance(next[index]);
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
    // Signed-balance transfer is intentionally direction-only so add/delete/edit stay perfectly reversible.
    adjustBalance(tx.fromAccountId, -tx.amount * direction);
    adjustBalance(tx.toAccountId, tx.amount * direction);
  }

  return next;
}

interface GoogleSignInButtonProps {
  onError: (message: string) => void;
}

function GoogleSignInButton({ onError }: GoogleSignInButtonProps) {
  const [isLoading, setIsLoading] = useState(false);

  async function handleGoogleSignIn() {
    if (!firebaseAuthConfigured || !auth || !googleProvider) {
      onError("Firebase is not configured. Add VITE_FIREBASE_* env values.");
      return;
    }

    setIsLoading(true);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Google sign-in failed.";
      if (/popup|redirect/i.test(message)) {
        try {
          await signInWithRedirect(auth, googleProvider);
          return;
        } catch (redirectError) {
          onError(redirectError instanceof Error ? redirectError.message : "Google sign-in failed.");
          return;
        }
      }

      onError(message);
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="auth-google-wrap">
      <button type="button" className="auth-google-btn" onClick={handleGoogleSignIn} disabled={isLoading}>
        {isLoading ? "Signing in..." : "Continue with Google"}
      </button>
    </div>
  );
}

// ── Post-transfer split modal ──────────────────────────────────────────────

interface PostTransferSplitModalProps {
  transaction: Transaction;
  group: SplitGroup;
  currentUser: string;
  authToken: string;
  onDone: () => void;
}

function PostTransferSplitModal({ transaction, group, currentUser, authToken, onDone }: PostTransferSplitModalProps) {
  const [splitMode, setSplitMode] = useState<"equal" | "custom">("equal");
  const [customShares, setCustomShares] = useState<Record<string, string>>({});
  const [paidBy, setPaidBy] = useState(currentUser);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const perPerson = group.members.length > 0 ? transaction.amount / group.members.length : 0;

  function getShares() {
    if (splitMode === "equal") {
      return group.members.map((m) => ({ email: m, amount: perPerson }));
    }
    return group.members.map((m) => ({ email: m, amount: parseFloat(customShares[m] || "0") || 0 }));
  }

  async function handleConfirm() {
    const shares = getShares();
    if (splitMode === "custom") {
      const total = shares.reduce((s, x) => s + x.amount, 0);
      if (Math.abs(total - transaction.amount) > 0.5) {
        setError(`Shares total ₹${total.toFixed(2)} but transaction is ₹${transaction.amount.toFixed(2)}`);
        return;
      }
    }
    setSaving(true);
    try {
      await fetch(SYNC_ENDPOINT, {
        method: "POST",
        body: JSON.stringify({
          action: "splitsAddExpense",
          firebaseIdToken: authToken,
          authProvider: "google-firebase",
          groupId: group.id,
          description: transaction.title,
          totalAmount: transaction.amount,
          paidBy,
          shares,
          linkedTransactionId: transaction.id,
        }),
      });
      onDone();
    } catch {
      setError("Failed to create split expense");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="splits-modal-overlay">
      <div className="splits-modal panel">
        <div className="splits-modal-header">
          <h3>Split with {group.name}?</h3>
          <button className="icon-btn" onClick={onDone} aria-label="Skip">✕</button>
        </div>
        <div className="splits-modal-body">
          <p className="splits-expense-meta">
            Transfer of <strong>₹{transaction.amount.toLocaleString("en-IN")}</strong> — "{transaction.title}"
          </p>

          <label className="field-label">
            Paid by
            <select className="field-input" value={paidBy} onChange={(e) => setPaidBy(e.target.value)}>
              {group.members.map((m) => (
                <option key={m} value={m}>{m === currentUser ? `${m.split("@")[0]} (you)` : m.split("@")[0]}</option>
              ))}
            </select>
          </label>

          <div className="splits-split-toggle">
            <button type="button" className={`splits-toggle-btn${splitMode === "equal" ? " active" : ""}`} onClick={() => setSplitMode("equal")}>Equal</button>
            <button type="button" className={`splits-toggle-btn${splitMode === "custom" ? " active" : ""}`} onClick={() => setSplitMode("custom")}>Custom</button>
          </div>

          <div className="splits-shares-list">
            {group.members.map((m) => (
              <div key={m} className="splits-share-input-row">
                <span className="splits-share-label">{m === currentUser ? `${m.split("@")[0]} (you)` : m.split("@")[0]}</span>
                {splitMode === "equal" ? (
                  <span className="splits-share-amount">₹{perPerson.toFixed(2)}</span>
                ) : (
                  <input className="field-input splits-share-field" type="number" min="0" step="0.01"
                    value={customShares[m] ?? ""} placeholder="0.00"
                    onChange={(e) => setCustomShares((prev) => ({ ...prev, [m]: e.target.value }))} />
                )}
              </div>
            ))}
          </div>

          {error && <p className="splits-error">{error}</p>}

          <div className="splits-modal-actions">
            <button type="button" className="ghost-btn" onClick={onDone}>Skip</button>
            <button type="button" className="primary-btn" disabled={saving} onClick={handleConfirm}>
              {saving ? "Adding…" : "Add Split Expense"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [transactions, setTransactions] = useLocalStorage<Transaction[]>("mm-transactions", []);
  const [accounts, setAccounts] = useLocalStorage<Account[]>("mm-accounts", []);
  const [accountTypes, setAccountTypes] = useLocalStorage<AccountType[]>(
    "mm-account-types",
    defaultAccountTypes
  );
  const [customCategories, setCustomCategories] = useLocalStorage<Category[]>("mm-custom-categories", []);
  const [activeTab, setActiveTab] = useState<Tab>("dashboard");
  const [focusDate, setFocusDate] = useState(getTodayString);
  const [editingTransactionId, setEditingTransactionId] = useState<string | null>(null);
  const [dashboardMonth, setDashboardMonth] = useState(getCurrentMonth);
  const [showBalance, setShowBalance] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [userEmail, setUserEmail] = useState(() =>
    normalizeEmail(window.localStorage.getItem("mm-user-email") ?? "")
  );
  const [authToken, setAuthToken] = useState(() => window.localStorage.getItem("mm-auth-token") ?? "");
  const [authStatus, setAuthStatus] = useState("Sign in with Google to continue.");
  const [authReady, setAuthReady] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastPulledToken, setLastPulledToken] = useState("");
  const [showInstallHint, setShowInstallHint] = useState(false);
  const [showLaunchSplash, setShowLaunchSplash] = useState(false);
  const skipNextAutoPush = useRef(false);

  // ── Splits state ────────────────────────────────────────────────────────
  const [splitGroups, setSplitGroups] = useState<SplitGroup[]>([]);
  const [pendingSplitExpense, setPendingSplitExpense] = useState<{
    transaction: Transaction;
    group: SplitGroup;
  } | null>(null);

  const syncSplitGroupAccounts = useCallback((groups: SplitGroup[], netPerGroup: Record<string, number>) => {
    setSplitGroups(groups);
    setAccounts((current) => {
      let next = [...current];
      for (const group of groups) {
        const net = netPerGroup[group.id] ?? 0;
        const existingIdx = next.findIndex((a) => a.splitGroupId === group.id);
        if (existingIdx >= 0) {
          next = next.map((a, i) =>
            i === existingIdx
              ? { ...a, balance: net, type: net < 0 ? "liability" : "asset", name: group.name }
              : a
          );
        } else {
          next = [
            ...next,
            {
              id: "split-" + group.id,
              name: group.name,
              group: "other",
              type: (net < 0 ? "liability" : "asset") as "asset" | "liability",
              balance: net,
              splitGroupId: group.id,
              createdAt: group.createdAt,
            },
          ];
        }
      }
      // Remove accounts for groups that were deleted
      const groupIds = new Set(groups.map((g) => g.id));
      return next.filter((a) => !a.splitGroupId || groupIds.has(a.splitGroupId));
    });
  }, []);

  const totalAssets = accounts.filter((a) => a.type === "asset").reduce((sum, a) => sum + a.balance, 0);
  const rawLiabilityBalance = accounts
    .filter((a) => a.type === "liability")
    .reduce((sum, a) => sum + a.balance, 0);
  const totalLiabilities = Math.abs(rawLiabilityBalance);
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

  const allCategories = useMemo(() => [...builtinCategories, ...customCategories], [customCategories]);

  const snapshot: AppDataSnapshot = {
    version: 1,
    transactions,
    accounts,
    accountTypes,
    customCategories,
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

  useEffect(() => {
    if (!showBalance) {
      return;
    }

    const timer = window.setTimeout(() => {
      setShowBalance(false);
    }, 5 * 60 * 1000);

    return () => {
      window.clearTimeout(timer);
    };
  }, [showBalance]);

  useEffect(() => {
    const standalone = isStandaloneDisplay();
    const shouldShowHint =
      isIosSafari() &&
      !standalone &&
      window.localStorage.getItem("mm-ios-install-hint-dismissed") !== "1";

    setShowInstallHint(shouldShowHint);

    if (!standalone) {
      return;
    }

    setShowLaunchSplash(true);
    const timer = window.setTimeout(() => {
      setShowLaunchSplash(false);
    }, 1400);

    return () => {
      window.clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    if (!auth) {
      setAuthReady(true);
      return;
    }

    const unsubscribe = onIdTokenChanged(auth, async (user) => {
      if (!user) {
        setUserEmail("");
        setAuthToken("");
        setLastPulledToken("");
        setAuthStatus("Sign in with Google to continue.");
        setAuthReady(true);
        return;
      }

      const email = normalizeEmail(user.email ?? user.providerData[0]?.email ?? "");
      const token = await user.getIdToken();
      setUserEmail(email);
      setAuthToken(token);
      setAuthStatus("Signed in. Loading your data...");
      setAuthReady(true);
    });

    return () => {
      unsubscribe();
    };
  }, []);

  async function syncRequest(action: "push" | "pull", email: string, token: string) {
    if (!SYNC_ENDPOINT) {
      throw new Error("Cloud sync endpoint is not configured.");
    }

    if (!token) {
      throw new Error("Authentication required.");
    }

    const response = await fetch(SYNC_ENDPOINT, {
      method: "POST",
      body: JSON.stringify({
        action,
        email,
        password: token,
        firebaseIdToken: token,
        authProvider: "google-firebase",
        ...(action === "push" ? { payload: snapshot } : {})
      })
    });

    const result = (await response.json()) as {
      ok: boolean;
      message?: string;
      data?: AppDataSnapshot;
      email?: string;
    };

    if (!response.ok) {
      throw new Error(result.message || `Sync request failed (${response.status}).`);
    }

    if (!result.ok) {
      throw new Error(result.message || "Sync rejected.");
    }

    return result;
  }

  function importSnapshot(next: AppDataSnapshot) {
    setTransactions(next.transactions ?? []);
    setAccounts(next.accounts ?? []);
    setAccountTypes(next.accountTypes?.length ? next.accountTypes : defaultAccountTypes);
    if (next.customCategories?.length) setCustomCategories(next.customCategories);
    setEditingTransactionId(null);
  }

  async function pullFromCloud(email: string, token: string) {
    setIsSyncing(true);
    try {
      const result = await syncRequest("pull", email, token);
      if (result.email) {
        setUserEmail(normalizeEmail(result.email));
      }
      if (result.data) {
        skipNextAutoPush.current = true;
        importSnapshot(result.data);
      }
      setAuthStatus("Data loaded from Google Sheets.");
      setLastPulledToken(token);
    } catch (error) {
      const message = formatSyncError(error);
      if (/session expired|invalid session|authentication required/i.test(message)) {
        setAuthToken("");
        setLastPulledToken("");
      }
      setAuthStatus(message);
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
      const result = await syncRequest("push", email, token);
      if (result.email) {
        setUserEmail(normalizeEmail(result.email));
      }
      setAuthStatus(`Synced for ${email}.`);
    } catch (error) {
      const message = formatSyncError(error);
      if (/session expired|invalid session|authentication required/i.test(message)) {
        setAuthToken("");
        setLastPulledToken("");
      }
      setAuthStatus(message);
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
  const syncStatusLabel = isSyncing
    ? "Syncing"
    : /cannot reach|failed|error|rejected|expired|invalid/i.test(authStatus)
      ? "Sync error"
      : "Synced";

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

    // If this is a transfer to a split group account, prompt to create a split expense
    if (payload.kind === "transfer" && payload.toAccountId) {
      const targetAccount = accounts.find((a) => a.id === payload.toAccountId);
      if (targetAccount?.splitGroupId) {
        const group = splitGroups.find((g) => g.id === targetAccount.splitGroupId);
        if (group) {
          setPendingSplitExpense({ transaction: nextTransaction, group });
        }
      }
    }
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
    const normalizedType =
      data.type === "liability"
        ? "liability"
        : data.balance < 0
          ? "liability"
          : data.balance > 0
            ? "asset"
            : data.type;

    const normalizedBalance =
      normalizedType === "liability" && data.balance !== 0 ? -Math.abs(data.balance) : data.balance;

    setAccounts((current) => [
      ...current,
      {
        ...data,
        type: normalizedType,
        balance: normalizedBalance,
        id: makeId(),
        createdAt: new Date().toISOString()
      },
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

  function addCustomCategory(data: Omit<Category, "id">) {
    setCustomCategories((current) => {
      const baseId = slugify(data.name) || "custom-cat";
      let id = baseId;
      let counter = 2;
      while ([...builtinCategories, ...current].some((c) => c.id === id)) {
        id = `${baseId}-${counter}`;
        counter += 1;
      }
      return [...current, { ...data, id }];
    });
  }

  function deleteCustomCategory(id: string) {
    setCustomCategories((current) => current.filter((c) => c.id !== id));
    // reassign any transactions using this category to the "other" fallback
    setTransactions((current) =>
      current.map((tx) =>
        tx.categoryId === id
          ? { ...tx, categoryId: tx.kind === "income" ? "other-income" : "other-expense" }
          : tx
      )
    );
  }

  function importTransactions(txs: ImportedTx[]) {
    const now = new Date().toISOString();
    const newTxs = txs.map((tx) => ({
      ...tx,
      id: makeId(),
      createdAt: now,
    }));
    setTransactions((current) => [
      ...newTxs,
      ...current,
    ]);
    setAccounts((current) => {
      let next = current;
      for (const tx of newTxs) {
        next = applyTransactionEffect(next, tx, 1);
      }
      return next;
    });
  }

  const installHint = showInstallHint ? (
    <aside className="ios-install-hint" aria-label="Install on iPhone">
      <div className="ios-install-card panel">
        <p className="eyebrow">Install on iPhone</p>
        <h3>Add this app to your home screen</h3>
        <p>
          In Safari, tap <strong>Share</strong> then <strong>Add to Home Screen</strong> to launch Money Manager like a native app.
        </p>
        <div className="ios-install-actions">
          <button
            type="button"
            className="ghost-btn"
            onClick={() => {
              window.localStorage.setItem("mm-ios-install-hint-dismissed", "1");
              setShowInstallHint(false);
            }}
          >
            Dismiss
          </button>
        </div>
      </div>
    </aside>
  ) : null;

  const launchSplash = showLaunchSplash ? (
    <div className="launch-splash" aria-hidden="true">
      <div className="launch-splash-card">
        <div className="launch-splash-mark">
          <span>₹</span>
        </div>
        <div>
          <p className="eyebrow">Money Manager</p>
          <h2>Track cash flow with clarity</h2>
        </div>
      </div>
    </div>
  ) : null;

  if (!authReady) {
    return (
      <>
        {launchSplash}
        {installHint}
        <div className="auth-gate-wrap">
          <div className="auth-gate-card panel">
            <p className="eyebrow">Money Manager</p>
            <h1>Checking sign-in status...</h1>
            <p className="auth-gate-note">{authStatus}</p>
          </div>
        </div>
      </>
    );
  }

  if (!authToken) {
    return (
      <>
        {launchSplash}
        {installHint}
        <div className="auth-gate-wrap">
          <div className="auth-gate-card panel">
            <p className="eyebrow">Money Manager</p>
            <h1>Sign in to access your personal dashboard</h1>
            <p className="auth-gate-text">
              Use one click Google sign-in to continue. Your data stays on your cloud sync destination.
            </p>
            <GoogleSignInButton onError={(message) => setAuthStatus(message)} />
            {!firebaseAuthConfigured ? (
              <p className="auth-gate-note">Missing Firebase env keys. Add VITE_FIREBASE_API_KEY, VITE_FIREBASE_AUTH_DOMAIN, VITE_FIREBASE_PROJECT_ID, and VITE_FIREBASE_APP_ID.</p>
            ) : null}
            <p className="auth-gate-note">{authStatus}</p>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      {launchSplash}
      {installHint}
      {showImport && (
        <StatementImport
          accounts={accounts}
          categories={allCategories}
          onImport={importTransactions}
          onClose={() => setShowImport(false)}
        />
      )}
      {pendingSplitExpense && (
        <PostTransferSplitModal
          transaction={pendingSplitExpense.transaction}
          group={pendingSplitExpense.group}
          currentUser={userEmail}
          authToken={authToken}
          onDone={() => setPendingSplitExpense(null)}
        />
      )}
      <div className="app-shell">
        <div className="background-layers" aria-hidden="true" />

      <section className="panel session-strip">
        <div>
          <strong>Money Manager</strong>
          <p>{userEmail}</p>
        </div>
        <div className="session-strip-actions">
          <span className="session-sync-status" title={isSyncing ? "Syncing..." : authStatus}>
            {syncStatusLabel}
          </span>
          <button
            type="button"
            className="ghost-btn import-trigger-btn"
            onClick={() => setShowImport(true)}
          >
            <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" style={{ marginRight: "5px", verticalAlign: "middle" }}>
              <path d="M12 2v14M5 9l7 7 7-7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M3 19h18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
            Import
          </button>
          <button
            type="button"
            className="ghost-btn"
            onClick={async () => {
              try {
                if (auth) {
                  await firebaseSignOut(auth);
                }
              } catch {
                // State reset below still clears local session if sign-out RPC fails.
              }

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
            <div className="balance-header">
              <p>Current Total Balance (Assets - Liabilities)</p>
              <button
                type="button"
                className="icon-btn balance-toggle"
                aria-label={showBalance ? "Hide balance" : "Show balance"}
                onClick={() => setShowBalance(!showBalance)}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  {showBalance ? (
                    <>
                      <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                      <circle cx="12" cy="12" r="2.6" fill="none" stroke="currentColor" strokeWidth="1.8" />
                    </>
                  ) : (
                    <>
                      <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                      <path d="M4 4 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                    </>
                  )}
                </svg>
              </button>
            </div>
            <h2 className={`${currentTotalBalance >= 0 ? "plus" : "minus"}${!showBalance ? " balance-hidden" : ""}`}>
              {showBalance ? `₹${Math.round(currentTotalBalance).toLocaleString("en-IN")}` : "••••••"}
            </h2>
            <div className="balance-split-row">
              <span className="plus">Assets: {showBalance ? `₹${Math.round(totalAssets).toLocaleString("en-IN")}` : "••••••"}</span>
              <span className="minus">Liabilities: {showBalance ? `₹${Math.round(totalLiabilities).toLocaleString("en-IN")}` : "••••••"}</span>
            </div>
          </section>

          <div className="dashboard-form-section">
            <TransactionForm
              categories={allCategories}
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
              categories={allCategories}
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
            categories={allCategories}
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
            categories={allCategories}
            builtinCategoryIds={builtinCategories.map((c) => c.id)}
            onAddCategory={addCustomCategory}
            onDeleteCategory={deleteCustomCategory}
          />
          </div>
        )}

        {/* ── Charts ────────────────────────────────── */}
        {activeTab === "charts" && (
          <div className="tab-content">
            <section className="panel budget-section chart-filter-section">
              <label>
                Expense Breakdown Month
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
              categories={allCategories}
              label={dashboardMonth}
            />

            <div className="charts-analytics-wrap">
              <ChartsDashboard transactions={transactions} categories={allCategories} />
            </div>
          </div>
        )}

        {/* ── Splits ────────────────────────────────── */}
        {activeTab === "splits" && (
          <SplitsPage
            userEmail={userEmail}
            authToken={authToken}
            transactions={transactions}
            onSyncAccounts={syncSplitGroupAccounts}
          />
        )}
      </div>
    </>
  );
}
