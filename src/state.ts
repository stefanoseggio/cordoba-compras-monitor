import { Actor } from 'apify';

// A NAMED key-value store (not the run's default one, which is isolated per
// run and would not survive between scheduled runs) - this is what makes
// "only new since last run" possible at all across a schedule. Only one
// sub-dataset here (licitaciones), unlike uk-hse-enforcement-monitor's
// convictions/notices split, so state is a flat id-keyed map rather than
// keyed per dataset.
const STATE_STORE_NAME = 'cordoba-compras-monitor-delta-state';
const MAX_SEEN_IDS = 5000;

/** v2: last-known estado + content fingerprint per id, not just a bare seen flag - this is
 *  what makes STATUS_CHANGE and UPDATED possible. Both fields come from the already-walked
 *  listing row, at zero extra request cost. tipoContratacion/jurisdiccion are kept too, so a
 *  CLOSED record (see src/deltaEngine.ts) - reported when a previously-active tender is no
 *  longer in the listing - can still say what it was, since the source has no per-tender page
 *  to look it up on once it has left the active list. */
export interface SeenEntry {
    estado: string;
    hash: string;
    tipoContratacion: string;
    jurisdiccion: string;
}

export interface DeltaState {
    entries: Record<string, SeenEntry>;
    lastRunAt: string;
}

function emptyState(): DeltaState {
    return { entries: {}, lastRunAt: '' };
}

function isValidState(value: unknown): value is DeltaState {
    if (!value || typeof value !== 'object') return false;
    const v = value as Partial<DeltaState>;
    return typeof v.entries === 'object' && v.entries !== null;
}

export async function loadState(): Promise<DeltaState> {
    const store = await Actor.openKeyValueStore(STATE_STORE_NAME);
    const state = await store.getValue<unknown>('state');
    // A v1-shaped state ({ seenIds: string[] }) fails isValidState and is treated as absent -
    // the first v2 run on an existing schedule re-baselines rather than crashing on the old
    // shape. Disclosed in CHANGELOG.md.
    return isValidState(state) ? state : emptyState();
}

/**
 * Pure and exported on its own so the cap/ordering logic is testable without touching Actor's
 * key-value store. Newest ids first (this run's ids, which - per fetchTenders' own walk - are
 * the freshest reconfirmations), then whatever from the previous state wasn't re-seen this
 * run, capped so the store doesn't grow unbounded across months of scheduled runs.
 */
export function mergeEntries(
    previousEntries: Record<string, SeenEntry>,
    observedThisRun: readonly { id: string; entry: SeenEntry }[],
    cap = MAX_SEEN_IDS,
): Record<string, SeenEntry> {
    const observedIds = new Set(observedThisRun.map((o) => o.id));
    const order = [...observedThisRun.map((o) => o.id), ...Object.keys(previousEntries).filter((id) => !observedIds.has(id))];
    const cappedIds = order.slice(0, cap);

    const merged: Record<string, SeenEntry> = { ...previousEntries };
    for (const { id, entry } of observedThisRun) merged[id] = entry;

    const result: Record<string, SeenEntry> = {};
    for (const id of cappedIds) {
        const entry = merged[id];
        if (entry) result[id] = entry;
    }
    return result;
}

export async function saveState(entries: Record<string, SeenEntry>, runAt: string): Promise<void> {
    const store = await Actor.openKeyValueStore(STATE_STORE_NAME);
    await store.setValue('state', { entries, lastRunAt: runAt });
}
