import { describe, expect, it } from 'vitest';
import { EMPTY_GUIDE, guideLines, guideProblems, guideRequiredLabels, learnedLabel, learnGuide, SentInvoice } from '../src/reading/form-guide';
import { printedAmount } from '../src/reading/box-text';

/** A ونوس شیشه customer receipt, as Mistral OCR writes it (its labels; the values change per invoice). */
const receipt = ({ number = 'SF9903', date = '۱۴۰۵/۷/۲۹', base = '۴۵,۰۰۰,۰۰۰', extra = '۰', total = '۴۵,۰۰۰,۰۰۰', withTotal = true } = {}) => `F-LO-005

تاریخ ایجاد: ۹۶/۰۴/۰۱ تاریخ بازنگری: شماره بازنگری: ۰۰

# رسید مشتری

ونوس شیشه

|  شماره خروج ${number} | تاریخ و ساعت ارسال ${date} ۰۰:۰۰:۰۰ | نام راننده هادی قاسمی | موبایل ۰۹۱۹۱۱۴۶۰۵۲  |
|  شماره قرارداد TC4456 | شماره محموله CK7147 | کد ملی / اقتصادی مشتری ۶۱۱۸۹۷۴۰۲۷۹  |

هزینه پایه (ریال) : ${base}
هزینه مازاد (ریال) : ${extra}
هزینه تخلیه (ریال) : ۰
${withTotal ? `هزینه کل (ریال) : ${total}` : ''}

مهر و امضاء:
تاریخ:`;

const sent = (ocrText: string, values: SentInvoice['values'], read: SentInvoice['read'] = values): SentInvoice => ({
  ocrText,
  values,
  read,
  itemNames: [],
  amountFactors: [1, 10]
});

const VALUES = { invoiceNumber: 'SF9903', invoiceDate: '2026-10-21', totalAmount: 45_000_000 };

describe('learnGuide', () => {
  const once = learnGuide(EMPTY_GUIDE, sent(receipt(), VALUES, { ...VALUES, invoiceNumber: 'TC4456' }));
  const twice = learnGuide(once, sent(receipt({ number: 'SF9950', date: '۱۴۰۵/۸/۰۳', base: '۳۰,۰۰۰,۰۰۰', extra: '۵,۰۰۰,۰۰۰', total: '۳۵,۰۰۰,۰۰۰' }), {
    invoiceNumber: 'SF9950',
    invoiceDate: '2026-10-25',
    totalAmount: 35_000_000
  }));

  it('learns the label before every value sent, not only the corrected ones', () => {
    expect(learnedLabel(once, 'invoiceNumber')).toBeNull(); // once is not enough
    expect(learnedLabel(twice, 'invoiceNumber')).toBe('شماره خروج');
    expect(learnedLabel(twice, 'invoiceDate')).toBe('تاریخ و ساعت ارسال');
  });

  it("takes the total's own label where the total is also printed after one of its parts", () => {
    expect(once.labels.totalAmount[0].label).toBe('هزینه کل (ریال)');
    expect(learnedLabel(twice, 'totalAmount')).toBe('هزینه کل (ریال)');
  });

  it('learns which labelled amounts add up to the total, and that the form has no line items', () => {
    expect(twice.totalParts).toEqual({ labels: ['هزینه پایه (ریال)', 'هزینه مازاد (ریال)', 'هزینه تخلیه (ریال)'], seen: 2 });
    expect(twice.noItems).toBe(2);
  });

  it('remembers the label of what the reading took wrongly', () => {
    expect(once.notAfter.invoiceNumber[0].label).toBe('شماره قرارداد');
  });

  it('learns nothing from a value the text does not have (a wrong total sent, the OCR missing its line)', () => {
    const wrong = learnGuide(EMPTY_GUIDE, sent(receipt({ extra: '۴۵,۰۰۰,۰۰۰', withTotal: false }), { totalAmount: 90_000_000 }));
    expect(wrong.labels.totalAmount).toBeUndefined();
    expect(wrong.totalParts).toBeNull();
    expect(wrong.sends).toBe(1);
  });

  it('finds an amount printed in Toman when it is stored as Rial', () => {
    const toman = learnGuide(EMPTY_GUIDE, sent('جمع کل (تومان): ۴,۵۰۰,۰۰۰', { totalAmount: 45_000_000 }));
    expect(toman.labels.totalAmount[0].label).toBe('جمع کل (تومان)');
  });
});

