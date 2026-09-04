import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import * as cheerio from 'cheerio';
import { describe, expect, it } from 'vitest';

import { parseGrid } from '../../src/parsers/table.js';

const fixturesDir = fileURLToPath(new URL('../fixtures', import.meta.url));

function loadFixture(name: string) {
    return cheerio.load(readFileSync(`${fixturesDir}/${name}`, 'utf-8'));
}

describe('parseGrid', () => {
    it('extracts all 25 rows from a real page 1 capture, with correct fields', () => {
        const $ = loadFixture('page1.html');
        const rows = parseGrid($);

        expect(rows).toHaveLength(25);

        const first = rows[0];
        expect(first.nroCotizacion).toBe('2026/000091');
        expect(first.tipoContratacion).toBe('Licitación - Soporte Digital');
        expect(first.servicioAdministrativo).toContain('Agencia Córdoba');
        expect(first.estado).toBe('EN PROCESO');
        expect(first.prorroga).toBe(false);
        expect(first.telefonoContacto).toBe('3517660269');
        expect(first.items).toHaveLength(1);
        expect(first.items[0].cantidad).toBe('1');
        expect(first.items[0].presupuestoOficial).toContain('$');
    });

    it('parses "prorroga" SI as true', () => {
        const $ = loadFixture('page1.html');
        const rows = parseGrid($);
        const withProrroga = rows.find((r) => r.prorroga);
        expect(withProrroga).toBeDefined();
        expect(withProrroga?.nroCotizacion).toBeDefined();
    });

    it('extracts a partial (<25) page of real data further into pagination', () => {
        // Captured as page 8 when it was the last page with content (93 total
        // tenders that day); the live dataset has since grown past that boundary
        // (125+ tenders within the same working session), but this frozen
        // snapshot's own row count is still a valid regression fixture.
        const $ = loadFixture('page8_last.html');
        const rows = parseGrid($);
        expect(rows.length).toBeGreaterThan(0);
        expect(rows.length).toBeLessThan(25);
    });

    it('returns an empty array on a page with no data rows', () => {
        const $ = loadFixture('page_no_results.html');
        const rows = parseGrid($);
        expect(rows).toHaveLength(0);
    });

    it('every row has a well-formed nroCotizacion (YYYY/NNNNNN)', () => {
        const $ = loadFixture('page2.html');
        const rows = parseGrid($);
        expect(rows.length).toBeGreaterThan(0);
        for (const row of rows) {
            expect(row.nroCotizacion).toMatch(/^\d{4}\/\d+$/);
        }
    });
});
