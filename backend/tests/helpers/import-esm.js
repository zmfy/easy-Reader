// jest 专用的 src/utils/import-esm.ts 替身（见该文件说明）：普通 JS，ts-jest 不改写，import() 由当前测试文件的环境处理
exports.importEsm = specifier => import(specifier);
