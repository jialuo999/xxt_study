/**
 * 学习通 font-cxsecret 字体反爬解码。
 *
 * 学习通会给题目文字换一套自定义字体：页面显示正常，但 DOM textContent 是
 * 伪字符。这里解析页面里的字体（内联 base64 / @font-face URL），按字形轮廓
 * MD5 在映射表中查回真实 Unicode 字符。
 *
 * 参考公开脚本“超星复制粘贴助手 / 字体解密.js”的思路；
 * Typr.js、blueimp-md5 与映射表来源见 THIRD_PARTY_NOTICES.md。
 */
import { logger } from "../../../core/logger";
import { Typr, md5 } from "./typr-md5";
import table from "./table.json";

type GlyphTable = Record<string, number | string>;
type FontLike = unknown;

interface FontSource {
  kind: "data" | "url";
  value: string;
  label: string;
}

const FontApi = Typr as unknown as {
  U: {
    codeToGlyph: (font: FontLike, code: number) => number;
    glyphToPath: (font: FontLike, glyph: number) => unknown;
  };
};

const glyphTable = table as unknown as GlyphTable;
const FONT_RETRY_MS = 2000;
const CACHE_LIMIT = 4000;

interface FontCacheEntry {
  font: FontLike | null;
  at: number;
}

const fontCache = new WeakMap<Document, FontCacheEntry>();
const decodedCache = new WeakMap<Document, Map<string, string>>();
const priming = new WeakMap<Document, Promise<FontLike | null>>();
const missingLogged = new WeakSet<Document>();

function parseFontBytes(bytes: Uint8Array, label: string): FontLike | null {
  try {
    const parsed = Typr.parse(bytes) as FontLike[] | undefined;
    const font = parsed?.[0] ?? null;
    if (font) logger.debug("font", "已解析学习通加密字体", label);
    return font;
  } catch (error) {
    logger.debug("font", "解析加密字体失败", { label, error });
    return null;
  }
}

function parseBase64Font(base64: string, label: string): FontLike | null {
  try {
    const binary = atob(base64.replace(/\s+/g, ""));
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) {
      bytes[index] = binary.charCodeAt(index);
    }
    return parseFontBytes(bytes, label);
  } catch (error) {
    logger.debug("font", "base64 字体解码失败", { label, error });
    return null;
  }
}

function dataUrlToBase64(url: string): string | null {
  const match = /^data:[^,]*;base64,([A-Za-z0-9+/=\s]+)$/i.exec(url.trim());
  return match?.[1] ?? null;
}

