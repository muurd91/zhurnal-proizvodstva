// Простые линейные иконки (SVG, цвет берётся из currentColor).
const ICONS = (() => {
  const svg = (body) =>
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
  return {
    current:   svg('<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>'),
    history:   svg('<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/><path d="M12 7v5l3 2"/>'),
    equipment: svg('<path d="M3 21V11l5 3v-3l5 3v-3l5 3V4h3v17z"/><path d="M7 17h2M12 17h2"/>'), // цех
    repair:    svg('<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.5-.5-.5-2.5z"/>'),
    warehouse: svg('<path d="M3 9l9-5 9 5v11H3z"/><path d="M7 20v-7h10v7M7 16h10"/>'),
    manuals:   svg('<path d="M4 4h6a3 3 0 0 1 2 1 3 3 0 0 1 2-1h6v15h-6a2 2 0 0 0-2 2 2 2 0 0 0-2-2H4z"/><path d="M12 5v16"/>'),
    settings:  svg('<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>'),
    shifts:    svg('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.5 3.4-5.5 6.5-5.5s5.7 2 6.5 5.5"/><circle cx="18" cy="15" r="3.5"/><path d="M18 13.3V15l1.2.8"/>'),
    find:      svg('<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>'),
    trash:     svg('<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/>'),
    chevron:   svg('<path d="M6 9l6 6 6-6"/>'),
    edit:      svg('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>'),
    add:     svg('<path d="M12 5v14M5 12h14"/>'),
    sun:       svg('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'),
    moon:      svg('<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>'),
    search:    svg('<path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3"/><path d="M12 17h.01"/><circle cx="12" cy="12" r="10"/>'),
  };
})();
