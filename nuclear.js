import { BehaviorContext } from "./Core/Behavior";
import BehaviorBuilder from "./Core/BehaviorBuilder";
import objMgr, { me } from "./Core/ObjectManager";
import { flagsComponents } from "./Core/Util";
import colors from "./Enums/Colors";
import { defaultHealTargeting } from "./Targeting/HealTargeting";
import { defaultCombatTargeting } from "./Targeting/CombatTargeting";
import { renderBehaviorTree } from "./Debug/BehaviorTreeDebug";
import settings from "@/Core/Settings";
import KeyBinding from "@/Core/KeyBinding";
import drTracker from "./Core/DRTracker";
import cooldownTracker from "./Core/CooldownTracker";

export let availableBehaviors = [];

// Make drTracker globally accessible
globalThis.drTracker = drTracker;
// Make cooldownTracker globally accessible
globalThis.cooldownTracker = cooldownTracker;

class Nuclear extends wow.EventListener {
  async initialize() {
    this.builder = new BehaviorBuilder();
    await this.builder.initialize();
    this.rebuild();
    this.isPaused = false;

    // Initialize DR tracker
    drTracker.initialize();

    // Initialize cooldown tracker
    cooldownTracker.initialize();

    KeyBinding.setDefault("burstToggle", imgui.Key.X);
  }

  tick() {
    if (!this.gameReady()) {
      return;
    }
    if (this.error) {
      const text = "ERROR\n".repeat(5);
      const displaySize = imgui.io.displaySize;
      const center = {x: displaySize.x / 2, y: displaySize.y / 2};
      const textSize = imgui.calcTextSize(text);
      const adjusted = {x: center.x - textSize.x / 2, y: center.y - textSize.y / 2};
      imgui.getBackgroundDrawList()?.addText(text, adjusted, colors.red);
      return;
    }

    if (!KeyBinding.isBinding()) {
      if (KeyBinding.isPressed("pause")) {
        this.isPaused = !this.isPaused;
        console.info(`Rotation ${this.isPaused ? 'paused' : 'resumed'}`);
      }
      if (KeyBinding.isPressed("burstToggle")) {
        defaultCombatTargeting.toggleBurst();
      }
    }

    const failPauseEnabled = settings.PauseRotationOnFailedCasts;
    const failPauseUntil = globalThis.__nuclearFailPauseUntil || 0;
    const failPaused = failPauseEnabled && failPauseUntil > wow.frameTime;
    const rotationPaused = this.isPaused || failPaused;

    // Draw pause indicator if paused
    if (rotationPaused) {
      const displaySize = imgui.io.displaySize;
      const remainingMs = Math.max(0, failPauseUntil - wow.frameTime);
      const pauseText = failPaused ? `BOT PAUSED (${Math.ceil(remainingMs)}ms)` : "ROTATION PAUSED";
      const textSize = imgui.calcTextSize(pauseText);

      // Log pause status periodically so we can verify timing behavior.
      if (failPaused && settings.FailedCastPauseDebugLogs) {
        const now = wow.frameTime;
        if (!this._lastFailPauseStatusLog || (now - this._lastFailPauseStatusLog) >= 250) {
          console.info(`Bot paused, ${Math.ceil(remainingMs)}ms remaining`);
          this._lastFailPauseStatusLog = now;
        }
      } else {
        this._lastFailPauseStatusLog = 0;
      }

      let drawPos = { x: (displaySize.x - textSize.x) / 2, y: displaySize.y / 2 };
      const meScreenPos = me ? wow.WorldFrame.getScreenCoordinates(me.position) : null;
      if (meScreenPos && meScreenPos.x !== -1 && meScreenPos.y !== -1) {
        // Draw near player feet, then nudge further down by ~10% of screen height.
        drawPos = {
          x: meScreenPos.x - textSize.x / 2,
          y: meScreenPos.y + (displaySize.y * 0.05)
        };
      }

      imgui.getBackgroundDrawList()?.addText(pauseText, drawPos, colors.yellow);
    }

    try {
      defaultHealTargeting?.update();
      defaultCombatTargeting?.update();
      drTracker.update();
      cooldownTracker.update();
      if (this.behaviorRoot && !rotationPaused) {
        this.behaviorRoot.execute(this.behaviorContext);
      }
    } catch (e) {
      this.error = true;
      this.behaviorRoot = null;
      console.error(`${e.message}`);
      console.error(`${e.stack}`);
    }
  }

  // Add method to render keybinding UI
  renderKeybindingUI() {
    imgui.text("Configure Hotkeys");
    imgui.separator();

    // Group layout
    if (imgui.collapsingHeader("Core Controls", imgui.TreeNodeFlags.DefaultOpen)) {
      // Add pause rotation key binding button
      KeyBinding.button("pause", "Pause Rotation");

      // Add pause core key binding button
      KeyBinding.button("pauseCore", "Pause Application");

      // Add toggle window key binding button
      KeyBinding.button("toggleWindow", "Toggle Nuclear Window");

      KeyBinding.button("toggleDebug", "Toggle Debug Window");

      KeyBinding.button("burstToggle", "Burst Toggle");
    }

    // Info about key binding
    imgui.spacing();
    imgui.separator();
    imgui.spacing();

    // Display binding status
    if (KeyBinding.isBinding()) {
      imgui.pushStyleColor(imgui.Col.Text, [1.0, 0.8, 0.0, 1.0]); // Yellow
      imgui.text("Press a key combination to bind (ESC to cancel)...");
      imgui.popStyleColor();
    } else {
      imgui.textWrapped("Click on a button and press any key combination to rebind. Press ESC to cancel binding.");
    }

    imgui.spacing();

    // Add reset buttons
    if (imgui.button("Reset All to Defaults")) {
      KeyBinding.resetAll();
    }

    // Add note about reserved keys
    imgui.spacing();
    imgui.textWrapped("Note: ESC is reserved for canceling binding mode and cannot be bound.");
  }

  rebuild() {
    objMgr.tick();
    if (me) {
      console.info('Rebuilding behaviors');

      const specializationId = wow.SpecializationInfo.activeSpecializationId;
      const profileKey = `profile${specializationId}`;

      // If no profile is set for this specialization, automatically set Nuclear Default
      if (!settings[profileKey] || settings[profileKey] === "None selected") {
        // Check if Nuclear Default behavior is available
        const defaultBehavior = this.builder.behaviors.find(b => b.name === "Nuclear Default");
        if (defaultBehavior) {
          settings[profileKey] = "Nuclear Default";
          console.info(`Auto-selected Nuclear Default for specialization ${specializationId}`);
        }
      }

      const { root, settings: behaviorSettings } = this.builder.build(specializationId, BehaviorContext.Normal);
      this.behaviorRoot = root;
      this.behaviorContext = {};
      this.behaviorSettings = behaviorSettings;
      availableBehaviors = this.builder.behaviors;
      defaultHealTargeting?.reset();
    }
  }

  onEvent(event) {
    if (event.name == 'PLAYER_ENTERING_WORLD') {
      this.rebuild();
    }
  }

  gameReady() {
    if (wow.GameUI.state != this.previous_state) {
      console.debug(`state changed to ${flagsComponents(wow.GameUI.state, 16)}`);
      this.previous_state = wow.GameUI.state;
    }
    // XXX: figure out game state flags, 0x211 is "in game" mask for retail
    if (wow.GameUI.state != 0x211) {
      return false;
    }

    return me ? true : false;
  }
}

export default new Nuclear();
