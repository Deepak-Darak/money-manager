export type Tab = "dashboard" | "transactions" | "accounts" | "charts" | "splits";

interface NavigationProps {
  activeTab: Tab;
  onChange: (tab: Tab) => void;
}

const TABS: { id: Tab; label: string; symbol: string }[] = [
  { id: "dashboard",    label: "Dashboard",     symbol: "◈" },
  { id: "transactions", label: "Transactions",  symbol: "≡" },
  { id: "accounts",     label: "Accounts",      symbol: "◉" },
  { id: "charts",       label: "Charts",        symbol: "◑" },
  { id: "splits",       label: "Splits",        symbol: "⇌" },
];

export default function Navigation({ activeTab, onChange }: NavigationProps) {
  return (
    <nav className="app-nav" aria-label="Main navigation">
      {TABS.map((t) => (
        <button
          key={t.id}
          className={`nav-btn${activeTab === t.id ? " active" : ""}`}
          onClick={() => onChange(t.id)}
          aria-current={activeTab === t.id ? "page" : undefined}
        >
          <span className="nav-icon" aria-hidden="true">{t.symbol}</span>
          <span className="nav-label">{t.label}</span>
        </button>
      ))}
    </nav>
  );
}
