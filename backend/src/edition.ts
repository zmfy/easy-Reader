// 版本线：main = 看书版，study = 学习版。合并 main → study 后，在 study 分支把这里改为 'study'
export const EDITION = 'study' as 'main' | 'study';
export const UPDATE_BRANCH = EDITION;
export const VERSION_SUFFIX = EDITION === 'study' ? '-study' : '';
