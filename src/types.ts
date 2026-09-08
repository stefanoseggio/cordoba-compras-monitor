import type { DateRangePreset } from './dateFilter.js';

/**
 * NEW_LISTING: nroCotizacion never seen before. STATUS_CHANGE: seen before, `estado` differs
 * from last time - free to detect, already in the walked row. UPDATED: seen before, same
 * estado, but the content fingerprint differs (a prorroga granted, a changed fechaFinalizacion,
 * an amended item/budget). UNCHANGED: seen before, same estado, same fingerprint - only ever
 * produced on a full (onlyNew=false) run. CLOSED: a previously-active tender absent from a
 * COMPLETE walk this run (fetchTenders was not truncated by maxItems) - it has left the active
 * list: awarded, closed or expired. Only trustworthy against a complete walk - see
 * src/fetchTenders.ts and AGENTS.md "Delta engine v2".
 */
export type EventType = 'NEW_LISTING' | 'STATUS_CHANGE' | 'UPDATED' | 'UNCHANGED' | 'CLOSED';

export interface ActorInput {
    maxItems: number;
    proxyConfiguration?: {
        useApifyProxy?: boolean;
        apifyProxyGroups?: string[];
        apifyProxyCountry?: string;
    };
    onlyNew: boolean;
    /** Which event types to deliver when onlyNew=true. Ignored (everything delivered) when onlyNew=false. */
    eventTypes?: Exclude<EventType, 'UNCHANGED'>[];
    dateRange?: DateRangePreset;
}

export interface TenderItem {
    renglon: string;
    cantidad: string;
    precioReferencia: string;
    presupuestoOficial: string;
}

export interface TenderRow {
    nroCotizacion: string;
    tipoContratacion: string;
    servicioAdministrativo: string;
    jurisdiccion: string;
    fechaInicio: string;
    fechaFinalizacion: string;
    estado: string;
    prorroga: boolean;
    items: TenderItem[];
    telefonoContacto: string | null;
}

// The standardized B2B integration envelope shared across this portfolio's
// fleet, layered on top of the raw domain fields above.
export interface TenderRecord extends TenderRow {
    record_id: string;
    event_type: EventType;
    /** Set only for event_type=STATUS_CHANGE: the estado this record_id was last seen under. */
    previousEstado: string | null;
    scraped_at: string;
    is_new: boolean;
    source_url: string;
    /** sha1 content fingerprint as of this run - see src/fingerprint.ts. */
    contentHash: string;
}

export type FormFields = Record<string, string>;
