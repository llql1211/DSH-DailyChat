/**
 * Client half of the daily-chat plugin.
 *
 * The product idea: DSH's New Session has one meaning — the full coding agent.
 * This plugin splits it into two, the way ChatGPT splits chat from work:
 *
 *   日常  a lightweight conversation agent. Its own agent preset (`daily`) is
 *         composed of a chat persona, the web tools, local file read/write
 *         (read/write/edit/glob/grep), the question tool and compaction — no
 *         shell, no plan mode, no subagents. The loop is
 *         用户消息 → 模型 → 工具调用 → 回复.
 *   工作  exactly the shipped behaviour, untouched.
 *
 * Five contributions hold that up:
 *
 * 1. Two labeled rows. The shipped New Session button is hand-written JSX
 *    inside the sidebar shell and is wrapped by no slot, so nothing can be added
 *    beside it; the sidebar's own additive seats are the only places a plugin
 *    may appear. The one that renders a full-width icon + label row is
 *    `sidebar.panellist`, so 「日常聊天」 and 「开始工作」 live there, ordered
 *    above 「插件」 by a negative `order` (the shell sorts by it ascending, and
 *    panels default to 0). A panellist row's click is the shell's and is fixed
 *    to `selectPanel(id)`, which is why contribution 2 exists.
 *
 *    The two rows share one horizontal capsule: a light track split into two
 *    clickable halves, with a dark, half-width pill painted on the selected
 *    side. They stay ordinary `sidebar.panellist` buttons — the shell keeps
 *    their click, focus ring and accessible name — and only their layout is bent
 *    into segments by CSS keyed on a marker on this plugin's own glyphs. The
 *    rest of the panel list — 「插件」, 「自动化任务」 and DSH's own 「更多」 row
 *    included — is the shell's and is left alone.
 *
 *    A separate, smaller pair of passes removes the entry-customization
 *    plugin's two discovery rows from the conversation view tab row's 「更多」
 *    menu — a different menu, not the panel list's — and hides that launcher up
 *    front whenever no view tab is folded behind it (`mountViewActions` for the
 *    rows, `ViewMoreWatch` for the launcher).
 * 2. Two `main` panels under those ids, one per row. Both are transient: a row
 *    ACTS rather than navigates, so the panel performs the action and hands the
 *    centre column straight back to the conversation. That is what makes the
 *    mode rows land in the composer, with no page in between.
 * 3. The daily session list in `sidebar.workspaces`. Work mode leaves that slot
 *    completely alone: our entry is registered with `priority: -1`, and for a
 *    `single` slot the LOWEST live priority renders, so ours wins while it is
 *    registered and the shipped browser returns the moment it is disposed. A
 *    row is that browser's own row minus what a daily chat cannot do: status
 *    dot, title, and the same trailing relative age (`relativeTime` plus the
 *    same thresholds), refreshed on a clock because this list can sit idle.
 * 4. A prototype patch of `uiWorkspace.startSession` — the one method every New
 *    Session entry point calls, the sidebar shell's own button included — so
 *    that button starts a daily chat instead of a work session while 日常 is
 *    the active mode.
 * 5. The elapsed line in a settled Turn's footer. DSH measures a Turn's duration
 *    already — `turn.end.time - turn.start.time`, floored at a second — but
 *    paints it only inside the Turn process header, which every shipped display
 *    mode except 「完全展开」 folds away the moment the Turn settles, so the
 *    figure is unreadable exactly when it is wanted. `conversation.chat.turnTail`
 *    is the one seat a settled Turn always paints, and the `turn` prop it hands
 *    over is the same location the header reads, so the line moves an existing
 *    number instead of measuring a second time. The seat that would hold it on
 *    the row with the usage figure and the clock is the row's own, and the only
 *    way into that row is its `extraActions`, fed by
 *    `conversation.chat.assistant-actions` — so the figure is published from the
 *    first seat and painted by the second, which is what {@link TurnDuration}
 *    and {@link TurnElapsed} are. It is not mode-gated on purpose: the question
 *    it answers does not depend on the mode.
 *
 * Daily chats are Sessions in a dedicated workspace, so "daily" is a durable
 * place rather than a UI flag: the history survives, and the lists are just the
 * sessions accounted to that workspace.
 *
 * The mode is remembered in `localStorage`, the same mechanism the shipped
 * client plugins use for their own UI preferences.
 */

