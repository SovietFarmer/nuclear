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
    // Spell Cast Settings
    { type: "slider", uid: "SpellCastDelay", text: "Spell Cast Delay (ms)", min: 0, max: 1000, default: 0 },
    { type: "slider", uid: "SpellQueueExpirationTimer", text: "Spell Queue Expiration Timer (ms)", min: 2000, max: 5000, default: 3000 },
    { type: "checkbox", uid: "SpellDebugCompare", text: "Log Default Rotation Comparison", default: false },
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
      { header: "Spell Casting", options: this.options.slice(5, 8) },
      { header: "Cache Settings", options: [this.options[8]] },
      { header: "Interrupt", options: this.options.slice(9, 11) },
      { header: "Dispel", options: [this.options[11]] },
      { header: "Healthstone", options: [this.options[12]] },
    ]);
  }

  static tick() {
    this.general();
  }

  static general() {
    this.handleAutoTargetSwitch();
    this.handleHealthstone();
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
