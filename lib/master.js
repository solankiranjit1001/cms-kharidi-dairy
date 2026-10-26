// Vegetables and traders: one permanent record each, de-duplicated by normalized name.
import { q, tx } from './db.js';
import { bad, conflict, forbidden, notFound } from './errors.js';
import { text, nameKey, oneOf, UNITS, phone as vPhone, id as vId, todayIST,
  PAYMENT_METHODS, SALE_MODES, MARKETS, EXPENSE_CATEGORIES } from './validate.js';
import { paise, rupees } from './money.js';
import { audit } from './audit.js';

export async function meta() {
  const [v, t] = await Promise.all([
    q('SELECT id, name, unit, active FROM vegetables ORDER BY active DESC, name'),
    q('SELECT id, name, phone, active FROM traders ORDER BY active DESC, name'),
  ]);
  return {
    today: todayIST(),
    vegetables: v.rows,
    traders: t.rows,
    units: UNITS, markets: MARKETS, paymentMethods: PAYMENT_METHODS, saleModes: SALE_MODES,
    expenseCategories: EXPENSE_CATEGORIES,
  };
}

/** Find vegetable by id or name; optionally create it (unit given) when body allows. */
export async function resolveVegetable(c, { vegetable_id, vegetable, unit, createVegetable }, userId) {
  if (vegetable_id) {
    const { rows: [v] } = await c.query('SELECT id, name, unit FROM vegetables WHERE id = $1', [vId(vegetable_id, 'શાક')]);
    if (!v) throw bad('શાક મળ્યું નથી.');
    return v;
  }
  const name = text(vegetable, { label: 'શાકનું નામ', max: 60, required: true });
  const key = nameKey(name);
  const { rows: [ex] } = await c.query('SELECT id, name, unit FROM vegetables WHERE name_key = $1', [key]);
  if (ex) return ex;
  if (!createVegetable) throw bad(`"${name}" શાક યાદીમાં નથી. નવું શાક ઉમેરવાની પુષ્ટિ કરો.`, { unknownVegetable: name });
  const u = unit ? oneOf(unit, UNITS, 'એકમ') : 'kg';
  const { rows: [v] } = await c.query(
    `INSERT INTO vegetables(name, name_key, unit, created_by) VALUES ($1,$2,$3,$4)
     ON CONFLICT (name_key) DO UPDATE SET name_key = EXCLUDED.name_key RETURNING id, name, unit`, [name, key, u, userId]);
  await audit(c, userId, 'create', 'vegetables', v.id, null, v, null);
  return v;
}

export async function createVegetable(user, body) {
  return tx((c) => resolveVegetable(c, { vegetable: body.name, unit: body.unit, createVegetable: true }, user.id));
}

export async function updateVegetable(user, vegId, body) {
  vegId = vId(vegId);
  return tx(async (c) => {
    const { rows: [before] } = await c.query('SELECT id, name, unit, active FROM vegetables WHERE id = $1 FOR UPDATE', [vegId]);
    if (!before) throw notFound();
    const next = { ...before };
    if (body.name !== undefined) {
      next.name = text(body.name, { label: 'શાકનું નામ', max: 60, required: true });
      const { rows: dup } = await c.query('SELECT id FROM vegetables WHERE name_key = $1 AND id <> $2', [nameKey(next.name), vegId]);
      if (dup.length) throw conflict('આ નામનું શાક પહેલેથી છે.');
    }
    if (body.unit !== undefined && body.unit !== before.unit) {
      next.unit = oneOf(body.unit, UNITS, 'એકમ');
      const { rows: [{ n }] } = await c.query('SELECT count(*)::int AS n FROM stock_moves WHERE vegetable_id = $1', [vegId]);
      if (n > 0) throw bad('આ શાકની એન્ટ્રી થઈ ચૂકી છે, તેથી એકમ બદલી શકાતો નથી.');
    }
    if (body.active !== undefined) next.active = Boolean(body.active);
    await c.query('UPDATE vegetables SET name=$2, name_key=$3, unit=$4, active=$5 WHERE id=$1',
      [vegId, next.name, nameKey(next.name), next.unit, next.active]);
    await audit(c, user.id, 'update', 'vegetables', vegId, before, next, null);
    return next;
  });
}