window.__ModuleLoader__.load({
  id: '@local/dsh-daily-chat',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const primitives = require('@deepseek-ai/dsh-client-ui-primitives');
    /** Locale namespace for this plugin's own copy. */
    const LOCALE_NS = 'dailyChat';
    /** The single localStorage key holding the active mode. */
    const MODE_KEY = 'dsh.daily-chat.mode';
    /**
     * One localStorage key holding the last session of each mode, as
     * `{ daily, work }`. The shortcut uses it to return to where the operator
     * was instead of piling up a fresh blank session on every switch. Kept
     * apart from the mode itself so switching modes never clears it.
     */
    const LAST_SESSION_KEY = 'dsh.daily-chat.last-session';
    /**
     * The single localStorage key holding the archived-row filter. It is kept
     * apart from the mode because the two are independent: switching to work
     * and back must not reset which archived chats the list is showing.
     */
    const ARCHIVED_FILTER_KEY = 'dsh.daily-chat.archived-filter';
    /**
     * The three visibility choices for archived chats, spelled exactly as the
     * workspace browser spells its own: `default` hides them, `show` mixes them
     * into the list, `only` shows nothing else. Same values, same semantics.
     */
    const ARCHIVED_FILTERS = ['default', 'show', 'only'];
    /** How long a success notice stays up, matching the workspace browser's toast. */
    const TOAST_HOLD_MS = 6000;
    /** The `<html>` attribute the mode-scoped chrome rules hang off. */
    const MODE_ATTRIBUTE = 'data-dsc-mode';
    /**
     * Marker carried by this plugin's two panellist glyphs. The shell paints
     * those glyphs inside its own panel rows, which have no id or `data-*` to
     * hook onto — so the capsule rules find the two halves through this marker
     * rather than through a localized label.
     */
    const MODE_GLYPH_ATTR = 'data-dsc-mode-row';
    /** The two halves of the mode capsule, keyed on the glyph markers. */
    const MODE_DAILY_GLYPH = `svg[${MODE_GLYPH_ATTR}="daily"]`;
    const MODE_WORK_GLYPH = `svg[${MODE_GLYPH_ATTR}="work"]`;
    /**
     * The panel list while BOTH halves are present in its wide form. The title
     * span is the shell's wide-only label: in the rail it is not rendered, and
     * the two rows stay the ordinary icon controls DSH draws there.
     */
    const MODE_CAPSULE = `nav[class*="panelList"]:has(${MODE_DAILY_GLYPH}):has(${MODE_WORK_GLYPH}):has(span[class*="panelTitle"])`;
    const MODE_HALF_DAILY = `${MODE_CAPSULE} > div:has(${MODE_DAILY_GLYPH})`;
    const MODE_HALF_WORK = `${MODE_CAPSULE} > div:has(${MODE_WORK_GLYPH})`;
    /**
     * Where a panel row's glyph starts, measured from the panel list's left
     * edge: the row wrapper's paint inset, the button's paint inset, and the
     * button's inline padding (`row padding - paint inset`). The capsule's
     * left edge uses the same sum so it lines up with the 「插件」 icon.
     */
    const MODE_CAPSULE_INSET = 'calc(var(--dsh-sidebar-row-padding,12px) + var(--dsh-sidebar-paint-inset,3px))';
    /**
     * Two even halves spanning the panel row from the icon's left edge to the
     * row's right paint inset: 15px on the left, 3px on the right.
     */
    const MODE_CAPSULE_HALF = 'calc((100% - 18px) / 2)';
    /** The agent preset a daily chat runs on. */
    const DAILY_PRESET = 'daily';
    /** The workspace directory basename that identifies the daily workspace. */
    const DAILY_DIRECTORY = 'daily-chat';
    /** The title the Host half registers the daily workspace with. */
    const DAILY_TITLE = '日常聊天';
    /** The `main` panel the 「日常聊天」 sidebar row opens. */
    const DAILY_PANEL = 'daily-chat';
    /** The `main` panel the 「开始工作」 sidebar row transiently opens. */
    const WORK_PANEL = 'daily-chat-work';
    /** The attribute a menu surface carries all by itself (see the primitives `Menu`). */
    const MENU_SURFACE_ATTR = 'data-menu-material';
    /**
     * Markers for the conversation view tab row's own 「更多」 menu: the two
     * plugin-discovery rows this plugin removes from it, the empty-launcher
     * state (nothing left to open), and the surface while it is being retired.
     */
    const VIEW_ACTION_ATTR = 'data-dsc-hide-entry-action';
    const VIEW_MORE_EMPTY_ATTR = 'data-dsc-view-more-empty';
    const VIEW_MORE_MENU_ATTR = 'data-dsc-view-more-menu';
    /**
     * Hashed class halves that identify that menu and its launcher. Only the
     * suffix is stable across DSH builds; the hash in front changes with the
     * stylesheet.
     */
    const VIEW_MORE_MENU_CLASS = 'viewsMoreMenu';
    const VIEW_MORE_ANCHOR_CLASS = 'viewsMoreAnchor';
    /** The attribute the conversation shell puts on its view tablist. */
    const CONVERSATION_TABS_ATTR = 'data-conversation-tabs';
    /** The class the elapsed line and its two parts carry. */
    const TURN_CLASS = 'dsc-took';
    /** The line as the turnTail seat paints it: under the action row, on its own. */
    const TURN_FALLBACK_CLASS = 'dsc-took-fallback';
    /** The line as the action row paints it: in-row, after the usage figure. */
    const TURN_INLINE_CLASS = 'dsc-took-inline';
    /** The hidden carrier the turnTail seat publishes its numbers through. */
    const TURN_FACT_CLASS = 'dsc-took-facts';
    /** The attribute a settled Turn's container carries. */
    const TURN_ROOT_MARKER = 'data-turn-tail';
    /** Milliseconds this Turn took, on the carrier. */
    const TURN_FACT_ELAPSED = 'data-dsc-elapsed';
    /** Why this Turn ended (`aborted` / `error` / empty), on the carrier. */
    const TURN_FACT_REASON = 'data-dsc-reason';
    /** When this Turn started, epoch ms, on the carrier. */
    const TURN_FACT_START = 'data-dsc-start';
    /** When this Turn ended, epoch ms, on the carrier. */
    const TURN_FACT_END = 'data-dsc-end';
    /** The turnTail seat's contribution id — the carrier, not the painted line. */
    const TURN_CONTRIBUTION = 'daily-chat-turn-took';
    /** The action row's contribution id — the painted line. */
    const TURN_INLINE_CONTRIBUTION = 'daily-chat-turn-took-inline';
    /**
     * Where the elapsed line sits among its seat's contributions: last, so it
     * comes after another plugin's block instead of splitting the reply from it.
     * Which of the two seats it ends up painting in is not this number's doing —
     * see {@link TURN_CSS} and {@link TurnElapsed}.
     */
    const TURN_ORDER = 20;

    const zh = {
      dismiss: '知道了',
      dailyChats: '日常聊天',
      startWork: '开始工作',
      // The two capsule halves. Kept separate from `dailyChats`, which is also
      // the title of the daily session list and should stay descriptive there.
      modeChat: '聊天',
      modeWork: '工作',
      toggleMode: '切换聊天 / 工作模式',
      newChat: '新建日常聊天',
      // Row actions. The words are the workspace browser's own, so the two
      // lists read the same way; only the controls differ in where they sit.
      pin: '置顶会话',
      unpin: '取消置顶',
      moreActions: '更多操作',
      archive: '归档会话',
      unarchive: '取消归档',
      pinned: '已置顶',
      pinFailed: '置顶失败，请稍后重试',
      unpinFailed: '取消置顶失败，请稍后重试',
      archiveFailed: '归档失败，请稍后重试',
      unarchiveFailed: '取消归档失败，请稍后重试',
      archiveActiveBlocked: '这个会话还在运行，停止后才能归档。',
      // The archive notice is the shipped one, word for word: the toast reads
      // 「会话已归档，可 [撤销] 或 [筛选已归档会话]」, with the two action
      // buttons inline — not a bespoke card with separate buttons.
      archivedNotice: '会话已归档，可',
      stoppedArchivedNotice: '已停止并归档，可',
      toastOr: '或',
      undo: '撤销',
      filterArchived: '筛选已归档会话',
      archivedNotOpenable: '已归档对话暂时无法查看，请取消归档后查看',
      // Archived-row filtering, the same three choices the workspace browser
      // offers under its 「视图选项」 menu.
      viewOptions: '视图选项',
      filterLabel: '筛选会话',
      hideArchived: '隐藏已归档',
      showArchived: '全部对话（显示已归档）',
      onlyArchived: '仅显示已归档',
      noneArchived: '暂无已归档会话',
      viewOthers: '查看其他会话',
      // The confirmation the workspace browser raises before archiving a
      // session that is still working.
      archiveConfirmTitle: '停止并归档此会话？',
      archiveConfirmDesc: '“{title}”仍有正在进行的工作。归档会先停止这些工作；之后可在侧栏筛选“全部对话（显示已归档）”中恢复会话，被停止的工作不会自动继续。',
      archiveConfirmActivity: '将被停止的工作',
      archiveConfirmTurn: '进行中的回合',
      archiveConfirmSubagents: '{n} 个运行中的子智能体：{names}',
      archiveConfirmJobs: '{n} 个后台任务：{names}',
      archiveConfirmSchedules: '{n} 条定时提醒：{names}',
      archiveConfirmOther: '{n} 项其他工作（{kind}）',
      archiveConfirmListSeparator: '、',
      archiveConfirmAction: '停止并归档',
      archiveConfirmPending: '正在停止并归档…',
      cancel: '取消',
      lockedProject: '日常聊天固定在自己的工作区，不能切换项目。要开始工作，请点侧边栏的「开始工作」。',
      starting: '正在打开日常聊天…',
      startingWork: '正在切换到工作模式…',
      empty: '还没有日常聊天，点上面开始第一句。',
      needWorkspace: '没能准备好日常聊天目录，请在弹出的选择框里挑一个文件夹。',
      failed: '打开日常聊天失败',
      turnTook: '用时',
      turnStopped: '已中断，用时',
      turnFailed: '已出错，用时',
      timeNow: '刚刚',
      timeMinutes: '{n}分钟',
      timeHours: '{n}小时',
      timeDays: '{n}天',
      timeMonths: '{n}个月',
      timeYears: '{n}年',
      hourUnit: '小时',
      minuteUnit: '分',
      secondUnit: '秒',
    };

    const en = {
      dismiss: 'Dismiss',
      dailyChats: 'Chats',
      startWork: 'Start working',
      modeChat: 'Chat',
      modeWork: 'Work',
      toggleMode: 'Toggle chat / work mode',
      newChat: 'New chat',
      pin: 'Pin session',
      unpin: 'Unpin session',
      moreActions: 'More actions',
      archive: 'Archive session',
      unarchive: 'Unarchive session',
      pinned: 'Pinned',
      pinFailed: 'Could not pin the session. Try again.',
      unpinFailed: 'Could not unpin the session. Try again.',
      archiveFailed: 'Could not archive the session. Try again.',
      unarchiveFailed: 'Could not unarchive the session. Try again.',
      archiveActiveBlocked: 'This chat is still working. Stop it before archiving.',
      archivedNotice: 'Session archived. You can ',
      stoppedArchivedNotice: 'Stopped and archived. You can ',
      toastOr: ' or ',
      undo: 'Undo',
      filterArchived: 'Filter archived sessions',
      archivedNotOpenable: 'Archived sessions cannot be opened. Unarchive it to view.',
      viewOptions: 'View options',
      filterLabel: 'Filter sessions',
      hideArchived: 'Hide archived',
      showArchived: 'All conversations (show archived)',
      onlyArchived: 'Only archived',
      noneArchived: 'No archived sessions yet',
      viewOthers: 'View other sessions',
      archiveConfirmTitle: 'Stop and archive this session?',
      archiveConfirmDesc: '“{title}” still has work in progress. Archiving stops that work first; the session can be recovered later under “All conversations (show archived)”. Stopped work does not resume automatically.',
      archiveConfirmActivity: 'Work that will be stopped',
      archiveConfirmTurn: 'A running turn',
      archiveConfirmSubagents: '{n} running subagents: {names}',
      archiveConfirmJobs: '{n} background jobs: {names}',
      archiveConfirmSchedules: '{n} scheduled reminders: {names}',
      archiveConfirmOther: '{n} other work items ({kind})',
      archiveConfirmListSeparator: ', ',
      archiveConfirmAction: 'Stop and archive',
      archiveConfirmPending: 'Stopping and archiving…',
      cancel: 'Cancel',
      lockedProject: 'A chat stays in its own workspace — use “Start working” in the sidebar to open a project.',
      starting: 'Opening chat…',
      startingWork: 'Switching to work…',
      empty: 'No chats yet. Start one above.',
      needWorkspace: 'Could not prepare the chat folder — pick one in the dialog.',
      failed: 'Could not open the chat',
      turnTook: 'Took',
      turnStopped: 'Stopped after',
      turnFailed: 'Failed after',
      timeNow: 'now',
      timeMinutes: '{n}min',
      timeHours: '{n}h',
      timeDays: '{n}d',
      timeMonths: '{n}mo',
      timeYears: '{n}y',
      hourUnit: 'h ',
      minuteUnit: 'm ',
      secondUnit: 's',
    };

    const CSS = [
      // The mode rows are `sidebar.panellist` entries, which the shell renders
      // as icon + label (the shape of 「插件」). What is left here for the centre
      // column is the one-frame placeholder a transient mode panel paints.
      '.dsc-panel{display:flex;flex-direction:column;min-height:0;height:100%;padding:28px 24px 24px;overflow-y:auto}',
      '.dsc-panelInner{display:flex;flex-direction:column;gap:14px;width:100%;max-width:720px;margin:0 auto}',
      '.dsc-panelHint{font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary)}',

      // The overlay layer itself is click-through, so an occupant opts back in.
      '.dsc-toast{position:fixed;bottom:18px;left:18px;z-index:60;pointer-events:auto;display:flex;align-items:flex-start;gap:10px;max-width:360px;padding:10px 12px;font-size:12.5px;line-height:18px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-overlay);border:1px solid var(--dsw-alias-border-l2);border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.18)}',
      '.dsc-toast-text{min-width:0;word-break:break-word}',
      // A notice that carries actions (undo / filter) stacks them under its
      // text, the way the workspace browser's own toast does.
      '.dsc-toast-body{display:flex;flex-direction:column;gap:6px;min-width:0}',
      '.dsc-toast-actions{display:flex;flex-wrap:wrap;align-items:center;gap:12px}',
      '.dsc-toast-action{padding:0;font:inherit;font-size:12px;color:var(--dsw-alias-link);cursor:pointer;background:transparent;border:0}',
      '.dsc-toast-action:hover{text-decoration:underline}',
      '.dsc-toast-close{flex:none;padding:0;font:inherit;font-size:12px;color:var(--dsw-alias-label-secondary);cursor:pointer;background:transparent;border:0}',
      '.dsc-toast-close:hover{color:var(--dsw-alias-label-primary)}',

      // The region and its section header mirror the shipped browser's own
      // geometry, declaration for declaration. `.bhn1Oq_root` insets itself by
      // `--dsh-sidebar-inline-padding`, which `regionArea` has already handed
      // back to the sidebar's own gutter. `.bhn1Oq_sectionHeader` is a 36px row
      // whose padding-left is `var(--dsh-sidebar-row-padding)` (12px here), and
      // its `.sectionLabel` adds `position:relative;left:-1px` — so the first
      // glyph starts at row-padding minus one, not at the 4px this header used
      // to copy from an older release. That stale 4px is why 「日常聊天」 sat
      // 7px left of 「工作区」 in a side-by-side capture. The label carries no
      // type of its own: it inherits the sidebar's 14px and the header's
      // tertiary ink, with `max-width:45%` so it can never crowd the controls.
      //
      // One rule in that stylesheet is NOT mirrored, because it does not land:
      // `.bhn1Oq_root:not(.bhn1Oq_rail) .bhn1Oq_sectionHeader` also declares
      // `margin-right:-4px`, yet measuring a 工作 capture puts the shipped add
      // button's right edge flush with the sidebar's content box (18.5px inside
      // the sidebar's outer edge), not 4px past it. Copying the declaration
      // instead of the measurement left 「日常聊天」's own control 4px tighter
      // than 工作's, which is exactly what this row's right margin must not be.
      // The three numbers the shipped browser publishes on its own root and the
      // list spends. Declared here for the same reason: our list has to reserve
      // exactly the same room for its scrollbar.
      '.dsc-region{--dsh-session-list-edge-inset:var(--dsh-sidebar-inline-padding,12px);--dsh-session-list-scrollbar-width:8px;--dsh-session-list-scrollbar-offset:2px;display:flex;flex-direction:column;min-height:0;height:100%;padding:0 var(--dsh-sidebar-inline-padding,12px) 0 0}',
      '.dsc-region.dsc-rail{padding-right:0}',
      // One deliberate difference from the shipped rail header: that one drops
      // its actions entirely, while this header always has the add control to
      // place. With the label hidden in the rail the single remaining child sits
      // at the start either way, so the distribution needs no rail override.
      '.dsc-head{box-sizing:border-box;display:flex;align-items:center;justify-content:space-between;gap:4px;height:36px;margin-top:2px;margin-bottom:4px;padding-left:var(--dsh-sidebar-row-padding,12px);color:var(--dsw-alias-label-tertiary);border-radius:12px;flex:none;overflow:hidden}',
      '.dsc-title{position:relative;left:-1px;white-space:nowrap;min-width:0;max-width:45%;flex:none;line-height:20px;overflow:hidden}',
      // The header's controls: the archive-filter menu and the add button, in
      // the workspace browser's own order (view options, then add).
      '.dsc-headactions{display:flex;flex:none;align-items:center;gap:4px}',
      // A rail is for picking a mode, not for browsing or for starting one. The
      // shipped browser renders neither its label nor its list when collapsed;
      // 日常's one remaining control in the section would be the add button, and
      // measured against a rail capture it sat 4px left of the icon column the
      // mode rows above it share — so the header goes with the list instead of
      // leaving one misaligned glyph behind it.
      '.dsc-rail .dsc-head{display:none}',
      '.dsc-rail .dsc-listArea{display:none}',
      // The section header's two controls are the shipped workspace browser's
      // own icon button, declaration for declaration (`.bhn1Oq_iconButton` in
      // @deepseek-ai/dsh-client-ui-workspace): a bare 28px control, the small
      // `--dsw-radius-sm` corner (NOT a circle — captured from the 0.2.x
      // browser's hover square), and the same hover wash. 日常 replaces that
      // browser in the sidebar, so its own header carries the same affordances
      // in the same clothes: 「视图选项」 and 「新建日常聊天」.
      '.dsc-new{flex:none;display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;padding:0;font:inherit;color:var(--dsw-alias-label-secondary);cursor:pointer;background:transparent;border:0;border-radius:var(--dsw-radius-sm)}',
      '.dsc-new:hover{background:var(--dsw-alias-interactive-bg-hover)}',
      // The list sits in a wrapper that mirrors `.bhn1Oq_listArea`, and that
      // wrapper is what decides where the scrollbar ends up: it pulls back out
      // by the same inset the root added, so the list's box reaches the sidebar's
      // outer edge and the list's own 2px offset then lands the gutter 2px inside
      // it. Leave the wrapper out and the scrollbar — and every row's right edge
      // — sits a whole inset too far in; that is exactly the miss this plugin
      // made twice before a side-by-side capture settled it (工作: thumb ends 2px
      // inside the sidebar edge; 日常 had 14px).
      '.dsc-listArea{min-height:0;margin-left:-4px;margin-right:calc(-1 * var(--dsh-session-list-edge-inset));flex-direction:column;flex:1;padding-left:4px;display:flex;overflow:visible}',
      // ...and the scroll container is the list inside it, mirroring
      // `.bhn1Oq_list`: a 2px offset margin, a gutter reserved even when nothing
      // overflows (`scrollbar-gutter:stable`, so the rows never jump when the
      // list starts or stops scrolling), and a right padding of edge-inset minus
      // scrollbar minus offset — 2px — which puts the rows' right edge where
      // 工作's rows put theirs.
      '.dsc-list{display:flex;flex-direction:column;gap:1px;flex:1;min-height:0;margin-left:-4px;margin-right:var(--dsh-session-list-scrollbar-offset);padding-left:4px;padding-right:calc(var(--dsh-session-list-edge-inset) - var(--dsh-session-list-scrollbar-width) - var(--dsh-session-list-scrollbar-offset));padding-bottom:16px;scrollbar-gutter:stable;overflow-y:auto}',
      // The row is now 工作's `.sessionRow`, declaration for declaration
      // (`Rows.module.css` in `@deepseek-ai/dsh-client-ui-workspace`), not a
      // lookalike with a dot where the slot should be. The old row spent its
      // 32px as a 20px title line plus 6px of vertical padding, opened with an
      // 8px pad + 6px dot + 8px gap: the title landed 22px from the row edge,
      // 工作's lands 34px, exactly the offset a side-by-side capture shows.
      // The shipped row is a fixed 32px line with the paint inset carried on
      // both borders, an asymmetric horizontal pad, a 16px leading slot, and
      // the label gap before the title. Following those declarations makes the
      // two lists' titles, status dots and trailing cells share one x axis.
      //
      // The row's hover paint is 工作's own: the same
      // `--dsw-alias-interactive-bg-hover` (a translucent ink, not a solid
      // layer) inside the same `--dsw-radius-md` corner. A selected row keeps
      // that paint standing, exactly like the workspace browser's selected row.
      //
      // The row is a `<div role="treeitem">`, not a `<button>`: it owns nested
      // action buttons (archive and pin), and interactive elements must not
      // nest inside a button. Enter and Space open it the way the shipped
      // session row does, and the nested buttons stop propagation themselves.
      // A div also has to say `border-box` itself: `width:100%` plus padding
      // on a content-box div would make every row wider than the list and clip
      // the right-hand action against the list's edge.
      '.dsc-row{box-sizing:border-box;display:flex;align-items:center;gap:0;height:32px;width:100%;padding:0 8px;padding-inline-start:calc(var(--dsh-sidebar-row-padding,12px) - var(--dsh-sidebar-paint-inset,3px));border-inline:var(--dsh-sidebar-paint-inset,3px) solid transparent;background:transparent;background-clip:padding-box;font:inherit;text-align:left;color:var(--dsw-alias-label-primary);cursor:pointer;user-select:none;-webkit-user-select:none;border-radius:var(--dsw-radius-md)}',
      '.dsc-row:hover,.dsc-row[aria-selected="true"]{background:var(--dsw-alias-interactive-bg-hover)}',
      // The 16px leading cell the shipped browser gives every session row.
      // The row paints DSH's own `StateDot` here — a spinner while running,
      // an amber dot while waiting on the user, a green one for completed-but-
      // unread — and leaves it blank when idle. These two CSS dots are only
      // the fallback for a primitives build without `StateDot`.
      '.dsc-slot{flex:none;display:inline-flex;align-items:center;justify-content:center;width:16px;height:20px}',
      // An archived row reads the way 工作's archived row reads: the title
      // drops to the caption ink. Nothing else moves — the empty leading
      // slot, the age and the hover actions all stay where they are.
      '.dsc-row-archived .dsc-rowtitle{color:var(--dsw-alias-label-caption)}',
      '.dsc-dot{flex:none;width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-border-l2)}',
      '.dsc-dot-on{background:var(--dsw-alias-state-success-primary)}',
      // The title is the workspace browser's `.title`, declaration for
      // declaration (see @deepseek-ai/dsh-client-ui-workspace's
      // Rows.module.css): 14px/20px, with the shipped `.sessionRow .title`
      // margins — a label gap after the 16px slot and 6px before the trailing
      // cell. The 13px/18px this replaces was a leftover of the once-tried
      // whole-column 13px (reverted), which left this list a size smaller than
      // the list it stands in for, in the same column.
      '.dsc-rowtitle{flex:1;min-width:0;margin:0 6px 0 var(--dsh-sidebar-label-gap,6px);overflow:hidden;font-size:14px;line-height:20px;text-overflow:ellipsis;white-space:nowrap}',
      // The trailing age cell is the workspace browser's `.time`, declaration
      // for declaration (see @deepseek-ai/dsh-client-ui-workspace's
      // Rows.module.css): 10px/16px in the tertiary ink, taking no width from
      // the title. Like 工作's row, it shares a resting cell with the pinned
      // marker and gives that cell up to the row actions on hover.
      '.dsc-rowtime{flex:none;margin-inline-end:-1px;font-size:10px;line-height:16px;color:var(--dsw-alias-label-tertiary)}',
      // `.rowResting`: the age plus, when the row is pinned, the pin marker.
      // The marker is the workspace browser's own `PinnedIndicator`: a 16px
      // cell holding a 14px filled pin in the caption ink. The spacing is the
      // shipped pair, too — the resting cell is a 6px-gap flex line and the
      // marker itself sits at `margin-left:0` inside it (the shipped stylesheet
      // overrides the marker's own 6px for exactly this context), so the icon
      // lands where 工作 puts it instead of 6px further along.
      '.dsc-rowresting{flex:none;display:inline-flex;align-items:center;gap:6px}',
      '.dsc-rowpin{flex:none;display:inline-flex;align-items:center;justify-content:center;width:16px;height:20px;margin-left:0;color:var(--dsw-alias-label-caption)}',
      // `.rowActions`: the hover-only band the row swaps in for the resting
      // cell. Two 24px bare icon buttons with the workspace browser's 13px gap
      // and -4px optical margin, archive first, pin second — its own order.
      '.dsc-rowactions{flex:none;display:none;align-items:center;gap:13px}',
      '.dsc-rowact{flex:none;display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;margin:-4px;padding:0;color:var(--dsw-alias-label-tertiary);cursor:pointer;background:transparent;border:0;border-radius:var(--dsw-radius-xs)}',
      '.dsc-rowact:hover{color:var(--dsw-alias-label-primary)}',
      // Same swap 工作's session row performs, with the same two triggers it
      // recognises: hover, and keyboard focus — and only keyboard focus. A
      // MOUSE click on the pin button also leaves focus inside the row, but the
      // shipped stylesheet deliberately does not count that as a resting-state
      // swap: once the pointer leaves, the row goes back to 「time + pin」 and
      // the archive button disappears again. Without the modality check the
      // just-pinned row would keep showing its action buttons after the click,
      // which is exactly the mismatch this rule fixes (the shipped selector is
      // `html[data-input-modality=keyboard] .sessionRow:focus-within …`).
      '@media (hover:hover){.dsc-row:hover .dsc-rowresting{display:none}.dsc-row:hover .dsc-rowactions{display:inline-flex}html[data-input-modality="keyboard"] .dsc-row:focus-within .dsc-rowresting{display:none}html[data-input-modality="keyboard"] .dsc-row:focus-within .dsc-rowactions{display:inline-flex}}',
      '@media (hover:none){.dsc-rowresting{display:none}.dsc-rowactions{display:inline-flex}}',

      // The page trigger. It is neither a row nor a control: a 1px strip at the
      // end of the painted window that only the observer looks at. It needs a
      // box — a zero-area target is not reliably reported as intersecting —
      // takes no pointer, paints nothing, and as a `<div>` stays out of the tab
      // order. Scrolling it into view is what asks for the next page.
      '.dsc-pager{flex:none;height:1px;pointer-events:none}',
      '.dsc-empty{padding:10px 8px;font-size:12.5px;line-height:18px;color:var(--dsw-alias-label-secondary)}',
      // The archived-only empty state, borrowed whole from the workspace
      // browser's `EmptySessions`: a glyph over a line, with the way back to the
      // ordinary list underneath. Its geometry is the shipped one (centered,
      // 80px down, 13px/20px tertiary ink).
      '.dsc-emptyarchived{display:flex;flex-direction:column;align-items:center;gap:8px;margin-top:80px;padding:0 12px;text-align:center;font-size:13px;line-height:20px;color:var(--dsw-alias-label-tertiary)}',
      '.dsc-emptyarchived > svg{color:var(--dsw-alias-label-caption);margin-bottom:4px}',
      '.dsc-emptylink{padding:0;font:inherit;font-size:13px;line-height:20px;color:var(--dsw-alias-link);cursor:pointer;background:transparent;border:0}',
      // The stop-and-archive confirmation's activity list, matching the shipped
      // dialog: a plain bulleted list under the description.
      '.dsc-archiveactivity{margin:0 0 8px;padding-left:18px;color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px}',
      '.dsc-archiveactivity li{overflow-wrap:anywhere}',
      '.dsc-archivestatus{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}',
      '.dsc-archiveerror{margin-top:8px;font-size:12px;line-height:18px;color:var(--dsw-alias-state-error-primary)}',
    ].join('');

    /**
     * Chrome adjustments that no additive seat can express.
     *
     * The sidebar shell's own New Session button is hand-written JSX inside a
     * shipped plugin and is wrapped by no slot, so it cannot be unregistered,
     * configured away or replaced from the outside — hiding it is the only lever
     * an additive plugin has. Three facts make this selector safe rather than a
     * blind guess:
     *
     * - `newSession` is the CSS-module LOCAL name of exactly that one button in
     *   `@deepseek-ai/dsh-client-ui-sidebar`, and that package is the only place
     *   in this deployment that defines it (verified across every installed
     *   bundle);
     * - the macOS window-chrome control that does the same job lives in a
     *   different module and uses a different class, so it is NOT caught here —
     *   it stays available when the sidebar is hidden;
     * - if a future version renames the class the rule simply stops matching and
     *   the button comes back. The failure mode is "visible again", never
     *   "something else disappeared".
     *
     * (The one place this over-hides is a Windows titlebar rail, where the shell
     * hides the panel list and this button would be the remaining affordance.
     * This profile runs macOS.)
     *
     * The second rule is mode-scoped: it hangs off an attribute this plugin puts
     * on `<html>` while 日常 is the active mode, and the attribute goes away with
     * the mode, so the rule only exists for a daily chat. It hides the new-chat
     * row the conversation renders above the composer — 「项目」 and 「Agent 模式」,
     * the two choices a daily chat does not get to make, because its workspace
     * and its preset are what make it a daily chat. Typing into either is refused
     * on the service side as well (the `openWorkspace` patch below, and the
     * Host's preset lock), so this rule is what the operator sees rather than
     * the only thing standing in the way. As with the button rule, a renamed
     * class means the row simply comes back.
     *
     * The third rule drops the icon from the session header's Agent-preset chip
     * while 日常 is active, leaving its text. The chip is the shipped
     * `AgentPresetLabel` in `@deepseek-ai/dsh-client-ui-agent-preset`, and its
     * icon says "this session runs a preset"; in 日常 the answer is always the
     * same one, so the glyph is noise. It is anchored on the slot key — the same
     * `conversation.session.header.actions` this deployment registers into, and
     * the anchor DSH's own stylesheets use — rather than on the chip's hashed
     * class, and then on the chip's SHAPE: a root `<span>` carrying the preset's
     * description as its `title`, with the glyph as its own first child. The
     * other occupants of that slot (jobs, schedule, terminal, cost meter) are
     * buttons or `<div>`s, so the shape selects exactly one element.
     *
     * One more rule hides the provisional New Session row. Every New Session
     * entry — 「日常聊天」, 「开始工作」, the shell's own button — opens a Session
     * that has no content yet, and until the first prompt is accepted DSH paints
     * exactly that Session in the tree as the selected 「新会话」 placeholder: its
     * title is localized, and it carries no timestamp. That row is there from the
     * click, so a workspace browser shows a conversation the user has not had;
     * this rule is what keeps the list to conversations that exist.
     *
     * It is identified by SHAPE, not by name. `data-row-key="session:…"` is the
     * tree row's own non-hashed handle, and the timestamp cell and the row-actions
     * cell are both rendered `!row.blank && …`, so the placeholder is the only
     * Session row that carries neither. Both anchors have to be missing to match,
     * which is also what bounds the failure: renaming ONE class leaves the other
     * anchor in place, so the rule still hides the placeholder and still skips
     * every real row (a real row keeps the other cell). Only a release that
     * changes BOTH suffixes — or drops both cells — would read a real row as the
     * placeholder and hide it; the shared `!row.blank` gate is what rules that out
     * today. Nothing has to bring the row back either: `blank` clears when
     * the first prompt is ACCEPTED (a refused prompt leaves it set), and the next
     * render paints an ordinary row. The two workspace and session projections
     * above are deliberately left alone by this: DSH reuses a blank Session when
     * the same entry point is clicked again, and that reuse reads the very ids a
     * projection would have to hide.
     *
     * The last rules shape the two mode rows into one horizontal capsule. They
     * are still the shell's own `sidebar.panellist` buttons: only their layout
     * changes, so the click, the accessible name and the focus ring stay the
     * shell's. The panel list becomes a wrapping flex row: the two halves take
     * a compact, equal width, start where a panel row's icon starts, and every
     * other panel row keeps the full width. Each half paints a light track;
     * the selected one adds a dark pill through a pseudo-element on the
     * button, inset 2px from the track, with inverted ink on top. Which half
     * is selected comes from the same `<html>` mode attribute the other
     * mode-scoped rules use. Nothing is keyed on a localized label: the rules
     * find the rows through the markers on this plugin's own glyphs, and leave
     * the rail and every foreign row alone.
     */
    const CHROME_CSS = [
      'button[class*="newSession"]{display:none !important}',
      `html[${MODE_ATTRIBUTE}="daily"] [class*="heroWorkspaceRow"]{display:none !important}`,
      `html[${MODE_ATTRIBUTE}="daily"] [data-slot="conversation.session.header.actions"] > span[title] > svg{display:none !important}`,
      '[data-row-key^="session:"]:not(:has(> [class*="_time"])):not(:has(> [class*="_rowActions"])){display:none !important}',
      // The track: two compact side-by-side halves, left edge lined up with
      // the panel rows' icon, every other row still full width. `panelUnpin`
      // is hidden here by design — mode rows are the switch, not entries a
      // user can fold into the native More menu.
      `${MODE_CAPSULE}{display:flex;flex-direction:row;flex-wrap:wrap;align-content:flex-start;column-gap:0;row-gap:2px}`,
      `${MODE_CAPSULE} > *{flex:none;width:100%}`,
      `${MODE_HALF_DAILY},${MODE_HALF_WORK}{box-sizing:border-box;width:${MODE_CAPSULE_HALF};min-width:0;margin:0;border:0;background:var(--dsw-alias-interactive-bg-hover-solid) !important}`,
      `${MODE_HALF_DAILY}{margin-left:${MODE_CAPSULE_INSET};border-radius:14px 0 0 14px !important}`,
      `${MODE_HALF_WORK}{border-radius:0 14px 14px 0 !important}`,
      `${MODE_HALF_DAILY} button[class*="panelUnpin"],${MODE_HALF_WORK} button[class*="panelUnpin"]{display:none !important}`,
      `${MODE_HALF_DAILY} button[class*="panelRow"],${MODE_HALF_WORK} button[class*="panelRow"]{position:relative;box-sizing:border-box;display:flex;align-items:center;justify-content:center;gap:4px;width:100%;height:32px;min-height:32px;margin:0;padding:0 6px;border:0;border-radius:14px;background:transparent !important;color:var(--dsw-alias-label-secondary);font:inherit;font-size:14px;line-height:22px}`,
      `${MODE_HALF_DAILY} button[class*="panelRow"] > *,${MODE_HALF_WORK} button[class*="panelRow"] > *{position:relative;z-index:1}`,
      // The selected thumb and its ink. The fill keeps the theme's primary
      // colour but sits at 70% — between a glare and a wash — so the white
      // pill in a dark theme reads as a soft light grey. Only the pill dims;
      // the label stays on its own layer at full contrast.
      // `:not()` covers work mode, where the attribute is removed entirely,
      // so the right half is selected before the first click as well.
      `html[${MODE_ATTRIBUTE}="daily"] ${MODE_HALF_DAILY} button[class*="panelRow"]::before,html:not([${MODE_ATTRIBUTE}="daily"]) ${MODE_HALF_WORK} button[class*="panelRow"]::before{content:"";position:absolute;inset:2px;z-index:0;border-radius:12px;background:var(--dsw-alias-button-primary-fill);opacity:.7}`,
      `html[${MODE_ATTRIBUTE}="daily"] ${MODE_HALF_DAILY} button[class*="panelRow"],html:not([${MODE_ATTRIBUTE}="daily"]) ${MODE_HALF_WORK} button[class*="panelRow"]{color:var(--dsw-alias-label-primary-inverted)}`,
      `[${VIEW_ACTION_ATTR}]{display:none !important}`,
      `[${VIEW_MORE_EMPTY_ATTR}]{display:none !important}`,
      `[${VIEW_MORE_MENU_ATTR}]{display:none !important}`,
    ].join('');

    /**
     * The elapsed line's own rules, shipped with the components rather than with
     * {@link CHROME_CSS} so the line carries its styling to whichever surface
     * paints it, and the same colour ramp as the shipped footer chrome around it.
     *
     * The line has two faces. The one that normally paints is {@link TurnElapsed},
     * inside the copy/branch/time row, where `order: 1` puts it after that row's
     * own usage figure and clock — the row is a flex line and the slot's anchor
     * div is `display: contents`, so this rule lands on the flex item itself. The
     * other face, {@link TurnDuration}'s, is the stand-in used when the row is not
     * there to paint into (a Turn the chat view has not finalized, a surface that
     * renders the seat without a row): it stays on its own line under the row,
     * where the negative top margin shaves the column's 16px gap down to the same
     * 4px the row's own `margin-top: 4px` sets. The first face, once painted,
     * retires the second — no surface shows both.
     */
    const TURN_CSS = [
      `.${TURN_FACT_CLASS}{display:none}`,
      `.${TURN_FALLBACK_CLASS}{order:1;display:flex;align-items:baseline;gap:6px;margin:-12px 0 0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}`,
      `.${TURN_INLINE_CLASS}{order:1;display:inline-flex;align-items:center;gap:6px;white-space:nowrap;font-size:calc(var(--dsh-content-font-size-secondary,13px) - 1px);line-height:calc(24px + var(--dsh-content-font-delta,0px));color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}`,
      `[${TURN_ROOT_MARKER}]:has(.${TURN_INLINE_CLASS}) .${TURN_FALLBACK_CLASS}{display:none}`,
      `.${TURN_CLASS}-label{color:var(--dsw-alias-label-secondary)}`,
      `.${TURN_CLASS}-value{color:var(--dsw-alias-label-tertiary)}`,
    ].join('');

    /* ── relative time ────────────────────────────────────────────────────── */

    /**
     * The workspace browser's own bucketing, when primitives ships it: below a
     * minute reads 「刚刚」, then minutes below the hour, hours below the day,
     * days below 30, months below the year, then years. Sharing the helper is
     * what makes a daily row and a 工作 row age in the same words at the same
     * thresholds instead of two similar-but-not-equal ladders.
     */
    const bucketOf = typeof primitives.relativeTime === 'function'
      ? primitives.relativeTime
      : fallbackBucket;

    /**
     * Local bucketing used only when the primitives module carries no helper.
     * Same thresholds and units as `relativeTime`, so the fallback changes
     * nothing about what a row reads — only where the number came from.
     * @param at - the row's `updatedAt`, epoch ms.
     * @param now - current epoch ms.
     * @returns the bucket unit and its magnitude.
     */
    function fallbackBucket(at, now) {
      const diff = Math.max(0, now - at);
      const minutes = Math.floor(diff / 60000);
      if (minutes < 1) return { unit: 'now', n: 0 };
      if (minutes < 60) return { unit: 'minutes', n: minutes };
      const hours = Math.floor(minutes / 60);
      if (hours < 24) return { unit: 'hours', n: hours };
      const days = Math.floor(hours / 24);
      if (days < 30) return { unit: 'days', n: days };
      const months = Math.floor(days / 30);
      if (months < 12) return { unit: 'months', n: months };
      return { unit: 'years', n: Math.floor(months / 12) };
    }

    /** The dictionary key for one bucket; the magnitude stays a number. */
    const UNIT_KEYS = {
      minutes: 'timeMinutes',
      hours: 'timeHours',
      days: 'timeDays',
      months: 'timeMonths',
      years: 'timeYears',
    };

    /**
     * Localize one row's age in the compact form the workspace rows use —
     * `5分钟` / `3小时` / `22天`, never a trailing 「前」: the cell sits beside
     * the title, not in a sentence. The magnitude goes through the dictionary
     * rather than a hand-built number + word pair, so a language pack can put
     * the number anywhere in its own template.
     * @param at - the row's `updatedAt`, epoch ms; anything non-finite paints nothing.
     * @param now - current epoch ms.
     * @param t - this plugin's bound translator.
     * @returns the trailing label, or an empty string when there is no usable time.
     */
    function timeLabel(at, now, t) {
      if (typeof at !== 'number' || !Number.isFinite(at)) return '';
      const bucket = bucketOf(at, now);
      if (bucket.unit === 'now') return t('timeNow');
      const key = UNIT_KEYS[bucket.unit];
      return key === undefined ? '' : t(key, { n: bucket.n });
    }

    /**
     * How often the rows re-read the clock. A relative label names whole
     * minutes (or hours / days), so half a minute keeps it correct to its own
     * granularity without repainting a mounted sidebar on every frame.
     */
    const RELATIVE_CLOCK_PERIOD_MS = 30000;

    /**
     * Current epoch ms, re-sampled on {@link RELATIVE_CLOCK_PERIOD_MS}.
     *
     * The workspace browser samples `Date.now()` while it renders and gets away
     * with it: that tree repaints on every session and workspace event. The
     * daily list can sit untouched for hours — a chat opened at 09:00 and never
     * touched again would keep saying `5分钟` — so it owns a clock instead. The
     * cost is one callback per period while the region is mounted, and the
     * region only exists in 日常: switching to 工作 unmounts it and the timer
     * goes with it.
     * @returns epoch milliseconds, updated once per period.
     */
    function useRelativeClock() {
      const [now, setNow] = React.useState(() => Date.now());
      React.useEffect(() => {
        const timer = setInterval(() => { setNow(Date.now()); }, RELATIVE_CLOCK_PERIOD_MS);
        return () => { clearInterval(timer); };
      }, []);
      return now;
    }

    /* ── mode store ───────────────────────────────────────────────────────── */

    /** Read the persisted mode; anything unreadable means work. */
    function readMode() {
      try {
        if (typeof localStorage === 'undefined') return 'work';
        return localStorage.getItem(MODE_KEY) === 'daily' ? 'daily' : 'work';
      } catch (reason) {
        console.warn('[daily-chat] reading the saved mode failed:', reason);
        return 'work';
      }
    }

    /**
     * Read the persisted archived-row filter. Anything unknown — an older value,
     * a cleared storage, a hand-edited string — means the shipped default:
     * archived chats are hidden, exactly like 工作's out-of-the-box view.
     * @returns one of {@link ARCHIVED_FILTERS}.
     */
    function readArchivedFilter() {
      try {
        if (typeof localStorage === 'undefined') return 'default';
        const saved = localStorage.getItem(ARCHIVED_FILTER_KEY);
        return ARCHIVED_FILTERS.indexOf(saved) === -1 ? 'default' : saved;
      } catch (reason) {
        console.warn('[daily-chat] reading the saved archived filter failed:', reason);
        return 'default';
      }
    }

    /**
     * The last session each mode was in. Corrupt, partial or hand-edited storage
     * degrades to "nothing remembered", which makes the shortcut fall back to
     * the most recent conversation in the target mode.
     * @returns `{ daily, work }`, each either a session id or null.
     */
    function readLastSessions() {
      const empty = { daily: null, work: null };
      try {
        if (typeof localStorage === 'undefined') return empty;
        const raw = localStorage.getItem(LAST_SESSION_KEY);
        if (raw === null) return empty;
        const saved = JSON.parse(raw);
        if (saved === null || typeof saved !== 'object') return empty;
        return {
          daily: typeof saved.daily === 'string' && saved.daily !== '' ? saved.daily : null,
          work: typeof saved.work === 'string' && saved.work !== '' ? saved.work : null,
        };
      } catch (reason) {
        console.warn('[daily-chat] reading the last sessions failed:', reason);
        return empty;
      }
    }

    /**
     * Record the session a mode is currently showing. Deliberately idempotent:
     * the session list publishes many snapshots while a conversation settles,
     * and the same id must not rewrite storage on each one.
     * @param mode - `daily` or `work`.
     * @param sessionId - the main-view session to remember.
     */
    function rememberSession(mode, sessionId) {
      if (mode !== 'daily' && mode !== 'work') return;
      if (typeof sessionId !== 'string' || sessionId === '') return;
      const saved = readLastSessions();
      if (saved[mode] === sessionId) return;
      saved[mode] = sessionId;
      try {
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem(LAST_SESSION_KEY, JSON.stringify(saved));
        }
      } catch (reason) {
        console.warn('[daily-chat] saving the last session failed:', reason);
      }
    }

    let state = {
      mode: readMode(),
      busy: false,
      error: null,
      /** Which of {@link ARCHIVED_FILTERS} the daily list is showing. */
      archivedFilter: readArchivedFilter(),
      /** The transient success notice: `{ seq, text, actions }`, or null. */
      notice: null,
      /** A pending stop-and-archive confirmation: `{ sessionId, displayTitle, activity }`, or null. */
      archiveRequest: null,
    };
    const listeners = new Set();

    /**
     * Reflect the active mode onto the document, which is what the mode-scoped
     * chrome rules key off. The CSS this plugin injects is static, so the mode
     * has to be readable from the DOM rather than from React state; anything
     * other than `daily` means the attribute is absent and every rule that
     * depends on it is inert.
     * @param mode - the mode to publish.
     */
    function syncModeAttribute(mode) {
      try {
        if (typeof document === 'undefined') return;
        if (mode === 'daily') document.documentElement.setAttribute(MODE_ATTRIBUTE, 'daily');
        else document.documentElement.removeAttribute(MODE_ATTRIBUTE);
      } catch (reason) {
        console.warn('[daily-chat] publishing the active mode to the document failed:', reason);
      }
    }

    /** Merge one state patch, persist the mode and the filter, and notify every reader. */
    function setState(patch) {
      state = Object.assign({}, state, patch);
      if (patch.mode !== undefined) {
        try {
          if (typeof localStorage !== 'undefined') localStorage.setItem(MODE_KEY, patch.mode);
        } catch (reason) {
          console.warn('[daily-chat] saving the mode failed:', reason);
        }
        syncModeAttribute(patch.mode);
      }
      if (patch.archivedFilter !== undefined) {
        try {
          if (typeof localStorage !== 'undefined') localStorage.setItem(ARCHIVED_FILTER_KEY, patch.archivedFilter);
        } catch (reason) {
          console.warn('[daily-chat] saving the archived filter failed:', reason);
        }
      }
      for (const listener of [...listeners]) listener();
    }

    /** Subscribe one reader to the mode state. */
    function subscribeState(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    }

    /** Read the current state; identity-stable between mutations. */
    function readState() {
      return state;
    }

    /** The component-side reader. */
    function useChatState() {
      return React.useSyncExternalStore(subscribeState, readState, readState);
    }

    /* ── fallback snapshots ───────────────────────────────────────────────── */

    // The standard-prop hooks come from plugins this one does not own. Using a
    // stable empty snapshot instead of guessing keeps the hook order fixed and
    // degrades to an empty list rather than a crash when a source is absent.
    const EMPTY_WORKSPACES = {
      items: [], archivedSessionIds: [], pinnedSessionIds: [], state: 'idle', phase: 'pending', error: null,
    };
    const EMPTY_SESSIONS = {
      ids: [], byId: {}, phase: 'pending', subagentsByParent: {}, jobsBySession: {},
    };

    /** A short human-readable reason for a failed start. */
    function describe(reason) {
      if (reason === null || reason === undefined) return 'unknown error';
      if (typeof reason === 'string') return reason;
      if (typeof reason.message === 'string' && reason.message !== '') return reason.message;
      if (typeof reason.code === 'string') return reason.code;
      try {
        return JSON.stringify(reason);
      } catch (ignored) {
        return String(reason);
      }
    }

    /* ── artwork ──────────────────────────────────────────────────────────── */

    /**
     * The 「add」 glyph the shipped workspace browser draws in its section
     * header. Taken from the primitives module rather than hand-drawn, because
     * the point of the control is that it looks like the one 日常 replaced; a
     * deployment whose primitives predate it falls back to a bare plus.
     *
     * Two export names cover the two generations of that glyph in DSH:
     * `IconProjectAddOutline16` (the name this plugin has always used) and the
     * current `IconProjectAddOutlineRegular`, which is what the shipped header
     * itself draws in 0.2.x. Without the second fallback the button degrades to
     * a text plus on a current install instead of matching its neighbour.
     */
    const AddGlyph = typeof primitives.IconProjectAddOutline16 === 'function'
      ? primitives.IconProjectAddOutline16
      : (typeof primitives.IconProjectAddOutlineRegular === 'function'
        ? primitives.IconProjectAddOutlineRegular
        : null);

    /**
     * One primitives glyph, or null when this deployment predates it. Used for
     * the pin/archive artwork the workspace browser draws on its own rows: a
     * build without those exports loses the buttons and keeps the list, never
     * the other way round.
     */
    function primitiveGlyph(name) {
      return typeof primitives[name] === 'function' ? primitives[name] : null;
    }

    /** The pin glyphs: outline on an ordinary row, filled once pinned. */
    const PinGlyph = primitiveGlyph('IconPinOutlineRegular');
    const PinFilledGlyph = primitiveGlyph('IconPinFillRegular');
    /** Archive / unarchive row glyphs, plus the three filter-menu glyphs. */
    const ArchiveGlyph = primitiveGlyph('IconArchiveOutlineRegular');
    const UnarchiveGlyph = primitiveGlyph('IconUnarchiveOutlineRegular');
    const ArchiveOffGlyph = primitiveGlyph('IconArchiveOffOutlineRegular');
    const QueueGlyph = primitiveGlyph('IconQueueOutlineRegular');
    const ArchiveCheckGlyph = primitiveGlyph('IconArchiveCheckOutlineRegular');
    /** The workspace browser's 「视图选项」 glyph, reused for the filter control. */
    const SlidersGlyph = primitiveGlyph('IconSlidersTwoOutlineRegular');
    /** The warning glyph the shipped failure toasts put in front of their text. */
    const WarningGlyph = primitiveGlyph('IconWarningOutlineRegular');
    /** Shared primitives the row actions and filter menu need, when present. */
    const TooltipComponent = typeof primitives.Tooltip === 'function' ? primitives.Tooltip : null;
    const MenuComponent = typeof primitives.Menu === 'function' ? primitives.Menu : null;
    const ModalComponent = typeof primitives.Modal === 'function' ? primitives.Modal : null;
    const ButtonComponent = typeof primitives.Button === 'function' ? primitives.Button : null;
    /**
     * The shipped toast the workspace browser raises for its own row actions.
     * Using it — rather than a card of our own — is what makes 「归档」's
     * 「会话已归档，可 [撤销] 或 [筛选已归档会话]」 read and sit exactly like
     * the one 工作 shows: top-center, success mark, inline action buttons.
     */
    const ToastComponent = typeof primitives.Toast === 'function' ? primitives.Toast : null;
    /**
     * The workspace browser's own status dot: an animated 14px spinner for an
     * ongoing session, a 10px dot for `done` (completed but unread) and
     * `warning` (waiting on the user), and nothing at all for `idle`. Reusing
     * it instead of a green dot of our own is what makes those three states
     * read the same in 日常 and 工作.
     */
    const StateDotComponent = typeof primitives.StateDot === 'function' ? primitives.StateDot : null;

    /**
     * Hang a label on one control, with the workspace browser's own tooltip
     * behaviour (bottom, end-aligned, half-second delay). Without the primitive
     * the control keeps its `title`/`aria-label`, so nothing becomes unusable.
     * @param label - text to show.
     * @param child - the control element.
     * @returns the wrapped control, or the control itself.
     */
    function withTooltip(label, child) {
      if (TooltipComponent === null) return child;
      return h(TooltipComponent, {
        label,
        side: 'bottom',
        align: 'end',
        delayMs: 500,
        portal: true,
      }, child);
    }

    /**
     * A chat bubble. The seat decides the size: the sidebar asks a
     * `sidebar.panellist` occupant for 16px wide and 18px in the rail. The
     * marker is how the capsule CSS finds its left half — the shell's row has
     * no id or `data-*` of its own.
     */
    function ChatGlyph(props) {
      const size = typeof props.size === 'number' ? props.size : 16;
      return h('svg', {
        viewBox: '0 0 24 24', width: size, height: size, 'aria-hidden': true,
        [MODE_GLYPH_ATTR]: 'daily',
        fill: 'none', stroke: 'currentColor', strokeWidth: 1.8,
        strokeLinecap: 'round', strokeLinejoin: 'round',
      }, h('path', {
        d: 'M4.5 6.4A2.4 2.4 0 0 1 6.9 4h10.2a2.4 2.4 0 0 1 2.4 2.4v6a2.4 2.4 0 0 1-2.4 2.4h-5.2L7.6 18.6v-3.8H6.9a2.4 2.4 0 0 1-2.4-2.4z',
      }));
    }

    /** A terminal window, same seat contract as {@link ChatGlyph}. */
    function WorkGlyph(props) {
      const size = typeof props.size === 'number' ? props.size : 16;
      return h('svg', {
        viewBox: '0 0 24 24', width: size, height: size, 'aria-hidden': true,
        [MODE_GLYPH_ATTR]: 'work',
        fill: 'none', stroke: 'currentColor', strokeWidth: 1.8,
        strokeLinecap: 'round', strokeLinejoin: 'round',
      }, [
        h('rect', { key: 'frame', x: 3.4, y: 4.4, width: 17.2, height: 15.2, rx: 2.4 }),
        h('path', { key: 'caret', d: 'M7.6 10.2l2.3 2.1-2.3 2.1' }),
        h('path', { key: 'line', d: 'M12.6 14.6h4' }),
      ]);
    }

    /* ── settled-turn elapsed line ────────────────────────────────────────── */

    /**
     * Render an elapsed span the way the shipped Turn process header does.
     *
     * The units and their trailing spacing are copied from DSH's own `duration.*`
     * messages rather than invented: the shipped header prints hours only past an
     * hour, minutes only past a minute, and always prints the seconds — so 90s is
     * 「1分30秒」 and 3600s is 「1小时0分0秒」. English units carry a trailing space
     * ("1h 2m 5s"); Chinese ones do not ("1小时2分5秒").
     *
     * @param ms - elapsed milliseconds; negatives clamp and fractions floor.
     * @param t - translate seat bound to {@link LOCALE_NS}.
     * @returns the figure as text, ready to concatenate onto its label.
     */
    function formatElapsed(ms, t) {
      const total = Math.max(0, Math.floor(ms / 1000));
      const hours = Math.floor(total / 3600);
      const minutes = Math.floor(total / 60) % 60;
      const seconds = total % 60;
      let text = '';
      if (hours > 0) text += String(hours) + t('hourUnit');
      if (total >= 60) text += String(minutes) + t('minuteUnit');
      return text + String(seconds) + t('secondUnit');
    }

    /**
     * Which of the three labels a Turn's elapsed line opens with.
     *
     * Aborted and failed Turns DO keep their figure here, unlike in the shipped
     * header, where the two are labelled 「已停止」/「失败」 with no number: the
     * question this line answers is how long the Turn took, and an interrupted
     * Turn took exactly as long as it took. The label says which happened so the
     * number is not read as a completed answer.
     */
    function turnLabel(reason, t) {
      if (reason === 'aborted') return t('turnStopped');
      if (reason === 'error') return t('turnFailed');
      return t('turnTook');
    }

    /** The absolute span a Turn's elapsed line summarizes, for its tooltip. */
    function turnTitle(start, end) {
      if (start === undefined || end === undefined) return undefined;
      return `${new Date(start).toLocaleString()} → ${new Date(end).toLocaleString()}`;
    }

    /** Whether two readings off the carrier are the same reading. */
    function sameTurnFacts(left, right) {
      if (left === right) return true;
      if (left === undefined || right === undefined) return false;
      return left.elapsed === right.elapsed
        && left.reason === right.reason
        && left.start === right.start
        && left.end === right.end;
    }

    /**
     * Read back the numbers {@link TurnDuration} published for the Turn this
     * action row closes.
     *
     * The action row's seat is told which *message* it belongs to, not which
     * Turn, and the chat store keeps no message-to-Turn index (the only way
     * across is a walk of every node in the session). The carrier makes the
     * crossing free instead of merely cheap: both seats are rendered by DSH into
     * the same `[data-turn-tail]` box, the carrier is already in the DOM by the
     * time this row's layout effect runs, and one `closest` plus one `querySelector`
     * is all it takes to get from the row to the numbers.
     *
     * @param element - the row's own node, or null before it exists.
     * @returns the reading, or undefined when this Turn has no carrier to read.
     */
    function readTurnFacts(element) {
      if (element === null || element === undefined) return undefined;
      const container = element.closest('[' + TURN_ROOT_MARKER + ']');
      if (container === null) return undefined;
      const carrier = container.querySelector('.' + TURN_FACT_CLASS);
      if (carrier === null) return undefined;
      const elapsed = Number(carrier.getAttribute(TURN_FACT_ELAPSED));
      if (!Number.isFinite(elapsed)) return undefined;
      const reason = carrier.getAttribute(TURN_FACT_REASON);
      const start = Number(carrier.getAttribute(TURN_FACT_START));
      const end = Number(carrier.getAttribute(TURN_FACT_END));
      return {
        elapsed: elapsed,
        reason: reason === null || reason === '' ? undefined : reason,
        start: Number.isFinite(start) ? start : undefined,
        end: Number.isFinite(end) ? end : undefined,
      };
    }

    /**
     * The elapsed figure of a settled Turn, published for whichever of the two
     * faces ends up painting it.
     *
     * DSH already measures this — `turn.end.time - turn.start.time`, floored at
     * one second — but paints it only inside the Turn process header, and every
     * shipped display mode except 「完全展开」 folds that header away the moment a
     * Turn settles. A settled Turn therefore shows no duration at all anywhere.
     * This component is the carrier half: it reads the two timestamps off the
     * `conversation.chat.turnTail` seat, states them on a hidden node, and keeps
     * a visible line of its own only as a fallback for the surfaces where
     * {@link TurnElapsed} cannot reach that node.
     *
     * Nothing is invented and nothing is faked: a Turn whose `turn/start` fell
     * outside the loaded window carries no `start`, and one that never settled
     * carries no `end` — both draw nothing rather than a zero.
     *
     * @param props.turn - the settled Turn location, straight from the seat.
     * @param props.t - translate seat bound to {@link LOCALE_NS}.
     * @returns the carrier and its fallback line, or null when there is nothing
     *   to show.
     */
    function TurnDuration(props) {
      const turn = props.turn;
      const t = props.t;
      if (turn === undefined || turn.status !== 'closed') return null;
      if (turn.start === undefined || turn.end === undefined) return null;
      const reason = turn.end.data === undefined || turn.end.data.reason === undefined
        ? undefined
        : turn.end.data.reason.kind;
      // The shipped header's floor, for the same reason: a pause that took less
      // than a second reads as 0, and 0 reads as a bug.
      const elapsed = Math.max(1000, turn.end.time - turn.start.time);
      return h(React.Fragment, null, [
        h('style', { key: 'css' }, TURN_CSS),
        h('span', {
          key: 'facts',
          className: TURN_FACT_CLASS,
          [TURN_FACT_ELAPSED]: String(elapsed),
          [TURN_FACT_REASON]: reason === undefined ? '' : reason,
          [TURN_FACT_START]: String(turn.start.time),
          [TURN_FACT_END]: String(turn.end.time),
        }),
        h('span', {
          key: 'fallback',
          className: `${TURN_CLASS} ${TURN_FALLBACK_CLASS}`,
          title: turnTitle(turn.start.time, turn.end.time),
        }, [
          h('span', { key: 'label', className: `${TURN_CLASS}-label` }, turnLabel(reason, t)),
          h('span', { key: 'value', className: `${TURN_CLASS}-value` }, formatElapsed(elapsed, t)),
        ]),
      ]);
    }

    /**
     * The same figure, painted on the action row's own line.
     *
     * This contribution lives in `conversation.chat.assistant-actions`, the seat
     * DSH hands to the row's `extraActions` — the only way into that row — and
     * `order: 1` in {@link TURN_CSS} is what moves it past the row's own usage
     * figure and clock rather than leaving it in front of the branch button.
     *
     * It paints nothing until it has read the carrier: a Turn that never settled,
     * or a row DSH rendered without its Turn's tail, has no figure to show, and a
     * row that quietly shows none is better than one that shows a guess.
     *
     * @param props - standard seat props; only `t` is needed.
     */
    function TurnElapsed(props) {
      const t = props.t;
      const holder = React.useRef(null);
      const retried = React.useRef(false);
      const [facts, setFacts] = React.useState(undefined);
      // The carrier lands in the same commit as this row, so a layout effect
      // reads it a paint early and the line never flashes in late.
      React.useLayoutEffect(() => {
        const found = readTurnFacts(holder.current);
        setFacts((previous) => (sameTurnFacts(previous, found) ? previous : found));
        // Carrier and row come from two different seats, so a surface that gains
        // one of them a commit later would strand the figure on the fallback
        // line. One deferred re-read covers that, and a read that stays empty
        // changes nothing — the fallback line is already showing.
        if (found !== undefined || retried.current) return;
        retried.current = true;
        requestAnimationFrame(() => {
          setFacts((previous) => {
            const late = readTurnFacts(holder.current);
            return sameTurnFacts(previous, late) ? previous : late;
          });
        });
      });
      if (facts === undefined) {
        // Not hidden by CSS: the class is what the fallback watches for, so an
        // empty first pass must not wear it.
        return h('span', { key: 'anchor', ref: holder, style: { display: 'none' } });
      }
      return h('span', {
        key: 'line',
        ref: holder,
        className: `${TURN_CLASS} ${TURN_INLINE_CLASS}`,
        title: turnTitle(facts.start, facts.end),
      }, [
        h('span', { key: 'label', className: `${TURN_CLASS}-label` }, turnLabel(facts.reason, t)),
        h('span', { key: 'value', className: `${TURN_CLASS}-value` }, formatElapsed(facts.elapsed, t)),
      ]);
    }

    return {
      inject: [
        'slots',
        'locale',
        'layout',
        'remote',
        'remote.agentPresets',
        'uiWorkspace',
        'workspaces',
        'sessions',
      ],

      apply(ctx) {
        ctx.effect(
          () => ctx.locale.register(LOCALE_NS, { zh, en }),
          'daily-chat: dictionaries',
        );
        const t = ctx.locale.bind(LOCALE_NS);

        // Publish the mode the page loaded with, and take the mark away when
        // this plugin unloads: the chrome rules it drives belong to the plugin,
        // so nothing of them may outlive it.
        ctx.effect(() => {
          syncModeAttribute(state.mode);
          return () => syncModeAttribute('work');
        }, 'daily-chat: mode-scoped chrome');

        // Remember where each mode was. Reading it off the live session list
        // rather than off our own few entry points means every way of opening a
        // session counts — the capsule, a sidebar row, DSH's own buttons and the
        // toggle shortcut alike. The store publishes a fresh snapshot on each
        // session event, so the callback only re-reads and writes when the id
        // actually changes. Blank sessions are skipped: they are placeholders,
        // and their id is the one DSH reuses for the next New Session click.
        ctx.effect(() => {
          const store = ctx.sessions.list;
          if (store === null || store === undefined || typeof store.subscribe !== 'function') return undefined;
          return store.subscribe(() => {
            const snapshot = store.getSnapshot();
            const id = mainViewSessionId(snapshot);
            if (id === undefined) return;
            const row = snapshot === null || snapshot === undefined ? undefined : snapshot.byId[id];
            if (row === undefined || row.blank === true || row.origin === 'subagent') return;
            rememberSession(state.mode, id);
          });
        }, 'daily-chat: remember the last session per mode');

        /** The shipped `startSession`, restored on unload. */
        let originalStartSession = undefined;
        /** The model's own workspace read, before the work-mode projection. */
        let readRawWorkspaces = undefined;
        /** Re-entrancy guard: starting a chat must not re-enter through the patch. */
        let starting = false;
        /** Bumped by every mode action so a slow start cannot land after a newer one. */
        let startTicket = 0;

        /** The harness home as the Host reports it, when it does. */
        function hostHome() {
          try {
            const facts = ctx.remote.$host;
            if (facts !== undefined && typeof facts.home === 'string' && facts.home !== '') {
              return facts.home.replace(/\/+$/, '');
            }
          } catch (reason) {
            console.warn('[daily-chat] reading host facts failed:', reason);
          }
          return undefined;
        }

        /** Find the daily workspace among the registered ones. */
        function pickDailyWorkspace(items) {
          const home = hostHome();
          if (home !== undefined) {
            const expected = home + '/.dsh/' + DAILY_DIRECTORY;
            for (const item of items) {
              if (item.path === expected) return item;
            }
          }
          for (const item of items) {
            const segments = item.path.split(/[\\/]/);
            if (segments[segments.length - 1] === DAILY_DIRECTORY) return item;
          }
          return undefined;
        }

        /* ── the work-mode view ───────────────────────────────────────────────── */

        /**
         * Whether one registered workspace is 日常聊天 itself rather than a
         * project.
         *
         * Deliberately stricter than {@link pickDailyWorkspace}, which may fall
         * back to the directory basename alone: a wrong "yes" here deletes a
         * real project from the work-mode sidebar, while a wrong "no" only
         * leaves the daily row in place. The basename fallback therefore also
         * asks for the title the Host half registered the workspace with.
         * @param item - one workspace record.
         * @param expected - the path the Host half registers, when it is known.
         * @returns whether work mode should keep this row out of the sidebar.
         */
        function isDailyWorkspace(item, expected) {
          if (expected !== undefined && item.path === expected) return true;
          const segments = item.path.split(/[\\/]/);
          return segments[segments.length - 1] === DAILY_DIRECTORY && item.title === DAILY_TITLE;
        }

        /** The path the Host half registers the daily workspace under, when it is known. */
        function expectedDailyPath() {
          const home = hostHome();
          return home === undefined ? undefined : home + '/.dsh/' + DAILY_DIRECTORY;
        }

        // A Workspace registration carries no `hidden` flag, so work mode can
        // only keep the daily row out of the sidebar by filtering the snapshot
        // the sidebar renders from. The projection is cached per raw snapshot:
        // the browser reads through `useWorkspaces`, whose selector hook
        // compares snapshots by IDENTITY, and a fresh object on every call would
        // re-render forever.
        /** raw workspace snapshot → its work-mode projection. */
        const workModeViews = new WeakMap();

        /**
         * The workspace snapshot the sidebar may see for the active mode.
         *
         * Chat mode sees everything — that is the mode the daily workspace
         * belongs to, and resolving it reads this very snapshot. Work mode sees
         * every OTHER workspace: 日常聊天 is not a project, and a project row
         * that switches the whole product back into chat mode reads as one.
         * @param snapshot - the model's own snapshot.
         * @returns the snapshot to publish.
         */
        function visibleWorkspaces(snapshot) {
          if (state.mode !== 'work') return snapshot;
          const items = snapshot === null || typeof snapshot !== 'object' ? undefined : snapshot.items;
          if (!Array.isArray(items)) return snapshot;
          const expected = expectedDailyPath();
          if (!items.some((item) => isDailyWorkspace(item, expected))) return snapshot;
          const cached = workModeViews.get(snapshot);
          if (cached !== undefined) return cached;
          const filtered = Object.assign({}, snapshot, {
            items: items.filter((item) => !isDailyWorkspace(item, expected)),
          });
          workModeViews.set(snapshot, filtered);
          return filtered;
        }

        /* ── the work-mode session list ───────────────────────────────────────── */

        /** Shared empty answer for the ordinary "no daily workspace yet" case. */
        const NO_DAILY_IDS = new Set();

        /** raw workspace snapshot → the ids its daily workspace accounts for. */
        const dailyIdViews = new WeakMap();

        /**
         * The session ids the daily workspace accounts for.
         *
         * Read from the model's OWN workspace snapshot, which the projection
         * above deliberately leaves alone: a daily chat is hidden because of
         * what it is, so the question has to be asked of the unfiltered list.
         * @returns the ids, empty while the baseline has not landed yet.
         */
        function dailySessionIds() {
          const snapshot = readRawWorkspaces === undefined ? undefined : readRawWorkspaces();
          const items = snapshot === null || snapshot === undefined ? undefined : snapshot.items;
          if (!Array.isArray(items)) return NO_DAILY_IDS;
          const cached = dailyIdViews.get(snapshot);
          if (cached !== undefined) return cached;
          const expected = expectedDailyPath();
          const ids = new Set();
          for (const item of items) {
            if (!isDailyWorkspace(item, expected)) continue;
            for (const id of item.sessionIds) ids.add(id);
          }
          dailyIdViews.set(snapshot, ids);
          return ids;
        }

        // Hiding the daily WORKSPACE is not enough on its own: the browser
        // builds its 未分组 group out of every Session that no VISIBLE Workspace
        // accounts for, so the daily chats would simply move into that bucket.
        // Work mode therefore drops them from the session list too, which is
        // what "the two modes cannot see each other" means in practice. The
        // projection is cached per raw snapshot for the same identity reason as
        // the workspace one.
        /** raw session-list snapshot → its work-mode projection. */
        const workModeSessionViews = new WeakMap();

        /**
         * Whether one session belongs to the daily workspace.
         * @param id - the session id.
         * @param byId - the raw snapshot's session table.
         * @param accounted - ids the daily workspace accounts for.
         * @param expected - the path the Host half registers, when it is known.
         * @returns whether work mode should keep this session out of the list.
         */
        function isDailySession(id, byId, accounted, expected) {
          if (accounted.has(id)) return true;
          const row = byId[id];
          return row !== undefined && expected !== undefined && row.cwd === expected;
        }

        /**
         * The session-list snapshot the sidebar may see for the active mode.
         *
         * Chat mode sees everything; work mode sees neither the daily workspace
         * nor its chats. Only `ids` is projected — `byId` stays complete, so a
         * session still open in the main column keeps its summary and its
         * status while its row is gone from the list.
         * @param snapshot - the store's own snapshot.
         * @returns the snapshot to publish.
         */
        function visibleSessions(snapshot) {
          if (state.mode !== 'work') return snapshot;
          const ids = snapshot === null || typeof snapshot !== 'object' ? undefined : snapshot.ids;
          const byId = snapshot === null || typeof snapshot !== 'object' ? undefined : snapshot.byId;
          if (!Array.isArray(ids) || byId === null || typeof byId !== 'object') return snapshot;
          const accounted = dailySessionIds();
          const expected = expectedDailyPath();
          const hidden = (id) => isDailySession(id, byId, accounted, expected);
          if (!ids.some(hidden)) return snapshot;
          const cached = workModeSessionViews.get(snapshot);
          if (cached !== undefined) return cached;
          const filtered = Object.assign({}, snapshot, { ids: ids.filter((id) => !hidden(id)) });
          workModeSessionViews.set(snapshot, filtered);
          return filtered;
        }

        /**
         * Whether opening one workspace would stay inside the daily workspace.
         *
         * Project switching is the one navigation a daily chat does not get: its
         * workspace is what makes it a daily chat, and every other workspace
         * belongs to the work half of the product. The daily workspace is
         * resolved on each call rather than remembered, so this holds on a page
         * that is still waiting for the Host's first workspace baseline — an
         * unresolved daily workspace lets the navigation through rather than
         * breaking it outright.
         * @param workspaceId - the workspace the navigation targets.
         * @returns whether the target is the daily workspace.
         */
        function staysDaily(workspaceId) {
          const daily = pickDailyWorkspace(ctx.workspaces.list.getSnapshot().items);
          return daily !== undefined && workspaceId === daily.workspaceId;
        }

        /** Resolve once the Host's first workspace baseline lands, or on timeout. */
        function waitForWorkspaceBaseline(timeoutMs) {
          const source = ctx.workspaces.list;
          if (source.getSnapshot().phase === 'ready') return Promise.resolve();
          return new Promise((resolve) => {
            let settled = false;
            let timer = null;
            function finish() {
              if (settled) return;
              settled = true;
              off();
              if (timer !== null) clearTimeout(timer);
              resolve();
            }
            const off = source.subscribe(() => {
              if (source.getSnapshot().phase === 'ready') finish();
            });
            timer = setTimeout(finish, timeoutMs);
          });
        }

        /** Adopt one directory as the daily workspace, creating it when missing. */
        async function adopt(path) {
          try {
            return await ctx.workspaces.create({ path });
          } catch (reason) {
            const cut = path.lastIndexOf('/');
            if (cut <= 0) return undefined;
            try {
              await ctx.uiWorkspace.createDirectory(path.slice(0, cut), path.slice(cut + 1));
              return await ctx.workspaces.create({ path });
            } catch (retry) {
              console.warn(`[daily-chat] adopting ${path} failed:`, retry);
              return undefined;
            }
          }
        }

        /** The daily workspace, creating or adopting one when nothing matches. */
        async function resolveDailyWorkspace() {
          let found = pickDailyWorkspace(ctx.workspaces.list.getSnapshot().items);
          if (found !== undefined) return found;

          await waitForWorkspaceBaseline(4000);
          found = pickDailyWorkspace(ctx.workspaces.list.getSnapshot().items);
          if (found !== undefined) return found;

          const home = hostHome();
          const candidates = [];
          if (home !== undefined) {
            candidates.push(home + '/.dsh/' + DAILY_DIRECTORY);
            candidates.push(home + '/' + DAILY_DIRECTORY);
          }
          for (const candidate of candidates) {
            const adopted = await adopt(candidate);
            if (adopted !== undefined) return adopted;
          }

          const picked = await ctx.uiWorkspace.pickDirectory();
          if (typeof picked === 'string' && picked !== '') {
            return await ctx.workspaces.create({ path: picked });
          }
          throw new Error(t('needWorkspace'));
        }

        /** Open an existing session and make sure the sidebar shows chat mode. */
        function openDaily(sessionId) {
          setState({ mode: 'daily', error: null });
          ctx.layout.selectPanel(null);
          ctx.uiWorkspace.openSession(sessionId);
        }

        /* ── pin & archive ────────────────────────────────────────────────── */

        // The workspace browser's own two row actions, over the same model:
        // pinning and archiving go through the Host-global sets, so a chat
        // pinned (or archived) from 日常 is pinned (or archived) for 工作 too.
        // Everything the shipped browser does around the call — the fronted
        // order, the failure notices, the stop-and-archive confirmation, the
        // archived-only filter — is reproduced here, because this list stands
        // in for that browser and must not behave like a second, weaker one.

        /** Bumped per notice, so the toast is remounted only for a new message. */
        let noticeSeq = 0;

        /**
         * Raise one row-action notice.
         *
         * The notice is deliberately shaped the way the workspace browser
         * shapes its own: a sentence the inline actions continue from
         * (「会话已归档，可 [撤销] 或 [筛选已归档会话]」), a success or warning
         * tone, and the shipped six-second hold for successes. {@link
         * RowActionToast} is what paints it, through the shipped `Toast`
         * primitive, so placement and clothes are DSH's rather than ours.
         * @param text - the sentence the actions continue from.
         * @param tone - `success` for a completed action, `warning` for a refusal.
         * @param actions - optional `{ label, prefix, run }` inline buttons.
         */
        function notifyNotice(text, tone, actions) {
          noticeSeq += 1;
          const warning = tone === 'warning';
          setState({
            notice: {
              seq: noticeSeq,
              text,
              tone: warning ? 'warning' : 'success',
              holdMs: warning ? undefined : TOAST_HOLD_MS,
              actions: (Array.isArray(actions) ? actions : []).map((action) => ({
                label: action.label,
                ...(action.prefix === undefined ? {} : { prefix: action.prefix }),
                onClick: () => {
                  dismissNotice();
                  if (typeof action.run === 'function') action.run();
                },
              })),
            },
          });
        }

        /** Take the current notice down. */
        function dismissNotice() {
          if (state.notice !== null) setState({ notice: null });
        }

        /**
         * Switch which archived rows the daily list shows, and remember it.
         * @param filter - one of {@link ARCHIVED_FILTERS}.
         */
        function setArchivedFilter(filter) {
          if (ARCHIVED_FILTERS.indexOf(filter) === -1 || state.archivedFilter === filter) return;
          setState({ archivedFilter: filter });
        }

        /**
         * A session's human title, for the stop-and-archive confirmation.
         * @param sessionId - the session being archived.
         * @returns its display title, or the id when the snapshot has none.
         */
        function dailyTitleOf(sessionId) {
          try {
            const row = ctx.sessions.list.getSnapshot().byId[sessionId];
            if (row !== undefined) {
              if (typeof row.displayTitle === 'string' && row.displayTitle !== '') return row.displayTitle;
              if (typeof row.title === 'string' && row.title !== '') return row.title;
            }
          } catch (reason) {
            console.warn('[daily-chat] reading a daily chat title failed:', reason);
          }
          return sessionId;
        }

        /**
         * The work a Host refusal said is still running, or undefined for any
         * other failure.
         *
         * Error-class identity does not cross client plugin bundles, so — as in
         * the shipped browser — the test is by `name` plus the Remote error
         * code, not by `instanceof`.
         * @param reason - the rejected archive call.
         * @returns the reported activity list, or undefined when this was not
         *   the `workspace/session-active` refusal.
         */
        function activeArchiveActivity(reason) {
          if (reason === null || typeof reason !== 'object') return undefined;
          if (reason instanceof Error && reason.name !== 'WorkspaceArchiveError') return undefined;
          const rpc = reason.rpcError;
          if (rpc === null || typeof rpc !== 'object' || rpc.code !== 'workspace/session-active') return undefined;
          const details = rpc.details;
          const activity = details === null || details === undefined ? undefined : details.activity;
          return Array.isArray(activity) ? activity : [];
        }

        /**
         * The actions a successful archive offers, in the shipped order: undo
         * it, then — after 「或」 — switch the list to the archived filter to
         * find it again. Same wording, same order and same inline placement as
         * the workspace browser's own archive notice, including its one
         * conditional: the filter action is only offered while archived rows
         * are still hidden (offering it from the archived view would be a
         * button that does nothing visible).
         * @param sessionId - the session that was archived.
         * @returns the notice actions, in `notifyNotice`'s shape.
         */
        function archiveNoticeActions(sessionId) {
          const actions = [
            {
              label: t('undo'),
              run: () => unarchiveDaily(sessionId),
            },
          ];
          if (state.archivedFilter === 'default') {
            actions.push({
              label: t('filterArchived'),
              prefix: t('toastOr'),
              run: () => setArchivedFilter('show'),
            });
          }
          return actions;
        }

        /**
         * Archive one daily chat.
         *
         * A chat with work still running is refused by the Host with
         * `workspace/session-active`; that refusal becomes the shipped
         * stop-and-archive confirmation instead of an error, because silently
         * killing a running turn is not a thing an archive button may do.
         * @param sessionId - the session to archive.
         */
        function archiveDaily(sessionId) {
          Promise.resolve()
            .then(() => ctx.uiWorkspace.archiveSession(sessionId))
            .then(() => {
              notifyNotice(t('archivedNotice'), 'success', archiveNoticeActions(sessionId));
            })
            .catch((reason) => {
              const activity = activeArchiveActivity(reason);
              if (activity !== undefined) {
                if (ModalComponent === null) {
                  notifyNotice(t('archiveActiveBlocked'), 'warning');
                  return;
                }
                setState({
                  archiveRequest: {
                    sessionId,
                    displayTitle: dailyTitleOf(sessionId),
                    activity,
                  },
                });
                return;
              }
              console.warn('[daily-chat] archiving a daily chat failed:', reason);
              notifyNotice(t('archiveFailed'), 'warning');
            });
        }

        /**
         * Restore one archived daily chat. Idempotent on the Host, so a lost
         * race with another surface resolves as a no-op.
         * @param sessionId - the session to unarchive.
         */
        function unarchiveDaily(sessionId) {
          Promise.resolve()
            .then(() => ctx.uiWorkspace.unarchiveSession(sessionId))
            .catch((reason) => {
              console.warn('[daily-chat] unarchiving a daily chat failed:', reason);
              notifyNotice(t('unarchiveFailed'), 'warning');
            });
        }

        /**
         * Pin one daily chat to the front of the list. The shipped service also
         * fronts it in the browser's saved manual order, so 工作's manual view
         * agrees with this one.
         * @param sessionId - the session to pin.
         */
        function pinDaily(sessionId) {
          Promise.resolve()
            .then(() => ctx.uiWorkspace.pinSession(sessionId))
            .catch((reason) => {
              console.warn('[daily-chat] pinning a daily chat failed:', reason);
              notifyNotice(t('pinFailed'), 'warning');
            });
        }

        /**
         * Drop one daily chat's pin.
         * @param sessionId - the session to unpin.
         */
        function unpinDaily(sessionId) {
          Promise.resolve()
            .then(() => ctx.uiWorkspace.unpinSession(sessionId))
            .catch((reason) => {
              console.warn('[daily-chat] unpinning a daily chat failed:', reason);
              notifyNotice(t('unpinFailed'), 'warning');
            });
        }

        /**
         * The confirmation's `停止并归档`: stop what the Host listed, then
         * archive. Errors stay in the dialog so it can be retried or cancelled.
         * @param sessionId - the session to stop and archive.
         */
        async function stopAndArchiveDaily(sessionId) {
          await ctx.uiWorkspace.archiveSession(sessionId, { stopActivity: true });
          setState({ archiveRequest: null });
          notifyNotice(t('stoppedArchivedNotice'), 'success', archiveNoticeActions(sessionId));
        }

        /**
         * One line of the confirmation's activity list, in the shipped wording.
         * @param entry - one `{ kind, items }` activity record from the Host.
         * @returns the localized line.
         */
        function archiveActivityLine(entry) {
          if (entry === null || typeof entry !== 'object') return '';
          const items = Array.isArray(entry.items) ? entry.items : [];
          const names = items
            .map((item) => (item === null || typeof item !== 'object' ? '' : String(item.label ?? item.id ?? '')))
            .join(t('archiveConfirmListSeparator'));
          const n = items.length;
          switch (entry.kind) {
            case 'turn': return t('archiveConfirmTurn');
            case 'subagent': return t('archiveConfirmSubagents', { n, names });
            case 'job': return t('archiveConfirmJobs', { n, names });
            case 'schedule': return t('archiveConfirmSchedules', { n, names });
            default: return t('archiveConfirmOther', { n, kind: String(entry.kind ?? '') });
          }
        }

        /**
         * The Host code a failed create carried, when it carried one.
         *
         * The client hands a create failure over as a `SessionCreateError` whose
         * own `rpcError` holds the Host's code, so the code is the difference
         * between "this deployment has no `daily` preset" and every other
         * failure.
         * @param reason - the thrown create failure.
         * @returns the code, or undefined.
         */
        function hostErrorCode(reason) {
          if (reason === null || typeof reason !== 'object') return undefined;
          if (typeof reason.code === 'string') return reason.code;
          const rpc = reason.rpcError;
          if (rpc === null || typeof rpc !== 'object' || typeof rpc.code !== 'string') return undefined;
          return rpc.code;
        }

        /**
         * Whether the daily workspace already holds the blank Session a create
         * would reuse.
         *
         * Answered from a FRESH snapshot, with the predicate DSH's own
         * `createInWorkspace` picks its blank with, because that fact decides
         * whether the fallback below may run: a blank means the create will
         * compose a Session that already exists, and no blank means it mints a
         * new one. Re-resolving the workspace here rather than reading the item
         * `resolveDailyWorkspace` handed over keeps both reads on one snapshot
         * version — the create re-resolves its workspace too.
         *
         * Anything it cannot read counts as "there is something to reuse": the
         * caller's conservative answer is to keep the original failure.
         * @param workspaceId - the daily workspace's id.
         * @returns whether a reuse is possible.
         */
        function hasReusableBlank(workspaceId) {
          try {
            const registry = ctx.workspaces.list.getSnapshot();
            const items = registry === null || registry === undefined ? undefined : registry.items;
            if (!Array.isArray(items)) return true;
            const workspace = items.find((item) => item.workspaceId === workspaceId);
            if (workspace === undefined) return false;
            const sessions = ctx.sessions.list.getSnapshot();
            const byId = sessions === null || sessions === undefined ? undefined : sessions.byId;
            const ids = sessions === null || sessions === undefined ? undefined : sessions.ids;
            if (byId === null || typeof byId !== 'object' || !Array.isArray(ids)) return true;
            const archived = Array.isArray(registry.archivedSessionIds) ? registry.archivedSessionIds : [];
            return ids.some((id) => {
              const row = byId[id];
              return row !== undefined
                && row.blank
                && row.cwd === workspace.path
                && workspace.sessionIds.indexOf(id) !== -1
                && archived.indexOf(id) === -1;
            });
          } catch (reason) {
            console.warn('[daily-chat] reading the workspace for a reusable blank Session failed:', reason);
            return true;
          }
        }

        /**
         * Open the daily workspace's blank Session, asking for the daily preset
         * as part of the request instead of composing it afterwards.
         *
         * `connectWorkspace` opens the blank Session a workspace already has —
         * its second argument is what puts it in that reuse branch at all — and
         * DSH composes a reused or minted blank with the preset the create
         * request NAMES, falling back to the deployment default when it names
         * none. That default is what a daily chat may not run on (see the Host
         * half's preset lock), so the unnamed request is refused and the whole
         * create fails with `failed to create session: … 日常聊天固定使用 daily
         * 预设…`. Clicking 「日常聊天」 a second time is exactly that request: the
         * first click already put the blank on `daily`, so the second one asked
         * to put it back on the default. Naming `daily` makes the request agree
         * with the Session it reuses, and a workspace with no blank mints the new
         * Session on `daily` directly rather than composing it on the default and
         * switching afterwards.
         *
         * The fallback keeps the degradation this plugin documents elsewhere — a
         * deployment whose roster lost `daily` still opens the chat on its default
         * preset, with a warning — and it retries ONLY when both halves of that
         * case hold: the create failed because the preset could not be resolved
         * (every other failure is reported instead of retried, which also keeps a
         * half-finished create from being run twice), and the workspace has
         * nothing to reuse. The reuse branch is precisely the one that cannot
         * reach the default: it composes the Session it reuses, the Host lock
         * refuses every non-daily preset for a Session in the daily directory,
         * and retrying through it would hand the user back the very error this
         * function exists to avoid.
         * @param workspace - the resolved daily workspace.
         * @returns the Session the workspace opened.
         */
        async function connectDailySession(workspace) {
          try {
            return await ctx.uiWorkspace.connectWorkspace(workspace.workspaceId, { agentPreset: DAILY_PRESET });
          } catch (reason) {
            const code = hostErrorCode(reason);
            const missingPreset = code === 'agent-preset/not-found' || code === 'agent-preset/invalid';
            if (!missingPreset || hasReusableBlank(workspace.workspaceId)) throw reason;
            console.warn(`[daily-chat] the "${DAILY_PRESET}" preset is unavailable; opening on the deployment default instead:`, reason);
            return await ctx.uiWorkspace.connectWorkspace(workspace.workspaceId);
          }
        }

        /**
         * Start (or reuse the blank) daily session and compose it on the daily
         * preset.
         *
         * Resolving the workspace is asynchronous, and the two mode rows are one
         * click apart: without the ticket below, picking 「开始工作」 while a
         * daily start is still in flight would let that start land afterwards
         * and drag the UI back into chat mode. A start that loses the ticket
         * also leaves the mode alone — the newer action already set it.
         *
         * Chat mode is published BEFORE the workspace is resolved, because work
         * mode hides the daily workspace from the snapshot (see
         * {@link visibleWorkspaces}) and both the resolution and the connect
         * below read that snapshot. A start that fails puts the previous mode
         * back and hands the centre column back with it, so a refusal leaves the
         * sidebar and the composer exactly as they were instead of parking the
         * middle column on the placeholder line a transient panel paints.
         */
        async function startDailyChat() {
          if (starting) return;
          starting = true;
          const ticket = ++startTicket;
          const previous = state.mode;
          setState({ mode: 'daily', busy: true, error: null });
          try {
            const workspace = await resolveDailyWorkspace();
            if (ticket !== startTicket) return;
            const sessionId = await connectDailySession(workspace);
            if (ticket !== startTicket) return;
            setState({ busy: false, error: null });
            ctx.layout.selectPanel(null);
            ctx.uiWorkspace.openSession(sessionId);
            try {
              await ctx.remote.agentPresets.select(sessionId, DAILY_PRESET);
            } catch (reason) {
              console.warn(`[daily-chat] composing the "${DAILY_PRESET}" preset failed:`, reason);
            }
          } catch (reason) {
            console.warn('[daily-chat] starting a daily chat failed:', reason);
            if (ticket !== startTicket) return;
            setState({ mode: previous, busy: false, error: `${t('failed')}：${describe(reason)}` });
            ctx.layout.selectPanel(null);
          } finally {
            starting = false;
          }
        }

        /** The shipped New Session behaviour. */
        function startWorkSession() {
          startTicket += 1;
          setState({ mode: 'work', error: null });
          ctx.layout.selectPanel(null);
          if (typeof originalStartSession === 'function') {
            originalStartSession.call(ctx.uiWorkspace);
          } else {
            ctx.uiWorkspace.startSession();
          }
        }

        /** The archived ids, read from the model's own (unprojected) snapshot. */
        function archivedIdsFromRaw() {
          const snapshot = readRawWorkspaces === undefined ? undefined : readRawWorkspaces();
          const ids = snapshot === null || snapshot === undefined ? undefined : snapshot.archivedSessionIds;
          return new Set(Array.isArray(ids) ? ids : []);
        }

        /**
         * The session a mode switch should land in. The remembered one wins when
         * it still belongs to that mode and can be opened; otherwise the most
         * recently updated conversation of that mode, and otherwise nothing —
         * the caller then falls back to starting a new session, which is what
         * makes the shortcut work on a fresh install too.
         *
         * Archived chats are skipped: a daily one cannot be opened at all, and
         * a work one needs the archive filter changed first. Blank placeholders
         * and subagent sessions are skipped for the same reason the daily list
         * skips them.
         * @param mode - the mode being switched to.
         * @returns a session id, or undefined when there is nothing to resume.
         */
        function resumeSessionForMode(mode) {
          const snapshot = ctx.sessions.list.getSnapshot();
          const byId = snapshot === null || snapshot === undefined ? undefined : snapshot.byId;
          if (byId === null || byId === undefined || typeof byId !== 'object') return undefined;
          const archived = archivedIdsFromRaw();
          const dailyIds = dailySessionIds();
          const expected = expectedDailyPath();
          const usable = (id) => {
            const row = byId[id];
            if (row === undefined || row.blank === true || row.origin === 'subagent' || archived.has(id)) return undefined;
            const daily = isDailySession(id, byId, dailyIds, expected);
            return (mode === 'daily') === daily ? row : undefined;
          };
          const remembered = readLastSessions()[mode];
          if (remembered !== null && usable(remembered) !== undefined) return remembered;
          const candidates = mode === 'daily'
            ? dailyIds
            : (Array.isArray(snapshot.ids) ? snapshot.ids : Object.keys(byId));
          let best = undefined;
          let bestAt = -Infinity;
          for (const id of candidates) {
            const row = usable(id);
            if (row === undefined) continue;
            const at = typeof row.updatedAt === 'number' && Number.isFinite(row.updatedAt) ? row.updatedAt : 0;
            if (at > bestAt) {
              bestAt = at;
              best = id;
            }
          }
          return best;
        }

        /** Open an existing session and switch the surrounding mode with it. */
        function openSessionInMode(mode, sessionId) {
          startTicket += 1;
          setState({ mode, busy: false, error: null });
          ctx.layout.selectPanel(null);
          ctx.uiWorkspace.openSession(sessionId);
          rememberSession(mode, sessionId);
        }

        /**
         * The mode-toggle shortcut. Unlike the capsule halves — which are New
         * Session entry points and still start a fresh conversation — this is a
         * context switch: it returns to where the other mode was left. The
         * session is opened before anything waits on a workspace, so no middle
         * page flashes and no async start can drag the UI back into the old mode.
         */
        function toggleMode() {
          if (state.busy) return;
          const target = state.mode === 'daily' ? 'work' : 'daily';
          const id = resumeSessionForMode(target);
          if (id !== undefined) {
            openSessionInMode(target, id);
          } else if (target === 'daily') {
            void startDailyChat();
          } else {
            startWorkSession();
          }
        }

        /* ── the entry row, and the daily home it opens ───────────────────── */

        /**
         * Conversations accounted to the daily workspace, in the workspace
         * browser's own order and under its own archived filter.
         *
         * Pinned rows lead — newest first among themselves — and everything
         * else follows newest first, exactly what the shipped browser does in
         * its default 「最近更新」 order: `sectionMembers` fronts the pinned
         * partition without touching either side's order. Archival follows the
         * filter: hidden by default, mixed in for `show`, alone for `only`.
         * Blank and subagent rows stay out in every case, as before.
         *
         * @param workspaces - the workspace snapshot.
         * @param sessions - the session-list snapshot.
         * @param archivedFilter - one of {@link ARCHIVED_FILTERS}.
         * @returns the rows both daily surfaces render.
         */
        function dailyRows(workspaces, sessions, archivedFilter) {
          const workspace = pickDailyWorkspace(workspaces.items);
          if (workspace === undefined || sessions.phase !== 'ready') return [];
          const archivedIds = Array.isArray(workspaces.archivedSessionIds) ? workspaces.archivedSessionIds : [];
          const pinnedIds = Array.isArray(workspaces.pinnedSessionIds) ? workspaces.pinnedSessionIds : [];
          const archived = new Set(archivedIds);
          const pinned = new Set(pinnedIds);
          const filter = ARCHIVED_FILTERS.indexOf(archivedFilter) === -1 ? 'default' : archivedFilter;
          const rows = [];
          for (const id of workspace.sessionIds) {
            const row = sessions.byId[id];
            if (row === undefined || row.blank === true || row.origin === 'subagent') continue;
            const isArchived = archived.has(id);
            if (filter === 'default' && isArchived) continue;
            if (filter === 'only' && !isArchived) continue;
            // A pinned row can never be archived (the Host refuses that pin),
            // so the two markers are mutually exclusive on screen as well.
            rows.push(Object.assign({}, row, {
              archived: isArchived,
              pinned: !isArchived && pinned.has(id),
            }));
          }
          rows.sort((left, right) => (right.updatedAt || 0) - (left.updatedAt || 0));
          // Stable partition, not a second sort: pinned rows keep their recency
          // order among themselves, and so does the rest.
          const leading = rows.filter((row) => row.pinned);
          const rest = rows.filter((row) => !row.pinned);
          return leading.concat(rest);
        }

        /**
         * The session the centre column currently shows, for the selected-row
         * highlight and for remembering where each mode was. Read from the
         * Session list exactly the way the workspace browser reads it: the
         * entry retained by the main view.
         * @param sessions - the session-list snapshot.
         * @returns the session id, or undefined when nothing is open.
         */
        function mainViewSessionId(sessions) {
          try {
            for (const id of sessions.ids) {
              const row = sessions.byId[id];
              if (row === undefined) continue;
              const retainedBy = row.retainedBy;
              if (retainedBy !== undefined && retainedBy !== null && retainedBy.mainView > 0) return id;
            }
          } catch (reason) {
            console.warn('[daily-chat] reading the open daily chat failed:', reason);
          }
          return undefined;
        }

        /**
         * How many rows one page adds to the daily list.
         *
         * The rows are all in the snapshot already — this window decides what
         * gets painted, not what gets fetched. An account with hundreds of
         * conversations therefore mounts one page of buttons on open and one
         * more page each time the list reaches its end, instead of mounting
         * every row before the first paint.
         */
        const ROW_PAGE = 20;

        /**
         * The sliding window of daily rows the mounted list has painted.
         *
         * The window belongs to the list, not to the snapshot: a row arriving,
         * leaving or being renamed re-cuts the same window and must never push
         * rows below it back out of reach. Entering 日常 remounts the region, so
         * the window starts over at one page there.
         *
         * The end of the list is a 1px `.dsc-pager` strip watched by an
         * IntersectionObserver rooted at the scroll container. That is one
         * browser-maintained comparison instead of a scroll handler, and it also
         * covers a viewport tall enough to show the whole page: the strip is in
         * view on mount, so the next page loads even though no wheel event can
         * ever reach the bottom of a list that does not overflow yet.
         *
         * The effect re-arms after every page (`visible` is a dependency)
         * because a viewport may be tall enough to show two or three pages: an
         * observer kept on the same node only fires on threshold CROSSINGS, so
         * once the strip stays inside the viewport it would never ask again.
         * Re-observing publishes the current state instead, and the window keeps
         * growing until the list overflows or runs out — never leaving a
         * non-scrollable list with rows stranded behind it.
         *
         * @param rows - the rows the list would paint without a window.
         * @returns `visible` (rows to paint), `more` (whether any wait behind
         *   them), `listRef` (the scroll container) and `sentinelRef` (the
         *   trigger strip).
         */
        function usePagedRows(rows) {
          const [visible, setVisible] = React.useState(ROW_PAGE);
          const listRef = React.useRef(null);
          const sentinelRef = React.useRef(null);
          const total = rows.length;
          const more = total > visible;

          React.useEffect(() => {
            if (!more) return undefined;
            const scroll = listRef.current;
            const sentinel = sentinelRef.current;
            if (scroll === null || sentinel === null) return undefined;
            if (typeof IntersectionObserver !== 'function') {
              // No observer (an old webview): paint everything. A window that
              // can never grow would hide rows with nothing left to reveal them.
              setVisible(total);
              return undefined;
            }
            const observer = new IntersectionObserver((entries) => {
              if (!entries.some((entry) => entry.isIntersecting)) return;
              setVisible((painted) => Math.min(painted + ROW_PAGE, total));
            }, { root: scroll, rootMargin: '120px 0px' });
            observer.observe(sentinel);
            return () => { observer.disconnect(); };
          }, [more, total, visible]);

          return { visible, more, listRef, sentinelRef };
        }

        /**
         * The standard-prop workspace reader, with a stable empty fallback so an
         * absent source degrades to an empty list instead of a crash.
         * @param props - the composed slot props.
         * @returns the workspace snapshot.
         */
        function useWorkspacesOf(props) {
          const read = typeof props.useWorkspaces === 'function'
            ? props.useWorkspaces
            : () => EMPTY_WORKSPACES;
          return read((snapshot) => snapshot);
        }

        /**
         * The standard-prop session-list reader, same fallback contract.
         * @param props - the composed slot props.
         * @returns the session-list snapshot.
         */
        function useSessionsOf(props) {
          const read = typeof props.useSessions === 'function'
            ? props.useSessions
            : () => EMPTY_SESSIONS;
          return read((snapshot) => snapshot);
        }

        /**
         * The standard-prop session-STATUS reader: the same global seat the
         * workspace browser reads for its row dots. An older shell without
         * `useSessionStatus` yields null, which the row treats as "no status
         * facts" and falls back to the list's own `running` flag.
         * @param props - the composed slot props.
         * @returns the status snapshot, or null when the seat is absent.
         */
        function useStatusesOf(props) {
          const read = typeof props.useSessionStatus === 'function'
            ? props.useSessionStatus
            : () => null;
          return read((snapshot) => snapshot);
        }

        /**
         * Collapse DSH's session-status ladder (`sessionStatuses` in
         * ui-workspace's Rows.tsx) to one `StateDot` state:
         * waiting on the user outranks running, which outranks the completion
         * reminder; an idle row shows no dot at all. The list's `running`
         * flag is only the fallback for a shell with no status seat.
         * @param status - the row's `useSessionStatus` entry, if any.
         * @param row - the session-list row.
         * @returns the StateDot state, or null when nothing should be painted.
         */
        function rowStateOf(status, row) {
          const kind = status === undefined || status === null || status.pendingInteraction === undefined || status.pendingInteraction === null
            ? undefined
            : status.pendingInteraction.kind;
          if (kind === 'approval' || kind === 'plan-review' || kind === 'question') return 'warning';
          const running = status === undefined || status === null || status.running === undefined
            ? row.running
            : status.running;
          if (running === true) return 'ongoing';
          if (status !== undefined && status !== null && status.completionUnread === true) return 'done';
          return null;
        }

        /**
         * Build one transient mode panel — the surface behind a sidebar mode row.
         *
         * A `sidebar.panellist` row's click belongs to the shell and can only
         * `selectPanel(id)`, so a row that ACTS has to be a panel that hands
         * control straight back: it performs its action once and returns the
         * centre column to the conversation. Both mode rows work this way, which
         * is what makes 「日常聊天」 and 「开始工作」 land in the composer instead
         * of on an intermediate page. The line rendered below is what the centre
         * paints for the frame before the effect runs.
         *
         * @param panelId - the `main` key this panel answers for.
         * @param textKey - locale key for the placeholder line.
         * @param action - what the row does.
         * @returns the slot component.
         */
        function makeStarter(panelId, textKey, action) {
          return function Starter(props) {
            // Gated on the panel actually being the dispatched key: a keyed slot
            // may keep an entry mounted while another key renders, and mounting
            // is not selecting — acting on mount alone would fire the action just
            // for having the plugin loaded.
            const active = typeof props.usePanelInfo === 'function'
              ? props.usePanelInfo((info) => info.activePanelId === panelId)
              : true;

            React.useEffect(() => {
              if (active) action();
            }, [active]);

            return h('div', { className: 'dsc-panel' }, [
              h('style', { key: 'css' }, CSS),
              h('div', { className: 'dsc-panelInner', key: 'inner' },
                h('div', { className: 'dsc-panelHint', key: 'hint' }, props.t(textKey))),
            ]);
          };
        }

        /** 「日常聊天」: enter chat mode and land in the blank chat's composer. */
        const DailyStarter = makeStarter(DAILY_PANEL, 'starting', () => {
          void startDailyChat();
        });

        /** 「开始工作」: enter work mode and land in the work session. */
        const WorkStarter = makeStarter(WORK_PANEL, 'startingWork', () => {
          startWorkSession();
        });

        /* ── the conversation view row's menu ─────────────────────────────────── */

        /**
         * Keep the conversation view tab row's 「更多」 menu free of the two
         * plugin-discovery actions.
         *
         * That menu belongs to the conversation shell; the rows come from the
         * shipped `entry-customization` plugin (`浏览更多插件` / `创建你的插件`),
         * which has no seat-level switch a bundle can flip. They are recognised
         * by the labels that plugin publishes in its own locale namespace —
         * `ctx.locale.bind('entryCustomization')` resolves them in whatever
         * language is active, and a namespace this build no longer carries makes
         * `translate` fall back to the key itself, so nothing matches and the
         * rows simply stay. The menu surface is recognised by the
         * `viewsMoreMenu` class half it carries (`viewsMoreMenu` is the
         * listClassName the conversation shell passes to the shared menu), which
         * is why the sidebar's own 「更多」 is never touched.
         *
         * The launcher's own visibility is decided up front by
         * {@link ViewMoreWatch}; this pass only needs a fallback for the case
         * that estimate misses (a view the shell hides for its own reasons): if
         * the menu turns out to hold nothing but those two rows, the surface is
         * marked hidden and the launcher toggled closed within the same mutation
         * turn — before a paint — and stays hidden until the tab strip moves.
         *
         * @returns the disposer that gives the menu and its launcher back.
         */
        function mountViewActions() {
          if (
            typeof document === 'undefined'
            || typeof MutationObserver !== 'function'
          ) {
            return () => {};
          }

          const entryT = ctx.locale.bind('entryCustomization');
          /** Disposer of the one-shot tab-strip watcher, while a launcher is hidden. */
          let releaseTabs = null;

          /** The two row labels to remove, in the active language. */
          function hiddenLabels() {
            return new Set([entryT('install'), entryT('create')]);
          }

          /** Stop watching the tab strip and show every hidden launcher again. */
          function restoreLaunchers() {
            if (releaseTabs !== null) releaseTabs();
            for (const marked of document.querySelectorAll(`[${VIEW_MORE_EMPTY_ATTR}]`)) {
              marked.removeAttribute(VIEW_MORE_EMPTY_ATTR);
            }
          }

          /** Bring the launcher back on the next tab-strip change. */
          function watchTabs(trigger) {
            restoreLaunchers();
            const anchor = trigger.closest(`[class*="${VIEW_MORE_ANCHOR_CLASS}"]`);
            const row = anchor === null ? null : anchor.parentElement;
            const tabs = row === null ? null : row.querySelector(`[${CONVERSATION_TABS_ATTR}]`);
            if (tabs === null) return;
            const watcher = new MutationObserver(() => {
              restoreLaunchers();
            });
            const dispose = () => {
              watcher.disconnect();
              if (releaseTabs === dispose) releaseTabs = null;
            };
            watcher.observe(tabs, { childList: true });
            releaseTabs = dispose;
          }

          /** Remove the two rows; retire the launcher when nothing else is left. */
          function filter(surface) {
            const labels = hiddenLabels();
            let removed = 0;
            for (const row of surface.querySelectorAll('button[role="menuitem"]')) {
              const text = (row.textContent ?? '').trim();
              if (!labels.has(text)) continue;
              row.setAttribute(VIEW_ACTION_ATTR, '');
              removed += 1;
            }
            if (removed === 0) return;
            const left = surface.querySelectorAll(`button[role="menuitem"]:not([${VIEW_ACTION_ATTR}])`);
            if (left.length > 0) return;
            // Nothing but the plugin actions: close the empty surface before it
            // can paint and keep the launcher out of the way until the tab strip
            // moves again.
            surface.setAttribute(VIEW_MORE_MENU_ATTR, '');
            const trigger = document.querySelector(`[class*="${VIEW_MORE_ANCHOR_CLASS}"] button[aria-haspopup="menu"][aria-expanded="true"]`);
            if (trigger === null) return;
            // Watch first (it clears any previous mark), then close and mark: the
            // tab-strip watcher must not treat the mark it is about to guard as stale.
            watchTabs(trigger);
            trigger.click();
            trigger.setAttribute(VIEW_MORE_EMPTY_ATTR, '');
          }

          const observer = new MutationObserver((records) => {
            for (const record of records) {
              for (const node of record.addedNodes) {
                if (!(node instanceof Element)) continue;
                const surface = node.hasAttribute(MENU_SURFACE_ATTR)
                  ? node
                  : node.querySelector(`[${MENU_SURFACE_ATTR}]`);
                if (surface === null) continue;
                if (typeof surface.className !== 'string') continue;
                if (!surface.className.includes(VIEW_MORE_MENU_CLASS)) continue;
                filter(surface);
              }
            }
          });
          observer.observe(document.body, { childList: true });

          return () => {
            observer.disconnect();
            restoreLaunchers();
          };
        }

        /**
         * Mounts {@link mountViewActions} for as long as the plugin is loaded;
         * like the 「更多」 pass it only corrects DOM the shell owns, so the
         * overlay occupant paints nothing.
         */
        function ViewActions() {
          React.useEffect(() => mountViewActions(), []);
          return null;
        }

        /**
         * Hide the conversation view row's 「更多」 launcher when no view tab is
         * folded behind it — without waiting for a click.
         *
         * The launcher exists because `entry-customization` registers rows into
         * the view actions seat, and {@link mountViewActions} removes those rows;
         * with nothing folded, the menu would open empty. The shell already
         * decides what is folded with one line — it shows
         * `floor((rowWidth - 48) / 120)` tabs and pushes the rest into this menu
         * — so the same arithmetic over the registered `conversation.view`
         * entries answers the question up front. A view that *is* folded keeps
         * the launcher, so it stays reachable.
         *
         * Called from the session header's actions seat, so it mounts with the
         * header; re-syncs on every header render (the blank→conversation flip
         * is what paints the tab row), on a resize of the row (the tab limit is
         * width-derived) and when the `conversation.view` ledger changes.
         */
        function syncViewMoreVisibility() {
          const tabs = document.querySelector(`[${CONVERSATION_TABS_ATTR}]`);
          const row = tabs === null ? null : tabs.parentElement;
          if (row === null) return;
          const anchors = row.querySelectorAll(`[class*="${VIEW_MORE_ANCHOR_CLASS}"]`);
          if (anchors.length === 0) return;
          let views = 0;
          try {
            views = ctx.slots.entries('conversation.view').length;
          } catch (reason) {
            console.warn('[daily-chat] reading the conversation views failed:', reason);
            return;
          }
          const visibleLimit = Math.max(1, Math.floor((row.clientWidth - 48) / 120));
          const folded = views > visibleLimit;
          for (const anchor of anchors) {
            if (folded) anchor.removeAttribute(VIEW_MORE_EMPTY_ATTR);
            else anchor.setAttribute(VIEW_MORE_EMPTY_ATTR, '');
          }
        }

        /**
         * The bridge that runs {@link syncViewMoreVisibility} while a session
         * header is mounted: the header, not the plugin, owns when the tab row
         * exists, so the plugin hangs this off a seat in the header that paints
         * nothing.
         */
        function ViewMoreWatch() {
          React.useEffect(() => {
            syncViewMoreVisibility();
            const tabs = document.querySelector(`[${CONVERSATION_TABS_ATTR}]`);
            const row = tabs === null ? null : tabs.parentElement;
            const resize = typeof ResizeObserver === 'function' && row !== null
              ? new ResizeObserver(() => syncViewMoreVisibility())
              : null;
            if (resize !== null) resize.observe(row);
            const stop = ctx.slots.subscribe('conversation.view', () => syncViewMoreVisibility());
            return () => {
              if (resize !== null) resize.disconnect();
              stop();
            };
          }, []);
          // Every header render (blank → conversation included) re-evaluates.
          React.useEffect(() => {
            syncViewMoreVisibility();
          });
          return null;
        }

        /**
         * Carries the chrome adjustments, mounted unconditionally on the
         * frame-wide overlay layer so they apply in every mode. Rendering a
         * `<style>` element means unmounting the plugin takes the rules away
         * with it.
         */
        function ChromeStyle() {
          return h('style', null, CHROME_CSS);
        }

        /**
         * A failed start has no room to print itself in a sidebar row, so it
         * surfaces as a transient card on the frame-wide overlay layer. This is
         * the plugin's own failure card (the shipped toast is for row actions,
         * see {@link RowActionToast}); action failures use that one instead.
         */
        function ErrorToast(props) {
          const t = props.t;
          const chat = useChatState();
          if (chat.error === null) return null;

          return h('div', { className: 'dsc-toast', role: 'status' }, [
            h('style', { key: 'css' }, CSS),
            h('div', { className: 'dsc-toast-text', key: 'text' }, chat.error),
            h('button', {
              key: 'close',
              type: 'button',
              className: 'dsc-toast-close',
              onClick: () => setState({ error: null }),
            }, t('dismiss')),
          ]);
        }

        /**
         * The row-action notice: the shipped `Toast` primitive, carrying the
         * same sentence and the same inline actions the workspace browser uses
         * for its own pin/archive rows.
         *
         * That is the whole point of this component — an archive in 日常 must
         * read 「会话已归档，可 [撤销] 或 [筛选已归档会话]」 at the same place
         * DSH puts it, not a second, different card. The primitive owns the
         * placement (top center, portalled to `<body>`), the success/warning
         * mark and the hold timer; this component only supplies its content.
         *
         * A primitives build without `Toast` falls back to the plugin's own
         * corner card with the same text and buttons, so the action is still
         * recoverable — just not in the shipped clothes.
         * @param props.t - translate seat bound to {@link LOCALE_NS}.
         * @returns the notice, or null when there is none.
         */
        function RowActionToast(props) {
          const t = props.t;
          const chat = useChatState();
          const notice = chat.notice;
          if (notice === null) return null;
          const actions = Array.isArray(notice.actions) ? notice.actions : [];

          if (ToastComponent !== null) {
            const toastProps = {
              key: notice.seq,
              text: notice.text,
              onDone: dismissNotice,
              ...(notice.tone === 'success' ? { tone: 'success' } : {}),
              ...(notice.tone === 'warning' && WarningGlyph !== null ? { icon: h(WarningGlyph, {}) } : {}),
              ...(notice.holdMs === undefined ? {} : { holdMs: notice.holdMs }),
              ...(actions.length === 0 ? {} : { actions }),
            };
            return h(ToastComponent, toastProps);
          }

          return h('div', { className: 'dsc-toast', role: 'status' }, [
            h('style', { key: 'css' }, CSS),
            h('div', { className: 'dsc-toast-body', key: 'body' }, [
              h('div', { className: 'dsc-toast-text', key: 'text' }, notice.text),
              actions.length === 0 ? null : h('div', { className: 'dsc-toast-actions', key: 'actions' },
                actions.map((action, index) => h('button', {
                  key: String(index),
                  type: 'button',
                  className: 'dsc-toast-action',
                  onClick: () => {
                    if (typeof action.onClick === 'function') action.onClick();
                  },
                }, action.label))),
            ]),
            h('button', {
              key: 'close',
              type: 'button',
              className: 'dsc-toast-close',
              onClick: dismissNotice,
            }, t('dismiss')),
          ]);
        }

        /* ── the daily browsing region ────────────────────────────────────── */

        /**
         * One 24px bare icon in a row's hover band, carrying the workspace
         * browser's own tooltip and aria label.
         * @param props.label - what the control does.
         * @param props.glyph - the primitives icon component.
         * @param props.run - the action.
         * @returns the button, optionally wrapped in a tooltip.
         */
        function RowActionButton(props) {
          const button = h('button', {
            type: 'button',
            className: 'dsc-rowact',
            'aria-label': props.label,
            onClick: (event) => {
              event.stopPropagation();
              props.run();
            },
          }, h(props.glyph, { size: 14 }));
          return withTooltip(props.label, button);
        }

        /**
         * One daily session row: 工作's own 32px session row, with the same
         * leading 16px status cell, title margins and trailing band.
         *
         * Presentation follows the shipped row declaration for declaration —
         * a 16px leading slot carrying DSH's own `StateDot` for the same status
         * ladder 工作 uses (waiting on the user, running, completed-but-unread,
         * idle = blank), the title with its label-gap margin, then a resting
         * cell holding the relative age and (when pinned) the same 14px pin
         * marker 工作 draws.
         * Hovering retires that cell and brings up the same three controls in
         * the same order: the shared 「更多」 trigger, archive, then pin. The
         * trigger comes from DSH's `contextMenu.button` factory, so the menu
         * and its entries are the ones a work session gets. An archived row is
         * muted, keeps its age, and offers unarchive instead of archive;
         * clicking it is refused with the shipped explanation rather than
         * opening it.
         *
         * The row is a `div role="treeitem"`; on a real key press Enter/Space
         * open it, while the nested action buttons keep their own clicks.
         *
         * @param props.row - the derived row (with `pinned` / `archived` flags).
         * @param props.now - epoch ms for the age cell.
         * @param props.selected - whether this session is the open one.
         * @param props.t - translate seat bound to {@link LOCALE_NS}.
         * @param props.useSessionAccess - the standard session access hook.
         * @param props.statuses - the standard `useSessionStatus` snapshot, read
         * once by the region (null when an older shell has no status seat).
         * @param props.renderFactorySlot - slot factory renderer for DSH's
         * context-menu trigger (absent in older shells, where no trigger shows).
         * @param props.onOpen - open the session (or refuse, when archived).
         * @param props.onArchive / props.onUnarchive - archive actions.
         * @param props.onPin / props.onUnpin - pin actions.
         * @returns the row.
         */
        function DailyRow(props) {
          const t = props.t;
          const row = props.row;
          const useSessionAccess = props.useSessionAccess;
          // The shipped browser gates each action on the session's access
          // snapshot. Both hook calls happen unconditionally, so the hook order
          // is the same whether the row is pinned or archived; when the standard
          // prop is absent (an older shell) nothing is gated, which is the
          // status quo this list had before row actions existed.
          const canArchive = typeof useSessionAccess === 'function'
            ? useSessionAccess(row.id, row.archived ? 'workspace/unarchiveSession' : 'workspace/archiveSession')
            : true;
          const canPin = typeof useSessionAccess === 'function'
            ? useSessionAccess(row.id, row.pinned ? 'workspace/unpinSession' : 'workspace/pinSession')
            : true;
          const open = () => props.onOpen(row);

          // The leading cell follows 工作's status ladder, read from the same
          // global seat 工作 reads. Archived rows keep that cell blank there,
          // and a shell without the seat falls back to the list's `running`.
          const statuses = props.statuses;
          const status = statuses !== null && statuses !== undefined && typeof statuses.get === 'function'
            ? statuses.get(row.id)
            : undefined;
          const state = row.archived ? null : rowStateOf(status, row);
          const dot = state === null ? null
            : StateDotComponent !== null
              ? h(StateDotComponent, { key: 'dot', state })
              : h('span', { key: 'dot', className: 'dsc-dot dsc-dot-on' });

          const actions = [];
          // 工作's trailing band starts with the shared ellipsis menu trigger,
          // then archive, then pin. Borrow the factory rather than drawing a
          // lookalike: the menu, its entries and its keyboard handling stay
          // DSH's, and an older shell simply has no trigger.
          const renderFactorySlot = props.renderFactorySlot;
          if (typeof renderFactorySlot === 'function') {
            const menuButton = renderFactorySlot('contextMenu.button', {
              target: {
                kind: 'session',
                value: { sessionId: row.id, displayTitle: row.displayTitle || row.id },
              },
              label: t('moreActions'),
              className: 'dsc-rowact',
            });
            if (menuButton !== null && menuButton !== undefined) {
              actions.push(h(React.Fragment, { key: 'more' }, menuButton));
            }
          }
          const archiveGlyph = row.archived ? UnarchiveGlyph : ArchiveGlyph;
          if (canArchive && archiveGlyph !== null) {
            actions.push(h(RowActionButton, {
              key: 'archive',
              label: t(row.archived ? 'unarchive' : 'archive'),
              glyph: archiveGlyph,
              run: () => (row.archived ? props.onUnarchive : props.onArchive)(row.id),
            }));
          }
          if (canPin && !row.archived && PinGlyph !== null) {
            actions.push(h(RowActionButton, {
              key: 'pin',
              label: t(row.pinned ? 'unpin' : 'pin'),
              glyph: row.pinned && PinFilledGlyph !== null ? PinFilledGlyph : PinGlyph,
              run: () => (row.pinned ? props.onUnpin : props.onPin)(row.id),
            }));
          }

          return h('div', {
            key: row.id,
            className: 'dsc-row' + (row.archived ? ' dsc-row-archived' : ''),
            role: 'treeitem',
            'aria-selected': props.selected === true,
            'aria-description': row.archived ? t('archivedNotOpenable') : undefined,
            tabIndex: 0,
            onClick: open,
            onKeyDown: (event) => {
              if (event.target !== event.currentTarget) return;
              if (event.key !== 'Enter' && event.key !== ' ') return;
              if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
              event.preventDefault();
              open();
            },
          }, [
            // Same 16px leading cell 工作 gives every session row: blank when
            // idle, a spinner while running, an amber dot while waiting on the
            // user, a green one once work finishes unviewed.
            h('span', { key: 'slot', className: 'dsc-slot' }, dot),
            h('span', { key: 'title', className: 'dsc-rowtitle' }, row.displayTitle || row.id),
            // Trailing cell, the way a workspace row carries it: the title cell
            // keeps `flex:1` and clips, so the age (and the pin marker after it)
            // never squeeze the title to nothing and never wrap.
            h('span', { key: 'resting', className: 'dsc-rowresting' }, [
              h('span', { key: 'time', className: 'dsc-rowtime' }, timeLabel(row.updatedAt, props.now, t)),
              row.pinned && (PinFilledGlyph !== null || PinGlyph !== null) ? h('span', {
                key: 'pin',
                className: 'dsc-rowpin',
                role: 'img',
                'aria-label': t('pinned'),
                title: t('pinned'),
              }, h(PinFilledGlyph === null ? PinGlyph : PinFilledGlyph, { size: 14 })) : null,
            ]),
            actions.length === 0 ? null : h('span', {
              key: 'actions',
              className: 'dsc-rowactions',
              onClick: (event) => {
                event.stopPropagation();
              },
            }, actions),
          ]);
        }

        /**
         * The section header's 「视图选项」 control: which archived rows the list
         * shows. Same control, same three choices and same glyph as the workspace
         * browser's own view-options menu; absent when this deployment predates
         * the `Menu` primitive, in which case the list keeps the shipped default
         * (archived rows hidden).
         * @param props.filter - the current {@link ARCHIVED_FILTERS} value.
         * @param props.onFilter - switch the filter.
         * @param props.t - translate seat bound to {@link LOCALE_NS}.
         * @returns the filter button, or null.
         */
        function DailyViewOptions(props) {
          const t = props.t;
          const [open, setOpen] = React.useState(false);
          if (MenuComponent === null) return null;
          const filter = props.filter;
          const selectedIds = [{
            default: 'hide-archived',
            show: 'show-archived',
            only: 'only-archived',
          }[filter] ?? 'hide-archived'];
          const glyphIcon = (glyph) => (glyph === null ? undefined : h(glyph, {}));
          const items = [
            { type: 'label', id: 'filter-by', text: t('filterLabel') },
            { id: 'hide-archived', label: t('hideArchived'), icon: glyphIcon(ArchiveOffGlyph) },
            { id: 'show-archived', label: t('showArchived'), icon: glyphIcon(QueueGlyph) },
            { id: 'only-archived', label: t('onlyArchived'), icon: glyphIcon(ArchiveCheckGlyph) },
          ];
          const anchor = withTooltip(t('viewOptions'), h('button', {
            type: 'button',
            className: 'dsc-new',
            'aria-label': t('viewOptions'),
            title: t('viewOptions'),
            onClick: () => setOpen((value) => !value),
          }, SlidersGlyph === null ? '⋯' : h(SlidersGlyph, {})));
          return h(MenuComponent, {
            open,
            onClose: () => setOpen(false),
            items,
            selectedIds,
            onSelect: (id) => {
              if (id === 'hide-archived') props.onFilter('default');
              else if (id === 'show-archived') props.onFilter('show');
              else if (id === 'only-archived') props.onFilter('only');
              setOpen(false);
            },
            align: 'end',
            dense: true,
            portal: true,
            anchor,
          });
        }

        /**
         * The stop-and-archive confirmation the shipped browser raises when the
         * Host refuses to archive a session that is still working.
         *
         * It lists the work that would be stopped and does nothing until the
         * reader confirms; confirm calls the stop-and-archive form of the same
         * archive call, and a failure keeps the dialog open with the reason.
         * @param props.t - translate seat bound to {@link LOCALE_NS}.
         * @returns the dialog, or null when nothing is pending.
         */
        function ArchiveConfirm(props) {
          const t = props.t;
          const chat = useChatState();
          const request = chat.archiveRequest;
          const [busy, setBusy] = React.useState(false);
          const [error, setError] = React.useState(null);
          React.useEffect(() => {
            setBusy(false);
            setError(null);
          }, [request === null ? null : request.sessionId]);
          if (request === null || ModalComponent === null) return null;

          const close = () => {
            if (busy) return;
            setState({ archiveRequest: null });
          };
          const confirm = () => {
            setBusy(true);
            setError(null);
            stopAndArchiveDaily(request.sessionId).catch((reason) => {
              setBusy(false);
              setError(describe(reason));
            });
          };
          const footerButton = (key, label, onClick) => (ButtonComponent === null
            ? h('button', { key, type: 'button', disabled: busy, onClick }, label)
            : h(ButtonComponent, { key, variant: 'outline', disabled: busy, onClick }, label));

          return h(ModalComponent, {
            open: true,
            onClose: close,
            closeLabel: t('cancel'),
            title: t('archiveConfirmTitle'),
            description: t('archiveConfirmDesc', { title: request.displayTitle }),
            footer: h(React.Fragment, null, [
              footerButton('cancel', t('cancel'), close),
              footerButton('confirm', t('archiveConfirmAction'), confirm),
            ]),
          }, [
            h('ul', {
              key: 'activity',
              className: 'dsc-archiveactivity',
              'aria-label': t('archiveConfirmActivity'),
            }, (Array.isArray(request.activity) ? request.activity : []).map((entry, index) => h('li', { key: String(index) }, archiveActivityLine(entry)))),
            busy ? h('div', { key: 'pending', className: 'dsc-archivestatus', role: 'status' }, t('archiveConfirmPending')) : null,
            error === null ? null : h('div', {
              key: 'error',
              className: 'dsc-archiveerror',
              role: 'alert',
            }, error),
          ]);
        }

        /**
         * The session list that stands in for the workspace browser in chat mode.
         *
         * A row is that browser's own row: status dot, title, and the trailing
         * cell with the relative age and, when pinned, the pin marker — same
         * words, same thresholds, same 10px tertiary age, same hover swap that
         * puts the archive and pin actions where the age was. Rows are ordered
         * the browser's way (pinned first, then by recency) and filtered the
         * browser's way (archived hidden, mixed in, or alone). What is left out
         * is what a daily chat cannot do — and nothing else.
         */
        function DailyRegion(props) {
          const t = props.t;
          const wide = props.wide !== false;
          const workspaces = useWorkspacesOf(props);
          const sessions = useSessionsOf(props);
          const statuses = useStatusesOf(props);
          const chat = useChatState();
          // One clock for the whole list: every row's age is read against the
          // same instant, so two rows that are the same age never disagree.
          const now = useRelativeClock();

          const rows = dailyRows(workspaces, sessions, chat.archivedFilter);
          // The list paints one page at a time and adds a page whenever its
          // 1px end strip scrolls into view; see {@link usePagedRows}.
          const paged = usePagedRows(rows);
          const current = mainViewSessionId(sessions);

          /** Open a row: an archived chat is refused with the shipped notice. */
          const openRow = (row) => {
            if (row.archived) {
              notifyNotice(t('archivedNotOpenable'), 'warning');
              return;
            }
            openDaily(row.id);
          };

          const empty = chat.archivedFilter === 'only'
            ? h('div', { className: 'dsc-emptyarchived', key: 'empty' }, [
              ArchiveGlyph === null ? null : h(ArchiveGlyph, { key: 'glyph', size: 24 }),
              h('div', { key: 'text' }, t('noneArchived')),
              h('button', {
                key: 'others',
                type: 'button',
                className: 'dsc-emptylink',
                onClick: () => setArchivedFilter('default'),
              }, t('viewOthers')),
            ])
            : h('div', { className: 'dsc-empty', key: 'empty' }, chat.busy ? t('starting') : t('empty'));

          return h('div', { className: 'dsc-region' + (wide ? '' : ' dsc-rail') }, [
            h('style', { key: 'css' }, CSS),
            h('div', { className: 'dsc-head', key: 'head' }, [
              h('div', { className: 'dsc-title', key: 'title' }, t('dailyChats')),
              h('div', { className: 'dsc-headactions', key: 'actions' }, [
                h(DailyViewOptions, {
                  key: 'filter',
                  filter: chat.archivedFilter,
                  onFilter: setArchivedFilter,
                  t,
                }),
                // The shipped header's add control: same glyph, same two sizes
                // (16 in the expanded sidebar, 18 in the collapsed rail), same
                // hover-only paint — a text button here would be the one row of
                // the sidebar that speaks a different language.
                h('button', {
                  key: 'new',
                  type: 'button',
                  className: 'dsc-new',
                  title: t('newChat'),
                  'aria-label': t('newChat'),
                  onClick: () => {
                    void startDailyChat();
                  },
                }, AddGlyph === null ? '＋' : h(AddGlyph, { size: wide ? 16 : 18 })),
              ]),
            ]),
            // The wrapper the shipped browser wraps its own list in; see the
            // `.dsc-listArea` rule for why the scrollbar needs it.
            h('div', { className: 'dsc-listArea', key: 'listArea' },
              h('div', {
                className: 'dsc-list',
                key: 'list',
                ref: paged.listRef,
                role: 'tree',
                'aria-label': t('dailyChats'),
              }, rows.length === 0 ? empty
                : rows.slice(0, paged.visible).map((row) => h(DailyRow, {
                  key: row.id,
                  row,
                  now,
                  selected: row.id === current,
                  t,
                  useSessionAccess: props.useSessionAccess,
                  renderFactorySlot: props.renderFactorySlot,
                  statuses,
                  onOpen: openRow,
                  onArchive: archiveDaily,
                  onUnarchive: unarchiveDaily,
                  onPin: pinDaily,
                  onUnpin: unpinDaily,
                })).concat(paged.more ? [h('div', {
                  key: 'more',
                  className: 'dsc-pager',
                  ref: paged.sentinelRef,
                  'aria-hidden': 'true',
                })] : []))),
          ]);
        }

        /* ── registration ─────────────────────────────────────────────────── */

        // The labeled entry points: two rows at the TOP of the sidebar's global
        // panel list — above 「插件」, which sits at order 0 — rendered by the
        // shell as icon + label. CSS bends the pair into one horizontal capsule;
        // the shell still owns both buttons and their `selectPanel(id)` clicks,
        // so each panellist id MUST address a registered `main` panel or that
        // call throws; each pair of registrations is therefore one unit. The
        // rest of the panel list — 「插件」「自动化任务」 and DSH's native
        // 「更多」 menu included — is the shell's and is left alone.
        ctx.slots.inject('sidebar', () => ctx.slots.register({
          name: 'sidebar.panellist',
          id: DAILY_PANEL,
          order: -20,
          label: () => t('modeChat'),
          locale: LOCALE_NS,
        }, ChatGlyph));

        ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main',
          key: DAILY_PANEL,
          locale: LOCALE_NS,
        }, DailyStarter));

        // The other half of the mode switch, as a sibling row: 「开始工作」.
        // Same seat, same constraint — the row needs a panel to address, and
        // that panel is the one that actually performs the switch.
        ctx.slots.inject('sidebar', () => ctx.slots.register({
          name: 'sidebar.panellist',
          id: WORK_PANEL,
          order: -10,
          label: () => t('modeWork'),
          locale: LOCALE_NS,
        }, WorkGlyph));

        ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main',
          key: WORK_PANEL,
          locale: LOCALE_NS,
        }, WorkStarter));

        // The keyboard route between the two modes. Registering through DSH's
        // shortcut service — instead of a private `keydown` listener — is what
        // makes the binding visible and rebindable in Settings → Keyboard
        // shortcuts, where all plugin commands are listed, and what keeps
        // composition, modal layers and other bindings arbitrated in one place.
        // `primary` is Ctrl on Windows/Linux and Command on macOS, so the
        // default is Ctrl+Alt+D on this machine. Web/Linux only admits a small
        // set of bindings, so that profile is deliberately left unbound.
        ctx.inject(['shortcuts'], (shortcutsCtx) => {
          shortcutsCtx.effect(() => {
            try {
              return shortcutsCtx.shortcuts.register({
                id: 'daily-chat.toggleMode',
                label: () => t('toggleMode'),
                aliases: ['toggle chat work mode', 'switch mode'],
                defaults: {
                  'desktop:macos': { code: 'KeyD', modifiers: ['primary', 'alt'] },
                  'desktop:windows': { code: 'KeyD', modifiers: ['primary', 'alt'] },
                  'desktop:linux': { code: 'KeyD', modifiers: ['primary', 'alt'] },
                  'web:macos': { code: 'KeyD', modifiers: ['primary', 'alt'] },
                  'web:windows': { code: 'KeyD', modifiers: ['primary', 'alt'] },
                },
                regions: ['page', 'editable', 'terminal'],
                modals: [],
                resolve: () => ({ status: 'handled', run: toggleMode }),
              });
            } catch (reason) {
              // A future DSH may claim KeyD or tighten its binding rules. Losing
              // the shortcut must not take the capsule or the rest of the plugin
              // down with it.
              console.warn('[daily-chat] registering the mode-toggle shortcut failed:', reason);
              return undefined;
            }
          }, 'daily-chat: toggle mode shortcut');
        });

        ctx.slots.inject('shell.overlay', () => ctx.slots.register({
          name: 'shell.overlay',
          id: 'daily-chat-chrome',
          order: 1,
        }, ChromeStyle));

        // The conversation view row's own 「更多」 menu: same idea, different menu.
        // It strips the two plugin-discovery rows and retires the launcher while
        // it would open empty.
        ctx.slots.inject('shell.overlay', () => ctx.slots.register({
          name: 'shell.overlay',
          id: 'daily-chat-view-actions',
          order: 4,
        }, ViewActions));

        // And the launcher itself: while a session header is mounted, decide up
        // front whether anything is folded behind the 「更多」, and hide it when
        // nothing is. Hangs off the header's actions seat purely to know when a
        // tab row exists; it paints nothing.
        ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({
          name: 'conversation.session.header.actions',
          id: 'daily-chat-view-more',
        }, ViewMoreWatch));

        ctx.slots.inject('shell.overlay', () => ctx.slots.register({
          name: 'shell.overlay',
          id: 'daily-chat-error',
          order: 50,
          locale: LOCALE_NS,
        }, ErrorToast));

        // The row-action notice, painted through the shipped `Toast` primitive
        // so an archive reads exactly like the one 工作 raises — same sentence,
        // same inline 「撤销 / 或 筛选已归档会话」 actions, same place.
        ctx.slots.inject('shell.overlay', () => ctx.slots.register({
          name: 'shell.overlay',
          id: 'daily-chat-row-toast',
          order: 50,
          locale: LOCALE_NS,
        }, RowActionToast));

        // The stop-and-archive confirmation, the same overlay entry the shipped
        // browser registers for its own archive action. It only ever paints
        // something while `state.archiveRequest` holds a refused archive.
        ctx.slots.inject('shell.overlay', () => ctx.slots.register({
          name: 'shell.overlay',
          id: 'daily-chat-archive-confirm',
          order: 51,
          locale: LOCALE_NS,
        }, ArchiveConfirm));

        // Only one entry renders a `single` slot, and it is the LOWEST live
        // priority — so `-1` takes the region over for chat mode and giving the
        // registration back puts the shipped workspace browser in charge again.
        let region = null;
        function refreshRegion() {
          if (state.mode === 'daily') {
            if (region === null) {
              region = ctx.slots.register({
                name: 'sidebar.workspaces',
                priority: -1,
                locale: LOCALE_NS,
              }, DailyRegion);
            }
            return;
          }
          if (region !== null) {
            region();
            region = null;
          }
        }

        ctx.slots.inject('sidebar.workspaces', () => {
          refreshRegion();
          listeners.add(refreshRegion);
          return () => {
            listeners.delete(refreshRegion);
            if (region !== null) {
              region();
              region = null;
            }
          };
        });

        // The elapsed line in a settled Turn's footer — its two faces.
        //
        // `conversation.chat.turnTail` is the seat DSH paints once per settled
        // Turn; the `turn` it hands over is the same Turn location the shipped
        // process header reads its duration from, so nothing has to be
        // subscribed to, stored or recomputed here. What is registered on it is
        // the carrier: the numbers, plus the line as it looks when the action
        // row below is not there to paint into.
        //
        // `conversation.chat.assistant-actions` is the other face, and the only
        // seat DSH renders *inside* the copy/branch/time row itself. Reading the
        // carrier back from there is what puts the figure on the row's own line,
        // after the usage figure and the clock, instead of on a line of its own.
        // Both seats are registered for both modes on purpose: the figure is
        // DSH's own and the line only ever repeats what the shipped header would
        // have shown had the default display modes not folded it away.
        ctx.slots.inject('conversation.chat.turnTail', () => ctx.slots.register({
          name: 'conversation.chat.turnTail',
          id: TURN_CONTRIBUTION,
          order: TURN_ORDER,
          locale: LOCALE_NS,
        }, TurnDuration));
        ctx.slots.inject('conversation.chat.assistant-actions', () => ctx.slots.register({
          name: 'conversation.chat.assistant-actions',
          id: TURN_INLINE_CONTRIBUTION,
          order: TURN_ORDER,
          locale: LOCALE_NS,
        }, TurnElapsed));

        // Two shipped navigation methods carry chat mode's two refusals.
        //
        // `startSession` is where every New Session entry point lands — the
        // sidebar shell's own button included — so that is where 日常 has to be
        // honoured. `openWorkspace` is where every project switch lands: the
        // new-chat row's 项目 chip, the empty composer's workspace prompt and
        // the directory picker all funnel into it, and a daily chat may not
        // leave its own workspace through any of them. Both patches live on the
        // service PROTOTYPE: Cordis hands each consumer a fresh traceable proxy
        // of one shared instance, and the sidebar captured its proxy long
        // before this plugin loaded.
        ctx.inject(['uiWorkspace'], (workspaceCtx) => {
          workspaceCtx.effect(() => {
            const proto = Object.getPrototypeOf(workspaceCtx.uiWorkspace);
            const original = proto === null ? undefined : proto.startSession;
            if (typeof original !== 'function') return undefined;
            const originalOpenWorkspace = proto.openWorkspace;

            originalStartSession = original;
            proto.startSession = function startSession(workspaceId) {
              if (state.mode === 'daily' && !starting) {
                void startDailyChat();
                return undefined;
              }
              return original.call(this, workspaceId);
            };

            // Refused rather than redirected: the caller asked for another
            // project, and the honest answer is that a daily chat does not have
            // one. The rejection is also what puts the pickers back in step —
            // they clear the choice they optimistically showed on a rejection —
            // and the toast is the only place the reason can be read, since the
            // pickers swallow their own failure.
            if (typeof originalOpenWorkspace === 'function') {
              proto.openWorkspace = function openWorkspace(workspaceId, beforeOpen) {
                if (state.mode === 'daily' && !staysDaily(workspaceId)) {
                  const refusal = new Error(t('lockedProject'));
                  setState({ error: refusal.message });
                  return Promise.reject(refusal);
                }
                return originalOpenWorkspace.call(this, workspaceId, beforeOpen);
              };
            }

            return () => {
              proto.startSession = original;
              if (typeof originalOpenWorkspace === 'function') {
                proto.openWorkspace = originalOpenWorkspace;
              }
              originalStartSession = undefined;
            };
          }, 'daily-chat: New Session routing and the project lock');
        });

        // Work mode does not list the daily workspace.
        //
        // The filter sits on the model PROTOTYPE for the same reason the two
        // navigation patches do: Cordis hands each consumer a fresh traceable
        // proxy of one shared model, and the sidebar published its own proxy as
        // the `workspaces` hook long before this plugin loaded. Only the shared
        // prototype reaches it — and the hook calls `getSnapshot()` through that
        // proxy on every read, so the projection needs no resubscription to take
        // effect.
        ctx.inject(['workspaces'], (workspaceCtx) => {
          workspaceCtx.effect(() => {
            const model = workspaceCtx.workspaces.list;
            const proto = model === null || model === undefined ? null : Object.getPrototypeOf(model);
            const original = proto === null ? undefined : proto.getSnapshot;
            if (typeof original !== 'function') return undefined;
            // The session projection below needs the daily workspace's own
            // account, so keep a way back to the unfiltered read.
            readRawWorkspaces = () => original.call(model);
            proto.getSnapshot = function getSnapshot() {
              return visibleWorkspaces(original.call(this));
            };
            return () => {
              proto.getSnapshot = original;
              readRawWorkspaces = undefined;
            };
          }, 'daily-chat: work mode hides the daily workspace');
        });

        // The daily chats go with the workspace.
        //
        // This store is an OBJECT, not a class instance — `createSnapshotStore`
        // hands back an object literal with `getSnapshot` on it — so unlike the
        // three patches above this one replaces the method on the object itself.
        // That is enough: the browser publishes this very object as the
        // `sessions` hook (`provideRoot({ hooks: { sessions: sessions.list } })`),
        // so every `useSessions` reader sees the projection.
        ctx.inject(['sessions'], (sessionCtx) => {
          sessionCtx.effect(() => {
            const store = sessionCtx.sessions.list;
            if (store === null || store === undefined) return undefined;
            const original = store.getSnapshot;
            if (typeof original !== 'function') return undefined;
            try {
              store.getSnapshot = function getSnapshot() {
                return visibleSessions(original.call(this));
              };
            } catch (reason) {
              console.warn('[daily-chat] hiding the daily chats from work mode failed:', reason);
              return undefined;
            }
            return () => {
              try {
                store.getSnapshot = original;
              } catch (reason) {
                console.warn('[daily-chat] restoring the session list failed:', reason);
              }
            };
          }, 'daily-chat: work mode hides the daily chats');
        });
      },
    };
  },
});
