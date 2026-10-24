// SAMPLE DATA for the proof of concept: raw materials as an Iranian ERP names
// them, with made-up prices in Rial (per unit) as of the start of Farvardin
// 1405. "Load sample materials" on the pricing page adds them; the AI then
// suggests a category for each. The expected category is noted for whoever
// checks the suggestions — the matcher never sees it.
export const SAMPLE_MATERIALS: { name: string; unit: string; price: number; expected: string | null }[] = [
  { name: 'میلگرد A3 سایز ۱۶', unit: 'کیلوگرم', price: 420_000, expected: 'STEEL_REBAR' },
  { name: 'ورق گالوانیزه ۰.۵ میل', unit: 'کیلوگرم', price: 650_000, expected: 'STEEL_GALV_SHEET' },
  { name: 'ورق سیاه ۲ میل', unit: 'کیلوگرم', price: 480_000, expected: 'STEEL_HR_SHEET' },
  { name: 'تیرآهن ۱۴', unit: 'کیلوگرم', price: 455_000, expected: 'STEEL_STRUCT' },
  { name: 'لوله مانیسمان ۲ اینچ', unit: 'متر', price: 2_900_000, expected: 'STEEL_PIPE' },
  { name: 'پروفیل آلومینیوم درب و پنجره', unit: 'کیلوگرم', price: 3_100_000, expected: 'ALU_EXTRUSION' },
  { name: 'سیم مسی افشان ۲.۵', unit: 'متر', price: 260_000, expected: 'COPPER_WIRE' },
  { name: 'گرانول پلی‌اتیلن سنگین', unit: 'کیلوگرم', price: 780_000, expected: 'PE' },
  { name: 'لوله پلی‌اتیلن ۶۳', unit: 'متر', price: 1_150_000, expected: 'PLASTIC_PIPE' },
  { name: 'سیمان تیپ ۲', unit: 'کیسه ۵۰ کیلوگرمی', price: 2_400_000, expected: 'CEMENT' },
  { name: 'ام‌دی‌اف ۱۶ میل', unit: 'ورق', price: 18_500_000, expected: 'MDF' },
  { name: 'پیچ و مهره گالوانیزه', unit: 'کیلوگرم', price: 1_350_000, expected: 'FASTENERS' },
  { name: 'رنگ اپوکسی', unit: 'گالن', price: 9_800_000, expected: 'PAINTS' },
  { name: 'درب ضدسرقت', unit: 'عدد', price: 420_000_000, expected: 'METAL_DOORS' },
  { name: 'هزینه حمل و نقل', unit: 'سرویس', price: 35_000_000, expected: null }
];

/** 1 Farvardin 1405. */
export const SAMPLE_PRICE_DATE = new Date('2026-03-21');
