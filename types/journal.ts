export type TradeDirection = "long" | "short";

export interface JournalEntry {
  id: string;
  tradeDate: string; // YYYY-MM-DD
  symbol: string;
  direction: TradeDirection;
  entryPrice: number;
  exitPrice: number | null;
  positionSize: number;
  stopLoss: number | null;
  profitLoss: number;
  setupScoreAtEntry: number | null;
  conditionsPassed: string[];
  conditionsMissing: string[];
  screenshotUrl: string | null;
  notes: string | null;
  emotionalState: string | null;
  followedPlan: boolean;
  mistakeCategory: string | null;
  lessonLearned: string | null;
  tags: string[];
  createdAt: string; // ISO timestamp
}

/** Fields the user actually fills in when creating an entry. */
export type NewJournalEntry = Omit<JournalEntry, "id" | "createdAt">;
