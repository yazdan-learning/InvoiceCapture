import { CountryProfile } from '../country-profile';
import { persianWordsToNumber } from './number-words';

const PERSIAN_INVOICE_RULES = `Persian invoices (فاکتور):
- Digits may be Persian or Arabic (۰۱۲۳۴۵۶۷۸۹, ٠١٢٣٤٥٦٧٨٩): output them as Western digits. Amounts are whole
  numbers: ",", "٬", "." or "/" between groups of three digits are thousands separators (۱.۲۵۰.۰۰۰ = 1250000).
- Columns: ردیف = row number (never an amount), شرح کالا / نام کالا = description, تعداد / مقدار = quantity,
  فی / قیمت واحد / مبلغ فی = unitPrice, مبلغ کل = the line's totalPrice. Keep descriptions in Persian as written.
- Footer lines are never items: جمع کل / جمع = subtotal before discount, تخفیف = discount,
  مالیات / عوارض / ارزش افزوده = taxAmount, مبلغ قابل پرداخت / مبلغ پرداختی / جمع کل بدهکاری = totalAmount.
  Without a discount or tax line, totalAmount = جمع کل.
- The seller (vendorName) is the business in the header, on the stamp (مهر) or next to فروشنده. Read the stamp
  even when a signature covers part of it. The name after نام مشتری, خریدار, آقای/خانم or صورتحساب is the
  customer (customerName), and the address next to it is customerAddress.
- Dates are Shamsi (Jalali), e.g. ۱۴۰۳/۱۱/۰۸: return invoiceDate exactly as written as "YYYY/MM/DD" with the
  Shamsi year (1403/11/08). Never convert it to the Gregorian calendar yourself.
- Currency only from a word actually written on the invoice: ریال -> "IRR", تومان -> "IRT". Always keep the amounts
  exactly as printed (never multiply Toman amounts). If neither word is written, currency null.`;

// Handwritten invoices are common in Iran: OCR loses handwritten digits —
// zeros written one per box, a dash standing for trailing zeros.
const persianHandwritingRules = (todayShamsi: string) => `- It is usually a printed Persian form (فاکتور فروش) filled in by hand.
- Amount columns (مبلغ کل, قیمت واحد) are often divided into boxes with one digit per box: read every box,
  including each 0. Never drop zeros.
- A dash or stroke after digits (e.g. "۴۵—") stands for trailing zeros: restore them so that
  quantity x unitPrice = totalPrice of that line.
- مبلغ کل بحروف / مبلغ به حروف is the total written in words: copy it into totalInWords and its value into
  totalInWordsValue. It is the most reliable total; totalAmount should match it.
- In Persian handwriting ۰ is a dot (.) and ۵ a small circle (o): "۱۳۹o" is 1395, not 1392. Handwritten ۲ and ۳,
  ۴ and ۶ look alike: use the column sums and the total in words to decide.
- Today is ${todayShamsi} (Shamsi). The invoice is almost always from the last few months, so a Shamsi year that
  looks far from today's is most likely a misread digit.`;

export const iran: CountryProfile = {
  id: 'IR',
  name: 'Iran',
  defaultCurrency: 'IRR',
  // Not in the shared list: only Iranian organizations get invoices in Rial.
  extraCurrencies: ['IRR'],
  calendar: 'persian',
  // Persian UI text is right-to-left; kept 'ltr' until the UI has a Persian translation.
  direction: 'ltr',
  invoice: {
    dateFormat: '"YYYY-MM-DD"|"YYYY/MM/DD (Shamsi)"|null',
    promptRules: PERSIAN_INVOICE_RULES,
    currencyUnits: [{ code: 'IRT', aliases: ['TOMAN', 'تومان'], name: 'Toman', storeAs: 'IRR', factor: 10 }],
    handwriting: {
      promptRules: persianHandwritingRules,
      wordsToNumber: persianWordsToNumber,
      currencyWords: { تومان: 'IRT', ریال: 'IRR' }
    }
  }
};
