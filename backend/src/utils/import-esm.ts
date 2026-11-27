// 只提供 ES 模块的包（如 pdfjs-dist）要用真正的动态 import 加载；
// 后端编译成 CommonJS 时 import() 会被改写成 require，用 Function 保留真正的 import（jest 里需要 --experimental-vm-modules，见 package.json）。
// jest 里不用这个文件：同一 worker 依次跑多个测试文件时，V8 会缓存同一段 Function 源码的编译结果，
// 第 3 个及之后的测试文件拿到的函数会把 import() 交给已结束的测试文件处理，报「Test environment has been torn down」。
// 所以 jest.config.js 用 moduleNameMapper 换成 tests/helpers/import-esm.js（普通 JS，jest 按测试文件各自加载）。
export const importEsm = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<unknown>;
