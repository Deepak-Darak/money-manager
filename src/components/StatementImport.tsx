import { useRef, useState } from "react";
import * as XLSX from "xlsx";
import type { Account, Category } from "../types/finance";
import { isPhonePeStatement, extractPhonePeTransactions } from "../utils/phonepeExtractor";

// ── PDF text item with position ───────────────────────────────────────────
interface PdfCell { x: number; y: number; text: string; }

// Regex patterns used exclusively by the PDF parser
// Date: DD/MM/YYYY, YYYY-MM-DD, DD MMM YYYY, and MMM DD, YYYY (PhonePe style)
const PDF_DATE_RX = /\b(\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}|\d{4}[\/.-]\d{1,2}[\/.-]\d{1,2}|\d{1,2}\s+(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{2,4}|(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2},?\s+\d{2,4})\b/i;
// Monetary amount: decimal values always allowed; integer values only when currency marker exists.
const PDF_AMOUNT_RX = /([+-]?\s*(?:₹|rs\.?|inr)\s*\d{1,3}(?:,\d{2,3})*(?:\.\d{1,2})?|[+-]?\s*\d{1,3}(?:,\d{2,3})*\.\d{1,2}|[+-]?\s*\d+\.\d{1,2})/gi;
// Lines to ignore entirely (ads, page numbers, account info, totals)
const NOISE_RX = /page\s*\d+(?:\s*of\s*\d+)?|statement\s*(date|period|summary|number)|account\s*(no\.?|number|summary|holder|type|name|details)|credit\s*limit|available\s*(credit|balance|limit)|minimum\s*(amount\s*)?due|payment\s*due(\s*date)?|total\s*(amount|due|outstanding|charges|credit|debit|transactions)|opening\s*balance|closing\s*balance|reward\s*(points|pts)|dear\s*(customer|member|cardholder|card\s*holder)|thank\s*you|for\s*(queries|assistance|support|any)|customer\s*(care|service)|toll[\s\-]free|helpline|www\.|[a-z0-9\-]+\.(?:com|in|co\.in|net|org)\b|billing\s*(date|period|cycle)|bill\s*(date|generated)|generated\s*on|previous\s*balance|amount\s*carried|sub[\s\-]?total|finance\s*charge|late\s*payment|service\s*tax|gst\s*on|surcharge|\bgstin\b|\bpan\b|\bifsc\b/i;

/**
 * Phase 1: Column-header based extraction — the same structured approach used for CSV/Excel.
 * Works well when the PDF has a clean table with a recognisable header row.
 * Also returns the raw lineGroups so Phase 2 can reuse the already-extracted text.
 */
