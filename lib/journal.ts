import type { RdtAnalysis } from "./rdt";
export type Trade = {
    id: string;
    symbol: string;
    side: "Long" | "Short";
    entry: string;
    exit: string;
    qty: number;
    entryPrice: number;
    exitPrice: number;
    pnl: number;
    spy: number;
    rrs: number;
    aligned: boolean;
    setup: string;
    tags: string[];
    notes: string;
    grade: string;
    assetType?: "equity" | "option";
    contract?: string;
    optionType?: "call" | "put";
    strike?: number;
    expiration?: string;
    multiplier?: number;
    demo?: boolean;
    analysis?: RdtAnalysis;
    analysisError?: string;
};

export type ReviewImage = { id: string; name: string; dataUrl: string };
export type Review = {
    tradeId: string;
    status: "pending" | "reviewed";
    flagged: boolean;
    thesis: string;
    thesisSource: "reconstructed" | "entry-notes";
    reflection: string;
    repeat: string;
    avoid: string;
    process: "unrated" | "followed" | "broke";
    screenshots: ReviewImage[];
    revision: number;
    updatedAt?: string;
};
export type ReviewSummary = Omit<Review, "screenshots"> & { screenshotCount: number };
export const blankReview = (tradeId: string): Review => ({
    tradeId, status: "pending", flagged: false, thesis: "", thesisSource: "reconstructed",
    reflection: "", repeat: "", avoid: "", process: "unrated", screenshots: [], revision: 0,
});
export const summarizeReview = ({ screenshots, ...review }: Review): ReviewSummary => ({ ...review, screenshotCount: screenshots.length });

// All evidence cohorts exclude demo rows; missing checks never count as failures.
export function cohortSummary(trades: Trade[], key: string, status: "pass" | "fail" = "pass") {
    const rows = trades.filter(t => !t.demo && t.analysis?.checks.some(c => c.key === key && c.status === status));
    const wins = rows.filter(t => t.pnl > 0).length;
    return { count: rows.length, wins, winRate: rows.length ? wins / rows.length * 100 : null };
}
export function checkSummary(trades: Trade[], key: string) {
    const checks = trades.filter(t => !t.demo).flatMap(t => t.analysis?.checks.filter(c => c.key === key) || []);
    const verified = checks.filter(c => c.status !== "unverified");
    const passes = verified.filter(c => c.status === "pass").length;
    return { count: verified.length, passes, rate: verified.length ? passes / verified.length * 100 : null };
}
