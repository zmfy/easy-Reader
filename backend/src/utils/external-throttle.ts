/** 外部检索（豆瓣 / 猫耳等）共用节流：全局串行，相邻两次请求至少间隔 intervalMs，避免触发反爬 */
let chain: Promise<unknown> = Promise.resolve();
let lastAt = 0;

export function throttled<T>(fn: () => Promise<T>, intervalMs = 3000): Promise<T> {
  const run = chain.then(async () => {
    const wait = lastAt + intervalMs - Date.now();
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    lastAt = Date.now();
    return fn();
  });
  chain = run.catch(() => undefined);
  return run;
}

/** 测试用：重置节流状态 */
export function _resetExternalThrottle(): void {
  chain = Promise.resolve();
  lastAt = 0;
}
