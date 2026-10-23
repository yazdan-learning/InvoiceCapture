import { describe, expect, it } from 'vitest';
import { applyCurrencyUnits, toInvoiceData } from '../src/ai/replies';
import { getCalendar } from '../src/countries/calendars';
import { international } from '../src/countries/international';
import { iran } from '../src/countries/iran';

const persian = getCalendar('persian');

describe('toInvoiceData', () => {
  it('converts a Shamsi date written in Persian digits', () => {
    expect(toInvoiceData({ invoiceDate: '۱۴۰۵/۰۷/۲۶' }, persian).invoiceDate).toBe('2026-10-18');
  });

  it('drops a Shamsi date on a Gregorian-calendar invoice', () => {
    expect(toInvoiceData({ invoiceDate: '1405/07/26' }, getCalendar('gregorian')).invoiceDate).toBeNull();
  });
});

describe('applyCurrencyUnits', () => {
  const toman = toInvoiceData(
    { currency: 'IRT', totalAmount: 1500, subtotal: 1500, items: [{ description: 'x', quantity: 1, unitPrice: 1500, totalPrice: 1500 }] },
    persian
  );

  it('stores Toman as Rial (x10) for Iran and notes the printed total', () => {
    const data = applyCurrencyUnits(toman, iran.invoice.currencyUnits);
    expect(data).toMatchObject({ currency: 'IRR', totalAmount: 15000, subtotal: 15000 });
    expect(data.items[0]).toMatchObject({ unitPrice: 15000, totalPrice: 15000 });
    expect(data.notes).toBe('Converted from Toman (x10): invoice total 1,500 Toman');
  });

  it('recognises the spelled-out unit too', () => {
    expect(applyCurrencyUnits({ ...toman, currency: 'تومان' }, iran.invoice.currencyUnits).currency).toBe('IRR');
  });

  it('leaves amounts alone where the country has no such unit', () => {
    expect(applyCurrencyUnits(toman, international.invoice.currencyUnits)).toBe(toman);
    expect(applyCurrencyUnits({ ...toman, currency: 'IRR' }, iran.invoice.currencyUnits).totalAmount).toBe(1500);
  });
});
