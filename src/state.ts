import { Actor } from 'apify';

// A NAMED key-value store (not the run's default one, which is isolated per
// run and would not survive between scheduled runs) - this is what makes
// "only new since last run" possible at all across a schedule. Only one
// sub-dataset here (licitaciones), unlike uk-hse-enforcement-monitor's
// convictions/notices split, so state is a flat id list rather than keyed
// per dataset.
const STATE_STORE_NAME = 'cordoba-compras-monitor-delta-state';
const MAX_SEEN_IDS = 5000;

export interface DeltaState {
    seenIds: string[];
    lastRunAt: string;
}

export async function loadState(): Promise<DeltaState> {
    const store = await Actor.openKeyValueStore(STATE_STORE_NAME);
    const state = await store.getValue<DeltaState>('state');
    return state ?? { seenIds: [], lastRunAt: '' };
}

// Pure and exported on its own so the cap/ordering logic is testable without
// touching Actor's key-value store. Newest ids first (this run's ids, which
// - per fetchTenders' own newest-first walk - are the freshest), then
// whatever from the previous state wasn't re-seen this run, capped so the
// store doesn't grow unbounded across months of scheduled runs.
export function mergeSeenIds(previousIds: string[], idsThisRun: string[], cap = MAX_SEEN_IDS): string[] {
    const merged = [...idsThisRun, ...previousIds.filter((id) => !idsThisRun.includes(id))];
    return merged.slice(0, cap);
}

export async function saveState(state: DeltaState, idsThisRun: string[], runAt: string): Promise<DeltaState> {
    const next: DeltaState = {
        seenIds: mergeSeenIds(state.seenIds, idsThisRun),
        lastRunAt: runAt,
    };
    const store = await Actor.openKeyValueStore(STATE_STORE_NAME);
    await store.setValue('state', next);
    return next;
}
