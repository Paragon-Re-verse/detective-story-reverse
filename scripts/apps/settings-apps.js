import { TEMPLATE_PATH } from "../constants.js";
import { localize, fullKey } from "../i18n.js";
import { DetectiveApplication } from "./base-application.js";
import { getSetting, setSetting, SETTING_KEYS } from "../settings.js";
import { getPlayerUsers, canCreateDrawingsDirectly } from "../permissions.js";

/**
 * Право профайлера выдаётся на весь мир; профайлеров может быть несколько.
 */
export class ProfilersConfig extends DetectiveApplication {
  static DEFAULT_OPTIONS = {
    id: "detective-story-profilers",
    tag: "form",
    classes: ["profilers-config"],
    window: { icon: "fa-solid fa-user-secret", title: fullKey("Settings.Profilers.Name"), resizable: false, contentClasses: ["standard-form"] },
    position: { width: 420, height: "auto" },
    form: {
      handler: ProfilersConfig.#onSubmit,
      closeOnSubmit: true
    }
  };

  static PARTS = {
    form: { template: `${TEMPLATE_PATH}/apps/profilers-config.hbs` },
    footer: { template: "templates/generic/form-footer.hbs" }
  };

  /** @inheritDoc */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const profilerIds = getSetting(SETTING_KEYS.profilers) ?? [];
    return Object.assign(context, {
      players: getPlayerUsers().map((user) => ({ id: user.id, name: user.name, checked: profilerIds.includes(user.id) })),
      buttons: [{ type: "submit", icon: "fa-solid fa-floppy-disk", label: fullKey("Common.Save") }]
    });
  }

  static async #onSubmit(event, form) {
    const profilerIds = [...form.querySelectorAll("input[name='profiler']:checked")].map((input) => input.value);
    await setSetting(SETTING_KEYS.profilers, profilerIds);
  }
}

/**
 * Предупреждение о правах игроков: какие игроки не могут создавать карточки доски сами
 * (нет DRAWING_CREATE, FILES_BROWSE или FILES_UPLOAD) и работают с доской только при ведущем в сети.
 */
export class PermissionsWarning extends DetectiveApplication {
  static DEFAULT_OPTIONS = {
    id: "detective-story-permissions",
    classes: ["permissions-warning"],
    window: { icon: "fa-solid fa-user-lock", title: fullKey("Permissions.Title"), resizable: false },
    position: { width: 560, height: "auto" },
    actions: {
      dismiss: PermissionsWarning.#onDismiss,
      disableWarning: PermissionsWarning.#onDisableWarning
    }
  };

  static PARTS = {
    content: { template: `${TEMPLATE_PATH}/apps/permissions-warning.hbs` }
  };

  /** Есть ли игроки без прав на самостоятельное создание карточек. */
  static hasRestrictedPlayers() {
    return getPlayerUsers().some((user) => !canCreateDrawingsDirectly(user));
  }

  /** @inheritDoc */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const roleLabels = {};
    for (const [roleName, roleValue] of Object.entries(CONST.USER_ROLES)) {
      roleLabels[roleValue] = game.i18n.localize(`USER.Role${roleName.titleCase()}`);
    }
    const players = getPlayerUsers().map((user) => ({
      name: user.name,
      roleName: roleLabels[user.role] ?? String(user.role),
      canDraw: user.can("DRAWING_CREATE"),
      canBrowse: user.can("FILES_BROWSE"),
      canUpload: user.can("FILES_UPLOAD"),
      direct: canCreateDrawingsDirectly(user)
    }));
    return Object.assign(context, { players, allDirect: players.every((player) => player.direct) });
  }

  static #onDismiss() {
    this.close();
  }

  static async #onDisableWarning() {
    await setSetting(SETTING_KEYS.showSetupWarning, false);
    ui.notifications.info(localize("Permissions.Disabled"));
    this.close();
  }
}