async function parsePdfToRows(pdfBytes: Uint8Array, password?: string): Promise<{
  rows: Record<string, unknown>[];
  rawHeaders: string[];
  lineGroups: PdfCell[][];
}> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pdfjs = (await import("pdfjs-dist")) as any;
  pdfjs.GlobalWorkerOptions.workerSrc =
    `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.mjs`;

  // Attempt to load PDF with password if provided
  // pdfjs accepts both 'password' and 'userPassword' parameters for compatibility
  const docParams: any = {
    data: pdfBytes,
  };
  if (password) {
    docParams.password = password;
    docParams.userPassword = password; // Try both for compatibility
    console.log("[PDF] Attempting to load with password");
  } else {
    console.log("[PDF] Attempting to load without password");
  }

  let pdf;
  try {
    pdf = await pdfjs.getDocument(docParams).promise;
    console.log("[PDF] Successfully loaded document with", pdf.numPages, "pages");
  } catch (docErr) {
    console.error("[PDF] Document loading failed:", docErr);
    throw docErr;
  }
  const allCells: PdfCell[] = [];
  let pageYOffset = 0;

  for (let p = 1; p <= pdf.numPages; p++) {
    try {
      const page = await pdf.getPage(p);
      const vp = page.getViewport({ scale: 1 });
      const tc = await page.getTextContent();
      console.log("[PDF] Page", p, "extracted", tc.items.length, "items");
      for (const item of tc.items) {
        if (!("str" in item) || !item.str.trim()) continue;
        const x = Math.round(item.transform[4]);
        const y = Math.round(vp.height - item.transform[5]) + pageYOffset;
        allCells.push({ x, y, text: item.str.trim() });
      }
      pageYOffset += Math.ceil(vp.height) + 30;
    } catch (pageErr) {
      console.error("[PDF] Error extracting page", p, ":", pageErr);
      throw pageErr;
    }
  }

  if (allCells.length === 0) {
    console.warn("[PDF] No cells extracted from any page");
    return { rows: [], rawHeaders: [], lineGroups: [] };
  }

  allCells.sort((a, b) => a.y - b.y || a.x - b.x);
  const lineGroups: PdfCell[][] = [];
  for (const cell of allCells) {
    const last = lineGroups[lineGroups.length - 1];
    if (last && Math.abs(cell.y - last[0].y) <= 5) {
      last.push(cell);
    } else {
      lineGroups.push([cell]);
    }
  }
  for (const g of lineGroups) g.sort((a, b) => a.x - b.x);

  const ALL_AMOUNT_KEYS = [...DEBIT_KEYS, ...CREDIT_KEYS, ...AMOUNT_KEYS];
  let headerIdx = -1;
  for (let i = 0; i < lineGroups.length; i++) {
    const line = lineGroups[i].map((c) => c.text.toLowerCase()).join(" ");
    const hasDate = DATE_KEYS.some((k) => line.includes(k));
    const hasAmt  = ALL_AMOUNT_KEYS.some((k) => line.includes(k));
    if (hasDate && hasAmt) { headerIdx = i; break; }
  }
  if (headerIdx === -1) return { rows: [], rawHeaders: [], lineGroups };

  const colDefs = lineGroups[headerIdx].map((c) => ({ name: c.text, x: c.x }));

  function nearestColName(x: number): string {
    let best = colDefs[0];
    let bestDist = Math.abs(x - best.x);
    for (const col of colDefs) {
      const d = Math.abs(x - col.x);
      if (d < bestDist) { bestDist = d; best = col; }
    }
    return best.name;
  }

  const rows: Record<string, unknown>[] = [];
  for (let i = headerIdx + 1; i < lineGroups.length; i++) {
    const group = lineGroups[i];
    const rowMap: Record<string, string[]> = {};
    for (const cell of group) {
      const col = nearestColName(cell.x);
      (rowMap[col] = rowMap[col] ?? []).push(cell.text);
    }
    const row: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(rowMap)) row[k] = v.join(" ");
    rows.push(row);
  }

  return { rows, rawHeaders: colDefs.map((c) => c.name), lineGroups };
}

function isPdfPasswordError(err: unknown): boolean {
  if (!err) return false;
  const maybeErr = err as { name?: string; message?: string; code?: number; reason?: string };
  const msg = String(maybeErr?.message ?? "").toLowerCase();
  const reason = String(maybeErr?.reason ?? "").toLowerCase();
  const combined = msg + " " + reason;
  
  return (
    maybeErr?.name === "PasswordException" ||
    maybeErr?.code === 1 || // PasswordException code
    maybeErr?.code === 2 || // needs password code
    combined.includes("password") ||
    combined.includes("encrypted") ||
    combined.includes("security") ||
    combined.includes("authorization") ||
    combined.includes("user password") ||
    combined.includes("owner password")
  );
}

function getPdfErrorDetails(err: unknown): { name: string; code: string; message: string; reason: string } {
  if (!err) {
    return { name: "Unknown", code: "", message: "", reason: "" };
  }
  const maybeErr = err as { name?: string; code?: number | string; message?: string; reason?: string };
  return {
    name: String(maybeErr?.name ?? "Unknown"),
    code: String(maybeErr?.code ?? ""),
    message: String(maybeErr?.message ?? ""),
    reason: String(maybeErr?.reason ?? ""),
  };
}

/**
 * Extract the transaction amount and expense/income direction from a line of text.
 *
 * Handles:
 *  - Single amount column  (e.g. "500.00 Dr")
 *  - Separate Debit/Credit columns  (e.g. "500.00       " or "       500.00")
 *  - Three-column layout  Debit | Credit | Balance  — drops the last (Balance)
 *  - Dr / Cr suffix on the amount (HDFC CC style: "500.00Cr")
 */
