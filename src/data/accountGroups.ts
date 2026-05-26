import type { AccountType } from "../types/finance";

export const defaultAccountTypes: AccountType[] = [
  { id: "portfolio", label: "Portfolio", defaultType: "asset", color: "#34d399" },
  { id: "bank", label: "Bank Accounts", defaultType: "asset", color: "#60a5fa" },
  { id: "credit", label: "Credit Cards", defaultType: "liability", color: "#f87171" },
  { id: "other", label: "Lent / Splitwise", defaultType: "asset", color: "#fbbf24" }
];
