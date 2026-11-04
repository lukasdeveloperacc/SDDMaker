'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { ProjectDetail } from '@/lib/contract';

// 아이디어는 길어도 머리말이 화면을 다 차지하지 않게 몇 줄만 보이고, 잘렸을 때만 더 보기를 둔다.
function Idea({ text }: { text: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [open, setOpen] = useState(false);
  const [clipped, setClipped] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || open) return;
    const measure = () => setClipped(el.scrollHeight > el.clientHeight + 1);
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [text, open]);
  return (
    <div className="project-idea-block">
      <p ref={ref} className="project-idea" data-open={open || undefined}>{text}</p>
      {(clipped || open) && (
        <button type="button" className="idea-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? '접기' : '더 보기'}
        </button>
      )}
    </div>
  );
}

// 프로젝트 화면 맨 위: 프로젝트 이름표. 실행 설정은 연결 화면(기본값)과 작업 화면(이번 작업)에 있다.
export function ProjectHeader({ project }: { project: ProjectDetail['project'] }) {
  const initial = Array.from(project.name.trim())[0] ?? '?';
  return (
    <header className="project-heading">
      <Link href="/" className="project-back">
        ← 프로젝트 목록
      </Link>
      <div className="project-heading-body">
        <span className="project-mark" data-tone={project.id % 6} aria-hidden="true">
          {initial}
        </span>
        <div className="project-title">
          <h1 className="h2">{project.name}</h1>
          {project.repo && (
            <a
              className="repo-chip"
              href={`https://github.com/${project.repo}`}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`${project.repo} GitHub 저장소 (새 탭에서 열림)`}
            >
              {project.repo}
            </a>
          )}
        </div>
        {project.idea.trim() !== '' && <Idea text={project.idea} />}
      </div>
    </header>
  );
}
