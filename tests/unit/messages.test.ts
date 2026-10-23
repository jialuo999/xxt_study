import { describe, expect, it } from "vitest";
import {
  createMessage,
  createToken,
  isFrameMessage,
  validateFrameMessage,
} from "../../src/core/messages";

describe("messages", () => {
  it("createToken 生成 24 位十六进制随机串", () => {
    const token = createToken();
    expect(token).toMatch(/^[0-9a-f]{24}$/);
    expect(createToken()).not.toBe(token);
  });

  it("validateFrameMessage 接受合法 HELLO 并保留 nonce", () => {
    const message = createMessage({
      t: "HELLO",
      frameId: "frame-1",
      url: "https://mooc1.chaoxing.com/x",
      title: "标题",
      pageKind: "chapter",
      nonce: "abc",
    });
    expect(isFrameMessage(message)).toBe(true);
    const valid = validateFrameMessage(message);
    expect(valid?.t).toBe("HELLO");
  });

  it("validateFrameMessage 拒绝缺少 nonce 的 HELLO", () => {
    const message = {
      sh: "study-helper",
      v: 1,
      t: "HELLO",
      frameId: "frame-1",
      url: "https://mooc1.chaoxing.com/x",
      title: "标题",
      pageKind: "chapter",
    };
    expect(validateFrameMessage(message)).toBeNull();
  });

  it("validateFrameMessage 拒绝字段类型错误的 MEDIA_STATE", () => {
    const message = createMessage({
      t: "MEDIA_STATE",
      token: "t",
      frameId: "f",
      state: { hasMedia: "yes", allEnded: false, anyPaused: false } as never,
    });
    expect(validateFrameMessage(message)).toBeNull();
  });

  it("validateFrameMessage 拒绝超长 QUESTIONS 列表", () => {
    const questions = Array.from({ length: 501 }, (_, index) => ({
      id: `q-${index}`,
      type: "single" as const,
      stem: "题干",
      options: [],
      hasImage: false,
      frameId: "top",
      index,
    }));
    const message = createMessage({
      t: "QUESTIONS",
      token: "t",
      frameId: "f",
      pageKind: "homework",
      questions,
    });
    expect(validateFrameMessage(message)).toBeNull();
  });

  it("接受超过 4000 字的题干，避免长题被整条丢弃", () => {
    const message = createMessage({
      t: "QUESTIONS",
      token: "t",
      frameId: "f",
      pageKind: "homework",
      questions: [
        {
          id: "q-long",
          type: "short",
          stem: "题".repeat(4500),
          options: [],
          hasImage: false,
          frameId: "f",
          index: 0,
        },
      ],
    });
    expect(validateFrameMessage(message)).not.toBeNull();
  });

  it("validateFrameMessage 拒绝未知消息类型", () => {
    expect(
      validateFrameMessage({ sh: "study-helper", v: 1, t: "UNKNOWN", token: "t" }),
    ).toBeNull();
  });
});
