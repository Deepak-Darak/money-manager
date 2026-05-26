export type TransactionKind = "income" | "expense";

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
  date: string;
  note?: string;
  createdAt: string;
}
