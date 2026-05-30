import { useCallback, useEffect, useRef, useState } from "react";
import type { SplitExpense, SplitGroup } from "../types/finance";
import type { Transaction } from "../types/finance";

const SYNC_ENDPOINT = import.meta.env.VITE_SYNC_ENDPOINT ?? "";

async function splitsApi(
  action: string,
  authToken: string,
  body: Record<string, unknown> = {}
): Promise<Record<string, unknown>> {
  const response = await fetch(SYNC_ENDPOINT, {
    method: "POST",
    body: JSON.stringify({
      action,
      firebaseIdToken: authToken,
      authProvider: "google-firebase",
      ...body,
    }),
  });
  const result = (await response.json()) as Record<string, unknown>;
  if (!result.ok) throw new Error((result.message as string) || `${action} failed`);
  return result;
}

function fmtAmount(n: number) {
  return "₹" + Math.abs(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function shortEmail(email: string) {
  return email.split("@")[0];
}

// ── Balance calculator ─────────────────────────────────────────────────────

function computeBalances(
  expenses: SplitExpense[],
  currentUser: string
): { email: string; net: number }[] {
  const netMap: Record<string, number> = {};

  for (const exp of expenses) {
    for (const share of exp.shares) {
      if (share.settled) continue;
      if (share.email === exp.paidBy) continue; // payer's own share — skip

      if (exp.paidBy === currentUser && share.email !== currentUser) {
        // others owe me
        netMap[share.email] = (netMap[share.email] ?? 0) + share.amount;
      } else if (share.email === currentUser && exp.paidBy !== currentUser) {
        // I owe someone
        netMap[exp.paidBy] = (netMap[exp.paidBy] ?? 0) - share.amount;
      }
    }
  }

  return Object.entries(netMap)
    .filter(([, v]) => Math.abs(v) > 0.001)
    .map(([email, net]) => ({ email, net }))
    .sort((a, b) => b.net - a.net);
}

// ── Group-wide balance + debt simplification ───────────────────────────────

function computeGroupWideBalances(expenses: SplitExpense[]): Record<string, number> {
  const bal: Record<string, number> = {};
  for (const exp of expenses) {
    for (const share of exp.shares) {
      if (share.settled || share.email === exp.paidBy) continue;
      bal[exp.paidBy] = (bal[exp.paidBy] ?? 0) + share.amount;
      bal[share.email] = (bal[share.email] ?? 0) - share.amount;
    }
  }
  return bal;
}

function simplifyDebts(
  balances: Record<string, number>
): { from: string; to: string; amount: number }[] {
  const cred = Object.entries(balances)
    .filter(([, v]) => v > 0.01)
    .map(([email, net]) => ({ email, net }));
  const debt = Object.entries(balances)
    .filter(([, v]) => v < -0.01)
    .map(([email, net]) => ({ email, net: -net }));

  const result: { from: string; to: string; amount: number }[] = [];
  let i = 0, j = 0;
  while (i < debt.length && j < cred.length) {
    const amt = Math.min(debt[i].net, cred[j].net);
    if (amt > 0.01) result.push({ from: debt[i].email, to: cred[j].email, amount: amt });
    debt[i].net -= amt;
    cred[j].net -= amt;
    if (debt[i].net < 0.01) i++;
    if (cred[j].net < 0.01) j++;
  }
  return result;
}

// ── Create Group Modal ─────────────────────────────────────────────────────

interface CreateGroupModalProps {
  currentUser: string;
  onClose: () => void;
  onCreate: (name: string, memberEmails: string[]) => Promise<void>;
}

function CreateGroupModal({ currentUser, onClose, onCreate }: CreateGroupModalProps) {
  const [name, setName] = useState("");
  const [memberInput, setMemberInput] = useState("");
  const [members, setMembers] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  function addMember() {
    const email = memberInput.trim().toLowerCase();
    if (!email || !email.includes("@")) { setError("Enter a valid email"); return; }
    if (email === currentUser) { setError("You are automatically included"); return; }
    if (members.includes(email)) { setError("Already added"); return; }
    setMembers((m) => [...m, email]);
    setMemberInput("");
    setError("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setError("Group name is required"); return; }
    if (members.length < 1) { setError("Add at least one other member"); return; }
    setSaving(true);
    try {
      await onCreate(name.trim(), members);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create group");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="splits-modal-overlay" onClick={onClose}>
      <div className="splits-modal panel" onClick={(e) => e.stopPropagation()}>
        <div className="splits-modal-header">
          <h3>New Group</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <form onSubmit={handleSubmit} className="splits-modal-body">
          <label className="field-label">
            Group name
            <input
              className="field-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Goa Trip"
              autoFocus
            />
          </label>

          <label className="field-label">Members</label>
          <div className="splits-member-row">
            <input
              className="field-input"
              value={memberInput}
              onChange={(e) => setMemberInput(e.target.value)}
              placeholder="friend@email.com"
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addMember(); } }}
            />
            <button type="button" className="ghost-btn" onClick={addMember}>Add</button>
          </div>

          <div className="splits-member-chips">
            <span className="splits-chip splits-chip--you">{shortEmail(currentUser)} (you)</span>
            {members.map((m) => (
              <span key={m} className="splits-chip">
                {shortEmail(m)}
                <button
                  type="button"
                  className="splits-chip-remove"
                  onClick={() => setMembers((prev) => prev.filter((x) => x !== m))}
                  aria-label={`Remove ${m}`}
                >✕</button>
              </span>
            ))}
          </div>

          {error && <p className="splits-error">{error}</p>}

          <div className="splits-modal-actions">
            <button type="button" className="ghost-btn" onClick={onClose}>Cancel</button>
            <button type="submit" className="primary-btn" disabled={saving}>
              {saving ? "Creating…" : "Create Group"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Add Expense Modal ──────────────────────────────────────────────────────

interface AddExpenseModalProps {
  group: SplitGroup;
  currentUser: string;
  transactions: Transaction[];
  onClose: () => void;
  onAdd: (expense: {
    description: string;
    totalAmount: number;
    paidBy: string;
    shares: { email: string; amount: number }[];
    linkedTransactionId?: string;
  }) => Promise<void>;
}

function AddExpenseModal({ group, currentUser, transactions, onClose, onAdd }: AddExpenseModalProps) {
  const [description, setDescription] = useState("");
  const [totalAmount, setTotalAmount] = useState("");
  const [paidBy, setPaidBy] = useState(currentUser);
  const [splitMode, setSplitMode] = useState<"equal" | "custom">("equal");
  const [customShares, setCustomShares] = useState<Record<string, string>>({});
  const [linkedTxId, setLinkedTxId] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const amount = parseFloat(totalAmount) || 0;
  const perPerson = group.members.length > 0 ? amount / group.members.length : 0;

  const recentTx = transactions
    .filter((t) => t.kind === "expense")
    .slice(0, 30);

  function getShares(): { email: string; amount: number }[] {
    if (splitMode === "equal") {
      return group.members.map((m) => ({ email: m, amount: perPerson }));
    }
    return group.members.map((m) => ({ email: m, amount: parseFloat(customShares[m] || "0") || 0 }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!description.trim()) { setError("Description is required"); return; }
    if (!amount || amount <= 0) { setError("Enter a valid amount"); return; }

    const shares = getShares();

    if (splitMode === "custom") {
      const total = shares.reduce((s, x) => s + x.amount, 0);
      if (Math.abs(total - amount) > 0.5) {
        setError(`Shares total ₹${total.toFixed(2)} but expense is ₹${amount.toFixed(2)}`);
        return;
      }
    }

    setSaving(true);
    try {
      await onAdd({
        description: description.trim(),
        totalAmount: amount,
        paidBy,
        shares,
        linkedTransactionId: linkedTxId || undefined,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add expense");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="splits-modal-overlay" onClick={onClose}>
      <div className="splits-modal panel" onClick={(e) => e.stopPropagation()}>
        <div className="splits-modal-header">
          <h3>Add Expense</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <form onSubmit={handleSubmit} className="splits-modal-body">
          <label className="field-label">
            Description
            <input
              className="field-input"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. Dinner at Olive"
              autoFocus
            />
          </label>

          <label className="field-label">
            Total amount (₹)
            <input
              className="field-input"
              type="number"
              min="0.01"
              step="0.01"
              value={totalAmount}
              onChange={(e) => setTotalAmount(e.target.value)}
              placeholder="0.00"
            />
          </label>

          <label className="field-label">
            Paid by
            <select className="field-input" value={paidBy} onChange={(e) => setPaidBy(e.target.value)}>
              {group.members.map((m) => (
                <option key={m} value={m}>{m === currentUser ? `${shortEmail(m)} (you)` : shortEmail(m)}</option>
              ))}
            </select>
          </label>

          {recentTx.length > 0 && (
            <label className="field-label">
              Link to transaction (optional)
              <select className="field-input" value={linkedTxId} onChange={(e) => setLinkedTxId(e.target.value)}>
                <option value="">— None —</option>
                {recentTx.map((t) => (
                  <option key={t.id} value={t.id}>{t.date} · {t.title} · ₹{t.amount.toLocaleString("en-IN")}</option>
                ))}
              </select>
            </label>
          )}

          <div className="splits-split-toggle">
            <button
              type="button"
              className={`splits-toggle-btn${splitMode === "equal" ? " active" : ""}`}
              onClick={() => setSplitMode("equal")}
            >Equal</button>
            <button
              type="button"
              className={`splits-toggle-btn${splitMode === "custom" ? " active" : ""}`}
              onClick={() => setSplitMode("custom")}
            >Custom</button>
          </div>

          <div className="splits-shares-list">
            {group.members.map((m) => (
              <div key={m} className="splits-share-input-row">
                <span className="splits-share-label">
                  {m === currentUser ? `${shortEmail(m)} (you)` : shortEmail(m)}
                </span>
                {splitMode === "equal" ? (
                  <span className="splits-share-amount">{amount > 0 ? fmtAmount(perPerson) : "—"}</span>
                ) : (
                  <input
                    className="field-input splits-share-field"
                    type="number"
                    min="0"
                    step="0.01"
                    value={customShares[m] ?? ""}
                    onChange={(e) => setCustomShares((prev) => ({ ...prev, [m]: e.target.value }))}
                    placeholder="0.00"
                  />
                )}
              </div>
            ))}
          </div>

          {error && <p className="splits-error">{error}</p>}

          <div className="splits-modal-actions">
            <button type="button" className="ghost-btn" onClick={onClose}>Cancel</button>
            <button type="submit" className="primary-btn" disabled={saving}>
              {saving ? "Adding…" : "Add Expense"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Expense Card ───────────────────────────────────────────────────────────

interface ExpenseCardProps {
  expense: SplitExpense;
  currentUser: string;
  onSettle: (expenseId: string, settleEmail: string) => Promise<void>;
}

function ExpenseCard({ expense, currentUser, onSettle }: ExpenseCardProps) {
  const [settling, setSettling] = useState<string | null>(null);

  async function handleSettle(email: string) {
    setSettling(email);
    try {
      await onSettle(expense.id, email);
    } finally {
      setSettling(null);
    }
  }

  const myShare = expense.shares.find((s) => s.email === currentUser);
  const iAmPayer = expense.paidBy === currentUser;

  return (
    <div className="splits-expense-card panel">
      <div className="splits-expense-header">
        <div>
          <p className="splits-expense-desc">{expense.description}</p>
          <p className="splits-expense-meta">
            {fmtAmount(expense.totalAmount)} · paid by{" "}
            <strong>{expense.paidBy === currentUser ? "you" : shortEmail(expense.paidBy)}</strong>
            {" · "}{new Date(expense.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
          </p>
        </div>
        {myShare && !iAmPayer && (
          <div className={`splits-expense-badge${myShare.settled ? " settled" : " owed"}`}>
            {myShare.settled ? "Settled" : `You owe ${fmtAmount(myShare.amount)}`}
          </div>
        )}
      </div>

      <div className="splits-shares-breakdown">
        {expense.shares.map((share) => {
          const isMe = share.email === currentUser;
          const canSettle =
            (iAmPayer || isMe) && !share.settled && share.email !== expense.paidBy;

          return (
            <div key={share.email} className={`splits-share-row${share.settled ? " settled" : ""}`}>
              <span className="splits-share-who">
                {isMe ? "You" : shortEmail(share.email)}
                {share.email === expense.paidBy ? " (paid)" : ""}
              </span>
              <span className="splits-share-amt">{fmtAmount(share.amount)}</span>
              {share.settled ? (
                <span className="splits-settled-tag">✓ settled</span>
              ) : canSettle ? (
                <button
                  type="button"
                  className="splits-settle-btn"
                  disabled={settling === share.email}
                  onClick={() => handleSettle(share.email)}
                >
                  {settling === share.email ? "…" : "Mark settled"}
                </button>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Main SplitsPage ────────────────────────────────────────────────────────

interface SplitsPageProps {
  userEmail: string;
  authToken: string;
  transactions: Transaction[];
  onSyncAccounts: (groups: SplitGroup[], netPerGroup: Record<string, number>) => void;
}

export default function SplitsPage({ userEmail, authToken, transactions, onSyncAccounts }: SplitsPageProps) {
  const [groups, setGroups] = useState<SplitGroup[]>([]);
  const [selectedGroup, setSelectedGroup] = useState<SplitGroup | null>(null);
  const [expenses, setExpenses] = useState<SplitExpense[]>([]);
  const [groupNetBalances, setGroupNetBalances] = useState<Record<string, number>>({});
  const [loadingGroups, setLoadingGroups] = useState(false);
  const [loadingExpenses, setLoadingExpenses] = useState(false);
  const [error, setError] = useState("");
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [showAddExpense, setShowAddExpense] = useState(false);

  const fetchGroups = useCallback(async () => {
    setLoadingGroups(true);
    setError("");
    try {
      const result = await splitsApi("splitsGetGroups", authToken);
      const loaded = (result.groups as SplitGroup[]) ?? [];
      setGroups(loaded);

      // Fetch all group expenses in parallel to compute net balances
      if (loaded.length > 0) {
        const expResults = await Promise.all(
          loaded.map((g) =>
            splitsApi("splitsGetExpenses", authToken, { groupId: g.id })
              .then((r) => ({ groupId: g.id, expenses: (r.expenses as SplitExpense[]) ?? [] }))
              .catch(() => ({ groupId: g.id, expenses: [] }))
          )
        );
        const netMap: Record<string, number> = {};
        for (const { groupId, expenses: exps } of expResults) {
          const allBal = computeGroupWideBalances(exps);
          netMap[groupId] = allBal[userEmail] ?? 0;
        }
        setGroupNetBalances(netMap);
        onSyncAccounts(loaded, netMap);
      } else {
        onSyncAccounts([], {});
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load groups");
    } finally {
      setLoadingGroups(false);
    }
  }, [authToken, userEmail, onSyncAccounts]);

  const fetchExpenses = useCallback(async (groupId: string) => {
    setLoadingExpenses(true);
    setError("");
    try {
      const result = await splitsApi("splitsGetExpenses", authToken, { groupId });
      const loaded = (result.expenses as SplitExpense[]) ?? [];
      setExpenses(loaded);
      // Update net balance for this group so accounts stay in sync
      const allBal = computeGroupWideBalances(loaded);
      setGroupNetBalances((prev) => ({ ...prev, [groupId]: allBal[userEmail] ?? 0 }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load expenses");
    } finally {
      setLoadingExpenses(false);
    }
  }, [authToken, userEmail]);

  useEffect(() => {
    void fetchGroups();
  }, [fetchGroups]);

  useEffect(() => {
    if (selectedGroup) void fetchExpenses(selectedGroup.id);
  }, [selectedGroup, fetchExpenses]);

  // Keep groups accessible in stable ref so balance-change effect doesn't need it as dep
  const groupsRef = useRef<SplitGroup[]>([]);
  useEffect(() => { groupsRef.current = groups; }, [groups]);

  // Re-sync accounts whenever per-group balances update (e.g. after settle/add expense)
  useEffect(() => {
    if (groupsRef.current.length > 0) {
      onSyncAccounts(groupsRef.current, groupNetBalances);
    }
  }, [groupNetBalances, onSyncAccounts]);

  async function handleCreateGroup(name: string, memberEmails: string[]) {
    await splitsApi("splitsCreateGroup", authToken, { name, memberEmails });
    setShowCreateGroup(false);
    await fetchGroups();
  }

  async function handleAddExpense(data: {
    description: string;
    totalAmount: number;
    paidBy: string;
    shares: { email: string; amount: number }[];
    linkedTransactionId?: string;
  }) {
    if (!selectedGroup) return;
    await splitsApi("splitsAddExpense", authToken, { groupId: selectedGroup.id, ...data });
    setShowAddExpense(false);
    await fetchExpenses(selectedGroup.id);
  }

  async function handleSettle(expenseId: string, settleEmail: string) {
    await splitsApi("splitsSettle", authToken, { expenseId, settleEmail });
    if (selectedGroup) await fetchExpenses(selectedGroup.id);
  }

  const balances = selectedGroup ? computeBalances(expenses, userEmail) : [];

  // ── Group detail view ──────────────────────────────────────────────────
  if (selectedGroup) {
    const totalOwed = balances.filter((b) => b.net > 0).reduce((s, b) => s + b.net, 0);
    const totalOwe = balances.filter((b) => b.net < 0).reduce((s, b) => s + Math.abs(b.net), 0);

    const groupWideBal = computeGroupWideBalances(expenses);
    const simplified = simplifyDebts(groupWideBal);

    return (
      <div className="tab-content splits-page">
        {showAddExpense && (
          <AddExpenseModal
            group={selectedGroup}
            currentUser={userEmail}
            transactions={transactions}
            onClose={() => setShowAddExpense(false)}
            onAdd={handleAddExpense}
          />
        )}

        <div className="splits-detail-header panel">
          <button className="ghost-btn splits-back-btn" onClick={() => { setSelectedGroup(null); setExpenses([]); }}>
            ← Back
          </button>
          <div className="splits-detail-title">
            <h2>{selectedGroup.name}</h2>
            <p className="splits-members-line">
              {selectedGroup.members.map((m) => m === userEmail ? "you" : shortEmail(m)).join(", ")}
            </p>
          </div>
          <button className="primary-btn" onClick={() => setShowAddExpense(true)}>+ Add</button>
        </div>

        {(totalOwed > 0 || totalOwe > 0) && (
          <section className="panel splits-balance-summary">
            {balances.map((b) => (
              <div key={b.email} className={`splits-balance-row ${b.net > 0 ? "plus" : "minus"}`}>
                <span>{b.net > 0 ? shortEmail(b.email) + " owes you" : "You owe " + shortEmail(b.email)}</span>
                <strong>{fmtAmount(b.net)}</strong>
              </div>
            ))}
          </section>
        )}

        {simplified.length > 0 && (
          <section className="panel splits-settle-up">
            <p className="splits-settle-title">
              Settle up · {simplified.length} payment{simplified.length > 1 ? "s" : ""}
            </p>
            {simplified.map((p, i) => (
              <div key={i} className="splits-settle-row">
                <span className={p.from === userEmail ? "splits-settle-you" : ""}>
                  {p.from === userEmail ? "You" : shortEmail(p.from)}
                </span>
                <span className="splits-settle-arrow">→</span>
                <span className={p.to === userEmail ? "splits-settle-you" : ""}>
                  {p.to === userEmail ? "you" : shortEmail(p.to)}
                </span>
                <strong>{fmtAmount(p.amount)}</strong>
              </div>
            ))}
          </section>
        )}

        {simplified.length === 0 && expenses.length > 0 && !loadingExpenses && (
          <div className="splits-all-settled panel">✓ All settled up</div>
        )}

        {error && <p className="splits-error">{error}</p>}

        {loadingExpenses ? (
          <p className="splits-loading">Loading expenses…</p>
        ) : expenses.length === 0 ? (
          <div className="panel splits-empty">
            <p>No expenses yet.</p>
            <button className="primary-btn" onClick={() => setShowAddExpense(true)}>Add first expense</button>
          </div>
        ) : (
          <div className="splits-expense-list">
            {[...expenses].reverse().map((exp) => (
              <ExpenseCard
                key={exp.id}
                expense={exp}
                currentUser={userEmail}
                onSettle={handleSettle}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  // ── Group list view ────────────────────────────────────────────────────
  return (
    <div className="tab-content splits-page">
      {showCreateGroup && (
        <CreateGroupModal
          currentUser={userEmail}
          onClose={() => setShowCreateGroup(false)}
          onCreate={handleCreateGroup}
        />
      )}

      <div className="splits-list-header panel">
        <h2>Splits</h2>
        <button className="primary-btn" onClick={() => setShowCreateGroup(true)}>+ New Group</button>
      </div>

      {error && <p className="splits-error">{error}</p>}

      {loadingGroups ? (
        <p className="splits-loading">Loading groups…</p>
      ) : groups.length === 0 ? (
        <div className="panel splits-empty">
          <p>No groups yet. Create one to start splitting expenses.</p>
          <button className="primary-btn" onClick={() => setShowCreateGroup(true)}>Create group</button>
        </div>
      ) : (
          <div className="splits-group-list">
          {groups.map((group) => {
            const net = groupNetBalances[group.id] ?? 0;
            return (
              <button
                key={group.id}
                className="splits-group-card panel"
                onClick={() => setSelectedGroup(group)}
              >
                <div className="splits-group-info">
                  <p className="splits-group-name">{group.name}</p>
                  <p className="splits-group-members">
                    {group.members.length} members · {group.members.map((m) => m === userEmail ? "you" : shortEmail(m)).join(", ")}
                  </p>
                </div>
                {Math.abs(net) > 0.01 && (
                  <span className={`splits-group-net ${net > 0 ? "plus" : "minus"}`}>
                    {net > 0 ? "+" : "-"}{fmtAmount(net)}
                  </span>
                )}
                <span className="splits-chevron">›</span>
              </button>
            );
          })}
          </div>
      )}
    </div>
  );
}
