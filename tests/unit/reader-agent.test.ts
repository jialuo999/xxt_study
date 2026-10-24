import { beforeEach, describe, expect, it } from "vitest";
import { findReaderIframes, resolveReaderTarget } from "../../src/app/reader-agent";

describe("reader-agent", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("云盘文档预览页（file.html）使用 window 滚动", () => {
    document.body.innerHTML = `
      <div class="fileBox"><ul><li><img src="1.png"></li></ul></div>
      <input id="fileInfoNameInput" value="阅读材料.pdf">
    `;
    expect(resolveReaderTarget(document)?.mode).toBe("window");
  });

  it("文档模块外层（#panView）不自己滚动，交给 relay", () => {
    document.body.innerHTML = `
      <div id="docContainer">
        <div class="imglook" id="img"></div>
        <iframe id="panView" src="/file.html"></iframe>
      </div>
    `;
    expect(resolveReaderTarget(document)).toBeNull();
  });

  it("PPT 预览返回 swiper 模式", () => {
    document.body.innerHTML = `
      <div class="swiper-container">
        <div class="swiper-slide">1</div>
        <div class="swiper-slide">2</div>
        <div class="swiper-button-next"></div>
      </div>
    `;
    expect(resolveReaderTarget(document)?.mode).toBe("swiper");
  });

  it("普通正文滚动容器返回 element 模式", () => {
    document.body.innerHTML = `<div id="content">${"正文".repeat(100)}</div>`;
    const content = document.querySelector<HTMLElement>("#content")!;
    content.style.overflowY = "auto";
    Object.defineProperty(content, "scrollHeight", { value: 1200, configurable: true });
    Object.defineProperty(content, "clientHeight", { value: 400, configurable: true });
    const target = resolveReaderTarget(document);
    expect(target?.mode).toBe("element");
    expect(target?.element).toBe(content);
  });

  it("findReaderIframes 优先按 data 里的 jobid/_jobid 匹配", () => {
    document.body.innerHTML = `
      <iframe data='{"jobid":"job-1"}'></iframe>
      <iframe data='{"_jobid":"job-2"}'></iframe>
      <iframe></iframe>
    `;
    expect(findReaderIframes(document, "job-1")).toHaveLength(1);
    expect(findReaderIframes(document, "job-2")).toHaveLength(1);
    expect(findReaderIframes(document, "missing")).toHaveLength(0);
    expect(findReaderIframes(document)).toHaveLength(3);
  });
});
