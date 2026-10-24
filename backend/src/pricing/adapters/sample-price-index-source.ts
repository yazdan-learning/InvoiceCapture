import { IndexSeries, IndexValue, PriceIndexSource } from '../ports';

// SAMPLE DATA for the proof of concept — not real index values. The tree is
// shaped like the US Producer Price Index (BLS) commodity hierarchy, but the
// ids are our own and the values are generated: a start value, a monthly trend
// per branch and a small fixed wiggle per series. Replace this adapter with a
// BLS one (same port) once the API is confirmed.

type Node = { id: string; title: string; trend?: number; children?: Node[] };

const TREE: Node[] = [
  {
    id: 'METALS',
    title: 'Metals and metal products',
    trend: 0.004,
    children: [
      {
        id: 'IRON_STEEL',
        title: 'Iron and steel',
        trend: 0.006,
        children: [
          {
            id: 'STEEL_MILL',
            title: 'Steel mill products',
            children: [
              { id: 'STEEL_HR_SHEET', title: 'Hot-rolled steel sheet and strip' },
              { id: 'STEEL_CR_SHEET', title: 'Cold-rolled steel sheet and strip' },
              { id: 'STEEL_GALV_SHEET', title: 'Hot-dipped galvanized steel sheet', trend: 0.008 },
              { id: 'STEEL_REBAR', title: 'Steel concrete reinforcing bars (rebar)', trend: 0.009 },
              { id: 'STEEL_PIPE', title: 'Steel pipe and tube' },
              { id: 'STEEL_STRUCT', title: 'Structural steel shapes (beams, angles, channels)' },
              { id: 'STAINLESS_SHEET', title: 'Stainless steel sheet and strip', trend: 0.002 }
            ]
          },
          { id: 'IRON_SCRAP', title: 'Iron and steel scrap', trend: -0.003 }
        ]
      },
      {
        id: 'NONFERROUS',
        title: 'Nonferrous metals',
        trend: 0.008,
        children: [
          {
            id: 'ALU_MILL',
            title: 'Aluminum mill shapes',
            children: [
              { id: 'ALU_EXTRUSION', title: 'Aluminum extruded shapes (profiles)' },
              { id: 'ALU_SHEET', title: 'Aluminum sheet and plate' }
            ]
          },
          { id: 'COPPER_WIRE', title: 'Copper wire and cable', trend: 0.011 },
          { id: 'COPPER_MILL', title: 'Copper and brass mill shapes (tube, sheet, rod)', trend: 0.01 },
          { id: 'ZINC', title: 'Zinc and zinc alloys' }
        ]
      },
      {
        id: 'FAB_METAL',
        title: 'Fabricated metal products',
        trend: 0.003,
        children: [
          { id: 'FASTENERS', title: 'Bolts, nuts, screws and rivets' },
          { id: 'METAL_DOORS', title: 'Metal doors, sash, frames and trim' },
          { id: 'WIRE_PRODUCTS', title: 'Steel wire and wire products (mesh, nails)' }
        ]
      }
    ]
  },
  {
    id: 'CHEMICALS',
    title: 'Chemicals and allied products',
    trend: 0.001,
    children: [
      {
        id: 'PLASTIC_RESINS',
        title: 'Plastic resins and materials',
        trend: -0.002,
        children: [
          { id: 'PE', title: 'Polyethylene resins' },
          { id: 'PP', title: 'Polypropylene resins' },
          { id: 'PVC', title: 'Polyvinyl chloride (PVC) resins', trend: -0.004 }
        ]
      },
      { id: 'PAINTS', title: 'Paints and coatings', trend: 0.003 }
    ]
  },
  {
    id: 'RUBBER_PLASTIC',
    title: 'Rubber and plastic products',
    trend: 0.001,
    children: [
      { id: 'PLASTIC_PIPE', title: 'Plastic pipe and fittings' },
      { id: 'PLASTIC_FILM', title: 'Plastic film and sheet' }
    ]
  },
  {
    id: 'NONMETALLIC',
    title: 'Nonmetallic mineral products',
    trend: 0.003,
    children: [
      { id: 'CEMENT', title: 'Cement', trend: 0.004 },
      { id: 'CONCRETE', title: 'Ready-mix concrete' },
      { id: 'FLAT_GLASS', title: 'Flat glass' },
      { id: 'BRICK', title: 'Brick and structural clay tile' }
    ]
  },
  {
    id: 'LUMBER',
    title: 'Lumber and wood products',
    trend: -0.004,
    children: [
      { id: 'SOFTWOOD', title: 'Softwood lumber' },
      { id: 'PLYWOOD', title: 'Plywood' },
      { id: 'MDF', title: 'Particleboard and fiberboard (MDF)', trend: -0.001 }
    ]
  },
  { id: 'PAPER', title: 'Pulp, paper and allied products', trend: 0.001, children: [{ id: 'CORRUGATED', title: 'Corrugated boxes and containerboard' }] },
  { id: 'FUELS', title: 'Fuels and related products', trend: 0.002, children: [{ id: 'BITUMEN', title: 'Asphalt and bitumen' }] }
];

/** The published months: index values come out about two weeks after a month ends. */
export const SAMPLE_PERIODS = [
  '2025-10', '2025-11', '2025-12', '2026-01', '2026-02', '2026-03',
  '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09'
];

type Series = IndexSeries & { values: number[] };

/** A small, fixed number per id, so every series wiggles differently but the same on every run. */
function seed(id: string): number {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) % 9973;
  return h;
}

function flatten(nodes: Node[], path: string[], inheritedTrend: number, out: Series[]): Series[] {
  for (const node of nodes) {
    const trend = node.trend ?? inheritedTrend;
    const s = seed(node.id);
    const start = 180 + (s % 180);
    const values = SAMPLE_PERIODS.map((_, m) => Math.round(start * (1 + trend) ** m * (1 + 0.008 * Math.sin(m + s)) * 1000) / 1000);
    out.push({ id: node.id, title: node.title, path, values });
    if (node.children) flatten(node.children, [...path, node.title], trend, out);
  }
  return out;
}

const SERIES = flatten(TREE, [], 0, []);

const periodOf = (date: Date) => date.toISOString().slice(0, 7);

export class SamplePriceIndexSource implements PriceIndexSource {
  async listSeries(): Promise<IndexSeries[]> {
    return SERIES.map(({ values: _values, ...series }) => series);
  }

  async valueAt(seriesId: string, date: Date): Promise<IndexValue | null> {
    const series = SERIES.find((s) => s.id === seriesId);
    if (!series) return null;
    const wanted = periodOf(date);
    for (let i = SAMPLE_PERIODS.length - 1; i >= 0; i--) {
      if (SAMPLE_PERIODS[i] <= wanted) return { period: SAMPLE_PERIODS[i], value: series.values[i] };
    }
    return null;
  }
}
