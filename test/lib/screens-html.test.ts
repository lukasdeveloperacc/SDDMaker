// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  applyBlocks,
  componentNames,
  extractHtml,
  frameOf,
  missingScreenLinks,
  previewDocument,
  sanitizeHtml,
  screenLinkTarget,
} from '@/lib/screens/html';

const page = `<!DOCTYPE html>
<html data-frame="page"><head><title>home</title></head><body>
<header data-component="top-bar"><a href="detail.html">상세</a></header>
<section data-component="filter-tabs"><button>전체</button></section>
<footer data-component="footer">푸터</footer>
</body></html>`;

function parseDoc(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html');
}

describe('applyBlocks', () => {
  it('수정 블록 2개를 적용하면 두 컴포넌트만 바뀌고 나머지 HTML은 그대로다', () => {
    const response = [
      '좋아요.',
      '```html\n<section data-component="filter-tabs"><button>새 탭</button></section>\n```',
      '중간 글',
      '```html\n<footer data-component="footer">새 푸터</footer>\n```',
    ].join('\n');
    const r = applyBlocks(page, response);
    expect(r.applied).toEqual(['filter-tabs', 'footer']);
    expect(r.warnings).toEqual([]);
    expect(r.html).toContain('<button>새 탭</button>');
    expect(r.html).toContain('새 푸터');
    expect(r.html).toContain('<header data-component="top-bar"><a href="detail.html">상세</a></header>');
    expect(r.html).not.toContain('>전체<');
  });

  it('없는 이름·최상위 2개·data-component 없음·중복 이름은 경고만 하고 적용하지 않는다', () => {
    const current = page.replace('</body>', '<p data-component="dup">1</p><p data-component="dup">2</p></body>');
    const doubled = '<div data-component="top-bar">a</div><div data-component="top-bar">b</div>';
    const response = [
      '```html\n<div data-component="missing">x</div>\n```',
      '```html\n' + doubled + '\n```',
      '```html\n<div>no name</div>\n```',
      '```html\n<div data-component="dup">x</div>\n```',
      '```html\n<p data-component="a">x</p><p>y</p>\n```',
    ].join('\n');
    const r = applyBlocks(current, response);
    expect(r.applied).toEqual([]);
    expect(r.html).toBe(current);
    expect(r.warnings).toEqual([
      { name: 'missing', reason: 'not_found' },
      { name: null, reason: 'multiple_roots' },
      { name: null, reason: 'no_component' },
      { name: 'dup', reason: 'duplicate' },
      { name: null, reason: 'multiple_roots' },
    ]);
  });

  it('같은 응답에서 같은 이름이 두 번 오면 두 번째는 duplicate 경고', () => {
    const response =
      '```html\n<footer data-component="footer">A</footer>\n```\n```html\n<footer data-component="footer">B</footer>\n```';
    const r = applyBlocks(page, response);
    expect(r.applied).toEqual(['footer']);
    expect(r.html).toContain('>A<');
    expect(r.warnings).toEqual([{ name: 'footer', reason: 'duplicate' }]);
  });

  it('바깥과 안쪽 컴포넌트를 주면 바깥 것만 적용하고 안쪽은 nested, 블록 순서와 무관하다', () => {
    const outer = '```html\n<section data-component="filter-tabs"><b data-component="tab-all">바깥</b></section>\n```';
    const inner = '```html\n<b data-component="tab-all">안쪽</b>\n```';
    const html = page.replace('<button>전체</button>', '<b data-component="tab-all">전체</b>');
    const a = applyBlocks(html, `${outer}\n${inner}`);
    const b = applyBlocks(html, `${inner}\n${outer}`);
    expect(a.applied).toEqual(['filter-tabs']);
    expect(b.applied).toEqual(['filter-tabs']);
    expect(a.html).toContain('바깥');
    expect(a.html).not.toContain('안쪽');
    expect(a.warnings).toEqual([{ name: 'tab-all', reason: 'nested' }]);
    expect(b.warnings).toEqual([{ name: 'tab-all', reason: 'nested' }]);
    expect(a.html).toBe(b.html);
  });

  it('블록 밖 글은 text로 돌려준다', () => {
    const r = applyBlocks(page, '  질문 답변입니다.\n```html\n<footer data-component="footer">F</footer>\n```\n끝  ');
    expect(r.text).toBe('질문 답변입니다.\n\n끝');
  });

  it('블록에 있는 script·on* 속성·iframe·object·embed·대문자 ONLOAD는 결과에 없다', () => {
    const block =
      '```html\n<footer data-component="footer" ONLOAD="x()">F<script>alert(1)</script><iframe src="a"></iframe>' +
      '<object data="o"></object><embed src="e"><span onclick="y()">s</span></footer>\n```';
    const r = applyBlocks(page, block);
    expect(r.applied).toEqual(['footer']);
    for (const bad of ['<script', '<iframe', '<object', '<embed', 'onload', 'onclick']) {
      expect(r.html.toLowerCase()).not.toContain(bad);
    }
    expect(r.html).toContain('>F<');
  });

  it('적용된 것이 없으면 html은 원래 값이다', () => {
    const r = applyBlocks(page, '그냥 글만 있음');
    expect(r.html).toBe(page);
    expect(r.text).toBe('그냥 글만 있음');
  });
});

describe('extractHtml', () => {
  it('첫 ```html 블록 내용을 돌려준다', () => {
    expect(extractHtml('앞\n```html\n<p>a</p>\n```\n```html\n<p>b</p>\n```')).toBe('<p>a</p>');
  });

  it('블록이 없으면 원문 전체를 trim해서 돌려준다', () => {
    expect(extractHtml('  <p>원문</p>  ')).toBe('<p>원문</p>');
  });
});

