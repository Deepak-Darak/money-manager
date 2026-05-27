import { useRef, useState } from "react";
import * as XLSX from "xlsx";
import type { Account, Category } from "../types/finance";

// ── Column header synonyms for common Indian bank / UPI exports ────────────
const DATE_KEYS    = ["date", "txn date", "transaction date", "value date", "tran date", "posting date", "trans date", "dt", "settled on"];
const DESC_KEYS    = ["description", "narration", "particulars", "transaction remarks", "details", "remarks", "trans details", "transaction details", "beneficiary name", "narration/chq. no.", "narration/chq no", "chq no./desc.", "particulars/cheque no.", "transaction", "transaction description", "merchant name", "ref no./narration", "upi description"];
const DEBIT_KEYS   = ["debit", "debit amount", "withdrawal", "dr", "withdrawal amt", "withdrawl amount", "debit(inr)", "debit(₹)", "debit amt(inr)", "amount(dr)", "amount debited", "money out"];
const CREDIT_KEYS  = ["credit", "credit amount", "deposit", "cr", "deposit amt", "credit(inr)", "credit(₹)", "credit amt(inr)", "amount(cr)", "amount credited", "money in"];
const AMOUNT_KEYS  = ["amount", "transaction amount", "trans amount", "amt", "txn amount", "inr amount"];
const TYPE_KEYS    = ["type", "transaction type", "txn type", "dr/cr", "cr/dr", "debit/credit"];

// ── Auto-category rules (Indian merchant / keyword patterns) ─────────────
const CATEGORY_RULES: Array<{ pattern: RegExp; category: string; kind: "income" | "expense" }> = [
  { pattern: /swiggy|zomato|restaurant|hotel|bakery|burger|pizza|cafe|dhaba|canteen|dominos|kfc|mcdonalds|starbucks|biryani|tiffin|mess\b/i, category: "food", kind: "expense" },
  { pattern: /uber|ola\b|rapido|metro\b|irctc|railway|flight|airline|bus\b|petrol|fuel|diesel|parking|fastag|cab|namma\s*metro|bmtc|ksrtc|redbus|cleartrip|makemytrip|yatra|goibibo/i, category: "transport", kind: "expense" },
  { pattern: /amazon|flipkart|myntra|meesho|ajio|nykaa|shoppers\s*stop|westside|dmart|reliance\s*smart|ikea|croma|vijay\s*sales|bigbasket|blinkit|zepto|grofers|instamart/i, category: "shopping", kind: "expense" },
  { pattern: /electricity|water\s*bill|\bgas\b|lpg\b|recharge|jio\b|airtel|bsnl|\bvi\b|vodafone|broadband|internet|tata\s*power|bescom|msedcl|adani\s*electric|bescom|telecom/i, category: "utilities", kind: "expense" },
  { pattern: /\brent\b|lease\b|pghouse|paying\s*guest/i, category: "rent", kind: "expense" },
  { pattern: /hospital|pharmacy|medicine|medical\b|apollo|fortis|max\s*hospital|cipla|medplus|1mg|practo|health|clinic|doctor|dentist|thyrocare|lal\s*path/i, category: "health", kind: "expense" },
  { pattern: /netflix|spotify|amazon\s*prime|hotstar|jiocinema|mxplayer|zee5|youtube\s*premium|cinema|movie|theatre|pvr|inox|bookmyshow/i, category: "entertainment", kind: "expense" },
  { pattern: /salary|sal\s*cr|payroll|stipend|\bctc\b|wages|sal\s*transfer|salary\s*credit/i, category: "salary", kind: "income" },
  { pattern: /freelance|consulting\s*fee|contract\s*pay|payment\s*received|client\s*payment/i, category: "freelance", kind: "income" },
  { pattern: /interest|dividend|redemption|mutual\s*fund|refund|cashback/i, category: "other-income", kind: "income" },
];

interface StagedTx {
  _id: string;
  selected: boolean;
  date: string;
  title: string;
  amount: number;
  kind: "income" | "expense";
  categoryId: string;
  accountId: string;
}

interface ColumnMap {
  date: string | null;
  desc: string | null;
  debit: string | null;
  credit: string | null;
  amount: string | null;
  type: string | null;
}

