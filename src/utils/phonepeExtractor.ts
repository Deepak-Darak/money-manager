/**
 * PhonePe-specific PDF statement extractor.
 * Uses block-based state machine parsing to handle multi-line transaction records.
 */

export interface PdfCell {
  x: number;
  y: number;
  text: string;
}

interface PhonePeTransaction {
  date: string;
  title: string;
  amount: number;
  kind: "income" | "expense";
  confidence: number; // 0-1 score
}

/**
 * Detect if extracted lines look like a PhonePe statement.
 */
export function isPhonePeStatement(lineGroups: PdfCell[][]): boolean {
  const fullText = lineGroups
    .slice(0, Math.min(50, lineGroups.length))
    .map((g) => g.map((c) => c.text).join(" ").toLowerCase())
    .join(" ");

  const phonepeSignals = [
    "transaction statement for",
    "phonepe",
    "utr no",
    "debit inr",
    "credit inr",
    "paid to",
    "received from",
  ];

  const matchCount = phonepeSignals.filter((sig) => fullText.includes(sig))
    .length;
  return matchCount >= 3;
}

/**
 * Extract transactions from PhonePe statement using block-based parsing.
 * Each transaction is a block:
 *   [Date] [optional Time] [Paid to/Received from description] [metadata lines] [Amount line]
 */
export function extractPhonePeTransactions(
  lineGroups: PdfCell[][],
): PhonePeTransaction[] {
  const lines = lineGroups.map((g) => g.map((c) => c.text).join(" ").trim());

  interface WipBlock {
    dateStr: string;
    descLines: string[];
    amountStr: string;
    kind: "income" | "expense";
    hasAmount: boolean;
  }

  const txs: PhonePeTransaction[] = [];
  let wip: WipBlock | null = null;

  function flush() {
    if (!wip || !wip.hasAmount) {
      wip = null;
      return;
    }

    const dateStr = wip.dateStr.trim();
    let desc = wip.descLines.join(" ");
    // Aggressively strip transaction metadata
    desc = desc
      .replace(/[A-Z][A-Za-z0-9]{20,}/g, "") // Long alphanumeric IDs
      .replace(/\bT\d{16,}\b/g, "") // T-prefixed IDs
      .replace(/\bAC\d{15,}\b/g, "") // AC-prefixed IDs
      .replace(/\bOLEX\d{15,}\b/g, "") // OLEX-prefixed IDs
      .replace(/\bAT\d{20,}\b/g, "") // AT-prefixed IDs
      .replace(/\d{10,}/g, "") // Long bare numbers (UTR numbers)
      .replace(/transaction\s*id\s*:\s*\w+/gi, "")
      .replace(/utr\s*no\s*:\s*\w+/gi, "")
      .replace(/credited?\s*(?:to|from)\s+\w+/gi, "")
      .replace(/debited?\s+from\s+\w+/gi, "")
      .replace(/debit\s+inr|credit\s+inr/gi, "")
      .replace(/xx\d{4}/gi, "")
      .replace(/\s{2,}/g, " ")
      .trim();
    if (desc.length < 2) desc = "UPI Transfer";

    const amount = parsePhonePeAmount(wip.amountStr);

    if (!dateStr || amount <= 0) {
      wip = null;
      return;
    }

    const date = parsePhonePeDate(dateStr);
    if (!date) {
      wip = null;
      return;
    }

    txs.push({
      date,
      title: desc.slice(0, 100),
      amount,
      kind: wip.kind,
      confidence: 0.95, // high confidence via block parsing
    });

    wip = null;
  }

  // State machine: WAIT_DATE → IN_BLOCK → COMMIT_BLOCK
  let awaitingAmount = false; // track if next line might be the amount
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line || line.length < 2) continue;

    const dateMatch = line.match(
      /\b((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s+\d{1,2},?\s+\d{4})\b/i
    );

    if (dateMatch) {
      // Start of new transaction block
      flush();
      wip = {
        dateStr: dateMatch[1],
        descLines: [],
        amountStr: "",
        kind: "expense",
        hasAmount: false,
      };
      awaitingAmount = false;
      continue;
    }

    if (!wip) continue;

    // Skip time-only lines (e.g., "09:17 PM")
    if (/^\d{1,2}:\d{2}\s*(am|pm)$/i.test(line)) {
      awaitingAmount = false;
      continue;
    }

    // Detect amount line: "Debit INR X.XX" or "Credit INR X.XX" (with optional separate amount line)
    const debitCreditMatch = line.match(
      /^(Debit|Credit)\s+INR(?:\s+([\d,]+\.?\d*))?$/i
    );
    if (debitCreditMatch) {
      wip.kind = debitCreditMatch[1].toLowerCase() === "credit" ? "income" : "expense";
      if (debitCreditMatch[2]) {
        // Amount on same line
        wip.amountStr = debitCreditMatch[2];
        wip.hasAmount = true;
      } else {
        // Amount may be on next line
        awaitingAmount = true;
      }
      continue;
    }

    // If awaiting amount and current line looks like a number, grab it
    if (awaitingAmount && /^[\d,]+\.?\d*$/.test(line.trim())) {
      wip.amountStr = line.trim();
      wip.hasAmount = true;
      awaitingAmount = false;
      continue;
    }
    awaitingAmount = false;

    // Skip metadata lines (UTR, Transaction ID, Debited from, Credited to)
    if (
      /^(transaction\s*id|utr\s*no|debited?\s+from|credited?\s+to):/i.test(
        line
      )
    ) {
      continue;
    }

    // Description lines: "Paid to X", "Received from X"
    if (/^(Paid\s+to|Received\s+from)/i.test(line)) {
      wip.descLines.push(line);
      continue;
    }

    // Any other non-empty line that's not metadata → append to description
    if (line.length > 1 && !wip.hasAmount) {
      wip.descLines.push(line);
    }
  }

  flush();
  return txs;
}

function parsePhonePeDate(dateStr: string): string | null {
  // e.g., "Apr 28, 2026" or "Apr 28 2026"
  const match = dateStr.match(
    /(\w+)\s+(\d{1,2}),?\s+(\d{4})/i
  );
  if (!match) return null;

  const monthStr = match[1];
  const day = parseInt(match[2]);
  const year = parseInt(match[3]);

  const months: { [key: string]: number } = {
    jan: 0,
    feb: 1,
    mar: 2,
    apr: 3,
    may: 4,
    jun: 5,
    jul: 6,
    aug: 7,
    sep: 8,
    oct: 9,
    nov: 10,
    dec: 11,
  };

  const month = months[monthStr.toLowerCase().slice(0, 3)];
  if (month === undefined || isNaN(day) || isNaN(year)) return null;

  const d = new Date(year, month, day);
  if (isNaN(d.getTime())) return null;

  return d.toISOString().slice(0, 10);
}

function parsePhonePeAmount(amountStr: string): number {
  if (!amountStr) return 0;
  const cleaned = amountStr
    .trim()
    .replace(/[,\s]/g, "")
    .replace(/(₹|rs\.?|inr)/gi, "");
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : Math.abs(num);
}
