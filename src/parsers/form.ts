import type { CheerioAPI } from 'cheerio';

import type { FormFields } from '../types.js';

// Replicates exactly what a real browser submits when this ASP.NET WebForms
// page posts back: every non-button input's current value, every select's
// selected option, and ONLY checkboxes/radios that are actually checked.
//
// Verified live 2026-09-04: sending every checkbox's declared `value=`
// regardless of checked state (an easy mistake when scraping raw attributes)
// silently corrupts the server-side filter state - the response comes back
// 200 with no error, but the page never actually advances. Omitting the
// unchecked ones entirely, as a real browser does, is what makes the
// pagination postback (__EVENTTARGET=paglbN) actually work.
export function extractFormFields($: CheerioAPI): FormFields {
    const fields: FormFields = {};

    $('input').each((_i, el) => {
        const $el = $(el);
        const name = $el.attr('name');
        if (!name) return;
        const type = ($el.attr('type') ?? 'text').toLowerCase();

        if (type === 'checkbox' || type === 'radio') {
            if ($el.attr('checked') === undefined) return;
            fields[name] = $el.attr('value') ?? 'on';
            return;
        }
        if (type === 'submit' || type === 'image' || type === 'button' || type === 'reset') return;

        fields[name] = $el.attr('value') ?? '';
    });

    $('select').each((_i, el) => {
        const $el = $(el);
        const name = $el.attr('name');
        if (!name) return;
        const selected = $el.find('option[selected]').first();
        const chosen = selected.length > 0 ? selected : $el.find('option').first();
        fields[name] = chosen.attr('value') ?? '';
    });

    $('textarea').each((_i, el) => {
        const $el = $(el);
        const name = $el.attr('name');
        if (!name) return;
        fields[name] = $el.text();
    });

    return fields;
}

export function buildPostbackPayload($: CheerioAPI, eventTarget: string): FormFields {
    return {
        ...extractFormFields($),
        __EVENTTARGET: eventTarget,
        __EVENTARGUMENT: '',
    };
}
