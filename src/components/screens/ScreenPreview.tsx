'use client';

import { useEffect, useRef, useState } from 'react';
import type { Box } from '@/lib/contract';
import { componentNames, frameOf, previewDocument } from '@/lib/screens/html';
import { overlapping, toRatioBox, truncateLabel, type Rect } from '@/lib/screens/geometry';

type Pt = { x: number; y: number };
type Mode = 'off' | 'select' | 'draw';

export interface ScreenPreviewProps {
  html: string;
  width: 1280 | 390;
  mode: Mode;
  highlight: { component?: string; drawingIndex?: number } | null;
  drawings: { points: Pt[] }[];
  onLink: (href: string | null) => void;
  onPick: (t: { component: string; tag: string; text: string; parents: string[] }) => void;
  onDraw: (d: { points: Pt[]; box: Box; components: string[] }) => void;
  onLoad: (info: { frame: 'mobile' | 'page'; components: { unique: string[]; duplicates: string[] }; doc: Document }) => void;
}

const MOBILE = { width: 390, height: 844 };
// 색은 디자인 토큰에서 읽는다. 읽지 못하면 아래 값을 쓴다 (서버 렌더링과 테스트에서는 토큰이 없다).
const TOKEN_FALLBACK = { primary: '#0075de', highlight: '#dd5b00' };

function readTokens(): typeof TOKEN_FALLBACK {
  const style = getComputedStyle(document.documentElement);
  const primary = style.getPropertyValue('--color-primary').trim() || TOKEN_FALLBACK.primary;
  const highlight = style.getPropertyValue('--color-accent-orange').trim() || TOKEN_FALLBACK.highlight;
  return { primary, highlight };
}

// iframe 문서 좌표(스크롤 포함)의 사각형
function docRect(el: Element, win: Window): Rect {
  const r = el.getBoundingClientRect();
  return { left: r.left + win.scrollX, top: r.top + win.scrollY, width: r.width, height: r.height };
}

function bboxOf(points: Pt[]): Rect {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  return { left, top, width: Math.max(...xs) - left, height: Math.max(...ys) - top };
}

function depthOf(el: Element): number {
  let d = 0;
  for (let p = el.parentElement; p; p = p.parentElement) d++;
  return d;
}