describe('the guide in the prompt and the checks', () => {
  let guide = EMPTY_GUIDE;
  for (const [n, total] of [['SF1', 45_000_000], ['SF2', 45_000_000]] as const) {
    guide = learnGuide(guide, sent(receipt({ number: n }), { invoiceNumber: n, invoiceDate: '2026-10-21', totalAmount: total }, { invoiceNumber: 'F-LO-005', totalAmount: total }));
  }

  it('describes the form in text: the label before each value and the parts of the total', () => {
    const lines = guideLines(guide).join('\n');
    expect(lines).toContain('- invoiceNumber: the value printed right after "شماره خروج"');
    expect(lines).toContain('- invoiceDate: the date printed right after "تاریخ و ساعت ارسال"');
    expect(lines).toContain('- totalAmount: the amount printed right after "هزینه کل (ریال)". The form adds "هزینه پایه (ریال)" + "هزینه مازاد (ریال)" + "هزینه تخلیه (ریال)" up to it');
    expect(guideLines(guide, ['invoiceNumber']).join('\n')).not.toContain('invoiceNumber');
  });

  it('lists the learned labels the OCR text must have', () => {
    expect(guideRequiredLabels(guide)).toEqual(['هزینه کل (ریال)', 'شماره خروج', 'تاریخ و ساعت ارسال']);
  });

  it('flags a reading that differs from what the form prints after a learned label', () => {
    const text = receipt({ number: 'SF7', date: '۱۴۰۵/۸/۰۳', total: '۴۵,۰۰۰,۰۰۰' });
    const right = { invoiceNumber: 'SF7', invoiceDate: '2026-10-25', totalAmount: 45_000_000 };
    expect(guideProblems(guide, right, text, printedAmount)).toEqual([]);
    expect(guideProblems(guide, { ...right, totalAmount: 90_000_000, invoiceNumber: 'F-LO-005' }, text, printedAmount)).toEqual([
      'invoiceNumber: the form prints "SF7" after "شماره خروج"',
      'totalAmount: the form prints "45,000,000" after "هزینه کل (ریال)"'
    ]);
    // Without the label in the text there is nothing to compare.
    expect(guideProblems(guide, { ...right, totalAmount: 90_000_000 }, receipt({ withTotal: false }), printedAmount)).not.toContainEqual(expect.stringContaining('totalAmount'));
  });
});

describe('a value alone in its table cell', () => {
  const HELIX = '|  جمع کل: | ۲,۳۹۶,۱۰۰,۰۰۰  |\n|  مبلغ پرداختی | ۲,۳۹۰,۰۰۰,۰۰۰  |\n|  جمع کل بدهکاری شما با احتساب این فاکتور ۲,۳۹۰,۰۰۰,۰۰۰ ریال است  |';

  it("takes the cell before it as its label, and reads the value from the next cell after that label", async () => {
    const { labelsBefore, valueAfter } = await import('../src/reading/templates');
    expect(labelsBefore(HELIX, '2390000000', { amount: true })).toEqual(['مبلغ پرداختی', 'با احتساب این فاکتور']);
    expect(labelsBefore(HELIX, '2396100000', { amount: true })).toEqual(['جمع کل']);
    expect(valueAfter(HELIX, 'مبلغ پرداختی')).toBe('2,390,000,000');
  });

  it("prefers the total's own words over a sentence's", () => {
    const guide = learnGuide(EMPTY_GUIDE, sent(HELIX, { totalAmount: 2_390_000_000 }));
    expect(guide.labels.totalAmount[0].label).toBe('مبلغ پرداختی');
  });
});
