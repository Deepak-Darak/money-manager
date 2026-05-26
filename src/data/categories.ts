import type { Category } from "../types/finance";

export const categories: Category[] = [
  { id: "salary", name: "Salary", kind: "income", color: "#1a936f", icon: "SAL" },
  { id: "freelance", name: "Freelance", kind: "income", color: "#0fa3b1", icon: "FRL" },
  { id: "business", name: "Business", kind: "income", color: "#2a9d8f", icon: "BUS" },
  { id: "other-income", name: "Other Income", kind: "income", color: "#4f772d", icon: "OTH" },
  { id: "food", name: "Food", kind: "expense", color: "#f4a261", icon: "FOD" },
  { id: "rent", name: "Rent", kind: "expense", color: "#e76f51", icon: "RNT" },
  { id: "transport", name: "Transport", kind: "expense", color: "#577590", icon: "TRN" },
  { id: "shopping", name: "Shopping", kind: "expense", color: "#bc4749", icon: "SHP" },
  { id: "utilities", name: "Utilities", kind: "expense", color: "#386641", icon: "UTL" },
  { id: "health", name: "Health", kind: "expense", color: "#6a4c93", icon: "HLT" },
  { id: "entertainment", name: "Entertainment", kind: "expense", color: "#ff006e", icon: "ENT" },
  { id: "other-expense", name: "Other Expense", kind: "expense", color: "#5f0f40", icon: "OTH" }
];
