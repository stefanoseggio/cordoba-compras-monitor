import { createHash } from 'node:crypto';

import type { TenderRow } from './types.js';

/**
 * A stable content fingerprint of everything about a tender that can change while it stays
 * `nroCotizacion`-identical: dates, prorroga, items, contact phone. Excludes nroCotizacion
 * (identity) and estado (tracked separately - see src/state.ts - so a genuine status
 * transition is reported as STATUS_CHANGE rather than folded into a generic UPDATED). Free to
 * compute: every field is already inline in the one listing fetch this actor always makes.
 */
export function fingerprintOf(row: TenderRow): string {
    const stable = {
        tipoContratacion: row.tipoContratacion,
        servicioAdministrativo: row.servicioAdministrativo,
        jurisdiccion: row.jurisdiccion,
        fechaInicio: row.fechaInicio,
        fechaFinalizacion: row.fechaFinalizacion,
        prorroga: row.prorroga,
        items: row.items,
        telefonoContacto: row.telefonoContacto,
    };
    return createHash('sha1').update(JSON.stringify(stable)).digest('hex');
}
