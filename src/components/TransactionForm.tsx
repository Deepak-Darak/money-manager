import { FormEvent, useEffect, useMemo, useState } from "react";
import type { Account, Category, TransactionKind } from "../types/finance";

export interface NewTransactionInput {
  title: string;
  amount: number;
  kind: TransactionKind;
  categoryId: string;
  accountId?: string;
  date: string;
  note?: string;
}

interface TransactionFormProps {
  categories: Category[];
  accounts?: Account[];
  onAddTransaction: (payload: NewTransactionInput) => void;
}

function getTodayString() {
  return new Date().toISOString().slice(0, 10);
}

export default function TransactionForm({ categories, accounts, onAddTransaction }: TransactionFormProps) {
  const [kind, setKind] = useState<TransactionKind>("expense");
  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(getTodayString);
  const [categoryId, setCategoryId] = useState("");
  const [accountId, setAccountId] = useState("");
  const [note, setNote] = useState("");

  const filteredCategories = useMemo(
    () => categories.filter((category) => category.kind === kind),
    [categories, kind]
  );

  useEffect(() => {
    if (filteredCategories.length === 0) {
      setCategoryId("");
      return;
    }

    if (!filteredCategories.some((category) => category.id === categoryId)) {
      setCategoryId(filteredCategories[0].id);
    }
  }, [categoryId, filteredCategories]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const parsedAmount = Number(amount);
    if (!title.trim() || !categoryId || !Number.isFinite(parsedAmount) || parsedAmount <= 0) {
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
  }

  return (
    <form className="panel form-panel" onSubmit={handleSubmit}>
      <div className="panel-header-row">
        <h2>Add Transaction</h2>
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
      </div>

      <div className="form-grid">
        <label>
          Title
          <input
            type="text"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="e.g. Groceries"
            required
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
            Account (optional)
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

      <button type="submit" className="primary-btn">
        Save Transaction
      </button>
    </form>
  );
}
