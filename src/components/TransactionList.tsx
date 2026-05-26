import { format, parseISO } from "date-fns";
import type { Category, Transaction } from "../types/finance";

interface TransactionListProps {
  transactions: Transaction[];
  categories: Category[];
  onDelete: (id: string) => void;
}

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "INR"
});

export default function TransactionList({ transactions, categories, onDelete }: TransactionListProps) {
  const categoryMap = new Map(categories.map((category) => [category.id, category]));

  const sorted = [...transactions].sort((a, b) => {
    if (a.date === b.date) {
      return b.createdAt.localeCompare(a.createdAt);
    }
    return b.date.localeCompare(a.date);
  });

  return (
    <section className="panel list-panel">
      <div className="panel-header-row">
        <h2>Transactions</h2>
        <span>{sorted.length} items</span>
      </div>

      {sorted.length === 0 ? (
        <p className="empty-state">No transactions found for selected filters.</p>
      ) : (
        <div className="transaction-list">
          {sorted.map((transaction) => {
            const category = categoryMap.get(transaction.categoryId ?? "");

            return (
              <article key={transaction.id} className="transaction-item">
                <div className="transaction-main">
                  <h3>{transaction.title}</h3>
                  <p>
                    {category?.icon} {category?.name ?? "Uncategorized"}
                  </p>
                  {transaction.note ? <small>{transaction.note}</small> : null}
                </div>

                <div className="transaction-meta">
                  <strong className={transaction.kind === "income" ? "plus" : "minus"}>
                    {transaction.kind === "income" ? "+" : "-"}
                    {currencyFormatter.format(transaction.amount)}
                  </strong>
                  <span>{format(parseISO(transaction.date), "dd MMM yyyy")}</span>
                  <button
                    type="button"
                    className="ghost-btn"
                    onClick={() => onDelete(transaction.id)}
                  >
                    Delete
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
