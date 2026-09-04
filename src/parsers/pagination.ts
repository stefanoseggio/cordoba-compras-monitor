import type { CheerioAPI } from 'cheerio';

// The results grid's own pager renders each numbered slot as either a
// clickable postback link (id="paglbN") or, for whichever page is
// currently active, a plain non-link label - and that active slot's id
// literally shifts with the current page (id="paglbl1" on page 1,
// "paglbl2" on page 2, ...), not a fixed id.
//
// There is a SEPARATE pager, differently prefixed
// (id="PopUpRubroProvNoMasterSoloPadres_paglbN"), that belongs to an
// unrelated category-filter popup and must never be confused with this
// one. Cheerio's #id selector is an exact match, so `#paglb${n}` only
// ever matches the bare grid pager - verified live 2026-09-04 against a
// real multi-page walk (8 real pages, 93 tenders, 3 trailing empty pager
// slots correctly recognized as "no more data").
export function getCurrentPage($: CheerioAPI): number | null {
    let found: number | null = null;
    $('[id]').each((_i, el) => {
        const id = $(el).attr('id') ?? '';
        const m = /^paglbl(\d+)$/.exec(id);
        if (m) found = Number(m[1]);
    });
    return found;
}

export function hasPageLink($: CheerioAPI, page: number): boolean {
    return $(`#paglb${page}`).length > 0;
}

// The pager only ever renders an 11-slot sliding WINDOW of page numbers
// (e.g. 1..11, then 2..12, then 3..13, ...) - beyond the current window's
// last slot there is no direct numbered link, only a "siguiente bloque"
// control (id="paglbS") that both advances one page AND slides the window
// forward. Verified live 2026-09-04: clicking paglbS from page 11 (window
// 1-11) landed on page 12 (new window 2-12), with no direct "paglb12" link
// ever appearing - paglbS is the only way past a window's edge, and must
// be used whenever the direct link for currentPage+1 isn't present.
export function hasNextBlockLink($: CheerioAPI): boolean {
    return $('#paglbS').length > 0;
}
