import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import * as cheerio from 'cheerio';
import { describe, expect, it } from 'vitest';

import { getCurrentPage, hasNextBlockLink, hasPageLink } from '../../src/parsers/pagination.js';

const fixturesDir = fileURLToPath(new URL('../fixtures', import.meta.url));

function loadFixture(name: string) {
    return cheerio.load(readFileSync(`${fixturesDir}/${name}`, 'utf-8'));
}

describe('getCurrentPage', () => {
    it('reads page 1 from the initial page load', () => {
        const $ = loadFixture('page1.html');
        expect(getCurrentPage($)).toBe(1);
    });

    it('reads page 2 after a real postback to paglb2 - the active slot id shifts to paglbl2', () => {
        const $ = loadFixture('page2.html');
        expect(getCurrentPage($)).toBe(2);
    });
});

describe('hasPageLink', () => {
    it('page 1 has a link forward to page 2', () => {
        const $ = loadFixture('page1.html');
        expect(hasPageLink($, 2)).toBe(true);
    });

    it('never matches the unrelated rubro-filter popup pager, which uses a prefixed id', () => {
        const $ = loadFixture('page1.html');
        // the popup pager also has a numbered link "2", but under a prefixed id -
        // hasPageLink must not be fooled by that into a false positive at a page
        // number the main grid doesn't actually have a link for.
        expect(hasPageLink($, 2)).toBe(true); // real link, exists on the bare grid too
        expect($('[id="PopUpRubroProvNoMasterSoloPadres_PopUpRubroProvNoMasterSoloPadres_paglb2"]').length).toBeGreaterThan(0); // sanity: popup's own (differently prefixed) id is present
    });

    it('page 9 (captured once the dataset grew past the original 11-slot window) still links to 10 and 11 inside the window', () => {
        const $ = loadFixture('page9_empty.html');
        expect(getCurrentPage($)).toBe(9);
        expect(hasPageLink($, 10)).toBe(true);
        expect(hasPageLink($, 11)).toBe(true);
        expect(hasPageLink($, 12)).toBe(false); // 12 is outside this window - only reachable via the block-jump control
    });
});

describe('hasNextBlockLink', () => {
    it('detects the "siguiente bloque" control once the dataset is deep enough to need it', () => {
        // Verified live 2026-09-04: clicking this control from page 11 (the
        // window's last slot) landed on page 12 with a freshly slid window -
        // it is the only way past a window's edge, no direct "paglb12" link
        // ever appears.
        const $ = loadFixture('page9_empty.html');
        expect(hasNextBlockLink($)).toBe(true);
    });
});