describe('sanitizeHtml', () => {
  it('script·iframe·object·embed를 지우고 on* 속성을 지운다', () => {
    const out = sanitizeHtml('<div data-component="a" OnClick="x()"><script>1</script><iframe></iframe><p onmouseover="z">t</p></div>');
    expect(out).not.toMatch(/script|iframe|onclick|onmouseover/i);
    expect(out).toContain('data-component="a"');
    expect(out).toContain('<p>t</p>');
  });

  it('href·src·action·formaction·xlink:href의 스크립트 URL 속성을 지우고 일반 링크는 남긴다', () => {
    const out = sanitizeHtml(
      '<div>' +
        '<a id="a1" href="  JaVa\tScript:alert(1)">x</a>' +
        '<a id="a2" href="vbscript:x">x</a>' +
        '<a id="a3" href="data:text/html,<script>1</script>">x</a>' +
        '<form id="f1" action="javascript:y()"><button id="b1" formaction="javascript:z()">b</button></form>' +
        '<svg><a id="s1" xlink:href="javascript:w()">s</a></svg>' +
        '<img id="i1" src="javascript:q()">' +
        '<a id="ok" href="detail.html">ok</a>' +
        '<img id="ok2" src="data:image/png;base64,AAAA">' +
        '</div>',
    );
    expect(out.toLowerCase()).not.toMatch(/javascript:|vbscript:|data:text\/html/);
    expect(out).toContain('id="ok" href="detail.html"');
    expect(out).toContain('id="ok2" src="data:image/png;base64,AAAA"');
    for (const id of ['a1', 'a2', 'a3', 'f1', 'b1', 's1', 'i1']) {
      expect(out).toMatch(new RegExp(`id="${id}"[^>]*>`));
      expect(out).not.toMatch(new RegExp(`id="${id}"[^>]*(href|src|action|formaction)=`));
    }
  });

  it('applyBlocks 결과에도 스크립트 URL이 남지 않는다', () => {
    const r = applyBlocks(page, '```html\n<footer data-component="footer"><a href="javascript:x()">f</a></footer>\n```');
    expect(r.html.toLowerCase()).not.toContain('javascript:');
    expect(r.html).toContain('>f<');
  });

  it('template 안의 script도 지운다', () => {
    const out = sanitizeHtml('<template><script>1</script><b>x</b></template>');
    expect(out).not.toMatch(/<script/i);
    expect(out).toContain('<b>x</b>');
  });
});

describe('frameOf', () => {
  it('data-frame 값을 읽고, 없거나 모르는 값이면 page', () => {
    expect(frameOf(parseDoc('<html data-frame="mobile"><body></body></html>'))).toBe('mobile');
    expect(frameOf(parseDoc('<html data-frame="page"><body></body></html>'))).toBe('page');
    expect(frameOf(parseDoc('<html data-frame="tablet"><body></body></html>'))).toBe('page');
    expect(frameOf(parseDoc('<html><body></body></html>'))).toBe('page');
  });
});

describe('componentNames', () => {
  it('고유 이름과 중복 이름을 나눈다', () => {
    const doc = parseDoc('<div data-component="a"><p data-component="b"></p></div><i data-component="b"></i><u data-component="c"></u>');
    expect(componentNames(doc)).toEqual({ unique: ['a', 'c'], duplicates: ['b'] });
  });
});

describe('previewDocument', () => {
  const src = '<!DOCTYPE html><html><head><meta http-equiv="REFRESH" content="0;url=https://x"><title>t</title></head><body><a href="x.html">l</a></body></html>';

  it('head 첫 자식이 base이고 CSP meta가 있으며 refresh meta는 없다', () => {
    const out = previewDocument(src);
    const doc = parseDoc(out);
    expect(doc.head.firstElementChild?.localName).toBe('base');
    expect(doc.head.firstElementChild?.getAttribute('target')).toBe('_blank');
    const csp = doc.querySelector('meta[http-equiv="Content-Security-Policy"]');
    expect(csp?.getAttribute('content')).toContain("default-src 'none'");
    expect(doc.querySelector('meta[http-equiv]:not([http-equiv="Content-Security-Policy"])')).toBeNull();
    expect(out.startsWith('<!DOCTYPE html>')).toBe(true);
  });

  it('입력 문자열은 바뀌지 않는다', () => {
    const copy = src;
    previewDocument(src);
    expect(src).toBe(copy);
  });
});

describe('screenLinkTarget', () => {
  it('화면 이름 링크만 screens/<name>.html로 바꾼다', () => {
    expect(screenLinkTarget('detail.html')).toBe('screens/detail.html');
    expect(screenLinkTarget('./detail.html#a')).toBe('screens/detail.html');
  });

  it('외부·절대·상위·다른 형식은 null', () => {
    for (const href of ['https://x.com/a.html', '/a.html', '../a.html', 'mailto:a@b.c', null, 'Detail.html']) {
      expect(screenLinkTarget(href)).toBeNull();
    }
  });
});

describe('missingScreenLinks', () => {
  it('프로젝트에 없는 화면 링크 대상만 중복 없이 돌려준다', () => {
    const doc = parseDoc(
      '<body><a href="home.html">a</a><a href="gone.html">b</a><a href="gone.html">c</a><a href="https://x.com">d</a></body>',
    );
    expect(missingScreenLinks(doc, ['screens/home.html'])).toEqual(['screens/gone.html']);
  });
});
