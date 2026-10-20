'use client';

import { useEffect, useState } from 'react';
import { AGENT_NAMES, type AgentName, type AgentUsage as Usage, type UsageResponse, type UsageWindow } from '@/lib/contract';
import { api } from '@/lib/api';
import { USAGE_REFRESH_EVENT } from '@/lib/use-agent-run';

const LABEL: Record<AgentName, string> = { claude: 'Claude', codex: 'Codex' };
const MIN = 60_000;

interface Live { pct: number; leftMs: number }

// 리셋 시각이 지난 창의 % 는 낡은 값이라 쓰지 않는다.
function live(w: UsageWindow | null, now: number): Live | null {
  const leftMs = w ? Date.parse(w.resetsAt) - now : NaN;
  return w && Number.isFinite(w.usedPercent) && leftMs > 0 ? { pct: w.usedPercent, leftMs } : null;
}

// 남은 시간은 분 단위로 내림한다.
function remaining(ms: number): string {
  const min = Math.floor(ms / MIN);
  if (min < 1) return '<1m';
  if (min < 60) return `${min}m`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours}h ${min % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

function windowText(w: Live | null): string {
  return w ? `${w.pct}% ${remaining(w.leftMs)}` : '—';
}

const pad = (n: number) => String(n).padStart(2, '0');

function AgentItem({ name, usage, now }: { name: AgentName; usage: Usage; now: number }) {
  const fiveHour = live(usage.fiveHour, now);
  const weekly = live(usage.weekly, now);
  const primary = fiveHour ?? weekly; // 막대 길이는 5시간 창, 없으면 주간 창
  const pct = primary?.pct ?? 0;
  const peak = Math.max(fiveHour?.pct ?? 0, weekly?.pct ?? 0); // 축약 숫자와 색은 두 창 중 높은 사용률로 정한다
  const tone = peak >= 100 ? 'is-danger' : peak >= 80 ? 'is-warn' : '';
  const readAt = usage.readAt ? new Date(usage.readAt) : null;
  const title = readAt ? `마지막으로 읽은 시각 ${pad(readAt.getHours())}:${pad(readAt.getMinutes())}` : '아직 읽은 값이 없습니다';
  return (
    <span className="usage-item" title={title}>
      <span className="usage-name">{LABEL[name]}</span>
      <span className="usage-bar" aria-hidden="true">
        <span className={tone ? `usage-fill ${tone}` : 'usage-fill'} style={{ width: `${pct}%` }} />
      </span>
      <span className="usage-fivehour"><span className="sr-only">5시간</span>{windowText(fiveHour)}</span>
      <span className="usage-weekly">· <span className="sr-only">주간</span>{windowText(weekly)}</span>
      <span className={tone ? `usage-compact ${tone}` : 'usage-compact'} aria-hidden="true">{primary ? `${peak}%` : '—'}</span>
    </span>
  );
}

export function AgentUsage() {
  const [data, setData] = useState<UsageResponse | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let latest = 0;
    const load = async () => {
      const seq = ++latest;
      try {
        const next = await api<UsageResponse>('GET', '/api/agents/usage');
        if (seq !== latest || !next) return; // 더 나중에 보낸 요청이 있으면 이 응답은 버린다
        setNow(Date.now());
        setData(next);
      } catch {
        // 실패하면 마지막으로 받은 값을 그대로 둔다
      }
    };
    void load();
    window.addEventListener(USAGE_REFRESH_EVENT, load);
    const tick = setInterval(() => setNow(Date.now()), MIN); // 리셋 시각이 지난 창을 '—'로 바꾸려고 다시 계산한다
    return () => {
      latest += 1; // 언마운트 뒤 도착하는 응답도 버린다
      window.removeEventListener(USAGE_REFRESH_EVENT, load);
      clearInterval(tick);
    };
  }, []);

  if (!data) return null;
  const rows = AGENT_NAMES.flatMap((name) => {
    const usage = data[name];
    return usage ? [{ name, usage }] : [];
  });
  if (rows.length === 0) return null;
  return (
    <div role="group" aria-label="에이전트 사용량" className="agent-usage">
      {rows.map(({ name, usage }) => <AgentItem key={name} name={name} usage={usage} now={now} />)}
    </div>
  );
}
