import { describe, expect, it } from 'vitest';

import { mergeSeenIds } from '../src/state.js';

describe('mergeSeenIds', () => {
    it('puts this run ids first (newest, per fetchTenders own newest-first walk), then unseen previous ids', () => {
        const merged = mergeSeenIds(['old1', 'old2'], ['new1', 'new2']);
        expect(merged).toEqual(['new1', 'new2', 'old1', 'old2']);
    });

    it('does not duplicate an id that appears in both this run and the previous state', () => {
        const merged = mergeSeenIds(['a', 'b', 'c'], ['b', 'd']);
        expect(merged).toEqual(['b', 'd', 'a', 'c']);
    });

    it('caps the result at the given size so the store does not grow unbounded', () => {
        const previous = Array.from({ length: 10 }, (_, i) => `old${i}`);
        const merged = mergeSeenIds(previous, ['new1', 'new2'], 5);
        expect(merged).toHaveLength(5);
        expect(merged).toEqual(['new1', 'new2', 'old0', 'old1', 'old2']);
    });

    it('handles an empty previous state (cold start)', () => {
        expect(mergeSeenIds([], ['a', 'b'])).toEqual(['a', 'b']);
    });

    it('handles an empty run (nothing fetched) by leaving previous state untouched', () => {
        expect(mergeSeenIds(['a', 'b'], [])).toEqual(['a', 'b']);
    });
});
