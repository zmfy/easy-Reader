import { FailureCounter, failureKeyForIp } from '../../src/middleware/opds-auth';

describe('失败计数的键', () => {
  it('IPv4 与 IPv4 映射地址按地址本身计', () => {
    expect(failureKeyForIp('10.0.0.1')).toBe('10.0.0.1');
    expect(failureKeyForIp('::ffff:10.0.0.1')).toBe('10.0.0.1');
  });

  it('普通 IPv6 按 /64 归并', () => {
    expect(failureKeyForIp('2001:db8:1:2::1')).toBe(failureKeyForIp('2001:db8:1:2:ffff::9'));
    expect(failureKeyForIp('2001:db8:1:2::1')).not.toBe(failureKeyForIp('2001:db8:1:3::1'));
  });

  it('内嵌 IPv4 的 IPv6（NAT64、6to4、Teredo、十六进制映射）不按 /64 归并，避免很多用户共用一个计数', () => {
    expect(failureKeyForIp('64:ff9b::a00:1')).not.toBe(failureKeyForIp('64:ff9b::a00:2'));
    expect(failureKeyForIp('::ffff:a00:1')).not.toBe(failureKeyForIp('::ffff:a00:2'));
    expect(failureKeyForIp('2002:a00:1::1')).not.toBe(failureKeyForIp('2002:a00:2::1'));
    expect(failureKeyForIp('2001:0:4136:e378:8000:63bf:3fff:fdd2')).not.toBe(failureKeyForIp('2001:0:4136:e378:8000:63bf:3fff:fdd3'));
  });
});

describe('FailureCounter', () => {
  it('达到上限后锁定，窗口过后解除', () => {
    const c = new FailureCounter({ limit: 3, windowMs: 1000, maxKeys: 100 });
    for (let i = 0; i < 3; i++) c.record('a', 0);
    expect(c.isLockedOut('a', 10)).toBe(true);
    expect(c.isLockedOut('a', 1001)).toBe(false);
  });

  it('记录满了淘汰旧记录时，不淘汰仍在锁定中的', () => {
    const c = new FailureCounter({ limit: 3, windowMs: 1000, maxKeys: 5 });
    for (let i = 0; i < 3; i++) c.record('locked', 0);
    for (let k = 0; k < 20; k++) c.record(`other${k}`, 1);
    expect(c.isLockedOut('locked', 2)).toBe(true);
  });

  it('全是锁定中的记录且已满时，新来源一律按锁定处理（失败即关闭）', () => {
    const c = new FailureCounter({ limit: 1, windowMs: 1000, maxKeys: 3 });
    for (const k of ['a', 'b', 'c']) c.record(k, 0);
    expect(c.isLockedOut('new', 1)).toBe(true);
    expect(c.isLockedOut('new', 1001)).toBe(false);
  });
});