export async function resolveTrader(c, { trader_id, trader, createTrader }, userId) {
  if (trader_id) {
    const { rows: [t] } = await c.query('SELECT id, name FROM traders WHERE id = $1', [vId(trader_id, 'વેપારી')]);
    if (!t) throw bad('વેપારી મળ્યો નથી.');
    return t;
  }
  const name = text(trader, { label: 'વેપારીનું નામ', max: 80, required: true });
  const key = nameKey(name);
  const { rows: [ex] } = await c.query('SELECT id, name FROM traders WHERE name_key = $1', [key]);
  if (ex) return ex;
  if (!createTrader) throw bad(`"${name}" વેપારી યાદીમાં નથી. નવો વેપારી ઉમેરવાની પુષ્ટિ કરો.`, { unknownTrader: name });
  const { rows: [t] } = await c.query(
    `INSERT INTO traders(name, name_key, created_by, updated_by) VALUES ($1,$2,$3,$3)
     ON CONFLICT (name_key) DO UPDATE SET name_key = EXCLUDED.name_key RETURNING id, name`, [name, key, userId]);
  await audit(c, userId, 'create', 'traders', t.id, null, t, null);
  return t;
}

export async function createTrader(user, body) {
  const name = text(body.name, { label: 'વેપારીનું નામ', max: 80, required: true });
  const opening = body.opening_balance ? paise(body.opening_balance, 'શરૂઆતની બાકી', { allowNegative: true }) : 0n;
  if (opening !== 0n && user.role !== 'owner') throw forbidden('શરૂઆતની બાકી માત્ર માલિક દાખલ કરી શકે.');
  const ph = vPhone(body.phone);
  const note = text(body.note, { label: 'નોંધ', max: 200 });
  return tx(async (c) => {
    const { rows: dup } = await c.query('SELECT id, name FROM traders WHERE name_key = $1', [nameKey(name)]);
    if (dup.length) throw conflict(`"${dup[0].name}" વેપારી પહેલેથી છે.`, { existingId: dup[0].id });
    const { rows: [t] } = await c.query(
      `INSERT INTO traders(name, name_key, phone, opening_balance, note, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$6) RETURNING id, name, phone, opening_balance, note, active`,
      [name, nameKey(name), ph, rupees(opening), note, user.id]);
    await audit(c, user.id, 'create', 'traders', t.id, null, t, null);
    return t;
  });
}

export async function updateTrader(user, traderId, body) {
  traderId = vId(traderId);
  return tx(async (c) => {
    const { rows: [before] } = await c.query('SELECT id, name, phone, opening_balance, note, active FROM traders WHERE id = $1 FOR UPDATE', [traderId]);
    if (!before) throw notFound();
    const next = { ...before };
    if (body.name !== undefined) {
      next.name = text(body.name, { label: 'વેપારીનું નામ', max: 80, required: true });
      const { rows: dup } = await c.query('SELECT id FROM traders WHERE name_key = $1 AND id <> $2', [nameKey(next.name), traderId]);
      if (dup.length) throw conflict('આ નામનો વેપારી પહેલેથી છે.');
    }
    if (body.phone !== undefined) next.phone = vPhone(body.phone);
    if (body.note !== undefined) next.note = text(body.note, { label: 'નોંધ', max: 200 });
    if (body.active !== undefined) next.active = Boolean(body.active);
    if (body.opening_balance !== undefined) {
      const ob = rupees(paise(body.opening_balance || '0', 'શરૂઆતની બાકી', { allowNegative: true }));
      if (ob !== before.opening_balance && user.role !== 'owner') throw forbidden('શરૂઆતની બાકી માત્ર માલિક બદલી શકે.');
      next.opening_balance = ob;
    }
    const reason = text(body.reason, { label: 'કારણ', max: 200 });
    await c.query(`UPDATE traders SET name=$2, name_key=$3, phone=$4, opening_balance=$5, note=$6, active=$7, updated_at=now(), updated_by=$8 WHERE id=$1`,
      [traderId, next.name, nameKey(next.name), next.phone, next.opening_balance, next.note, next.active, user.id]);
    await audit(c, user.id, 'update', 'traders', traderId, before, next, reason);
    return next;
  });
}
