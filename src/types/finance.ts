export type TransactionKind = "income" | "expense" | "transfer";
export type AccountGroup = string;

export interface AccountType {
  id: string;
  label: string;
  defaultType: "asset" | "liability";
  color: string;
}

export interface Category {
  id: string;
  name: string;
  kind: "income" | "expense";
  color: string;
  icon: string;
}

export interface Transaction {
  id: string;
  title: string;
  amount: number;
  kind: TransactionKind;
  categoryId?: string;
  accountId?: string;
  fromAccountId?: string;
  toAccountId?: string;
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
  splitGroupId?: string;
  createdAt: string;
}

export interface AppDataSnapshot {
  version: number;
  transactions: Transaction[];
  accounts: Account[];
  accountTypes: AccountType[];
  customCategories?: Category[];
}

export interface SplitShare {
  email: string;
  amount: number;
  settled: boolean;
}

export interface SplitGroup {
  id: string;
  name: string;
  members: string[];
  createdBy: string;
  createdAt: string;
}

export interface SplitExpense {
  id: string;
  groupId: string;
  description: string;
  totalAmount: number;
  paidBy: string;
  shares: SplitShare[];
  linkedTransactionId?: string;
  createdBy: string;
  createdAt: string;
}
