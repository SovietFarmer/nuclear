import Common from '@/Core/Common';
import ObjectManager, { me } from '@/Core/ObjectManager';
import Settings from '@/Core/Settings';
import { defaultCombatTargeting as combat } from '@/Targeting/CombatTargeting';

class General {
  static tabName = "General";

  static lastAutoTargetTime = 0;
  static lastHealthstone = 0;

  static options = [
    // Combat Behavior Settings
    { type: "checkbox", uid: "AttackOOC", text: "Attack Out of Combat", default: false },
    { type: "checkbox", uid: "AutoTargetSwitch", text: "Auto Target Switch", default: false },
    { type: "checkbox", uid: "RenderBestTargetCircle", text: "Render Best Target Circle", default: false },
    { type: "slider", uid: "TargetSwitchDelay", text: "Target Switch Delay (ms)", min: 0, max: 5000, default: 1000 },
    { type: "combobox", uid: "TargetPriority", text: "Target Priority", options: ["Closest", "Lowest Health", "Highest Health"], default: "Closest" },
    // Failed-cast behavior only — spell queue keybinds/timers live on the Spell Queue tab.
    { type: "checkbox", uid: "PauseRotationOnFailedCasts", text: "Pause rotation on failed casts", default: false },
    { type: "checkbox", uid: "AutoQueueFailedCasts", text: "Spell queue on failed spells", default: false },
    // Cache Settings
    { type: "slider", uid: "AuraCacheTimeMs", text: "Aura Cache Time (ms)", min: 1, max: 1000, default: 500 },
    // Interrupt Settings
    { type: "slider", uid: "InterruptPercentage", text: "Interrupt Percentage", min: 0, max: 100, default: 70 },
    { type: "combobox", uid: "InterruptMode", text: "Interrupt Mode", options: ["None", "Everything", "List"], default: "None" },
    // Dispel Settings
    { type: "combobox", uid: "DispelMode", text: "Dispel Mode", options: ["None", "Everything", "List"], default: "None" },
    // Healthstone Settings
    { type: "slider", uid: "HealthstonePercentage", text: "Healthstone Percentage", min: 0, max: 100, default: 0 },
  ];

  static renderOptions(renderFunction) {
    renderFunction([
      { header: "Combat Behavior", options: this.options.slice(0, 5) },
      { header: "Spell Casting", options: this.options.slice(5, 7) },
      { header: "Cache Settings", options: [this.options[7]] },
      { header: "Interrupt", options: this.options.slice(8, 10) },
      { header: "Dispel", options: [this.options[10]] },
      { header: "Healthstone", options: [this.options[11]] },
    ]);
  }

  static tick() {
    this.general();
  }

  static general() {
    this.migrateFailedCastSettings();

    // Pause-on-fail and auto-queue conflict; pause wins.
    if (Settings.PauseRotationOnFailedCasts && Settings.AutoQueueFailedCasts) {
      Settings.AutoQueueFailedCasts = false;
    }
    // Auto-queue requires the spell queue to be enabled (consumes the same queue).
    if (Settings.AutoQueueFailedCasts && !Settings.SpellQueueSystemEnabled) {
      Settings.AutoQueueFailedCasts = false;
    }

    this.handleAutoTargetSwitch();
    this.handleHealthstone();
  }

  /**
   * One-time: old "master" gated fail-pause on spell queue. Preserve prior effective behavior:
   * queue off + pause checked in JSON meant fail-pause was inactive — clear pause until user re-enables.
   */
  static migrateFailedCastSettings() {
    if (Settings.FailedCastRefactorMigrated) return;
    Settings.FailedCastRefactorMigrated = true;
    // Legacy: fail-pause only ran when spell queue was enabled; dormant "pause on" in settings had no effect.
    if (!Settings.SpellQueueSystemEnabled && Settings.PauseRotationOnFailedCasts) {
      Settings.PauseRotationOnFailedCasts = false;
      console.info(
        "[Nuclear] Failed-cast pause is now separate from the spell queue. " +
          "It was previously inactive while the queue was off — that setting was cleared. " +
          "Re-enable \"Pause rotation on failed casts\" under General → Spell Casting if you want it."
      );
    }
  }

  static handleAutoTargetSwitch() {
    const currentTime = wow.frameTime;
    if (Settings.AutoTargetSwitch && combat.bestTarget && currentTime - this.lastAutoTargetTime > Settings.TargetSwitchDelay) {
      wow.GameUI.setTarget(combat.bestTarget);
      this.lastAutoTargetTime = currentTime;
    }
  }

  static handleHealthstone() {
    if (Settings.HealthstonePercentage <= 0 || me.pctHealth > Settings.HealthstonePercentage || me.isDeadOrGhost) {
      return;
    }
    const currentTime = wow.frameTime;
    if (currentTime - this.lastHealthstone > 750) {
      if (!Common.useItemByName("Healthstone")) {
        Common.useItemByName("Invigorating Healing Potion");
      }
      this.lastHealthstone = currentTime;
    }
  }
}

export default General;
