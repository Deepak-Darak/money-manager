import { FormEvent, useState } from "react";
import { accountGroupConfigs } from "../data/accountGroups";
import type { Account, AccountGroup } from "../types/finance";

interface Props {
  accounts: Account[];
  onAdd: (a: Omit<Account, "id" | "createdAt">) => void;
  onDelete: (id: string) => void;
}

const fmt = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

const BLANK = {
  name: "",
  group: "bank" as AccountGroup,
  type: "asset" as "asset" | "liability",
  balance: "",
  note: "",
};

export default function AccountsPage({ accounts, onAdd, onDelete }: Props) {
  const [tab, setTab]           = useState<"asset" | "liability">("asset");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm]         = useState(BLANK);

  const totalAssets = accounts
    .filter((a) => a.type === "asset")
    .reduce((s, a) => s + a.balance, 0);
  const totalLiab = accounts
    .filter((a) => a.type === "liability")
    .reduce((s, a) => s + a.balance, 0);
  const netWorth = totalAssets - totalLiab;

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) return;
    onAdd({
      name:    form.name.trim(),
      group:   form.group,
      type:    form.type,
      balance: Number(form.balance) || 0,
      note:    form.note.trim() || undefined,
    });
    setForm(BLANK);
    setShowForm(false);
  }

  const visible = accounts.filter((a) => a.type === tab);

  return (
    <div className="accounts-page">
      {/* ── Net worth banner ───────────────────────────── */}
      <div className="networth-banner panel">
        <div className="networth-main">
          <p>Net Worth</p>
          <h2 className={netWorth >= 0 ? "plus" : "minus"}>{fmt.format(netWorth)}</h2>
        </div>
        <div className="networth-split">
          <div>
            <p>Assets</p>
            <strong className="plus">{fmt.format(totalAssets)}</strong>
          </div>
          <div>
            <p>Liabilities</p>
            <strong className="minus">{fmt.format(totalLiab)}</strong>
          </div>
        </div>
      </div>

      {/* ── Asset / Liability toggle ───────────────────── */}
      <div className="segmented-switch actype-switch">
        <button
          type="button"
          className={tab === "asset" ? "active" : ""}
          onClick={() => setTab("asset")}
        >
          Assets
        </button>
        <button
          type="button"
          className={tab === "liability" ? "active" : ""}
          onClick={() => setTab("liability")}
        >
          Liabilities
        </button>
      </div>

      {/* ── Account groups ─────────────────────────────── */}
      {accountGroupConfigs.map((grp) => {
        const grpAccounts = visible.filter((a) => a.group === grp.id);
        if (grpAccounts.length === 0 && grp.defaultType !== tab) return null;

        const grpTotal = grpAccounts.reduce((s, a) => s + a.balance, 0);

        return (
          <div key={grp.id} className="account-group panel">
            <div className="account-group-header">
              <div className="account-group-title">
                <span className="group-dot" style={{ backgroundColor: grp.color }} />
                <h3>{grp.label}</h3>
              </div>
              <strong style={{ color: grp.color }}>{fmt.format(grpTotal)}</strong>
            </div>

            {grpAccounts.length === 0 ? (
              <p className="empty-state" style={{ padding: "10px 0 2px" }}>
                No accounts yet.
              </p>
            ) : (
              grpAccounts.map((ac) => (
                <div key={ac.id} className="account-row">
                  <div className="account-row-left">
                    <span className="account-name">{ac.name}</span>
                    {ac.note && <small className="account-note">{ac.note}</small>}
                  </div>
                  <div className="account-row-right">
                    <span className={ac.type === "asset" ? "plus" : "minus"}>
                      {fmt.format(ac.balance)}
                    </span>
                    <button
                      type="button"
                      className="ghost-btn"
                      onClick={() => onDelete(ac.id)}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        );
      })}

      {/* ── Add account button ─────────────────────────── */}
      <button
        type="button"
        className="primary-btn"
        style={{ marginTop: 16 }}
        onClick={() => setShowForm((s) => !s)}
      >
        {showForm ? "Cancel" : "+ Add Account"}
      </button>

      {/* ── Add account form ───────────────────────────── */}
      {showForm && (
        <form className="panel form-panel" style={{ marginTop: 12 }} onSubmit={handleSubmit}>
          <h3 style={{ marginBottom: 14 }}>New Account</h3>

          <div className="form-grid">
            <label>
              Name
              <input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="e.g. HDFC Savings"
                required
              />
            </label>
            <label>
              Current Balance
              <input
                type="number"
                value={form.balance}
                onChange={(e) => setForm((f) => ({ ...f, balance: e.target.value }))}
                placeholder="0"
                min={0}
                step="0.01"
              />
            </label>
            <label>
              Group
              <select
                value={form.group}
                onChange={(e) => setForm((f) => ({ ...f, group: e.target.value as AccountGroup }))}
              >
                {accountGroupConfigs.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Type
              <select
                value={form.type}
                onChange={(e) =>
                  setForm((f) => ({ ...f, type: e.target.value as "asset" | "liability" }))
                }
              >
                <option value="asset">Asset</option>
                <option value="liability">Liability</option>
              </select>
            </label>
          </div>

          <label>
            Note (optional)
            <input
              value={form.note}
              onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
              placeholder="e.g. Primary savings account"
            />
          </label>

          <button type="submit" className="primary-btn">
            Save Account
          </button>
        </form>
      )}
    </div>
  );
}