function extractAmountAndKind(
  lineText: string,
): { amount: number; kind: "income" | "expense" } | null {
  const allMatches = [...lineText.matchAll(PDF_AMOUNT_RX)]
    .map((m) => {
      const token = (m[0] ?? "").trim();
      const numPart = token
        .replace(/(₹|rs\.?|inr)/gi, "")
        .replace(/,/g, "")
        .replace(/\s+/g, "");
      const value = parseFloat(numPart);
      return { token, value, index: m.index ?? 0 };
    })
    // Filter obvious false positives (dates and tiny non-amount numbers)
    .filter((x) => Number.isFinite(x.value) && x.value >= 1);

  if (allMatches.length === 0) return null;

  // 3+ numeric tokens on a line usually means Debit | Credit | Balance; drop last as balance.
  const useMatches = allMatches.length >= 3 ? allMatches.slice(0, -1) : allMatches;

  if (useMatches.length === 2) {
    // Separate Debit and Credit columns; exactly one should be non-zero
    const first = useMatches[0].value;
    const second = useMatches[1].value;
    if (first > 0 && second === 0) return { amount: first,  kind: "expense" }; // Debit
    if (second > 0 && first === 0) return { amount: second, kind: "income" };  // Credit
    // Both non-zero: pick the smaller as the actual transaction (other is running balance)
    return { amount: Math.min(first, second), kind: "expense" };
  }

  // Single amount
  const match = useMatches[useMatches.length - 1];
  const amount = match.value;
  const idxEnd = match.index + match.token.length;

  // Check chars around the amount for Dr/Cr markers
  const near = lineText.slice(Math.max(0, match.index - 8), idxEnd + 20);
  const hasPlus = /(^|\s)\+/.test(match.token);
  const hasMinus = /(^|\s)-/.test(match.token);
  // SBI Card style: amount followed by single-letter type code (C=credit, D=debit, M/FP/EN/BT=debit variants)
  const isIncomeHint = /Cr\b|\bCR\b|credit|received|refund|cashback|reversal|\s+C(?:\s|$)|\s+T(?:\s|$)/i.test(near);
  const isExpenseHint = /Dr\b|\bDR\b|debit|paid|sent|purchase|upi\s*pay|\s+D(?:\s|$)|\s+M(?:\s|$)|\s+FP(?:\s|$)|\s+EN(?:\s|$)|\s+BT(?:\s|$)/i.test(near);

  if (hasPlus || isIncomeHint) return { amount, kind: "income" };
  if (hasMinus || isExpenseHint) return { amount, kind: "expense" };
  return { amount, kind: "expense" };
}

/**
 * Phase 2: Pattern-based extraction for noisy credit card statement PDFs.
 *
 * Strategy:
 *  1. Scan every visual line.
 *  2. A line that STARTS with a recognisable date pattern opens a new transaction.
 *  3. Subsequent lines without a date are either:
 *     a. Description continuation (no monetary amount) → append to current description.
 *     b. Amount line (has monetary amount, no date) → attach amount to current transaction.
 *  4. Noise lines (page numbers, totals, account info, ads) are discarded.
 *  5. Multi-line merchant names (very common in CC statements) are merged naturally.
 */
