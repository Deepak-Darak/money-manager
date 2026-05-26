import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { format, parseISO, subMonths } from "date-fns";
import type { Category, Transaction } from "../types/finance";

type ChartTab = "overview" | "expense" | "income" | "trend";

interface Props {
  transactions: Transaction[];
  categories: Category[];
}

const fmtINR = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

const tooltipStyle = {
  background: "var(--surface-2)",
  border: "1px solid var(--line)",
  borderRadius: 10,
  color: "var(--ink)",
};

const TABS: { id: ChartTab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "expense",  label: "Expense"  },
  { id: "income",   label: "Income"   },
  { id: "trend",    label: "Trend"    },
];

export default function ChartsDashboard({ transactions, categories }: Props) {
  const [tab, setTab] = useState<ChartTab>("overview");

  // ── Overview: last 6 months income vs expense ─────
  const overviewData = useMemo(
    () =>
      Array.from({ length: 6 }, (_, i) => {
        const d        = subMonths(new Date(), 5 - i);
        const monthStr = format(d, "yyyy-MM");
        const txs      = transactions.filter((t) => t.date.startsWith(monthStr));
        return {
          month:   format(d, "MMM yy"),
          Income:  txs.filter((t) => t.kind === "income").reduce((s, t) => s + t.amount, 0),
          Expense: txs.filter((t) => t.kind === "expense").reduce((s, t) => s + t.amount, 0),
        };
      }),
    [transactions]
  );

  // ── Pie data for a given kind ─────────────────────
  function buildPieData(kind: "income" | "expense") {
    return categories
      .filter((c) => c.kind === kind)
      .map((c) => ({
        name:  c.name,
        value: transactions
          .filter((t) => t.kind === kind && t.categoryId === c.id)
          .reduce((s, t) => s + t.amount, 0),
        color: c.color,
      }))
      .filter((d) => d.value > 0)
      .sort((a, b) => b.value - a.value);
  }

  // ── Trend: running balance by month ───────────────
  const trendData = useMemo(() => {
    const sorted = [...transactions].sort((a, b) => a.date.localeCompare(b.date));
    let balance = 0;
    const monthly: Record<string, number> = {};
    sorted.forEach((t) => {
      const m = t.date.slice(0, 7);
      balance += t.kind === "income" ? t.amount : -t.amount;
      monthly[m] = balance;
    });
    return Object.entries(monthly).map(([m, v]) => ({
      month:   format(parseISO(m + "-01"), "MMM yy"),
      Balance: Math.round(v),
    }));
  }, [transactions]);

  // ── Pie section renderer ──────────────────────────
  function renderPie(kind: "income" | "expense") {
    const data = buildPieData(kind);
    if (data.length === 0)
      return (
        <p className="empty-state" style={{ marginTop: 24 }}>
          No {kind} transactions yet.
        </p>
      );
    return (
      <div className="chart-section">
        <h3>{kind === "expense" ? "Expense" : "Income"} by Category</h3>
        <ResponsiveContainer width="100%" height={260}>
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              outerRadius={100}
              innerRadius={55}
              paddingAngle={2}
            >
              {data.map((d) => (
                <Cell key={d.name} fill={d.color} />
              ))}
            </Pie>
            <Tooltip
              formatter={(v: number) => fmtINR.format(v)}
              contentStyle={tooltipStyle}
            />
          </PieChart>
        </ResponsiveContainer>
        <div className="chart-legend-list">
          {data.map((d) => (
            <div key={d.name} className="legend-item">
              <span className="legend-swatch" style={{ backgroundColor: d.color }} />
              <span>{d.name}</span>
              <strong>{fmtINR.format(d.value)}</strong>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <section className="charts-page panel">
      <div className="panel-header-row" style={{ marginBottom: 4 }}>
        <h2>Analytics</h2>
      </div>

      <div className="chart-tab-bar">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`chart-tab-btn${tab === t.id ? " active" : ""}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Overview ── */}
      {tab === "overview" && (
        <div className="chart-section">
          <h3>Income vs Expense — Last 6 Months</h3>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={overviewData} margin={{ left: -10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
              <XAxis dataKey="month" tick={{ fill: "var(--ink-3)", fontSize: 12 }} />
              <YAxis
                tick={{ fill: "var(--ink-3)", fontSize: 11 }}
                tickFormatter={(v: number) => `₹${(v / 1000).toFixed(0)}k`}
              />
              <Tooltip
                formatter={(v: number) => fmtINR.format(v)}
                contentStyle={tooltipStyle}
              />
              <Bar dataKey="Income"  fill="var(--accent)"     radius={[4, 4, 0, 0]} />
              <Bar dataKey="Expense" fill="var(--accent-red)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* ── Expense pie ── */}
      {tab === "expense" && renderPie("expense")}

      {/* ── Income pie ── */}
      {tab === "income" && renderPie("income")}

      {/* ── Balance trend ── */}
      {tab === "trend" && (
        <div className="chart-section">
          <h3>Balance Trend Over Time</h3>
          {trendData.length === 0 ? (
            <p className="empty-state">Add transactions to see your balance trend.</p>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={trendData} margin={{ left: -10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
                <XAxis dataKey="month" tick={{ fill: "var(--ink-3)", fontSize: 12 }} />
                <YAxis
                  tick={{ fill: "var(--ink-3)", fontSize: 11 }}
                  tickFormatter={(v: number) => `₹${(v / 1000).toFixed(0)}k`}
                />
                <Tooltip
                  formatter={(v: number) => fmtINR.format(v)}
                  contentStyle={tooltipStyle}
                />
                <Line
                  type="monotone"
                  dataKey="Balance"
                  stroke="var(--accent-blue)"
                  strokeWidth={2}
                  dot={{ fill: "var(--accent-blue)", r: 3 }}
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      )}
    </section>
  );
}