export function ScreenPreview({
  html,
  width,
  mode,
  highlight,
  drawings,
  onLink,
  onPick,
  onDraw,
  onLoad,
}: ScreenPreviewProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const dupRef = useRef<Set<string>>(new Set());
  const lastPt = useRef<Pt | null>(null);
  const modeRef = useRef<Mode>(mode);

  const [view, setView] = useState<{ srcDoc: string; frame: 'mobile' | 'page' } | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [docHeight, setDocHeight] = useState(MOBILE.height);
  const [scroll, setScroll] = useState<Pt>({ x: 0, y: 0 });
  const [hover, setHover] = useState<{ rect: Rect; label: string } | null>(null);
  const [hlRect, setHlRect] = useState<Rect | null>(null);
  const [stroke, setStroke] = useState<Pt[] | null>(null);
  const [tokens, setTokens] = useState(TOKEN_FALLBACK);

  useEffect(() => {
    setTokens(readTokens());
  }, []);

  const component = highlight?.component;
  const frame = view?.frame ?? 'page';
  const frameW = frame === 'mobile' ? MOBILE.width : width;
  const frameH = frame === 'mobile' ? MOBILE.height : docHeight;

  // 저장 HTML을 DOMParser로 읽어 미리보기 사본을 만든다 (서버 렌더링에서는 DOMParser가 없어서 effect에서 한다)
  useEffect(() => {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    setView({ srcDoc: previewDocument(html), frame: frameOf(doc) });
    setLoaded(false);
    setHover(null);
    setStroke(null);
  }, [html]);

  useEffect(() => {
    modeRef.current = mode;
    setHover(null);
    setStroke(null);
  }, [mode]);

  // 너비 전환이나 새 문서 로드 뒤 page 프레임의 높이를 다시 잰다
  useEffect(() => {
    if (!loaded || view?.frame !== 'page') return;
    const id = requestAnimationFrame(() => {
      const doc = iframeRef.current?.contentDocument;
      if (doc) setDocHeight(doc.documentElement.scrollHeight);
    });
    return () => cancelAnimationFrame(id);
  }, [width, loaded, view]);

  useEffect(() => {
    const doc = iframeRef.current?.contentWindow?.document;
    const win = iframeRef.current?.contentWindow;
    if (!loaded || !win || !doc || !component) {
      setHlRect(null);
      return;
    }
    const matches = Array.from(doc.querySelectorAll('[data-component]')).filter(
      (el) => el.getAttribute('data-component') === component,
    );
    setHlRect(matches.length === 1 && !dupRef.current.has(component) ? docRect(matches[0], win) : null);
  }, [component, loaded, width, view]);

  // 화면 좌표(뷰포트 기준) → iframe 안의 점
  function local(clientX: number, clientY: number): Pt | null {
    const iframe = iframeRef.current;
    if (!iframe) return null;
    const r = iframe.getBoundingClientRect();
    return { x: clientX - r.left, y: clientY - r.top };
  }

  function docPoint(clientX: number, clientY: number): Pt | null {
    const p = local(clientX, clientY);
    const win = iframeRef.current?.contentWindow;
    return p && win ? { x: p.x + win.scrollX, y: p.y + win.scrollY } : null;
  }

  function elementAt(clientX: number, clientY: number): Element | null {
    const p = local(clientX, clientY);
    const doc = iframeRef.current?.contentDocument;
    return p && doc ? doc.elementFromPoint(p.x, p.y) : null;
  }

  // 겹쳐 있는 이름(duplicates)은 건너뛰고 위의 고유한 컴포넌트를 고른다
  function componentAt(clientX: number, clientY: number): Element | null {
    let el = elementAt(clientX, clientY)?.closest('[data-component]') ?? null;
    while (el && dupRef.current.has(el.getAttribute('data-component') ?? '')) {
      el = el.parentElement?.closest('[data-component]') ?? null;
    }
    return el;
  }

  function parentNames(el: Element): string[] {
    const out: string[] = [];
    let p = el.parentElement?.closest('[data-component]') ?? null;
    while (p) {
      const name = p.getAttribute('data-component') ?? '';
      if (name && !dupRef.current.has(name)) out.push(name);
      p = p.parentElement?.closest('[data-component]') ?? null;
    }
    return out;
  }

  function hoverAt(clientX: number, clientY: number) {
    lastPt.current = { x: clientX, y: clientY };
    const el = componentAt(clientX, clientY);
    const win = iframeRef.current?.contentWindow;
    if (!el || !win) {
      setHover(null);
      return;
    }
    const name = el.getAttribute('data-component') ?? '';
    const text = truncateLabel(el.textContent ?? '');
    setHover({ rect: docRect(el, win), label: [el.localName, name, text].filter(Boolean).join(' · ') });
  }

  function finishDraw(points: Pt[]) {
    const win = iframeRef.current?.contentWindow;
    const doc = iframeRef.current?.contentDocument;
    if (!win || !doc) return;
    const box = bboxOf(points);
    const items = Array.from(doc.querySelectorAll('[data-component]'))
      .map((el) => ({ name: el.getAttribute('data-component') ?? '', el }))
      .filter(({ name }) => name && !dupRef.current.has(name))
      .map(({ name, el }) => ({ name, rect: docRect(el, win), depth: depthOf(el) }));
    onDraw({
      points,
      box: toRatioBox(box, doc.documentElement.scrollWidth, doc.documentElement.scrollHeight),
      components: overlapping(box, items),
    });
  }

  function handleLoad() {
    const iframe = iframeRef.current;
    const win = iframe?.contentWindow;
    const doc = win?.document;
    if (!iframe || !win || !doc || !view) return;
    const comps = componentNames(doc);
    dupRef.current = new Set(comps.duplicates);
    setLoaded(true);
    setScroll({ x: win.scrollX, y: win.scrollY });
    win.addEventListener('scroll', () => {
      setScroll({ x: win.scrollX, y: win.scrollY });
      if (modeRef.current === 'select' && lastPt.current) hoverAt(lastPt.current.x, lastPt.current.y);
    });
    if (view.frame === 'page') setDocHeight(doc.documentElement.scrollHeight);
    onLoad({ frame: view.frame, components: comps, doc });
  }

  if (!view) return <div aria-busy="true">미리보기 불러오는 중</div>;

  const highlightDrawing =
    highlight?.drawingIndex !== undefined ? drawings[highlight.drawingIndex] : undefined;

  return (
    <div style={{ maxWidth: '100%', overflowX: 'auto', overscrollBehavior: 'contain' }}>
      <div style={{ position: 'relative', width: frameW, height: frameH }}>
        <iframe
          ref={iframeRef}
          title="화면 정의서 미리보기"
          sandbox="allow-same-origin"
          srcDoc={view.srcDoc}
          onLoad={handleLoad}
          style={{ display: 'block', border: 0, width: frameW, height: frameH, background: '#fff' }}
        />
        <div
          onPointerDown={(e) => {
            if (mode !== 'draw') return;
            e.currentTarget.setPointerCapture(e.pointerId);
            const p = docPoint(e.clientX, e.clientY);
            if (p) setStroke([p]);
          }}
          onPointerMove={(e) => {
            if (mode === 'select') hoverAt(e.clientX, e.clientY);
            if (mode === 'draw' && stroke) {
              const p = docPoint(e.clientX, e.clientY);
              if (p) setStroke([...stroke, p]);
            }
          }}
          onPointerUp={(e) => {
            if (mode !== 'draw' || !stroke) return;
            const p = docPoint(e.clientX, e.clientY);
            const points = p ? [...stroke, p] : stroke;
            setStroke(null);
            if (points.length >= 2) finishDraw(points);
          }}
          onPointerLeave={() => {
            if (mode === 'select') {
              lastPt.current = null;
              setHover(null);
            }
          }}
          onClick={(e) => {
            if (mode === 'off') {
              const a = elementAt(e.clientX, e.clientY)?.closest('a[href]');
              if (a) onLink(a.getAttribute('href'));
              return;
            }
            if (mode === 'select') {
              const el = componentAt(e.clientX, e.clientY);
              if (!el) return;
              onPick({
                component: el.getAttribute('data-component') ?? '',
                tag: el.localName,
                text: truncateLabel(el.textContent ?? ''),
                parents: parentNames(el),
              });
            }
          }}
          onWheel={(e) => {
            // 휴대폰 프레임은 안에서 스크롤한다. 넘겨받지 않으면 바깥 페이지가 움직인다.
            if (frame === 'mobile') iframeRef.current?.contentWindow?.scrollBy(0, e.deltaY);
          }}
          style={{
            position: 'absolute',
            inset: 0,
            cursor: mode === 'off' ? 'default' : 'crosshair',
            touchAction: mode === 'draw' ? 'none' : 'auto',
          }}
        >
          {mode === 'select' && hover && (
            <>
              <div
                style={{
                  position: 'absolute',
                  left: hover.rect.left - scroll.x,
                  top: hover.rect.top - scroll.y,
                  width: hover.rect.width,
                  height: hover.rect.height,
                  outline: `2px solid ${tokens.primary}`,
                  pointerEvents: 'none',
                }}
              />
              <div
                style={{
                  position: 'absolute',
                  left: hover.rect.left - scroll.x,
                  top: Math.max(0, hover.rect.top - scroll.y - 22),
                  background: tokens.primary,
                  color: '#fff',
                  fontSize: 12,
                  padding: '2px 6px',
                  whiteSpace: 'nowrap',
                  pointerEvents: 'none',
                }}
              >
                {hover.label}
              </div>
            </>
          )}
          {hlRect && (
            <div
              style={{
                position: 'absolute',
                left: hlRect.left - scroll.x,
                top: hlRect.top - scroll.y,
                width: hlRect.width,
                height: hlRect.height,
                outline: `3px solid ${tokens.highlight}`,
                pointerEvents: 'none',
              }}
            />
          )}
          <svg
            width={frameW}
            height={frameH}
            style={{ position: 'absolute', left: 0, top: 0, pointerEvents: 'none', overflow: 'visible' }}
          >
            {drawings.map((d, i) => (
              <polyline
                key={i}
                points={d.points.map((p) => `${p.x - scroll.x},${p.y - scroll.y}`).join(' ')}
                fill="none"
                stroke={i === highlight?.drawingIndex ? tokens.highlight : tokens.primary}
                strokeWidth={i === highlight?.drawingIndex ? 4 : 2}
              />
            ))}
            {stroke && (
              <polyline
                points={stroke.map((p) => `${p.x - scroll.x},${p.y - scroll.y}`).join(' ')}
                fill="none"
                stroke={tokens.primary}
                strokeWidth={2}
              />
            )}
            {highlightDrawing && (
              <rect
                x={bboxOf(highlightDrawing.points).left - scroll.x}
                y={bboxOf(highlightDrawing.points).top - scroll.y}
                width={bboxOf(highlightDrawing.points).width}
                height={bboxOf(highlightDrawing.points).height}
                fill="none"
                stroke={tokens.highlight}
                strokeDasharray="6 4"
              />
            )}
          </svg>
        </div>
      </div>
    </div>
  );
}
