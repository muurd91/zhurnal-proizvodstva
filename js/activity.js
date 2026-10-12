// ================= Лента действий =================
// Сравнивает данные до и после изменения и превращает разницу в события для уведомлений.
// Работает по разнице документов, а не по вызовам из интерфейса: так одинаково ловятся и свои
// действия, и то, что пришло с другого устройства через OneDrive.
//
// Событие: { tone: 'repair' | 'maintenance' | 'ok' | 'info', title, detail, author }

const Activity = (() => {
  const LISTS = ['breakdowns', 'repairs', 'parts', 'equipment'];

  // Снимок до изменения: по каждой записи — её JSON. Дёшево, а сравнить потом можно точно.
  function snapshot(d) {
    const s = {};
    for (const k of LISTS) s[k] = new Map(d[k].map((x) => [x.id, JSON.stringify(x)]));
    s.shiftId = d.currentShift?.id ?? null;
    return s;
  }

  const clip = (t, n = 60) => {
    const s = String(t ?? '').trim();
    return s.length > n ? `${s.slice(0, n - 1)}…` : s;
  };

  function diff(before, d) {
    const events = [];
    const eqName = (id, old) => d.equipment.find((e) => e.id === id)?.name
      || (old && before.equipment.has(id) && JSON.parse(before.equipment.get(id)).name)
      || 'Оборудование';
    const push = (tone, title, detail, author = '') => events.push({ tone, title, detail, author });

    // Просматриваем и появившиеся/изменённые, и пропавшие записи.
    const scan = (key, onAdd, onChange, onDelete) => {
      const now = new Set();
      for (const item of d[key]) {
        now.add(item.id);
        const old = before[key].get(item.id);
        if (old === undefined) onAdd(item);
        else if (old !== JSON.stringify(item)) onChange(JSON.parse(old), item);
      }
      for (const [id, raw] of before[key]) if (!now.has(id)) onDelete(JSON.parse(raw));
    };

    scan('breakdowns',
      (b) => {
        const m = b.kind === 'maintenance';
        push(m ? 'maintenance' : 'repair', m ? 'Начато обслуживание' : 'Новая поломка',
          `${eqName(b.equipmentId)} — ${clip(b.reason)}`, b.master);
      },
      (o, b) => {
        if (o.status === 'repair' && b.status === 'done') {
          const m = b.kind === 'maintenance';
          push('ok', m ? 'Обслуживание завершено' : 'Ремонт завершён', eqName(b.equipmentId), b.repairedBy || b.master);
        }
      },
      (b) => push('info', 'Поломка удалена', eqName(b.equipmentId, true)));

    scan('repairs',
      (r) => push('maintenance', 'Заявка на ремонт', `${eqName(r.equipmentId)} — ${clip(r.description)}`, r.author),
      (o, r) => {
        if (o.status !== 'done' && r.status === 'done') push('ok', 'Заявка выполнена', eqName(r.equipmentId), r.doneBy);
      },
      (r) => push('info', 'Заявка удалена', eqName(r.equipmentId, true)));

    scan('parts',
      (p) => push('info', 'Запчасть на складе', `${p.name}${p.qty !== undefined ? ` — ${p.qty} ${p.unit || ''}` : ''}`.trim()),
      (o, p) => {
        if (o.qty !== p.qty) push('info', 'Изменён остаток на складе', `${p.name}: ${o.qty} → ${p.qty} ${p.unit || ''}`.trim());
      },
      (p) => push('info', 'Запчасть удалена со склада', p.name));

    scan('equipment',
      (e) => push('info', 'Добавлено оборудование', e.name),
      () => {},
      (e) => push('info', 'Оборудование удалено из перечня', e.name));

    // Смена: началась или закончилась (передача между сменами меняет id — её не показываем).
    const sid = d.currentShift?.id ?? null;
    if (before.shiftId === null && sid) push('ok', 'Смена началась', d.currentShift.master || '');
    else if (before.shiftId && sid === null) push('info', 'Смена закончилась', '');

    return events;
  }

  return { snapshot, diff };
})();
