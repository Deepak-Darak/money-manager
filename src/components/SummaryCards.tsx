interface SummaryCardsProps {
  income: number;
  expense: number;
  balance: number;
  monthBudget: number;
  monthExpense: number;
}

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "INR"
});

export default function SummaryCards({
  income,
  expense,
  balance,
  monthBudget,
  monthExpense
}: SummaryCardsProps) {
  const budgetUsage = monthBudget > 0 ? Math.min((monthExpense / monthBudget) * 100, 100) : 0;

  return (
    <section className="summary-grid">
      <article className="panel card income-card">
        <p>Total Income</p>
        <h3>{currencyFormatter.format(income)}</h3>
      </article>

      <article className="panel card expense-card">
        <p>Total Expense</p>
        <h3>{currencyFormatter.format(expense)}</h3>
      </article>

      <article className="panel card balance-card">
        <p>Balance</p>
        <h3>{currencyFormatter.format(balance)}</h3>
      </article>

      <article className="panel card budget-card">
        <p>Budget Usage</p>
        <h3>{monthBudget > 0 ? `${budgetUsage.toFixed(0)}%` : "Set Budget"}</h3>
        <div className="budget-track">
          <div className="budget-fill" style={{ width: `${budgetUsage}%` }} />
        </div>
      </article>
    </section>
  );
}