export interface ImportedTx {
  title: string;
  amount: number;
  kind: "income" | "expense";
  date: string;
  categoryId?: string;
  accountId?: string;
}

interface Props {
  accounts: Account[];
  categories: Category[];
  onImport: (txs: ImportedTx[]) => void;
  onClose: () => void;
}

function makeId() {
  return `imp-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function detectColumns(headers: string[]): ColumnMap {
  const lower = headers.map((h) => String(h).toLowerCase().trim());
  const find = (keys: string[]): string | null => {
    for (const key of keys) {
      const idx = lower.findIndex((h) => h === key);
      if (idx >= 0) return headers[idx];
    }
    for (const key of keys) {
      const idx = lower.findIndex((h) => h.includes(key));
      if (idx >= 0) return headers[idx];
    }
    return null;
  };
  return {
    date:   find(DATE_KEYS),
    desc:   find(DESC_KEYS),
    debit:  find(DEBIT_KEYS),
    credit: find(CREDIT_KEYS),
    amount: find(AMOUNT_KEYS),
    type:   find(TYPE_KEYS),
  };
}

function parseAmount(val: unknown): number {
  if (val === "" || val == null) return 0;
  const str = String(val).replace(/[₹$,\s]/g, "");
  const num = parseFloat(str);
  return isNaN(num) ? 0 : Math.abs(num);
}

function parseDate(val: unknown): string {
  if (!val && val !== 0) return new Date().toISOString().slice(0, 10);
  const str = String(val).trim();

  // DD/MM/YYYY or DD-MM-YYYY  
  const dmy = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (dmy) {
    let year = parseInt(dmy[3]);
    if (year < 100) year += 2000;
    const day = parseInt(dmy[1]);
    const month = parseInt(dmy[2]);
    const d = new Date(year, month - 1, day);
    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }

  // YYYY-MM-DD
  const ymd = str.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
  if (ymd) {
    const d = new Date(parseInt(ymd[1]), parseInt(ymd[2]) - 1, parseInt(ymd[3]));
    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }

  // Excel serial date (number between 40000–60000 ≈ year 2009–2064)
  const serial = Number(val);
  if (!isNaN(serial) && serial > 40000 && serial < 60000) {
    const d = new Date((serial - 25569) * 86400 * 1000);
    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }

  // Fallback
  const fallback = new Date(str);
  if (!isNaN(fallback.getTime())) return fallback.toISOString().slice(0, 10);

  return new Date().toISOString().slice(0, 10);
}

function autoCategory(title: string, fallbackKind: "income" | "expense"): { categoryId: string; kind: "income" | "expense" } {
  for (const rule of CATEGORY_RULES) {
    if (rule.pattern.test(title)) {
      return { categoryId: rule.category, kind: rule.kind };
    }
  }
  return {
    categoryId: fallbackKind === "income" ? "other-income" : "other-expense",
    kind: fallbackKind,
  };
}

function parseRows(rows: Record<string, unknown>[], colMap: ColumnMap, defaultAccountId: string): StagedTx[] {
  const txs: StagedTx[] = [];

  for (const row of rows) {
    const rawDesc = colMap.desc ? String(row[colMap.desc] ?? "").trim() : "";
    if (!rawDesc) continue;

    const date = parseDate(colMap.date ? row[colMap.date] : "");
    let amount = 0;
    let kind: "income" | "expense" = "expense";

    if (colMap.debit && colMap.credit) {
      const debit  = parseAmount(row[colMap.debit]);
      const credit = parseAmount(row[colMap.credit]);
      if (debit > 0) {
        amount = debit;
        kind = "expense";
      } else if (credit > 0) {
        amount = credit;
        kind = "income";
      } else {
        continue;
      }
    } else if (colMap.amount) {
      const raw = String(row[colMap.amount] ?? "").replace(/[₹$,\s]/g, "");
      const num = parseFloat(raw);
      if (isNaN(num) || num === 0) continue;
      amount = Math.abs(num);
      kind = num < 0 ? "expense" : "income";

      if (colMap.type) {
        const t = String(row[colMap.type] ?? "").toLowerCase();
        if (t.includes("dr") || t.includes("debit") || t.includes("withdrawal") || t.includes("out")) {
          kind = "expense";
        } else if (t.includes("cr") || t.includes("credit") || t.includes("deposit") || t.includes("in")) {
          kind = "income";
        }
      }
    } else {
      continue;
    }

    const { categoryId, kind: catKind } = autoCategory(rawDesc, kind);
    const finalCategoryId = catKind === kind ? categoryId : (kind === "income" ? "other-income" : "other-expense");

    txs.push({
      _id: makeId(),
      selected: true,
      date,
      title: rawDesc.slice(0, 100),
      amount,
      kind,
      categoryId: finalCategoryId,
      accountId: defaultAccountId,
    });
  }

  return txs;
}

export default function StatementImport({ accounts, categories, onImport, onClose }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [staged, setStaged] = useState<StagedTx[]>([]);
  const [step, setStep] = useState<"upload" | "review">("upload");
  const [error, setError] = useState("");
  const [isParsing, setIsParsing] = useState(false);

  const expCategories = categories.filter((c) => c.kind === "expense");
  const incCategories = categories.filter((c) => c.kind === "income");
  const defaultAccountId = accounts[0]?.id ?? "";

  async function handleFile(file: File) {
    setError("");
    setIsParsing(true);
    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: "array", cellDates: false });
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });

      if (rows.length === 0) {
        setError("No data rows found. Make sure the file has a header row and transaction rows.");
        setIsParsing(false);
        return;
      }

      const headers = Object.keys(rows[0]);
      const colMap = detectColumns(headers);

      if (!colMap.desc) {
        setError(`Could not detect a description column. Found: ${headers.slice(0, 6).join(", ")}. Try exporting as CSV.`);
        setIsParsing(false);
        return;
      }

      const txs = parseRows(rows, colMap, defaultAccountId);

      if (txs.length === 0) {
        setError("Parsed 0 transactions. The file may have no amount columns or all rows are empty.");
        setIsParsing(false);
        return;
      }

      setStaged(txs);
      setStep("review");
    } catch (err) {
      setError("Failed to read file. Make sure it is a valid CSV or Excel (.xlsx) file.");
      console.error(err);
    }
    setIsParsing(false);
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) void handleFile(file);
    e.target.value = "";
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) void handleFile(file);
  }

  function toggleRow(id: string) {
    setStaged((prev) => prev.map((tx) => tx._id === id ? { ...tx, selected: !tx.selected } : tx));
  }

  function toggleAll(checked: boolean) {
    setStaged((prev) => prev.map((tx) => ({ ...tx, selected: checked })));
  }

  function updateRow(id: string, changes: Partial<StagedTx>) {
    setStaged((prev) => prev.map((tx) => tx._id === id ? { ...tx, ...changes } : tx));
  }

  function handleImport() {
    const toImport = staged.filter((tx) => tx.selected && tx.amount > 0);
    onImport(
      toImport.map((tx) => ({
        title: tx.title,
        amount: tx.amount,
        kind: tx.kind,
        date: tx.date,
        categoryId: tx.categoryId || undefined,
        accountId: tx.accountId || undefined,
      }))
    );
    onClose();
  }

  const selectedCount = staged.filter((tx) => tx.selected).length;
  const allSelected = staged.length > 0 && staged.every((tx) => tx.selected);

  // ── Upload step ───────────────────────────────────────────────────────────
  if (step === "upload") {
    return (
      <div className="import-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
        <div className="import-modal panel">
          <div className="import-header">
            <h2>Import Bank Statement</h2>
            <button type="button" className="ghost-btn icon-btn" aria-label="Close" onClick={onClose}>
              <svg viewBox="0 0 24 24" aria-hidden="true" width="18" height="18">
                <path d="M6 6l12 12M6 18L18 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </button>
          </div>

          <p className="import-sub">
            Works with CSV and Excel (.xlsx) from HDFC, SBI, ICICI, Axis, PhonePe, GPay, and most credit cards.
          </p>

          {error && <p className="import-error">{error}</p>}

          <div
            className={`import-dropzone${isParsing ? " import-dropzone--loading" : ""}`}
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleDrop}
            onClick={() => !isParsing && fileRef.current?.click()}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === "Enter" && fileRef.current?.click()}
          >
            {isParsing ? (
              <p className="import-parsing">Parsing file…</p>
            ) : (
              <>
                <svg viewBox="0 0 24 24" width="40" height="40" aria-hidden="true">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                  <polyline points="14 2 14 8 20 8" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                  <line x1="12" y1="12" x2="12" y2="18" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                  <polyline points="9 15 12 12 15 15" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <p className="import-dropzone-label">Tap to select or drag a file here</p>
                <p className="import-dropzone-hint">CSV · XLS · XLSX</p>
              </>
            )}
          </div>

          <input
            ref={fileRef}
            type="file"
            accept=".csv,.xlsx,.xls"
            style={{ display: "none" }}
            onChange={handleFileChange}
          />

          <p className="import-tip">
            Tip: In your bank app, go to <strong>Statements → Download → CSV</strong>. Remove any header lines that are not column names before importing.
          </p>
        </div>
      </div>
    );
  }

  // ── Review step ───────────────────────────────────────────────────────────
  return (
    <div className="import-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="import-modal import-modal--wide panel">
        <div className="import-header">
          <div>
            <h2>Review Transactions</h2>
            <p className="import-sub">
              {staged.length} detected · <strong>{selectedCount} selected</strong> to import
            </p>
          </div>
          <button type="button" className="ghost-btn icon-btn" aria-label="Close" onClick={onClose}>
            <svg viewBox="0 0 24 24" aria-hidden="true" width="18" height="18">
              <path d="M6 6l12 12M6 18L18 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="import-table-wrap">
          <table className="import-table">
            <thead>
              <tr>
                <th>
                  <input type="checkbox" checked={allSelected} onChange={(e) => toggleAll(e.target.checked)} title="Select all" />
                </th>
                <th>Date</th>
                <th>Description</th>
                <th>Type</th>
                <th>Amount (₹)</th>
                <th>Category</th>
                <th>Account</th>
              </tr>
            </thead>
            <tbody>
              {staged.map((tx) => (
                <tr key={tx._id} className={tx.selected ? "import-row-on" : "import-row-off"}>
                  <td>
                    <input type="checkbox" checked={tx.selected} onChange={() => toggleRow(tx._id)} />
                  </td>
                  <td>
                    <input
                      type="date"
                      className="import-cell-input"
                      value={tx.date}
                      onChange={(e) => updateRow(tx._id, { date: e.target.value })}
                    />
                  </td>
                  <td>
                    <input
                      type="text"
                      className="import-cell-input import-desc-input"
                      value={tx.title}
                      onChange={(e) => updateRow(tx._id, { title: e.target.value })}
                    />
                  </td>
                  <td>
                    <select
                      className="import-cell-input"
                      value={tx.kind}
                      onChange={(e) => {
                        const kind = e.target.value as "income" | "expense";
                        const catList = kind === "income" ? incCategories : expCategories;
                        updateRow(tx._id, { kind, categoryId: catList[catList.length - 1]?.id ?? "" });
                      }}
                    >
                      <option value="expense">Expense</option>
                      <option value="income">Income</option>
                    </select>
                  </td>
                  <td>
                    <input
                      type="number"
                      className="import-cell-input import-amount-input"
                      value={tx.amount}
                      min="0"
                      step="0.01"
                      onChange={(e) => updateRow(tx._id, { amount: parseFloat(e.target.value) || 0 })}
                    />
                  </td>
                  <td>
                    <select
                      className="import-cell-input"
                      value={tx.categoryId}
                      onChange={(e) => updateRow(tx._id, { categoryId: e.target.value })}
                    >
                      {(tx.kind === "income" ? incCategories : expCategories).map((c) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <select
                      className="import-cell-input"
                      value={tx.accountId}
                      onChange={(e) => updateRow(tx._id, { accountId: e.target.value })}
                    >
                      <option value="">— no account —</option>
                      {accounts.map((a) => (
                        <option key={a.id} value={a.id}>{a.name}</option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="import-footer">
          <button type="button" className="ghost-btn" onClick={() => { setStep("upload"); setStaged([]); }}>
            ← Back
          </button>
          <button
            type="button"
            className="primary-btn import-confirm-btn"
            disabled={selectedCount === 0}
            onClick={handleImport}
          >
            Import {selectedCount} Transaction{selectedCount !== 1 ? "s" : ""}
          </button>
        </div>
      </div>
    </div>
  );
}
