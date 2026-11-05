import { PointerEvent as ReactPointerEvent, useEffect, useRef, useState } from 'react';
import { FieldBox, FieldBoxes, getPageImageBlobUrl, Region } from '../api';

type Props = {
  expenseId: string;
  pages: FieldBoxes['pages'];
  boxes: FieldBox[];
  /** The field whose box is highlighted (and scrolled into view). */
  activeField: string | null;
  /** While set, dragging on a page draws a region instead of selecting a box. */
  picking: boolean;
  onPick: (page: number, region: Region) => void;
  onSelectField: (field: string) => void;
  labelFor: (field: string) => string;
};

type Draft = { page: number; startX: number; startY: number; x: number; y: number };

/** Below this a drag is a tap, not a region. */
const MIN_REGION = 0.01;

const clamp = (v: number) => Math.min(1, Math.max(0, v));

/** One box per field: the one the user drew wins over the one the model found. */
function shownBoxes(boxes: FieldBox[]): FieldBox[] {
  const byField = new Map<string, FieldBox>();
  for (const box of boxes) {
    if (box.source === 'USER' || !byField.has(box.field)) byField.set(box.field, box);
  }
  return [...byField.values()];
}

const asPercent = (box: Region) => ({
  left: `${box.x * 100}%`,
  top: `${box.y * 100}%`,
  width: `${box.width * 100}%`,
  height: `${box.height * 100}%`
});

// The document's pages with a box on each field where it was read. Tapping a
// box selects its field; in "pick" mode a drag draws the region to read the
// field from. Boxes are fractions of the page, so they stay in place at any
// display size.
export function DocumentViewer({ expenseId, pages, boxes, activeField, picking, onPick, onSelectField, labelFor }: Props) {
  const [urls, setUrls] = useState<(string | null)[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const activeRef = useRef<HTMLButtonElement | null>(null);
  const viewerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    const created: string[] = [];
    Promise.all(pages.map((p) => getPageImageBlobUrl(expenseId, p.index).catch(() => null))).then((loaded) => {
      created.push(...loaded.filter((u): u is string => !!u));
      if (!cancelled) setUrls(loaded);
    });
    return () => {
      cancelled = true;
      created.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [expenseId, pages]);

  // Scrolls the viewer, never the page: on a phone the form is below it, and
  // focusing a field there must not jump the page up to the photo.
  useEffect(() => {
    const viewer = viewerRef.current;
    const box = activeRef.current;
    if (!viewer || !box) return;
    const offset = box.getBoundingClientRect().top - viewer.getBoundingClientRect().top;
    viewer.scrollTo({ top: viewer.scrollTop + offset - viewer.clientHeight / 2 + box.clientHeight / 2, behavior: 'smooth' });
  }, [activeField, urls]);

  const pointAt = (e: ReactPointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: clamp((e.clientX - rect.left) / rect.width), y: clamp((e.clientY - rect.top) / rect.height) };
  };

  const startDraw = (page: number) => (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!picking) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const { x, y } = pointAt(e);
    setDraft({ page, startX: x, startY: y, x, y });
  };

  const moveDraw = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!draft) return;
    const { x, y } = pointAt(e);
    setDraft({ ...draft, x, y });
  };

  const endDraw = () => {
    if (!draft) return;
    const region = draftRegion(draft);
    setDraft(null);
    if (region.width >= MIN_REGION && region.height >= MIN_REGION) onPick(draft.page, region);
  };

  const shown = shownBoxes(boxes);

  return (
    <div ref={viewerRef} className={`doc-viewer${picking ? ' doc-viewer--picking' : ''}`}>
      {pages.map((page, i) => (
        <div
          key={page.index}
          className="doc-page"
          style={{ aspectRatio: `${page.width} / ${page.height}` }}
          onPointerDown={startDraw(page.index)}
          onPointerMove={moveDraw}
          onPointerUp={endDraw}
          onPointerCancel={() => setDraft(null)}
        >
          {urls[i] ? <img src={urls[i]!} alt="" className="doc-page-image" draggable={false} /> : <span className="doc-page-loading" />}
          {shown
            .filter((box) => box.page === page.index)
            .map((box) => {
              const active = box.field === activeField;
              return (
                <button
                  key={box.field}
                  type="button"
                  ref={active ? activeRef : undefined}
                  className={`doc-box${active ? ' doc-box--active' : ''}${box.field.startsWith('items.') ? ' doc-box--item' : ''}`}
                  style={asPercent(box)}
                  title={labelFor(box.field)}
                  aria-label={labelFor(box.field)}
                  tabIndex={picking ? -1 : 0}
                  onClick={() => onSelectField(box.field)}
                />
              );
            })}
          {draft?.page === page.index && <span className="doc-draft" style={asPercent(draftRegion(draft))} />}
        </div>
      ))}
    </div>
  );
}

function draftRegion(d: Draft): Region {
  return { x: Math.min(d.startX, d.x), y: Math.min(d.startY, d.y), width: Math.abs(d.x - d.startX), height: Math.abs(d.y - d.startY) };
}
