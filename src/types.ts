export interface ActorInput {
    maxItems: number;
    proxyConfiguration?: {
        useApifyProxy?: boolean;
        apifyProxyGroups?: string[];
        apifyProxyCountry?: string;
    };
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
    scrapedAt: string;
}

export type FormFields = Record<string, string>;
