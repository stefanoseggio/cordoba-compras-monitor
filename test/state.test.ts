import { describe, expect, it } from 'vitest';

import { mergeEntries } from '../src/state.js';
import type { SeenEntry } from '../src/state.js';

function entry(estado: string, hash = 'h'): SeenEntry {
    return { estado, hash, tipoContratacion: 'tc', jurisdiccion: 'j' };
}

describe('mergeEntries', () => {
    it('puts this run ids first (newest, per fetchTenders own walk), then unseen previous ids', () => {
        const merged = mergeEntries(
            { old1: entry('EN PROCESO'), old2: entry('EN PROCESO') },
            [
                { id: 'new1', entry: entry('EN PROCESO') },
                { id: 'new2', entry: entry('EN PROCESO') },
            ],
        );
        expect(Object.keys(merged)).toEqual(['new1', 'new2', 'old1', 'old2']);
    });

    it('overwrites an existing id with its new entry (a real status/content change) when re-seen this run', () => {
        const merged = mergeEntries({ a: entry('EN PROCESO', 'old-hash') }, [{ id: 'a', entry: entry('ADJUDICADA', 'new-hash') }]);
        expect(merged.a).toEqual(entry('ADJUDICADA', 'new-hash'));
    });

    it('caps the result at the given size so the store does not grow unbounded', () => {
        const previous: Record<string, SeenEntry> = {};
        for (let i = 0; i < 10; i++) previous[`old${i}`] = entry('EN PROCESO');
        const merged = mergeEntries(
            previous,
            [
                { id: 'new1', entry: entry('EN PROCESO') },
                { id: 'new2', entry: entry('EN PROCESO') },
            ],
            5,
        );
        expect(Object.keys(merged)).toHaveLength(5);
        expect(Object.keys(merged)).toEqual(['new1', 'new2', 'old0', 'old1', 'old2']);
    });

    it('handles an empty previous state (cold start)', () => {
        const merged = mergeEntries({}, [
            { id: 'a', entry: entry('EN PROCESO') },
            { id: 'b', entry: entry('EN PROCESO') },
        ]);
        expect(Object.keys(merged)).toEqual(['a', 'b']);
    });

    it('handles an empty run (nothing fetched) by leaving previous state untouched', () => {
        const previous = { a: entry('EN PROCESO'), b: entry('EN PROCESO') };
        expect(mergeEntries(previous, [])).toEqual(previous);
    });
});
