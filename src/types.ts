import type { DateRangePreset } from './dateFilter.js';

export interface ActorInput {
    maxItems: number;
    proxyConfiguration?: {
        useApifyProxy?: boolean;
        apifyProxyGroups?: string[];
        apifyProxyCountry?: string;
    };
    onlyNew: boolean;
    dateRange?: DateRangePreset;
}

export interface TenderItem {
    renglon: string;
    cantidad: string;
    precioReferencia: string;
    presupuestoOficial: string;
}

// Only one meaningful signal exists on this domain (a licitacion appearing
// in the active-tenders listing) - see AGENTS.md for why this doesn't grow
// an HSE-style SANCTION/NEW_LISTING split.
export type EventType = 'NEW_LISTING';

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
    scraped_at: string;
    is_new: boolean;
    source_url: string;
}

export type FormFields = Record<string, string>;
