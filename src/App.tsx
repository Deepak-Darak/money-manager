import { useMemo, useState } from "react";
import { format, parse } from "date-fns";
import ExpenseChart from "./components/ExpenseChart";
import SummaryCards from "./components/SummaryCards";
import TransactionForm, { type NewTransactionInput } from "./components/TransactionForm";
import TransactionList from "./components/TransactionList";
import { categories } from "./data/categories";
import { useLocalStorage } from "./hooks/useLocalStorage";
import type { Transaction, TransactionKind } from "./types/finance";

function makeId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function getCurrentMonth() {
  return new Date().toISOString().slice(0, 7);
}

export default function App() {
  const [transactions, setTransactions] = useLocalStorage<Transaction[]>("mm-transactions", []);
  const [monthBudget, setMonthBudget] = useLocalStorage<number>("mm-month-budget", 1500);

  const [selectedMonth, setSelectedMonth] = useState<string>("all");
  const [kindFilter, setKindFilter] = useState<"all" | TransactionKind>("all");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");

  const monthOptions = useMemo(() => {
    const months = Array.from(new Set(transactions.map((item) => item.date.slice(0, 7))));
    return months.sort((a, b) => b.localeCompare(a));
  }, [transactions]);

  const filteredTransactions = useMemo(() => {
    return transactions.filter((item) => {
      if (selectedMonth !== "all" && item.date.slice(0, 7) !== selectedMonth) {
        return false;
      }
      if (kindFilter !== "all" && item.kind !== kindFilter) {
        return false;
      }
      if (categoryFilter !== "all" && item.categoryId !== categoryFilter) {
        return false;
      }
      return true;
    });
  }, [transactions, selectedMonth, kindFilter, categoryFilter]);

  const totals = useMemo(() => {
    const income = filteredTransactions
      .filter((item) => item.kind === "income")
      .reduce((sum, item) => sum + item.amount, 0);

    const expense = filteredTransactions
      .filter((item) => item.kind === "expense")
      .reduce((sum, item) => sum + item.amount, 0);

    return {
      income,
      expense,
      balance: income - expense
    };
  }, [filteredTransactions]);

  const budgetMonth = selectedMonth === "all" ? getCurrentMonth() : selectedMonth;
  const monthExpense = transactions
    .filter((item) => item.kind === "expense" && item.date.slice(0, 7) === budgetMonth)
    .reduce((sum, item) => sum + item.amount, 0);

  function addTransaction(payload: NewTransactionInput) {
    setTransactions((current) => [
      {
        ...payload,
        id: makeId(),
        createdAt: new Date().toISOString()
      },
      ...current
    ]);
  }

  function deleteTransaction(id: string) {
    setTransactions((current) => current.filter((transaction) => transaction.id !== id));
  }

  const categoryOptions =
    kindFilter === "all" ? categories : categories.filter((category) => category.kind === kindFilter);

  const budgetMonthLabel =
    budgetMonth === "all" ? "This Month" : format(parse(`${budgetMonth}-01`, "yyyy-MM-dd", new Date()), "MMMM yyyy");

  return (
    <div className="app-shell">
      <div className="background-layers" aria-hidden="true" />

      <header className="hero">
        <p className="eyebrow">Money Manager</p>
        <h1>Track every rupee and steer your future with clarity.</h1>
        <p>
          Keep income and expenses in one place, monitor budget usage, and understand where your money
          goes every month.
        </p>
      </header>

      <SummaryCards
        income={totals.income}
        expense={totals.expense}
        balance={totals.balance}
        monthBudget={monthBudget}
        monthExpense={monthExpense}
      />

      <section className="filters panel">
        <h2>Filters & Budget</h2>

        <div className="filter-grid">
          <label>
            Month
            <select value={selectedMonth} onChange={(event) => setSelectedMonth(event.target.value)}>
              <option value="all">All</option>
              {monthOptions.map((month) => (
                <option key={month} value={month}>
                  {format(parse(`${month}-01`, "yyyy-MM-dd", new Date()), "MMMM yyyy")}
                </option>
              ))}
            </select>
          </label>

          <label>
            Type
            <select
              value={kindFilter}
              onChange={(event) => {
                const next = event.target.value as "all" | TransactionKind;
                setKindFilter(next);
                setCategoryFilter("all");
              }}
            >
              <option value="all">All</option>
              <option value="income">Income</option>
              <option value="expense">Expense</option>
            </select>
          </label>

          <label>
            Category
            <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}>
              <option value="all">All</option>
              {categoryOptions.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </label>

          <label>
            Monthly Budget ({budgetMonthLabel})
            <input
              type="number"
              min={0}
              step="1"
              value={monthBudget}
              onChange={(event) => setMonthBudget(Number(event.target.value) || 0)}
            />
          </label>
        </div>
      </section>

      <main className="content-grid">
        <TransactionForm categories={categories} onAddTransaction={addTransaction} />
        <ExpenseChart transactions={filteredTransactions} categories={categories} />
      </main>

      <TransactionList transactions={filteredTransactions} categories={categories} onDelete={deleteTransaction} />
    </div>
  );
}
