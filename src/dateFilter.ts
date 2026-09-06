export type DateRangePreset = '24h' | '7d' | '30d';

const WINDOW_MS: Record<DateRangePreset, number> = {
    '24h': 24 * 60 * 60 * 1000,
    '7d': 7 * 24 * 60 * 60 * 1000,
    '30d': 30 * 24 * 60 * 60 * 1000,
};

// Argentina Time (ART) has been a fixed UTC-3 with no daylight saving since
// 2009 - unlike HSE's UK dates (GMT/BST, which this portfolio's sibling
// actor treats as UTC and discloses as an approximation), converting
// Cordoba's local wall-clock timestamp to a true UTC instant is a plain
// fixed offset, so there's no reason not to do it exactly.
const ARGENTINA_UTC_OFFSET_MS = 3 * 60 * 60 * 1000;

// `fechaInicio` (Publication Date) renders as DD/MM/YYYY HH:mm:ss - verified
// against real fixtures (test/fixtures/page1.html) and a fresh live pull of
// the same page two days later (2026-09-06). Note this is the record's own
// declared date field, not independent proof of when it actually first
// appeared - see AGENTS.md for why the listing's own SORT ORDER is a
// separate, unreliable thing from this field's value.
export function parseFechaInicio(value: string | null | undefined): Date | null {
    if (!value) return null;
    const match = /^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2}):(\d{2})$/.exec(value);
    if (!match) return null;
    const [, dd, mm, yyyy, hh, min, ss] = match;
    const localAsUtc = Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd), Number(hh), Number(min), Number(ss));
    return new Date(localAsUtc + ARGENTINA_UTC_OFFSET_MS);
}

export function isWithinDateRange(date: Date | null, preset: DateRangePreset | undefined, now: Date): boolean {
    if (!preset) return true;
    if (!date) return false;
    return now.getTime() - date.getTime() <= WINDOW_MS[preset];
}
