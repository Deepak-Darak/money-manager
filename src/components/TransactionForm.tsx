import { FormEvent, useEffect, useMemo, useState } from "react";
import type { Account, Category, TransactionKind } from "../types/finance";

export interface NewTransactionInput {
  title: string;
  amount: number;
  kind: TransactionKind;
  categoryId?: string;
  accountId?: string;
  fromAccountId?: string;
  toAccountId?: string;
  date: string;
  note?: string;
}

interface TransactionFormProps {
  categories: Category[];
  accounts?: Account[];
  onAddTransaction: (payload: NewTransactionInput) => void;
  initialValue?: Partial<NewTransactionInput>;
  submitLabel?: string;
  title?: string;
  onCancel?: () => void;
}

function getTodayString() {
  return new Date().toISOString().slice(0, 10);
}

export default function TransactionForm({
  categories,
  accounts,
  onAddTransaction,
  initialValue,
  submitLabel = "Save Transaction",
  title = "Add Transaction",
  onCancel
}: TransactionFormProps) {
  const [kind, setKind] = useState<TransactionKind>("expense");
  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(getTodayString);
  const [categoryId, setCategoryId] = useState("");
  const [accountId, setAccountId] = useState("");
  const [fromAccountId, setFromAccountId] = useState("");
  const [toAccountId, setToAccountId] = useState("");
  const [note, setNote] = useState("");

  const filteredCategories = useMemo(
    () => categories.filter((category) => category.kind === (kind === "income" ? "income" : "expense")),
    [categories, kind]
  );

  useEffect(() => {
    if (kind === "transfer") {
      setCategoryId("");
      return;
    }

    if (filteredCategories.length === 0) {
      setCategoryId("");
      return;
    }

    if (!filteredCategories.some((category) => category.id === categoryId)) {
      setCategoryId(filteredCategories[0].id);
    }
  }, [categoryId, filteredCategories]);

  useEffect(() => {
    if (!initialValue) {
      return;
    }

    setKind(initialValue.kind ?? "expense");
    setTitle(initialValue.title ?? "");
    setAmount(initialValue.amount !== undefined ? String(initialValue.amount) : "");
    setDate(initialValue.date ?? getTodayString());
    setCategoryId(initialValue.categoryId ?? "");
    setAccountId(initialValue.accountId ?? "");
    setFromAccountId(initialValue.fromAccountId ?? "");
    setToAccountId(initialValue.toAccountId ?? "");
    setNote(initialValue.note ?? "");
  }, [initialValue]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const parsedAmount = Number(amount);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      return;
    }

    if (kind === "transfer") {
      if (!fromAccountId || !toAccountId || fromAccountId === toAccountId) {
        return;
      }

      onAddTransaction({
        title: title.trim() || "Transfer",
        amount: parsedAmount,
        kind,
        fromAccountId,
        toAccountId,
        date,
        note: note.trim() ? note.trim() : undefined
      });

      setTitle("");
      setAmount("");
      setNote("");
      setFromAccountId("");
      setToAccountId("");
      return;
    }

    if (!title.trim() || !categoryId) {
      return;
    }

    onAddTransaction({
      title: title.trim(),
      amount: parsedAmount,
      kind,
      categoryId,
      accountId: accountId || undefined,
      date,
      note: note.trim() ? note.trim() : undefined
    });

    setTitle("");
    setAmount("");
    setNote("");
    setAccountId("");
  }

  return (
    <form className="panel form-panel" onSubmit={handleSubmit}>
      <div className="panel-header-row">
        <h2>{title}</h2>
      </div>

      <div className="segmented-switch" role="radiogroup" aria-label="Transaction type">
        <button
          type="button"
          className={kind === "expense" ? "active" : ""}
          onClick={() => setKind("expense")}
        >
          Expense
        </button>
        <button
          type="button"
          className={kind === "income" ? "active" : ""}
          onClick={() => setKind("income")}
        >
          Income
        </button>
        <button
          type="button"
          className={kind === "transfer" ? "active" : ""}
          onClick={() => setKind("transfer")}
        >
          Transfer
        </button>
      </div>

      <div className="form-grid">
        <label>
          Title
          <input
            type="text"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder={kind === "transfer" ? "e.g. Transfer to Savings" : "e.g. Groceries"}
          />
        </label>

        <label>
          Amount
          <input
            type="number"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            placeholder="0.00"
            min={0}
            step="0.01"
            required
          />
        </label>

        <label>
          Date
          <input
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
            required
          />
        </label>

        {kind !== "transfer" ? (
          <>
            <label>
              Category
              <select value={categoryId} onChange={(event) => setCategoryId(event.target.value)} required>
                {filteredCategories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
            </label>

            {accounts && accounts.length > 0 && (
              <label>
                Account
                <select value={accountId} onChange={(event) => setAccountId(event.target.value)}>
                  <option value="">None</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </>
        ) : (
          <>
            <label>
              From Account
              <select value={fromAccountId} onChange={(event) => setFromAccountId(event.target.value)} required>
                <option value="">Select source</option>
                {(accounts ?? []).map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>

            <label>
              To Account
              <select value={toAccountId} onChange={(event) => setToAccountId(event.target.value)} required>
                <option value="">Select destination</option>
                {(accounts ?? []).map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
      </div>

      <label>
        Note (optional)
        <textarea
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Any details you want to remember"
          rows={3}
        />
      </label>

      <div className="form-actions-row">
        <button type="submit" className="primary-btn">
          {submitLabel}
        </button>
        {onCancel && (
          <button type="button" className="ghost-btn" onClick={onCancel}>
            Cancel Edit
          </button>
        )}
      </div>
    </form>
  );
}