function patternExtractTransactions(
  lineGroups: PdfCell[][],
  defaultAccountId: string,
): StagedTx[] {
  interface WipTx {
    date: string;
    desc: string;
    amount: number;
    kind: "income" | "expense";
    hasAmount: boolean;
  }

  const txs: StagedTx[] = [];
  let wip: WipTx | null = null;

  function flush() {
    if (!wip || wip.amount <= 0) { wip = null; return; }
    const desc = wip.desc
      .replace(/\b[A-Z0-9]{3}[A-Z0-9]*\d[A-Z0-9]{8,}\b/g, "") // SBI Card / bank transaction IDs (e.g. 000DP216103XQRD79MB3CF2)
      .replace(/\s+[CDMTB]\s*$/g, "") // Trailing SBI Card type code
      .replace(/\s+FP\s*$/g, "").replace(/\s+EN\s*$/g, "").replace(/\s+BT\s*$/g, "")
      .replace(/\s{2,}/g, " ")
      .replace(/^[\s\-|]+|[\s\-|]+$/g, "")
      .trim();
    if (desc.length < 2) { wip = null; return; }
    const { categoryId, kind: catKind } = autoCategory(desc, wip.kind);
    txs.push({
      _id: makeId(),
      selected: true,
      date: wip.date,
      title: desc.slice(0, 100),
      amount: wip.amount,
      kind: wip.kind,
      categoryId: catKind === wip.kind ? categoryId : (wip.kind === "income" ? "other-income" : "other-expense"),
      accountId: defaultAccountId,
    });
    wip = null;
  }

  for (const group of lineGroups) {
    // Join the visual row into a single string preserving relative spacing
    const raw = group.map((c) => c.text).join(" ").trim();
    if (!raw || raw.length < 3) continue;
    // Discard global noise lines. Do not flush here because some statements
    // include noisy lines in the middle of a transaction block.
    if (NOISE_RX.test(raw)) continue;

    const dateMatch = raw.match(PDF_DATE_RX);

    if (dateMatch) {
      // ── New transaction starts here ─────────────────────────────────────
      flush();

      const afterDate = raw
        .slice(raw.indexOf(dateMatch[0]) + dateMatch[0].length)
        .trim();

      const amtKind = extractAmountAndKind(afterDate);
      // Remove monetary values, Dr/Cr markers and SBI Card type codes from description
      const cleanDesc = afterDate
        .replace(PDF_AMOUNT_RX, "")
        .replace(/\b(?:Dr|Cr)\b/g, "")
        .replace(/\s+[CDMT]\s*$/, "") // SBI Card trailing type code (C/D/M/T)
        .replace(/\s+(?:FP|EN|BT)\s*$/, "")
        .replace(/\b[A-Z0-9]{3}[A-Z0-9]*\d[A-Z0-9]{8,}\b/g, "") // Bank transaction IDs
        .replace(/\s{2,}/g, " ")
        .trim();

      wip = {
        date: parseDate(dateMatch[0]),
        desc: cleanDesc,
        amount: amtKind?.amount ?? 0,
        kind:   amtKind?.kind   ?? "expense",
        hasAmount: amtKind !== null && amtKind.amount > 0,
      };
    } else if (wip) {
      // ── Continuation line (no date) ──────────────────────────────────────
      if (/^\d{1,2}:\d{2}\s*(am|pm)$/i.test(raw)) continue; // time-only line
      const amtKind = extractAmountAndKind(raw);

      if (!wip.hasAmount && amtKind && amtKind.amount > 0) {
        // This line carries the amount for the current transaction
        wip.amount    = amtKind.amount;
        wip.kind      = amtKind.kind;
        wip.hasAmount = true;
        const descPart = raw
          .replace(PDF_AMOUNT_RX, "")
          .replace(/\b(?:Dr|Cr)\b/g, "")
          .replace(/\s{2,}/g, " ")
          .trim();
        if (descPart.length > 1) wip.desc += " " + descPart;
      } else if (!amtKind || amtKind.amount === 0) {
        // Pure text continuation (multi-line merchant name)
        wip.desc += " " + raw;
      }
      // If wip already has amount and line also has an amount → separate info; ignore
    }
  }
  flush();
  return txs;
}

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
  kind: "income" | "expense" | "transfer";
  categoryId: string;
  accountId: string;
  fromAccountId?: string;
  toAccountId?: string;
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
  kind: "income" | "expense" | "transfer";
  date: string;
  categoryId?: string;
  accountId?: string;
  fromAccountId?: string;
  toAccountId?: string;
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
  const str = String(val)
    .replace(/(₹|\$|rs\.?|inr)/gi, "")
    .replace(/[\s,]/g, "");
  const num = parseFloat(str);
  return isNaN(num) ? 0 : Math.abs(num);
}

function formatYmdUtc(year: number, month: number, day: number): string | null {
  const d = new Date(Date.UTC(year, month - 1, day));
  if (isNaN(d.getTime())) return null;
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  const mm = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `${year}-${mm}-${dd}`;
}

function formatYmdLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseDate(val: unknown): string {
  if (!val && val !== 0) return formatYmdLocal(new Date());
  const str = String(val).trim();

  // DD/MM/YYYY or DD-MM-YYYY  
  const dmy = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (dmy) {
    let year = parseInt(dmy[3]);
    if (year < 100) year += 2000;
    const day = parseInt(dmy[1]);
    const month = parseInt(dmy[2]);
    const parsed = formatYmdUtc(year, month, day);
    if (parsed) return parsed;
  }

  // YYYY-MM-DD
  const ymd = str.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
  if (ymd) {
    const parsed = formatYmdUtc(parseInt(ymd[1]), parseInt(ymd[2]), parseInt(ymd[3]));
    if (parsed) return parsed;
  }

  // DD MMM YY or DD MMM YYYY (SBI Card style: "14 Apr 26", "08 May 2026")
  const dmyWords = str.match(/^(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s+(\d{2,4})$/i);
  if (dmyWords) {
    const MONTH_NUMS: Record<string, number> = {
      jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
      jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
    };
    const day = parseInt(dmyWords[1]);
    const month = MONTH_NUMS[dmyWords[2].toLowerCase().slice(0, 3)];
    let year = parseInt(dmyWords[3]);
    if (year < 100) year += 2000;
    const parsed = formatYmdUtc(year, month, day);
    if (parsed) return parsed;
  }

  // MMM DD, YYYY (e.g., Apr 29, 2026)
  const mdyWords = str.match(/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s+(\d{1,2}),?\s+(\d{2,4})$/i);
  if (mdyWords) {
    const MONTH_NUMS: Record<string, number> = {
      jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
      jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
    };
    const month = MONTH_NUMS[mdyWords[1].toLowerCase().slice(0, 3)];
    const day = parseInt(mdyWords[2]);
    let year = parseInt(mdyWords[3]);
    if (year < 100) year += 2000;
    const parsed = formatYmdUtc(year, month, day);
    if (parsed) return parsed;
  }

  // Excel serial date (number between 40000–60000 ≈ year 2009–2064)
  const serial = Number(val);
  if (!isNaN(serial) && serial > 40000 && serial < 60000) {
    const utcMs = (Math.floor(serial) - 25569) * 86400 * 1000;
    const d = new Date(utcMs);
    if (!isNaN(d.getTime())) {
      return formatYmdUtc(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()) ?? formatYmdLocal(d);
    }
  }

  // Fallback
  const fallback = new Date(str);
  if (!isNaN(fallback.getTime())) return formatYmdLocal(fallback);

  return formatYmdLocal(new Date());
}

function parseDateOrNull(val: unknown): string | null {
  if (!val && val !== 0) return null;
  const str = String(val).trim();
  if (!str) return null;

  // DD/MM/YYYY or DD-MM-YYYY
  const dmy = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (dmy) {
    let year = parseInt(dmy[3]);
    if (year < 100) year += 2000;
    const day = parseInt(dmy[1]);
    const month = parseInt(dmy[2]);
    const parsed = formatYmdUtc(year, month, day);
    if (parsed) return parsed;
  }

  // YYYY-MM-DD
  const ymd = str.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
  if (ymd) {
    const parsed = formatYmdUtc(parseInt(ymd[1]), parseInt(ymd[2]), parseInt(ymd[3]));
    if (parsed) return parsed;
  }

  // DD MMM YY or DD MMM YYYY (SBI Card style)
  const dmyWords2 = str.match(/^(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s+(\d{2,4})$/i);
  if (dmyWords2) {
    const MONTH_NUMS: Record<string, number> = {
      jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
      jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
    };
    const day = parseInt(dmyWords2[1]);
    const month = MONTH_NUMS[dmyWords2[2].toLowerCase().slice(0, 3)];
    let year = parseInt(dmyWords2[3]);
    if (year < 100) year += 2000;
    const parsed = formatYmdUtc(year, month, day);
    if (parsed) return parsed;
  }

  // MMM DD, YYYY
  const mdyWords2 = str.match(/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s+(\d{1,2}),?\s+(\d{2,4})$/i);
  if (mdyWords2) {
    const MONTH_NUMS: Record<string, number> = {
      jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
      jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
    };
    const month = MONTH_NUMS[mdyWords2[1].toLowerCase().slice(0, 3)];
    const day = parseInt(mdyWords2[2]);
    let year = parseInt(mdyWords2[3]);
    if (year < 100) year += 2000;
    const parsed = formatYmdUtc(year, month, day);
    if (parsed) return parsed;
  }

  // Excel serial date (number between 40000–60000 ≈ year 2009–2064)
  const serial = Number(val);
  if (!isNaN(serial) && serial > 40000 && serial < 60000) {
    const utcMs = (Math.floor(serial) - 25569) * 86400 * 1000;
    const d = new Date(utcMs);
    if (!isNaN(d.getTime())) {
      return formatYmdUtc(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()) ?? formatYmdLocal(d);
    }
  }

  const fallback = new Date(str);
  if (!isNaN(fallback.getTime())) return formatYmdLocal(fallback);

  return null;
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
  let lastDate: string | null = null;

  for (const row of rows) {
    const rawDesc = colMap.desc ? String(row[colMap.desc] ?? "").trim() : "";
    if (!rawDesc) continue;

    const parsedDate = parseDateOrNull(colMap.date ? row[colMap.date] : "");
    if (parsedDate) lastDate = parsedDate;
    const date = parsedDate ?? lastDate;
    if (!date) continue;
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
      const raw = String(row[colMap.amount] ?? "")
        .replace(/(₹|\$|rs\.?|inr)/gi, "")
        .replace(/[\s,]/g, "");
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
  const [sourceType, setSourceType] = useState<"auto" | "upi" | "card" | "bank">("auto");
  const [fileFormat, setFileFormat] = useState<"auto" | "pdf" | "spreadsheet">("auto");

  const expCategories = categories.filter((c) => c.kind === "expense");
  const incCategories = categories.filter((c) => c.kind === "income");
  const defaultAccountId = accounts[0]?.id ?? "";

  async function handleFile(file: File) {
    setError("");
    setIsParsing(true);
    try {
      const buffer = await file.arrayBuffer();
      const isPdf =
        fileFormat === "pdf" ||
        (fileFormat !== "spreadsheet" && (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")));
      const pdfSourceBytes = isPdf ? new Uint8Array(buffer) : null;

      let rows: Record<string, unknown>[];
      let headers: string[];

      if (isPdf) {
        // ── PDF path: two-phase extraction ──────────────────────────────────
        // Phase 1 (column-header based) is tried first.
        // If it finds fewer than 3 transactions (common with noisy credit card
        // PDFs full of ads and account info), Phase 2 (pattern-based) takes over.
        let pdfResult: { rows: Record<string, unknown>[]; rawHeaders: string[]; lineGroups: PdfCell[][] } | null = null;
        let pdfPassword: string | undefined;
        let unlocked = false;
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            // Use a fresh copy for each attempt because pdfjs may detach transferred buffers.
            const attemptBytes = pdfSourceBytes ? pdfSourceBytes.slice() : new Uint8Array(buffer);
            pdfResult = await parsePdfToRows(attemptBytes, pdfPassword);
            unlocked = true;
            break;
          } catch (pdfErr) {
            const details = getPdfErrorDetails(pdfErr);
            const shouldAskPassword = isPdfPasswordError(pdfErr) || (!pdfPassword && attempt === 0);

            if (shouldAskPassword) {
              console.warn("[PDF] Unlock attempt failed", {
                attempt: attempt + 1,
                name: details.name,
                code: details.code,
                message: details.message,
                reason: details.reason,
              });
              const entered = window.prompt(
                attempt === 0
                  ? "This PDF is password-protected. Enter the PDF password to import transactions:"
                  : "Wrong password. Please enter the correct PDF password:"
              );

              if (entered === null) {
                setError("PDF import cancelled. The selected file is password-protected.");
                setIsParsing(false);
                return;
              }

              pdfPassword = entered;
            } else {
              // Non-password error; detailed logging for debugging
              const errMsg = details.message || details.reason || `${details.name}${details.code ? ` (code ${details.code})` : ""}`;
              console.error("PDF read error:", {
                name: details.name,
                code: details.code,
                message: details.message,
                reason: details.reason,
                raw: pdfErr,
              });
              setError(
                `Could not read the PDF: ${errMsg.slice(0, 80)}. This may be a scanned image PDF. ` +
                `Try downloading the statement as CSV or Excel from your bank instead.`
              );
              setIsParsing(false);
              return;
            }
          }
        }

        if (!unlocked) {
          setError("Could not unlock PDF after multiple attempts. Please re-check the password and try again.");
          setIsParsing(false);
          return;
        }

        if (!pdfResult) {
          setError("Failed to read PDF data after unlock. Please try again.");
          setIsParsing(false);
          return;
        }

        // Priority 1: PhonePe statement detection and extraction
        // Skip if user explicitly chose Card or Bank
        const forcePhonePe = sourceType === "upi";
        const skipPhonePe  = sourceType === "card" || sourceType === "bank";
        try {
          if (forcePhonePe || (!skipPhonePe && isPhonePeStatement(pdfResult.lineGroups))) {
            console.log("[PDF] PhonePe/UPI extraction...");
            const phonepeRawTxs = extractPhonePeTransactions(pdfResult.lineGroups);
            console.log("[PDF] PhonePe extraction completed:", phonepeRawTxs.length, "transactions");
            if (phonepeRawTxs.length > 0) {
              const phonepeStaged = phonepeRawTxs.map((tx) => {
                const { categoryId, kind: catKind } = autoCategory(tx.title, tx.kind);
                return {
                  _id: makeId(),
                  selected: tx.confidence > 0.8,
                  date: tx.date,
                  title: tx.title,
                  amount: tx.amount,
                  kind: tx.kind,
                  categoryId: catKind === tx.kind ? categoryId : (tx.kind === "income" ? "other-income" : "other-expense"),
                  accountId: defaultAccountId,
                };
              });
              setStaged(phonepeStaged);
              setStep("review");
              setIsParsing(false);
              return;
            }
          }
        } catch (phonepeErr) {
          console.error("PhonePe extractor error:", phonepeErr);
          // Fall through to generic parsers
        }

        // Priority 2: Column-based extraction (clean structured tables)
        if (pdfResult.rows.length >= 3) {
          console.log("[PDF] Using column-based extraction with", pdfResult.rows.length, "rows");
          // Phase 1 succeeded — feed into the existing column-based pipeline below
          rows = pdfResult.rows;
          headers = pdfResult.rawHeaders;
        } else {
          // Priority 3: Pattern-based extraction (generic noisy PDFs)
          console.log("[PDF] PhonePe not detected or produced 0 transactions, trying pattern-based extraction...");
          const patternTxs = patternExtractTransactions(pdfResult.lineGroups, defaultAccountId);
          console.log("[PDF] Pattern extraction found", patternTxs.length, "transactions");
          if (patternTxs.length > 0) {
            setStaged(patternTxs);
            setStep("review");
            setIsParsing(false);
            return;
          }
          console.error("[PDF] All extraction methods failed, no transactions found");
          setError(
            "No transactions found in this PDF. " +
            "The parser searched for date + amount patterns across every line but found nothing. " +
            "This may be a scanned (image) PDF with no text layer, or the statement format is " +
            "unusual. Try exporting as CSV or Excel from your bank's netbanking portal."
          );
          setIsParsing(false);
          return;
        }
      } else {
        // ── CSV / Excel path ───────────────────────────────────────────────
        const workbook = XLSX.read(buffer, { type: "array", cellDates: false });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
        if (rows.length === 0) {
          setError("No data rows found. Make sure the file has a header row and transaction rows.");
          setIsParsing(false);
          return;
        }
        headers = Object.keys(rows[0]);
      }

      const colMap = detectColumns(headers);

      if (!colMap.desc) {
        setError(
          `Could not detect a description/narration column. ` +
          `Detected columns: ${headers.slice(0, 8).join(", ")}. ` +
          (isPdf ? "PDFs with complex layouts may not parse correctly — try CSV/Excel export." : "Try CSV export.")
        );
        setIsParsing(false);
        return;
      }

      const txs = parseRows(rows, colMap, defaultAccountId);

      if (txs.length === 0) {
        setError("Parsed 0 transactions. No rows with recognisable amounts were found.");
        setIsParsing(false);
        return;
      }

      setStaged(txs);
      setStep("review");
    } catch (err) {
      const errorMsg = String(err instanceof Error ? err.message : err);
      console.error("[IMPORT] Final error:", err);
      setError(`Failed to read file: ${errorMsg || "Invalid PDF, CSV, or Excel (.xlsx) file."}`);
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
      toImport.map((tx) => {
        if (tx.kind === "transfer") {
          return {
            title: tx.title || "Transfer",
            amount: tx.amount,
            kind: "transfer" as const,
            date: tx.date,
            fromAccountId: tx.fromAccountId || undefined,
            toAccountId: tx.toAccountId || undefined,
          };
        }
        return {
          title: tx.title,
          amount: tx.amount,
          kind: tx.kind,
          date: tx.date,
          categoryId: tx.categoryId || undefined,
          accountId: tx.accountId || undefined,
        };
      })
    );
    onClose();
  }

  const selectedCount = staged.filter((tx) => tx.selected).length;
  const allSelected = staged.length > 0 && staged.every((tx) => tx.selected);

  // ── Upload step ───────────────────────────────────────────────────────────
  const fileAccept =
    fileFormat === "pdf" ? ".pdf" :
    fileFormat === "spreadsheet" ? ".csv,.xlsx,.xls" :
    ".csv,.xlsx,.xls,.pdf";

  if (step === "upload") {
    return (
      <div className="import-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
        <div className="import-modal panel">
          <div className="import-header">
            <h2>Import Statement</h2>
            <button type="button" className="ghost-btn icon-btn" aria-label="Close" onClick={onClose}>
              <svg viewBox="0 0 24 24" aria-hidden="true" width="18" height="18">
                <path d="M6 6l12 12M6 18L18 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </button>
          </div>

          {/* Source type selector */}
          <p className="import-section-label">What are you importing?</p>
          <div className="import-source-cards">
            {([
              { id: "auto",  icon: "✦", label: "Auto-detect" },
              { id: "upi",   icon: "📱", label: "UPI / Wallet", sub: "PhonePe, GPay" },
              { id: "card",  icon: "💳", label: "Credit / Debit Card", sub: "SBI Card, HDFC, Amex" },
              { id: "bank",  icon: "🏦", label: "Bank Account", sub: "SBI, ICICI, Axis" },
            ] as { id: "auto"|"upi"|"card"|"bank"; icon: string; label: string; sub?: string }[]).map((s) => (
              <button
                key={s.id}
                type="button"
                className={`import-source-card${sourceType === s.id ? " import-source-card--active" : ""}`}
                onClick={() => setSourceType(s.id)}
              >
                <span className="import-source-icon">{s.icon}</span>
                <span className="import-source-label">{s.label}</span>
                {s.sub && <span className="import-source-sub">{s.sub}</span>}
              </button>
            ))}
          </div>

          {/* File format selector */}
          <p className="import-section-label" style={{ marginTop: 14 }}>File format</p>
          <div className="segmented-switch import-format-switch">
            <button type="button" className={fileFormat === "auto" ? "active" : ""} onClick={() => setFileFormat("auto")}>Auto</button>
            <button type="button" className={fileFormat === "pdf" ? "active" : ""} onClick={() => setFileFormat("pdf")}>PDF</button>
            <button type="button" className={fileFormat === "spreadsheet" ? "active" : ""} onClick={() => setFileFormat("spreadsheet")}>Excel / CSV</button>
          </div>

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
                <p className="import-dropzone-hint">
                  {fileFormat === "pdf" ? "PDF" : fileFormat === "spreadsheet" ? "CSV · XLS · XLSX" : "PDF · CSV · XLS · XLSX"}
                </p>
              </>
            )}
          </div>

          <input
            ref={fileRef}
            type="file"
            accept={fileAccept}
            style={{ display: "none" }}
            onChange={handleFileChange}
          />

          <p className="import-tip">
            PDF must be a <em>digital</em> statement (text selectable) — scanned/image PDFs are not supported.
            For most reliable parsing use CSV or Excel export from your bank’s portal.
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
                  <td data-label="Select">
                    <input type="checkbox" checked={tx.selected} onChange={() => toggleRow(tx._id)} />
                  </td>
                  <td data-label="Date">
                    <input
                      type="date"
                      className="import-cell-input"
                      value={tx.date}
                      onChange={(e) => updateRow(tx._id, { date: e.target.value })}
                    />
                  </td>
                  <td data-label="Description">
                    <input
                      type="text"
                      className="import-cell-input import-desc-input"
                      value={tx.title}
                      onChange={(e) => updateRow(tx._id, { title: e.target.value })}
                    />
                  </td>
                  <td data-label="Type">
                    <select
                      className="import-cell-input"
                      value={tx.kind}
                      onChange={(e) => {
                        const kind = e.target.value as "income" | "expense" | "transfer";
                        if (kind === "transfer") {
                          updateRow(tx._id, { kind, categoryId: "", accountId: "" });
                        } else {
                          const catList = kind === "income" ? incCategories : expCategories;
                          updateRow(tx._id, { kind, categoryId: catList[catList.length - 1]?.id ?? "", fromAccountId: undefined, toAccountId: undefined });
                        }
                      }}
                    >
                      <option value="expense">Expense</option>
                      <option value="income">Income</option>
                      <option value="transfer">Transfer</option>
                    </select>
                  </td>
                  <td data-label="Amount">
                    <input
                      type="number"
                      className="import-cell-input import-amount-input"
                      value={tx.amount}
                      min="0"
                      step="0.01"
                      onChange={(e) => updateRow(tx._id, { amount: parseFloat(e.target.value) || 0 })}
                    />
                  </td>
                  <td data-label={tx.kind === "transfer" ? "From Account" : "Category"}>
                    {tx.kind === "transfer" ? (
                      <select
                        className="import-cell-input"
                        value={tx.fromAccountId ?? ""}
                        onChange={(e) => updateRow(tx._id, { fromAccountId: e.target.value })}
                      >
                        <option value="">— From account —</option>
                        {accounts.map((a) => (
                          <option key={a.id} value={a.id}>{a.name}</option>
                        ))}
                      </select>
                    ) : (
                      <select
                        className="import-cell-input"
                        value={tx.categoryId}
                        onChange={(e) => updateRow(tx._id, { categoryId: e.target.value })}
                      >
                        {(tx.kind === "income" ? incCategories : expCategories).map((c) => (
                          <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                      </select>
                    )}
                  </td>
                  <td data-label={tx.kind === "transfer" ? "To Account" : "Account"}>
                    {tx.kind === "transfer" ? (
                      <select
                        className="import-cell-input"
                        value={tx.toAccountId ?? ""}
                        onChange={(e) => updateRow(tx._id, { toAccountId: e.target.value })}
                      >
                        <option value="">— To account —</option>
                        {accounts.map((a) => (
                          <option key={a.id} value={a.id}>{a.name}</option>
                        ))}
                      </select>
                    ) : (
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
                    )}
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
