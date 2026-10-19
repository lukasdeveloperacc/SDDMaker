import { describe, expect, it } from 'vitest';
import { hostnameOf, isAllowedRequest } from '@/lib/host-check';

describe('hostnameOf', () => {
  it('포트를 떼고 hostname만 돌려준다', () => {
    expect(hostnameOf('localhost:3000')).toBe('localhost');
    expect(hostnameOf('evil.com')).toBe('evil.com');
    expect(hostnameOf(null)).toBeNull();
  });
});

describe('isAllowedRequest Host 검사', () => {
  it('허용된 Host는 통과한다', () => {
    expect(isAllowedRequest({ method: 'GET', host: '127.0.0.1:3000', origin: null })).toBe(true);
    expect(isAllowedRequest({ method: 'GET', host: 'localhost', origin: null })).toBe(true);
  });

  it('허용되지 않은 Host는 거부한다', () => {
    for (const host of ['evil.com', '127.0.0.1.evil.com', '192.168.0.2:3000', null]) {
      expect(isAllowedRequest({ method: 'GET', host, origin: null })).toBe(false);
    }
  });
});

describe('isAllowedRequest Origin 검사 (상태 변경 요청)', () => {
  const host = '127.0.0.1:3000';

  it('허용된 Origin의 POST는 통과한다', () => {
    expect(isAllowedRequest({ method: 'POST', host, origin: 'http://127.0.0.1:3000' })).toBe(true);
  });

  it('Origin이 없거나 잘못되면 POST를 거부한다', () => {
    for (const origin of [null, 'null', 'http://evil.com', 'not a url']) {
      expect(isAllowedRequest({ method: 'POST', host, origin })).toBe(false);
    }
  });

  it('PUT·DELETE·PATCH도 같은 규칙을 따른다', () => {
    for (const method of ['PUT', 'DELETE', 'PATCH']) {
      expect(isAllowedRequest({ method, host, origin: null })).toBe(false);
      expect(isAllowedRequest({ method, host, origin: 'http://127.0.0.1:3000' })).toBe(true);
    }
  });

  it('GET은 Origin이 없어도 통과한다', () => {
    expect(isAllowedRequest({ method: 'GET', host, origin: null })).toBe(true);
  });
});

describe('isAllowedRequest Origin은 host:port까지 Host와 같아야 한다', () => {
  it('같은 host:port의 Origin은 통과한다', () => {
    expect(isAllowedRequest({ method: 'POST', host: 'localhost:3000', origin: 'http://localhost:3000' })).toBe(true);
  });

  it('같은 호스트라도 다른 포트의 Origin은 거부한다', () => {
    expect(isAllowedRequest({ method: 'POST', host: '127.0.0.1:3000', origin: 'http://127.0.0.1:8080' })).toBe(false);
    expect(isAllowedRequest({ method: 'DELETE', host: '127.0.0.1:3000', origin: 'http://localhost:8080' })).toBe(false);
  });

  it('localhost와 127.0.0.1을 섞으면 같은 포트여도 Host와 맞을 때만 통과한다', () => {
    expect(isAllowedRequest({ method: 'PUT', host: 'localhost:3000', origin: 'http://127.0.0.1:3000' })).toBe(false);
    expect(isAllowedRequest({ method: 'PUT', host: 'localhost:3000', origin: 'http://localhost:3000' })).toBe(true);
  });

  it('기본 포트(80)끼리는 포트 표기가 없어도 같다', () => {
    expect(isAllowedRequest({ method: 'POST', host: 'localhost', origin: 'http://localhost:80' })).toBe(true);
  });
});
