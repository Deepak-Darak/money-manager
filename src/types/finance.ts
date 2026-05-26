export type TransactionKind = "income" | "expense";
export type AccountGroup = "portfolio" | "bank" | "credit" | "other";

export interface Category {
  id: string;
  name: string;
  kind: TransactionKind;
  color: string;
  icon: string;
}

export interface Transaction {
  id: string;
  title: string;
  amount: number;
  kind: TransactionKind;
  categoryId: string;
  accountId?: string;
  date: string;
  note?: string;
  createdAt: string;
}

export interface Account {
  id: string;
  name: string;
  group: AccountGroup;
  type: "asset" | "liability";
  balance: number;
  note?: string;
  createdAt: string;
}
