import { describe, expect, it } from 'vitest';
import { DOC_PATH_RE, docApiPath, isAgentName } from '@/lib/contract';

describe('docApiPath', () => {
  it('문서 경로의 / 를 인코딩한다', () => {
    expect(docApiPath(1, 'requirements/project.md', 'approve')).toBe(
      '/api/projects/1/documents/requirements%2Fproject.md/approve',
    );
  });

  it('action이 없으면 문서 경로까지만 만든다', () => {
    expect(docApiPath(2, 'screens/home.html')).toBe('/api/projects/2/documents/screens%2Fhome.html');
  });
});

describe('DOC_PATH_RE', () => {
  it('허용된 문서 경로를 통과시킨다', () => {
    for (const p of ['screens/home.html', 'changes/001-mvp.md', '0-PRODUCT.md', 'requirements/project.md']) {
      expect(DOC_PATH_RE.test(p)).toBe(true);
    }
  });

  it('허용되지 않은 문서 경로를 거부한다', () => {
    for (const p of ['requirements/Foo.md', 'requirements/a/b.md', '2-DESIGN.md', 'AGENTS.md']) {
      expect(DOC_PATH_RE.test(p)).toBe(false);
    }
  });
});

describe('isAgentName', () => {
  it('claude·codex만 참이다', () => {
    expect(isAgentName('codex')).toBe(true);
    expect(isAgentName('claude')).toBe(true);
    expect(isAgentName('gpt')).toBe(false);
  });
});