function sourcesFromStyleText(
  content: string,
  label: string,
  out: FontSource[],
): void {
  if (!content.includes("font-cxsecret") && !content.includes("cxsecret")) return;
  const data = /base64,([A-Za-z0-9+/=\s]+)/.exec(content);
  if (data?.[1]) {
    out.push({ kind: "data", value: data[1], label: `${label}:inline` });
    return;
  }
  const url = /url\((['"]?)([^'")]+)\1\)/.exec(content);
  if (url?.[2]) out.push({ kind: "url", value: url[2], label: `${label}:url` });
}

function collectSources(doc: Document): FontSource[] {
  const sources: FontSource[] = [];
  try {
    const styles = doc.getElementsByTagName("style");
    for (const style of Array.from(styles)) {
      sourcesFromStyleText(style.textContent ?? "", `style#${style.id || ""}`, sources);
    }
  } catch {
    /* ignore */
  }

  // 通过 CSSOM 读取 @font-face（可覆盖通过 link 引入的同源样式表）
  try {
    for (const sheet of Array.from(doc.styleSheets)) {
      let rules: CSSRuleList;
      try {
        rules = sheet.cssRules;
      } catch {
        continue; // 跨域样式表
      }
      for (const rule of Array.from(rules)) {
        const cssText = rule.cssText ?? "";
        if (!/font-cxsecret|cxsecret/i.test(cssText)) continue;
        const url = /url\((['"]?)([^'")]+)\1\)/.exec(cssText);
        if (!url?.[2]) continue;
        const data = dataUrlToBase64(url[2]);
        sources.push(
          data
            ? { kind: "data", value: data, label: "stylesheet:data" }
            : { kind: "url", value: url[2], label: "stylesheet:url" },
        );
      }
    }
  } catch {
    /* ignore */
  }
  return sources;
}

function candidateDocuments(doc: Document): Document[] {
  const docs: Document[] = [doc];
  const seen = new Set<Document>(docs);
  // 同源父页面（部分版本把字体样式放在顶层）
  try {
    let win: Window | null = doc.defaultView;
    while (win && win.parent && win.parent !== win) {
      try {
        const parentDoc = win.parent.document;
        if (parentDoc && !seen.has(parentDoc)) {
          seen.add(parentDoc);
          docs.push(parentDoc);
        }
        win = win.parent;
      } catch {
        break;
      }
    }
  } catch {
    /* ignore */
  }
  // 同源子 iframe
  try {
    for (const iframe of Array.from(doc.querySelectorAll("iframe"))) {
      try {
        const childDoc = iframe.contentDocument;
        if (childDoc && !seen.has(childDoc)) {
          seen.add(childDoc);
          docs.push(childDoc);
        }
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* ignore */
  }
  return docs;
}

function findFontSync(doc: Document): FontLike | null {
  const cached = fontCache.get(doc);
  if (cached && (cached.font || Date.now() - cached.at < FONT_RETRY_MS)) {
    return cached.font;
  }

  let font: FontLike | null = null;
  for (const candidate of candidateDocuments(doc)) {
    const sources = collectSources(candidate);
    for (const source of sources) {
      if (source.kind !== "data") continue;
      font = parseBase64Font(source.value, source.label);
      if (font) break;
    }
    if (font) break;
  }

  fontCache.set(doc, { font, at: Date.now() });
  return font;
}

function cacheFont(doc: Document, font: FontLike | null): FontLike | null {
  fontCache.set(doc, { font, at: Date.now() });
  return font;
}

/**
 * 预加载解码字体；会尝试内联 base64 与 @font-face URL。
 * 在 question 采集前调用可以避免第一批题目带着乱码进入 AI。
 */
export function primeFontDecoder(doc: Document = document): Promise<FontLike | null> {
  const existing = findFontSync(doc);
  if (existing) return Promise.resolve(existing);
  const running = priming.get(doc);
  if (running) return running;

  const task = (async () => {
    for (const candidate of candidateDocuments(doc)) {
      const sources = collectSources(candidate);
      for (const source of sources) {
        if (source.kind === "data") {
          const font = parseBase64Font(source.value, source.label);
          if (font) return cacheFont(doc, font);
          continue;
        }
        try {
          const response = await fetch(source.value, { credentials: "include" });
          if (!response.ok) continue;
          const font = parseFontBytes(new Uint8Array(await response.arrayBuffer()), source.label);
          if (font) return cacheFont(doc, font);
        } catch (error) {
          logger.debug("font", "下载加密字体失败", { url: source.value, error });
        }
      }
    }
    if (!missingLogged.has(doc)) {
      missingLogged.add(doc);
      let fontFamily = "";
      let styleCount = 0;
      let linkCount = 0;
      try {
        styleCount = doc.getElementsByTagName("style").length;
        linkCount = doc.querySelectorAll('link[rel="stylesheet"]').length;
        const sample = doc.querySelector<HTMLElement>(".TiMu, .questionLi, [data-questionid]");
        const win = doc.defaultView;
        if (sample && win) fontFamily = win.getComputedStyle(sample).fontFamily;
      } catch {
        /* ignore */
      }
      logger.debug("font", "未找到 font-cxsecret 字体样式，文本保持原样", {
        url: doc.location?.href ?? "",
        styleCount,
        linkCount,
        fontFamily,
      });
    }
    return cacheFont(doc, null);
  })();

  priming.set(doc, task);
  return task;
}

function lookupGlyph(path: unknown): string | null {
  try {
    const hash = md5(JSON.stringify(path)).slice(24);
    const value = glyphTable[hash] ?? glyphTable[String(parseInt(hash, 16))];
    if (value === undefined) return null;
    if (typeof value === "number") {
      try {
        return String.fromCodePoint(value);
      } catch {
        return String.fromCharCode(value);
      }
    }
    return value;
  } catch {
    return null;
  }
}

/**
 * 解码一段从 DOM 取出的文本；没有检测到 font-cxsecret 时原样返回。
 * 必须在包含题目的 Document 上调用。
 */
export function decodeObfuscatedText(text: string, doc: Document = document): string {
  if (!text || !/[^\x00-\x7f]/.test(text)) return text;
  const font = findFontSync(doc);
  if (!font) {
    // 异步再找一次（link/外部字体可能还没加载完），找到后由调用方重新采集
    void primeFontDecoder(doc);
    return text;
  }

  let cache = decodedCache.get(doc);
  if (!cache) {
    cache = new Map<string, string>();
    decodedCache.set(doc, cache);
  }
  const cached = cache.get(text);
  if (cached !== undefined) return cached;

  let result = "";
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (code < 0x80) {
      result += char;
      continue;
    }
    let decoded: string | null = null;
    try {
      const glyphIndex = FontApi.U.codeToGlyph(font, code);
      if (glyphIndex > 0) {
        const path = FontApi.U.glyphToPath(font, glyphIndex);
        if (path) decoded = lookupGlyph(path);
      }
    } catch {
      /* ignore */
    }
    result += decoded ?? char;
  }

  if (cache.size >= CACHE_LIMIT) cache.clear();
  cache.set(text, result);
  return result;
}
