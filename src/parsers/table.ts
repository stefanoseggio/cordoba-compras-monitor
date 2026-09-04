import type { CheerioAPI } from 'cheerio';

import type { TenderItem, TenderRow } from '../types.js';

const NRO_COTIZACION_RE = /^\d{4}\/\d+$/;

// Main results grid, id="gv". Each data row (class="Renglon" or
// "RenglonAlternativo") has 9 direct <td> children matching the header:
// Nro Cotizacion, Tipo Contratacion, Servicio Administrativo, Jurisdiccion,
// Fecha Inicio, Fecha Finalizacion, Estado, Prorroga, Acciones.
//
// The Acciones cell embeds richer data inline - a hidden popup table
// (id="gv_btnItems_{N}_gv") with per-item description/quantity/budget,
// and a contact phone in an <img title="..."> - both extracted here with
// no extra request needed, unlike PBA's fetchFullDetail gap for this
// same class of "full detail" data.
export function parseGrid($: CheerioAPI): TenderRow[] {
    const rows: TenderRow[] = [];
    const scrapedAt = new Date().toISOString();

    // cheerio (like a real browser) auto-inserts a <tbody> wrapping bare
    // <tr> elements, so the grid's top-level rows are #gv > tbody > tr, not
    // direct children of #gv itself - verified against a real capture.
    $('#gv > tbody > tr')
        .each((_i, el) => {
            const $row = $(el);
            const cells = $row.children('td');
            if (cells.length < 9) return;

            const nroCotizacion = cells.eq(0).text().trim();
            if (!NRO_COTIZACION_RE.test(nroCotizacion)) return;

            const accionesCell = cells.eq(8);

            const items: TenderItem[] = [];
            accionesCell.find('table.Grid tr').each((_j, itemEl) => {
                const $itemRow = $(itemEl);
                const itemCells = $itemRow.find('> td');
                if (itemCells.length < 4) return; // skip the header row (<th>)
                items.push({
                    renglon: itemCells.eq(0).text().trim(),
                    cantidad: itemCells.eq(1).text().trim(),
                    precioReferencia: itemCells.eq(2).text().trim(),
                    presupuestoOficial: itemCells.eq(3).text().trim(),
                });
            });

            const telefonoContacto = accionesCell.find('img[id*="btnTelContacto"]').attr('title')?.trim() || null;

            rows.push({
                nroCotizacion,
                tipoContratacion: cells.eq(1).text().trim(),
                servicioAdministrativo: cells.eq(2).text().trim(),
                jurisdiccion: cells.eq(3).text().trim(),
                fechaInicio: cells.eq(4).text().trim(),
                fechaFinalizacion: cells.eq(5).text().trim(),
                estado: cells.eq(6).text().trim(),
                prorroga: cells.eq(7).text().trim().toUpperCase() === 'SI',
                items,
                telefonoContacto,
                scrapedAt,
            });
        });

    return rows;
}
