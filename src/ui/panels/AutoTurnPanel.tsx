import type { DeepPartial, Settings } from "@/core/settings";
import { Toggle } from "@/ui/components";
import type { PageProps } from "../pages/shared";

/** 自动翻页与媒体播放设置：翻页开关 + 媒体偏好开关。 */
export function AutoTurnPanel({ controller, state }: Pick<PageProps, "controller" | "state">) {
  const { autoTurn, video } = state.settings;
  const save = (patch: DeepPartial<Settings>) => controller.saveSettings(patch);

  return (
    <>
      <Toggle
        checked={autoTurn.enabled}
        onChange={(enabled) => save({ autoTurn: { enabled } })}
        label="启用自动翻页"
        description="章节完成后自动下一节"
      />
      <Toggle
        checked={autoTurn.waitVideoEnd}
        onChange={(waitVideoEnd) => save({ autoTurn: { waitVideoEnd } })}
        label="等待视频/音频结束"
        description="媒体播完再翻页"
      />
      <Toggle
        checked={autoTurn.stopOnUnanswered}
        onChange={(stopOnUnanswered) => save({ autoTurn: { stopOnUnanswered } })}
        label="遇到未答题目时暂停"
        description="有未答题目时暂停"
      />
      <Toggle
        checked={autoTurn.resumeOnReload}
        onChange={(resumeOnReload) => save({ autoTurn: { resumeOnReload } })}
        label="刷新/跳转后自动恢复"
        description="刷新后继续上次进度"
      />

      <div class="sh-subhead">媒体播放</div>
      <Toggle
        checked={video.defaultMuted}
        onChange={(defaultMuted) => save({ video: { defaultMuted } })}
        label="默认静音"
        description="打开媒体时自动静音"
      />
      <Toggle
        checked={video.resumeOnPause}
        onChange={(resumeOnPause) => save({ video: { resumeOnPause } })}
        label="自动翻页时暂停后恢复"
        description="翻页等待时恢复暂停"
      />
    </>
  );
}
