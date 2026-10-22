/**
 * 仅用于本机受限沙箱中的测试运行，不属于产品代码。
 *
 * 背景：DSH 沙箱禁止子进程通过管道 spawn，而 Vite（rolldown）在首次解析模块真实路径时
 * 会执行 `exec("net use")`（Windows 网络盘检测），于是 `vitest` 加载配置阶段直接 EPERM。
 * 这里把 `fs.realpathSync.native` 对“目录”改为抛 EISDIR，命中 Vite 内置的降级分支
 * （optimizeSafeRealPathSync 会改用 fs.realpathSync），从而不再 spawn 子进程。
 *
 * 用法（PowerShell）：
 *   $env:NODE_OPTIONS = "--require=E:/Code/Script/tests/dom/tools/vite-sandbox-patch.cjs"
 *   npx vitest run tests/dom --pool=threads
 *
 * 正常环境（不受沙箱限制）直接 `npm test` 即可，不需要这个文件。
 */
const fs = require("node:fs");

const nativeRealpath = fs.realpathSync.native;

fs.realpathSync.native = function patchedRealpathSync(target, options) {
  let isDirectory = false;
  try {
    isDirectory = fs.statSync(target).isDirectory();
  } catch {
    isDirectory = false;
  }
  if (isDirectory) {
    const error = new Error("EISDIR: illegal operation on a directory");
    error.code = "EISDIR";
    throw error;
  }
  return nativeRealpath.call(fs.realpathSync, target, options);
};
