import { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent, ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { FieldBox, FieldBoxes, getPageImageBlobUrl, Region } from '../api';
import { useTranslation } from '../i18n/LanguageContext';

/** How a box is drawn: found on the document, set by the user, or a value to check. */
export type BoxTone = 'model' | 'user' | 'check';

type Props = {
  expenseId: string;
  pages: FieldBoxes['pages'];
  boxes: FieldBox[];
  /** The field whose box is highlighted (and scrolled into view). */
  activeField: string | null;
  /** The field under the mouse in the form: its box lights up, without zooming. */
  hoverField: string | null;
  /** A request to zoom into a field's box (chosen in the form); n changes on every request. */
  zoomRequest: { field: string; n: number } | null;
  /** While set, dragging on a page draws a region instead of selecting a box. */
  drawing: boolean;
  onDraw: (page: number, region: Region) => void;
  /** The active box can be moved and resized. */
  editable: boolean;
  onMoveBox: (field: string, page: number, region: Region) => void;
  onSelectField: (field: string) => void;
  onHoverField: (field: string | null) => void;
  labelFor: (field: string) => string;
  toneFor: (field: string) => BoxTone;
  /** The viewer fills most of the screen. */
  expanded: boolean;
  onToggleExpanded: () => void;
  /** Phone: only the toolbar shows, the form gets the screen. */
  minimized?: boolean;
  onToggleMinimized?: () => void;
  /** Under the toolbar: what can be done with the chosen field. */
  selectionBar?: ReactNode;
};

type Draft = { page: number; startX: number; startY: number; x: number; y: number };
type Handle = 'move' | 'nw' | 'ne' | 'sw' | 'se';
type Drag = { field: string; page: number; handle: Handle; clientX: number; clientY: number; rect: DOMRect; from: Region; region: Region; moved: boolean };

/** Below this a drag is a tap, not a region. */
const MIN_REGION = 0.01;
/** The smallest box a resize leaves (a fraction of the page). */
const MIN_BOX = 0.006;
/** A box moved less than this many pixels was tapped, not moved. */
const TAP_SLOP_PX = 4;
/** Arrow keys move the active box by this share of the page (Shift: ×5); saved once the keys rest. */
const NUDGE = 0.002;
const NUDGE_SAVE_MS = 500;
const HANDLES: Exclude<Handle, 'move'>[] = ['nw', 'ne', 'sw', 'se'];
/** 1 = the page fits the viewer's width; below 1 more of the page shows (the whole page: "fit"). */
const MAX_ZOOM = 5;
/** Zooming out stops here (a tall receipt would otherwise become a thin strip)… */
const LOWEST_ZOOM = 0.3;
/** Trying out (2026-11-08): the document opens at a fixed zoom (also what "Fit" goes back to)… */
const LAPTOP_ZOOM = 0.9;
const PHONE_ZOOM = 0.7;
/** …and choosing a field only scrolls it to the middle, at the zoom there is. false: the field zooms in (FIELD_* below). */
const FIXED_ZOOM = true;
const ZOOM_STEP = 1.5;
/** Choosing a field zooms so its box is about this tall on screen: readable, with its surroundings in view… */
const TARGET_BOX_HEIGHT_PX = 26;
/** On a phone's small document panel: less zoom, more of the page around the field. */
const PHONE_VIEWER_PX = 500;
const PHONE_TARGET_BOX_HEIGHT_PX = 18;
const PHONE_MAX_FIELD_ZOOM = 1.6;
/** …no wider than this share of the viewer (the labels next to it stay in view)… */
const MAX_BOX_SHARE = 0.6;
/** …and never deeper than this: the user keeps a sense of where on the page they are. */
const MAX_FIELD_ZOOM = 2.5;
/** A box already shown between these heights is left at the zoom it has (no jumping between fields). */
const COMFORTABLE_BOX_PX = [18, 60] as const;

const clamp = (v: number, min = 0, max = 1) => Math.min(max, Math.max(min, v));

/** The region after dragging a handle by (dx, dy) page fractions: moved inside the page, or resized no smaller than MIN_BOX. */
function dragged(from: Region, handle: Handle, dx: number, dy: number): Region {
  if (handle === 'move') return { ...from, x: clamp(from.x + dx, 0, 1 - from.width), y: clamp(from.y + dy, 0, 1 - from.height) };
  let left = from.x;
  let top = from.y;
  let right = from.x + from.width;
  let bottom = from.y + from.height;
  if (handle.includes('w')) left = clamp(left + dx, 0, right - MIN_BOX);
  if (handle.includes('e')) right = clamp(right + dx, left + MIN_BOX, 1);
  if (handle.includes('n')) top = clamp(top + dy, 0, bottom - MIN_BOX);
  if (handle.includes('s')) bottom = clamp(bottom + dy, top + MIN_BOX, 1);
  return { x: left, y: top, width: right - left, height: bottom - top };
}

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
// box selects its field; the chosen box can be dragged to move it, its
// corners to resize it (mouse, finger or pen: pointer events), or nudged with
// the arrow keys. In "draw" mode a drag draws a new region. Zoom with the
// buttons, Ctrl/⌘ + wheel, a trackpad or two-finger pinch; choosing a field
// in the form zooms into its box. Boxes are fractions of the page, so they
// stay in place at any zoom.
export function DocumentViewer({
  expenseId,
  pages,
  boxes,
  activeField,
  hoverField,
  zoomRequest,
  drawing,
  onDraw,
  editable,
  onMoveBox,
  onSelectField,
  onHoverField,
  labelFor,
  toneFor,
  expanded,
  onToggleExpanded,
  minimized = false,
  onToggleMinimized,
  selectionBar
}: Props) {
  const { t } = useTranslation();
  const [urls, setUrls] = useState<(string | null)[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  /** The active box moved with the arrow keys, saved once the keys rest. */
  const [nudged, setNudged] = useState<{ field: string; page: number; region: Region } | null>(null);
  const nudgeTimerRef = useRef<number | null>(null);
  /** A drag ends with a click on the box: that click must not count as a tap. */
  const suppressClickRef = useRef(false);
  const [zoom, setZoom] = useState(1);
  /** The zoom showing the whole (tallest) page, and the lowest zoom allowed; measured from the viewer. */
  const [fit, setFit] = useState({ whole: 1, lowest: 1 });
  const fitRef = useRef(fit);
  /** Until the user zooms or chooses a field, the document follows the viewer's size at its "fit" zoom. */
  const untouchedRef = useRef(true);
  const activeRef = useRef<HTMLButtonElement | null>(null);
  const viewerRef = useRef<HTMLDivElement | null>(null);
  const zoomRef = useRef(1);
  const clampZoom = useCallback((z: number) => Math.min(MAX_ZOOM, Math.max(fitRef.current.lowest, z)), []);
  /** The viewer point (px from its top-left) that stays put while zooming. */
  const anchorRef = useRef<{ x: number; y: number; from: number } | null>(null);
  /** Centre the active box once the new zoom is laid out. */
  const centerAfterZoomRef = useRef(false);

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

  // The whole page in view: measured from the viewer's size and the tallest page, again when the viewer resizes.
  useLayoutEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || !pages.length) return;
    const measure = () => {
      if (!viewer.clientWidth || !viewer.clientHeight) return;
      // The first real page decides (not a scanner app's banner strip, not a long screenshot further on).
      const main = pages.find((p) => p.height / p.width >= 0.5) ?? pages[0];
      const whole = Math.min(1, (viewer.clientHeight - 8) / ((viewer.clientWidth * main.height) / main.width));
      const opening = viewer.clientWidth < PHONE_VIEWER_PX ? PHONE_ZOOM : LAPTOP_ZOOM;
      const next = { whole: opening, lowest: Math.min(opening, Math.max(LOWEST_ZOOM, whole)) };
      fitRef.current = next;
      setFit(next);
      if (untouchedRef.current || zoomRef.current < next.lowest) {
        zoomRef.current = untouchedRef.current ? next.whole : next.lowest;
        setZoom(zoomRef.current);
      }
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(viewer);
    return () => observer.disconnect();
  }, [pages]);

  /** Zoom to a level, keeping the given viewer point (default: its centre) in place. */
  const zoomTo = useCallback((next: number, at?: { x: number; y: number }) => {
    const viewer = viewerRef.current;
    const target = clampZoom(next);
    untouchedRef.current = false;
    if (!viewer || target === zoomRef.current) return;
    anchorRef.current = { ...(at ?? { x: viewer.clientWidth / 2, y: viewer.clientHeight / 2 }), from: zoomRef.current };
    zoomRef.current = target;
    setZoom(target);
  }, []);

  // Scrolls the viewer, never the page: on a phone the form is below it, and
  // focusing a field there must not jump the page up to the photo.
  const centerActive = useCallback((smooth: boolean) => {
    const viewer = viewerRef.current;
    const box = activeRef.current;
    if (!viewer || !box) return;
    const v = viewer.getBoundingClientRect();
    const b = box.getBoundingClientRect();
    viewer.scrollTo({
      left: viewer.scrollLeft + b.left - v.left - viewer.clientWidth / 2 + b.width / 2,
      top: viewer.scrollTop + b.top - v.top - viewer.clientHeight / 2 + b.height / 2,
      behavior: smooth ? 'smooth' : 'auto'
    });
  }, []);

  // After a zoom: keep the anchor point in place, or centre the field zoomed into.
  useLayoutEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    if (centerAfterZoomRef.current) {
      centerAfterZoomRef.current = false;
      anchorRef.current = null;
      centerActive(false);
      return;
    }
    const anchor = anchorRef.current;
    if (!anchor) return;
    anchorRef.current = null;
    const ratio = zoom / anchor.from;
    viewer.scrollLeft = (viewer.scrollLeft + anchor.x) * ratio - anchor.x;
    viewer.scrollTop = (viewer.scrollTop + anchor.y) * ratio - anchor.y;
  }, [zoom, centerActive]);

  useEffect(() => {
    centerActive(true);
  }, [activeField, urls, centerActive]);

  // A field chosen in the form: zoom so its box is readable, then centre it.
  useEffect(() => {
    if (!zoomRequest) return;
    const viewer = viewerRef.current;
    const box = shownBoxes(boxes).find((b) => b.field === zoomRequest.field);
    const page = box && pages.find((p) => p.index === box.page);
    if (!viewer || !box || !page) return;
    untouchedRef.current = false;
    if (FIXED_ZOOM) {
      centerActive(true);
      return;
    }
    const phone = viewer.clientWidth < PHONE_VIEWER_PX;
    const targetHeight = phone ? PHONE_TARGET_BOX_HEIGHT_PX : TARGET_BOX_HEIGHT_PX;
    const maxZoom = phone ? PHONE_MAX_FIELD_ZOOM : MAX_FIELD_ZOOM;
    const pageHeightAtFit = (viewer.clientWidth * page.height) / page.width;
    const shownHeight = box.height * pageHeightAtFit * zoomRef.current;
    const fitsWidth = box.width * zoomRef.current <= MAX_BOX_SHARE || zoomRef.current <= 1;
    // Zooms out as well as in: the zoom follows the field, it doesn't only ever grow.
    const wanted = Math.min(targetHeight / (box.height * pageHeightAtFit), MAX_BOX_SHARE / box.width, maxZoom);
    const comfortable =
      shownHeight >= (phone ? 12 : COMFORTABLE_BOX_PX[0]) && shownHeight <= COMFORTABLE_BOX_PX[1] && fitsWidth && zoomRef.current <= maxZoom;
    // Never further out than the whole page: a big box is shown in place, not shrunk.
    const next = comfortable ? zoomRef.current : clampZoom(Math.max(wanted, fitRef.current.whole));
    if (next === zoomRef.current) {
      centerActive(true);
      return;
    }
    centerAfterZoomRef.current = true;
    zoomRef.current = next;
    setZoom(next);
    // Only a new request zooms: not the boxes or pages changing under it.
  }, [zoomRequest]);

  // Ctrl/⌘ + wheel and trackpad pinch (the browser sends those as wheel with ctrlKey), and two-finger pinch on touch screens.
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    const local = (clientX: number, clientY: number) => {
      const r = viewer.getBoundingClientRect();
      return { x: clientX - r.left, y: clientY - r.top };
    };
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      zoomTo(zoomRef.current * Math.exp(-e.deltaY * 0.01), local(e.clientX, e.clientY));
    };
    let pinch: { distance: number; zoom: number } | null = null;
    const spread = (e: TouchEvent) => Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 2) return;
      setDraft(null);
      setDrag(null);
      pinch = { distance: spread(e), zoom: zoomRef.current };
    };
    const onTouchMove = (e: TouchEvent) => {
      if (!pinch || e.touches.length !== 2) return;
      e.preventDefault();
      const mid = local((e.touches[0].clientX + e.touches[1].clientX) / 2, (e.touches[0].clientY + e.touches[1].clientY) / 2);
      zoomTo(pinch.zoom * (spread(e) / pinch.distance), mid);
    };
    const onTouchEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) pinch = null;
    };
    // Safari's own pinch would zoom the whole page instead of the document.
    const stopGesture = (e: Event) => e.preventDefault();
    viewer.addEventListener('gesturestart', stopGesture);
    viewer.addEventListener('gesturechange', stopGesture);
    viewer.addEventListener('wheel', onWheel, { passive: false });
    viewer.addEventListener('touchstart', onTouchStart, { passive: true });
    viewer.addEventListener('touchmove', onTouchMove, { passive: false });
    viewer.addEventListener('touchend', onTouchEnd);
    viewer.addEventListener('touchcancel', onTouchEnd);
    return () => {
      viewer.removeEventListener('gesturestart', stopGesture);
      viewer.removeEventListener('gesturechange', stopGesture);
      viewer.removeEventListener('wheel', onWheel);
      viewer.removeEventListener('touchstart', onTouchStart);
      viewer.removeEventListener('touchmove', onTouchMove);
      viewer.removeEventListener('touchend', onTouchEnd);
      viewer.removeEventListener('touchcancel', onTouchEnd);
    };
  }, [zoomTo]);

  // The viewer changes size when expanded: keep the active box in view.
  useLayoutEffect(() => {
    centerActive(false);
  }, [expanded, centerActive]);

  const pointAt = (e: ReactPointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: clamp((e.clientX - rect.left) / rect.width), y: clamp((e.clientY - rect.top) / rect.height) };
  };

  const startDraw = (page: number) => (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!drawing) return;
    // A second finger is a pinch, not a region.
    if (!e.isPrimary) {
      setDraft(null);
      return;
    }
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const { x, y } = pointAt(e);
    setDraft({ page, startX: x, startY: y, x, y });
  };

  const moveDraw = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!draft || !e.isPrimary) return;
    const { x, y } = pointAt(e);
    setDraft({ ...draft, x, y });
  };

  const endDraw = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!draft || !e.isPrimary) return;
    const region = draftRegion(draft);
    setDraft(null);
    if (region.width >= MIN_REGION && region.height >= MIN_REGION) onDraw(draft.page, region);
  };

  // Moving and resizing the active box. The pointer is captured by the box, so
  // the drag goes on outside it; a second finger (a pinch) cancels it.
  const startDrag = (box: FieldBox, handle: Handle) => (e: ReactPointerEvent<HTMLElement>) => {
    if (!editable || drawing || !e.isPrimary || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const boxElement = (e.currentTarget as HTMLElement).closest('.doc-box') as HTMLElement | null;
    const pageElement = boxElement?.closest('.doc-page') as HTMLElement | null;
    if (!boxElement || !pageElement) return;
    e.stopPropagation();
    e.preventDefault();
    boxElement.setPointerCapture(e.pointerId);
    const from = { x: box.x, y: box.y, width: box.width, height: box.height };
    setDrag({ field: box.field, page: box.page, handle, clientX: e.clientX, clientY: e.clientY, rect: pageElement.getBoundingClientRect(), from, region: from, moved: false });
  };

  const moveDrag = (e: ReactPointerEvent<HTMLElement>) => {
    if (!drag || !e.isPrimary) return;
    const px = e.clientX - drag.clientX;
    const py = e.clientY - drag.clientY;
    const moved = drag.moved || Math.hypot(px, py) > TAP_SLOP_PX;
    setDrag({ ...drag, moved, region: moved ? dragged(drag.from, drag.handle, px / drag.rect.width, py / drag.rect.height) : drag.from });
  };

  const endDrag = (e: ReactPointerEvent<HTMLElement>) => {
    if (!drag || !e.isPrimary) return;
    setDrag(null);
    suppressClickRef.current = drag.moved;
    if (drag.moved) onMoveBox(drag.field, drag.page, drag.region);
  };

  const saveNudge = useCallback(
    (moved: { field: string; page: number; region: Region }) => {
      if (nudgeTimerRef.current) window.clearTimeout(nudgeTimerRef.current);
      nudgeTimerRef.current = window.setTimeout(() => {
        nudgeTimerRef.current = null;
        onMoveBox(moved.field, moved.page, moved.region);
        setNudged(null);
      }, NUDGE_SAVE_MS);
    },
    [onMoveBox]
  );

  useEffect(() => () => {
    if (nudgeTimerRef.current) window.clearTimeout(nudgeTimerRef.current);
  }, []);

  const nudge = (box: FieldBox) => (e: ReactKeyboardEvent<HTMLButtonElement>) => {
    const step = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (!editable || !step) return;
    e.preventDefault();
    const size = NUDGE * (e.shiftKey ? 5 : 1);
    const from = nudged?.field === box.field ? nudged.region : { x: box.x, y: box.y, width: box.width, height: box.height };
    const moved = { field: box.field, page: box.page, region: dragged(from, 'move', step[0] * size, step[1] * size) };
    setNudged(moved);
    saveNudge(moved);
  };

  /** Where a box is drawn now: while dragged or nudged, where the user has it. */
  const placed = (box: FieldBox): Region => {
    if (drag?.field === box.field) return drag.region;
    if (nudged?.field === box.field) return nudged.region;
    return box;
  };

  const shown = shownBoxes(boxes);

  return (
    <div className="doc-viewer-frame">
      <div className="doc-toolbar" role="toolbar" aria-label={t('review.viewerTools')}>
        <button type="button" className="doc-tool" onClick={() => zoomTo(zoom / ZOOM_STEP)} disabled={zoom <= fit.lowest + 0.001} title={t('review.zoomOut')} aria-label={t('review.zoomOut')}>
          −
        </button>
        <span className="doc-zoom-level" aria-live="polite">
          {Math.round(zoom * 100)}%
        </span>
        <button type="button" className="doc-tool" onClick={() => zoomTo(zoom * ZOOM_STEP)} disabled={zoom >= MAX_ZOOM} title={t('review.zoomIn')} aria-label={t('review.zoomIn')}>
          +
        </button>
        <button type="button" className="doc-tool doc-tool--text" onClick={() => zoomTo(fit.whole)} disabled={Math.abs(zoom - fit.whole) < 0.001}>
          {t('review.zoomFit')}
        </button>
        <span className="doc-toolbar-spacer" />
        {onToggleMinimized && !expanded && (
          <button
            type="button"
            className="doc-tool"
            onClick={onToggleMinimized}
            aria-pressed={minimized}
            title={minimized ? t('review.showDocument') : t('review.hideDocument')}
            aria-label={minimized ? t('review.showDocument') : t('review.hideDocument')}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
              <path d={minimized ? 'M3 6l5 5 5-5' : 'M3 10l5-5 5 5'} />
            </svg>
          </button>
        )}
        <button
          type="button"
          className="doc-tool doc-tool--text"
          onClick={onToggleExpanded}
          aria-pressed={expanded}
          title={expanded ? t('review.collapseViewer') : t('review.expandViewer')}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
            {expanded ? <path d="M6 1v5H1M10 1v5h5M6 15v-5H1M10 15v-5h5" /> : <path d="M1 6V1h5M15 6V1h-5M1 10v5h5M15 10v5h-5" />}
          </svg>
          {expanded ? t('review.collapseViewer') : t('review.expandViewer')}
        </button>
      </div>
      {selectionBar}
      <div
        ref={viewerRef}
        className={`doc-viewer${drawing ? ' doc-viewer--picking' : ''}${zoom > fit.whole + 0.001 ? ' doc-viewer--zoomed' : ''}${minimized ? ' doc-viewer--minimized' : ''}`}
      >
        <div className="doc-zoom" style={{ width: `${zoom * 100}%` }}>
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
                  const movable = active && editable && !drawing;
                  const tone = toneFor(box.field);
                  const region = placed(box);
                  return (
                    <button
                      key={box.field}
                      type="button"
                      ref={active ? activeRef : undefined}
                      className={[
                        'doc-box',
                        `doc-box--${tone}`,
                        box.field.startsWith('items.') ? 'doc-box--item' : '',
                        active ? 'doc-box--active' : '',
                        movable ? 'doc-box--movable' : '',
                        drag?.field === box.field && drag.moved ? 'doc-box--dragging' : '',
                        !active && box.field === hoverField ? 'doc-box--hover' : ''
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      style={asPercent(region)}
                      title={labelFor(box.field)}
                      aria-label={movable ? `${labelFor(box.field)}. ${t('review.boxEditHint')}` : labelFor(box.field)}
                      tabIndex={drawing ? -1 : 0}
                      onClick={() => {
                        if (suppressClickRef.current) {
                          suppressClickRef.current = false;
                          return;
                        }
                        onSelectField(box.field);
                      }}
                      onPointerEnter={(e) => e.pointerType === 'mouse' && onHoverField(box.field)}
                      onPointerLeave={(e) => e.pointerType === 'mouse' && onHoverField(null)}
                      onPointerDown={movable ? startDrag(box, 'move') : undefined}
                      onPointerMove={movable ? moveDrag : undefined}
                      onPointerUp={movable ? endDrag : undefined}
                      onPointerCancel={movable ? () => setDrag(null) : undefined}
                      onKeyDown={movable ? nudge(box) : undefined}
                    >
                      {movable &&
                        HANDLES.map((handle) => (
                          <span key={handle} className={`doc-handle doc-handle--${handle}`} onPointerDown={startDrag(box, handle)} aria-hidden="true" />
                        ))}
                    </button>
                  );
                })}
              {draft?.page === page.index && <span className="doc-draft" style={asPercent(draftRegion(draft))} />}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function draftRegion(d: Draft): Region {
  return { x: Math.min(d.startX, d.x), y: Math.min(d.startY, d.y), width: Math.abs(d.x - d.startX), height: Math.abs(d.y - d.startY) };
}
