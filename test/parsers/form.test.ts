import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import * as cheerio from 'cheerio';
import { describe, expect, it } from 'vitest';

import { buildPostbackPayload, extractFormFields } from '../../src/parsers/form.js';

const fixturesDir = fileURLToPath(new URL('../fixtures', import.meta.url));

function loadFixture(name: string) {
    return cheerio.load(readFileSync(`${fixturesDir}/${name}`, 'utf-8'));
}

describe('extractFormFields', () => {
    it('includes the core ASP.NET postback fields', () => {
        const $ = loadFixture('page1.html');
        const fields = extractFormFields($);
        expect(fields.__VIEWSTATE).toBeTruthy();
        expect(fields.__VIEWSTATE.length).toBeGreaterThan(1000);
        expect(fields.__VIEWSTATEGENERATOR).toBeTruthy();
        expect(fields.__EVENTVALIDATION).toBeTruthy();
        expect(fields).toHaveProperty('__VIEWSTATEENCRYPTED');
    });

    it('excludes unchecked checkboxes entirely, matching real browser behaviour', () => {
        // Regression test for the live bug found 2026-09-04: naively sending every
        // checkbox's declared value= (checked or not) produces a 200 response that
        // silently never advances pages. This is real production data with 49
        // unchecked filter checkboxes on the page - none should appear in the payload.
        // (ddljurisdiccion / ddlTipoContratacion themselves are plain <select>
        // placeholders, not checkboxes, and are legitimately included.)
        const $ = loadFixture('page1.html');
        const fields = extractFormFields($);
        const checkboxFieldNames = Object.keys(fields).filter((name) => name.includes('CheckBoxLista'));
        expect(checkboxFieldNames).toHaveLength(0);
        expect(fields.ddljurisdiccion).toBe('--Seleccionar--');
    });

    it('excludes submit/image button fields (we are not "clicking" every button)', () => {
        const $ = loadFixture('page1.html');
        const fields = extractFormFields($);
        const buttonFieldNames = Object.keys(fields).filter((name) => name.includes('btnVerDetalles') || name.includes('btnPliego'));
        expect(buttonFieldNames).toHaveLength(0);
    });

    it('field count stays well below the raw <input> count (49 checkboxes + buttons excluded)', () => {
        const $ = loadFixture('page1.html');
        const fields = extractFormFields($);
        const rawInputCount = $('input').length;
        expect(rawInputCount).toBeGreaterThan(150); // the page has 180 <input> tags total
        expect(Object.keys(fields).length).toBeLessThan(50);
    });
});

describe('buildPostbackPayload', () => {
    it('sets __EVENTTARGET to the requested control and __EVENTARGUMENT to empty', () => {
        const $ = loadFixture('page1.html');
        const payload = buildPostbackPayload($, 'paglb2');
        expect(payload.__EVENTTARGET).toBe('paglb2');
        expect(payload.__EVENTARGUMENT).toBe('');
        expect(payload.__VIEWSTATE).toBeTruthy();
    });
});
