import { MODULE_ID, TEMPLATE_PATH, THREAD_COLORS } from "./constants.js";
import { localize, fullKey } from "./i18n.js";
import { toggleFocusMode, isFocusModeActive } from "./canvas/focus-mode.js";
import { getSetting, setSetting, SETTING_KEYS } from "./settings.js";
import { openClueList } from "./apps/clue-list.js";
import { openCaseJournal } from "./apps/case-journal.js";
import { openGameMasterWindow } from "./apps/gm-window.js";
import { listSuspects } from "./data/suspects.js";
import { isBoardScene } from "./board/board-scenes.js";
import { BoardState } from "./board/board-state.js";
import { createFreeCard, createSuspectCard } from "./board/clue-cards.js";
import { chooseSuspect } from "./board/pickers.js";

const { DialogV2 } = foundry.applications.api;
const { renderTemplate } = foundry.applications.handlebars;

/**
 * Группа «Детектив» в левой панели (в v13 хук getSceneControlButtons отдаёт объект).
 * Кнопки: «Список улик», «Журнал дела», «Режим сосредоточения» (переключатель), у ГМ — «Окно ГМ».
 * На сцене-доске — инструменты доски: режим доски, стикер, карточка подозреваемого, цвет нити.
 */
export function registerSceneControls() {
  Hooks.on("getSceneControlButtons", (controls) => {
    const onBoard = isBoardScene(canvas?.scene);
    controls.detective = {
      name: "detective",
      order: 20,
      title: fullKey("Controls.Group"),
      icon: "fa-solid fa-user-secret",
      activeTool: "select",
      tools: {
        select: { name: "select", order: 0, title: fullKey("Controls.Inspect"), icon: "fa-solid fa-arrow-pointer" },
        clueList: { name: "clueList", order: 1, title: fullKey("Controls.ClueList"), icon: "fa-solid fa-magnifying-glass", button: true, onChange: () => openClueList() },
        caseJournal: { name: "caseJournal", order: 2, title: fullKey("Controls.CaseJournal"), icon: "fa-solid fa-folder-open", button: true, onChange: () => openCaseJournal() },
        focus: {
          name: "focus",
          order: 3,
          title: fullKey("Controls.Focus"),
          icon: "fa-solid fa-eye",
          toggle: true,
          active: isFocusModeActive(),
          onChange: (event, active) => toggleFocusMode(active)
        },
        // Подписи над зонами (улика, проверка, СЛ, цепочка) — одним нажатием у ГМ (п. 5).
        zoneLabels: {
          name: "zoneLabels",
          order: 5,
          title: fullKey("Controls.ZoneLabels"),
          icon: "fa-solid fa-tags",
          toggle: true,
          active: Boolean(getSetting(SETTING_KEYS.zoneLabels)),
          visible: game.user.isGM,
          onChange: (event, active) => setSetting(SETTING_KEYS.zoneLabels, active)
        },
        gmWindow: {
          name: "gmWindow",
          order: 4,
          title: fullKey("Controls.GameMasterWindow"),
          icon: "fa-solid fa-user-tie",
          button: true,
          visible: game.user.isGM,
          onChange: () => openGameMasterWindow()
        },
        sticky: { name: "sticky", order: 11, title: fullKey("Controls.Sticky"), icon: "fa-solid fa-note-sticky", button: true, visible: onBoard, onChange: () => createFreeCard("sticky") },
        suspectCard: { name: "suspectCard", order: 12, title: fullKey("Controls.SuspectCard"), icon: "fa-solid fa-camera-retro", button: true, visible: onBoard, onChange: () => pickSuspectForBoard() },
        threadColor: { name: "threadColor", order: 13, title: fullKey("Controls.ThreadColor"), icon: "fa-solid fa-palette", button: true, visible: onBoard, onChange: () => chooseThreadColor() }
      }
    };
  });

  const resetControls = () => ui.controls?.render({ reset: true });
  Hooks.on("canvasReady", resetControls);
  Hooks.on("updateScene", (scene, changes) => {
    if (scene.id === canvas?.scene?.id && changes.flags?.[MODULE_ID]) resetControls();
  });
}

/** Горячие клавиши: по умолчанию не назначены, каждый назначает свои. */
export function registerKeybindings() {
  game.keybindings.register(MODULE_ID, "openClueList", {
    name: fullKey("Keybindings.ClueList"),
    editable: [],
    onDown: () => {
      openClueList();
      return true;
    }
  });
  game.keybindings.register(MODULE_ID, "openCaseJournal", {
    name: fullKey("Keybindings.CaseJournal"),
    editable: [],
    onDown: () => {
      openCaseJournal();
      return true;
    }
  });
  game.keybindings.register(MODULE_ID, "toggleFocus", {
    name: fullKey("Keybindings.Focus"),
    editable: [],
    onDown: () => {
      toggleFocusMode();
      return true;
    }
  });
  // Esc в активном списке улик снимает выделение (п. 11). В остальных случаях клавиша достаётся Foundry.
  game.keybindings.register(MODULE_ID, "clearClueSelection", {
    name: fullKey("Keybindings.ClearSelection"),
    editable: [{ key: "Escape" }],
    precedence: CONST.KEYBINDING_PRECEDENCE.PRIORITY,
    onDown: () => {
      const clueList = foundry.applications.instances.get("detective-story-clue-list");
      if (!clueList?.rendered || ui.activeWindow !== clueList) return false;
      return clueList.clearSelection();
    }
  });
  game.keybindings.register(MODULE_ID, "openGameMasterWindow", {
    name: fullKey("Keybindings.GameMasterWindow"),
    editable: [],
    restricted: true,
    onDown: () => {
      openGameMasterWindow();
      return true;
    }
  });
}

/** Фотокарточка подозреваемого в центре видимой области. */
async function pickSuspectForBoard() {
  const suspect = await chooseSuspect();
  if (suspect) await createSuspectCard(suspect);
}

/** Выбор цвета нити из палитры перед соединением карточек. */
async function chooseThreadColor() {
  const colors = Object.entries(THREAD_COLORS).map(([colorKey, colorValue]) => ({
    key: colorKey,
    value: colorValue,
    label: localize(`ThreadColors.${colorKey}`),
    selected: colorKey === BoardState.threadColor
  }));
  const content = await renderTemplate(`${TEMPLATE_PATH}/board/thread-color.hbs`, { colors });
  const colorKey = await DialogV2.wait({
    window: { title: localize("Controls.ThreadColor"), icon: "fa-solid fa-palette" },
    classes: ["detective-story", "thread-color-picker"],
    content,
    buttons: [
      {
        action: "confirm",
        label: localize("Common.Select"),
        icon: "fa-solid fa-check",
        default: true,
        callback: (event, button) => button.form.querySelector("input[name='threadColor']:checked")?.value ?? null
      }
    ],
    rejectClose: false
  });
  if (colorKey && THREAD_COLORS[colorKey]) BoardState.threadColor = colorKey;
}
