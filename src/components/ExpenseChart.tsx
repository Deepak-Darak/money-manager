import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import type { Category, Transaction } from "../types/finance";

interface ExpenseChartProps {
  transactions: Transaction[];
  categories: Category[];
}

interface ChartDatum {
  name: string;
  value: number;
  color: string;
}

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0
});

export default function ExpenseChart({ transactions, categories }: ExpenseChartProps) {
  const expenseData = transactions.filter((transaction) => transaction.kind === "expense");

  const chartData: ChartDatum[] = categories
    .filter((category) => category.kind === "expense")
    .map((category) => {
      const value = expenseData
        .filter((expense) => expense.categoryId === category.id)
        .reduce((sum, expense) => sum + expense.amount, 0);

      return {
        name: category.name,
        value,
        color: category.color
      };
    })
    .filter((item) => item.value > 0)
    .sort((a, b) => b.value - a.value);

  return (
    <section className="panel chart-panel">
      <div className="panel-header-row">
        <h2>Expense Breakdown</h2>
      </div>

      {chartData.length === 0 ? (
        <p className="empty-state">Add expense transactions to see your category distribution.</p>
      ) : (
        <div className="chart-wrap">
          <ResponsiveContainer width="100%" height={280}>
            <PieChart>
              <Pie
                data={chartData}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="50%"
                outerRadius={95}
                innerRadius={52}
                paddingAngle={2}
              >
                {chartData.map((entry) => (
                  <Cell key={entry.name} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip formatter={(value: number) => currencyFormatter.format(value)} />
            </PieChart>
          </ResponsiveContainer>

          <div className="chart-legend-list">
            {chartData.map((item) => (
              <div key={item.name} className="legend-item">
                <span className="legend-swatch" style={{ backgroundColor: item.color }} />
                <span>{item.name}</span>
                <strong>{currencyFormatter.format(item.value)}</strong>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
