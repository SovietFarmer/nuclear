import { Behavior, BehaviorContext } from "@/Core/Behavior";
import * as bt from '@/Core/BehaviorTree';
import Specialization from '@/Enums/Specialization';
import common from '@/Core/Common';
import spell from "@/Core/Spell";
import { me } from "@/Core/ObjectManager";
import { PowerType } from "@/Enums/PowerType";
import { defaultCombatTargeting as combat } from "@/Targeting/CombatTargeting";
import Settings from "@/Core/Settings";
import drTracker from "@/Core/DRTracker";
import pvpData, { pvpHelpers, pvpReflect, pvpInterrupts } from "@/Data/PVPData";
import { drHelpers } from "@/Data/PVPDRList";
import KeyBinding from "@/Core/KeyBinding";

const auras = {
  battleShout: 6673,
  enrage: 184362,
  whirlwind: 85739,
  thunderBlast: 435615,
  suddenDeath: 52437,
};

export class JmrSimcFuryBehavior extends Behavior {
  name = "Jmr SimC Warrior Fury";
  context = BehaviorContext.Any;
  specialization = Specialization.Warrior.Fury;
  version = 1;
  
  // Runtime toggles for overlay (independent of settings)
  overlayToggles = {
    showOverlay: new imgui.MutableVariable(false),
    interrupts: new imgui.MutableVariable(true),
    defensives: new imgui.MutableVariable(true),
    recklessness: new imgui.MutableVariable(true),
    avatar: new imgui.MutableVariable(true),
    pummel: new imgui.MutableVariable(true),
    stormBolt: new imgui.MutableVariable(true)
  };

  // Burst toggle system
  burstToggleTime = 0;
  
  constructor() {
    super();
    // Initialize the burst toggle keybinding with default
    KeyBinding.setDefault("BurstToggleKeybind", imgui.Key.F1);
    // Safety default: always start this profile in PvE mode.
    if (Settings.EnablePVPRotation) {
      Settings.EnablePVPRotation = false;
      console.info("[JmrSimcFury] PvP rotation auto-disabled on load (default PvE).");
    }
  }
  
  // Manual spell casting
  spellIdInput = new imgui.MutableVariable("1161");
  
  static settings = [
    {
      header: "PVP Settings",
      options: [
        { type: "checkbox", uid: "EnablePVPRotation", text: "Enable PVP Rotation", default: false },
        { type: "slider", uid: "DefensiveStanceHealthPct", text: "Defensive Stance Health %", min: 20, max: 80, default: 50 },
        { type: "checkbox", uid: "UseBerserkerShout", text: "Use Berserker Shout for Healer", default: true },
        { type: "checkbox", uid: "UseHamstring", text: "Use Hamstring for Movement Control", default: true }
      ]
    },
    {
      header: "Defensive Abilities",
      options: [
        { type: "checkbox", uid: "UseRallyingCry", text: "Use Rallying Cry", default: true },
        { type: "slider", uid: "RallyingCryHealthPct", text: "Rallying Cry Health %", min: 10, max: 50, default: 30 },
        { type: "checkbox", uid: "UseVictoryRush", text: "Use Victory Rush", default: true },
        { type: "slider", uid: "VictoryRushHealthPct", text: "Victory Rush Health %", min: 30, max: 90, default: 70 },
        { type: "checkbox", uid: "UseEnragedRegeneration", text: "Use Enraged Regeneration", default: true },
        { type: "slider", uid: "EnragedRegenerationHealthPct", text: "Enraged Regeneration Health %", min: 30, max: 80, default: 60 },
        { type: "checkbox", uid: "UseBloodthirstHealing", text: "Use Bloodthirst for Healing", default: true },
        { type: "slider", uid: "BloodthirstHealingHealthPct", text: "Bloodthirst Healing Health %", min: 40, max: 90, default: 70 }
      ]
    },
    {
      header: "Interrupts & Utility",
      options: [
        { type: "checkbox", uid: "UsePummel", text: "Use Pummel (Interrupt)", default: true },
        { type: "checkbox", uid: "UseStormBoltInterrupt", text: "Use Storm Bolt (Interrupt)", default: true }
      ]
    },
    {
      header: "Major Cooldowns", 
      options: [
        { type: "checkbox", uid: "UseRecklessness", text: "Use Recklessness", default: true },
        { type: "checkbox", uid: "UseAvatar", text: "Use Avatar", default: true }
      ]
    },
    {
      header: "Burst Toggle System",
      options: [
        { type: "hotkey", uid: "BurstToggleKeybind", text: "Burst Toggle Key", default: imgui.Key.X },
        { type: "checkbox", uid: "BurstModeWindow", text: "Use Window Mode (unchecked = Toggle Mode)", default: false },
        { type: "slider", uid: "BurstWindowDuration", text: "Burst Window Duration (seconds)", min: 5, max: 60, default: 15 },
        { type: "checkbox", uid: "BurstIncludeBloodFury", text: "Include Blood Fury in Burst", default: true }
      ]
    },
    {
      header: "Time to Death Settings",
      options: [
        { type: "checkbox", uid: "IgnoreTimeToDeath", text: "Ignore Time to Death (Use abilities regardless)", default: false },
        { type: "slider", uid: "MinTimeToDeath", text: "Minimum Time to Death (seconds)", min: 5, max: 60, default: 15 }
      ]
    }
  ];

  build() {    
    return new bt.Selector(
      new bt.Action(() => {
        this.renderOverlay();
        
        const target = this.getCurrentTarget();

        if (imgui.isKeyPressed(imgui.Key.RightArrow)) {
          const target = me.targetUnit || me;
          const spellId = parseInt(this.spellIdInput.value, 10);
          const spellObject = spell.getSpell(spellId);

          if (spellObject) {
            const spellName = spellObject.name || "Unknown Spell";
            console.log(`Casting spell "${spellName}" (ID: ${spellId}) on ${target.unsafeName}`);
            spell.castPrimitive(spellObject, target);
          } else {
            console.log(`Spell ID ${spellId} not found. Please enter a valid spell ID.`);
          }
        }

        // Handle burst toggle system
        this.handleBurstToggle();
        
        return bt.Status.Failure; // Always continue to the rest of the rotation
      }),
      
      common.waitForNotMounted(),
      new bt.Action(() => {
        if (this.getCurrentTarget() === null) {
          return bt.Status.Success;
        }
        return bt.Status.Failure;
      }),
      common.waitForCastOrChannel(),
      
      // PVP rotation takes priority if enabled
      new bt.Decorator(
        () => Settings.EnablePVPRotation,
        this.buildPVPRotation(),
        new bt.Action(() => bt.Status.Success)
      ),
      
      // Standard rotation if PVP is disabled
      new bt.Decorator(
        () => !Settings.EnablePVPRotation,
        new bt.Selector(
          // Defensive abilities
          this.buildDefensives(),

          new bt.Decorator(
            () => !spell.isGlobalCooldown(),
            new bt.Selector(
              common.waitForNotWaitingForArenaToStart(),
              common.waitForCombat(),

              // Trinkets and racials
              new bt.Decorator(
                () => this.shouldUseAvatar() && (me.hasAura("Recklessness") || me.hasAura("Avatar")),
                this.useTrinkets(),
                new bt.Action(() => bt.Status.Success)
              ),
              new bt.Decorator(
                () => this.shouldUseAvatar(),
                this.useRacials(),
                new bt.Action(() => bt.Status.Success)
              ),

              // Hero talent rotations (Thane first for Midnight pass)
              new bt.Decorator(
                () => this.hasTalent("Lightning Strikes"),
                this.thaneRotation(),
                new bt.Action(() => bt.Status.Success)
              ),
              new bt.Decorator(
                () => this.hasTalent("Slayer's Dominance"),
                this.slayerRotation(),
                new bt.Action(() => bt.Status.Success)
              )
            )
          )
        ),
        new bt.Action(() => bt.Status.Success)
      )
    );
  }

  renderOverlay() {
    // Safety check
    if (!me) return;
    
    if (!this.overlayToggles.showOverlay.value) {
      return;
    }

    const viewport = imgui.getMainViewport();
    if (!viewport) {
      return;
    }
    
    const workPos = viewport.workPos;
    const workSize = viewport.workSize;
    
    // Position overlay in top-right corner
    const overlaySize = { x: 250, y: 220 };
    const overlayPos = { 
      x: workPos.x + workSize.x - overlaySize.x - 20, 
      y: workPos.y + 20 
    };

    imgui.setNextWindowPos(overlayPos, imgui.Cond.FirstUseEver);
    imgui.setNextWindowSize(overlaySize, imgui.Cond.FirstUseEver);
    
    // Make background more opaque
    imgui.setNextWindowBgAlpha(0.30);
    
    // Window flags for overlay behavior
    const windowFlags = 
      imgui.WindowFlags.NoResize |
      imgui.WindowFlags.AlwaysAutoResize;

    if (imgui.begin("Fury Warrior Controls", this.overlayToggles.showOverlay, windowFlags)) {
      
      // Major Cooldowns section - collapsible
      if (imgui.collapsingHeader("Major Cooldowns", imgui.TreeNodeFlags.DefaultOpen)) {
        imgui.indent();
        
        // Recklessness toggle
        const reckColor = this.overlayToggles.recklessness.value ? 
          { r: 0.2, g: 1.0, b: 0.2, a: 1.0 } : { r: 1.0, g: 0.2, b: 0.2, a: 1.0 };
        imgui.pushStyleColor(imgui.Col.Text, reckColor);
        imgui.checkbox("Recklessness", this.overlayToggles.recklessness);
        imgui.popStyleColor();
        
        // Avatar toggle  
        const avatarColor = this.overlayToggles.avatar.value ?
          { r: 0.2, g: 1.0, b: 0.2, a: 1.0 } : { r: 1.0, g: 0.2, b: 0.2, a: 1.0 };
        imgui.pushStyleColor(imgui.Col.Text, avatarColor);
        imgui.checkbox("Avatar", this.overlayToggles.avatar);
        imgui.popStyleColor();
        
        imgui.unindent();
      }
      
      // Manual spell casting section - collapsible
      if (imgui.collapsingHeader("Manual Spell Casting")) {
        imgui.indent();
        
        imgui.text("Spell ID:");
        imgui.sameLine();
        imgui.setNextItemWidth(80);
        imgui.inputText("##spellId", this.spellIdInput);
        
        // Show spell name for current ID
        const currentSpellId = parseInt(this.spellIdInput.value, 10);
        if (currentSpellId > 0) {
          const currentSpellObject = spell.getSpell(currentSpellId);
          if (currentSpellObject) {
            const spellName = currentSpellObject.name || "Unknown Spell";
            imgui.textColored({ r: 0.2, g: 1.0, b: 0.2, a: 1.0 }, `"${spellName}"`);
          } else {
            imgui.textColored({ r: 1.0, g: 0.2, b: 0.2, a: 1.0 }, "Invalid Spell ID");
          }
        }
        
        imgui.text("Press RightArrow to cast");
        
        imgui.unindent();
      }
      
      // Interrupts section - collapsible
      if (imgui.collapsingHeader("Interrupts", imgui.TreeNodeFlags.DefaultOpen)) {
        imgui.indent();
        
        // Interrupts master toggle
        const interruptColor = this.overlayToggles.interrupts.value ?
          { r: 0.2, g: 1.0, b: 0.2, a: 1.0 } : { r: 1.0, g: 0.2, b: 0.2, a: 1.0 };
        imgui.pushStyleColor(imgui.Col.Text, interruptColor);
        imgui.checkbox("Interrupts", this.overlayToggles.interrupts);
        imgui.popStyleColor();
        
        // Individual interrupt toggles (indented)
        if (this.overlayToggles.interrupts.value) {
          imgui.indent();
          
          const pummelColor = this.overlayToggles.pummel.value ?
            { r: 0.2, g: 0.8, b: 1.0, a: 1.0 } : { r: 0.6, g: 0.6, b: 0.6, a: 1.0 };
          imgui.pushStyleColor(imgui.Col.Text, pummelColor);
          imgui.checkbox("Pummel", this.overlayToggles.pummel);
          imgui.popStyleColor();
          
          const stormBoltColor = this.overlayToggles.stormBolt.value ?
            { r: 0.2, g: 0.8, b: 1.0, a: 1.0 } : { r: 0.6, g: 0.6, b: 0.6, a: 1.0 };
          imgui.pushStyleColor(imgui.Col.Text, stormBoltColor);
          imgui.checkbox("Storm Bolt", this.overlayToggles.stormBolt);
          imgui.popStyleColor();
          
          imgui.unindent();
        }
        
        imgui.unindent();
      }

      // PVP Status section - always visible
      imgui.spacing();
      imgui.separator();
      
      // PVP Mode indicator
      if (Settings.EnablePVPRotation) {
        imgui.textColored({ r: 0.2, g: 1.0, b: 0.2, a: 1.0 }, "PVP MODE ACTIVE");
        
        // Show active PVP features
        const shatterTarget = this.findShatteringThrowTarget();
        if (shatterTarget) {
          imgui.textColored({ r: 1.0, g: 0.0, b: 0.0, a: 1.0 }, `Shattering Throw: ${shatterTarget.unsafeName}`);
        }
        
        const pummelTarget = this.findPummelTarget();
        if (pummelTarget) {
          imgui.textColored({ r: 1.0, g: 0.8, b: 0.2, a: 1.0 }, `Pummel Ready: ${pummelTarget.unsafeName}`);
        }
        
        if (this.shouldSpellReflectPVP()) {
          imgui.textColored({ r: 0.8, g: 0.2, b: 1.0, a: 1.0 }, "Spell Reflect Ready!");
        }
        

        
        // Show if current target has Blessing of Freedom
        const currentTarget = this.getCurrentTargetPVP();
        if (currentTarget && currentTarget.hasAura(1044)) {
          imgui.textColored({ r: 1.0, g: 1.0, b: 0.2, a: 1.0 }, `${currentTarget.unsafeName} has Freedom`);
        }
        
        // Show priority CC targets with cooldown info
        const priorityTarget = this.findEnhancedCCTarget();
        if (priorityTarget) {
          imgui.textColored({ r: 1.0, g: 0.2, b: 0.2, a: 1.0 }, `Priority CC: ${priorityTarget.name} (${priorityTarget.reason})`);
        }
        
        // Show immunity targets
        const immuneTarget = this.findImmuneTarget();
        if (immuneTarget) {
          imgui.textColored({ r: 0.6, g: 0.6, b: 0.6, a: 1.0 }, `Immune: ${immuneTarget.unsafeName}`);
        }
        
        // Show burst mode status (global burst toggle only)
        if (combat.burstToggle) {
          const statusText = Settings.BurstModeWindow ?
            `BURST WINDOW ACTIVE (${Math.max(0, Settings.BurstWindowDuration - Math.floor((wow.frameTime - this.burstToggleTime) / 1000))}s)` :
            "BURST TOGGLE ACTIVE";
          imgui.textColored({ r: 1.0, g: 0.2, b: 0.2, a: 1.0 }, statusText);
          if (imgui.button("Disable Burst", { x: 120, y: 0 })) {
            combat.burstToggle = false;
            this.burstToggleTime = 0;
            console.log("Burst mode DEACTIVATED via UI");
          }
        } else {
          const keyName = KeyBinding.formatKeyBinding(KeyBinding.keybindings["BurstToggleKeybind"]) || "F1";
          imgui.text(`Press ${keyName} to ${Settings.BurstModeWindow ? "start burst window" : "toggle burst"}`);
          if (imgui.button("Enable Burst", { x: 120, y: 0 })) {
            combat.burstToggle = true;
            if (Settings.BurstModeWindow) {
              this.burstToggleTime = wow.frameTime;
            }
            console.log("Burst mode ACTIVATED via UI");
          }
        }
      } else {
        imgui.textColored({ r: 0.6, g: 0.6, b: 0.6, a: 1.0 }, "PVE Mode");
      }
      
      imgui.spacing();
      
      // Quick controls
      if (imgui.button("Enable All", { x: 100, y: 0 })) {
        this.overlayToggles.interrupts.value = true;
        this.overlayToggles.defensives.value = true;
        this.overlayToggles.recklessness.value = true;
        this.overlayToggles.avatar.value = true;
        this.overlayToggles.pummel.value = true;
        this.overlayToggles.stormBolt.value = true;
      }
      
      imgui.sameLine();
      
      if (imgui.button("Disable All", { x: 100, y: 0 })) {
        this.overlayToggles.interrupts.value = false;
        this.overlayToggles.defensives.value = false;
        this.overlayToggles.recklessness.value = false;
        this.overlayToggles.avatar.value = false;
        this.overlayToggles.pummel.value = false;
        this.overlayToggles.stormBolt.value = false;
      }
      
      imgui.end();
    }
  }

  buildDefensives() {
    return new bt.Selector(
      // Battle Shout
      spell.cast("Battle Shout", () => !me.hasAura(auras.battleShout)),

      // Defensive abilities with user options
      spell.cast("Rallying Cry", () => Settings.UseRallyingCry && me.pctHealth < Settings.RallyingCryHealthPct),
      spell.cast("Victory Rush", () => Settings.UseVictoryRush && me.effectiveHealthPercent < Settings.VictoryRushHealthPct),
      spell.cast("Enraged Regeneration", () => Settings.UseEnragedRegeneration && me.pctHealth < Settings.EnragedRegenerationHealthPct),
      spell.cast("Bloodthirst", () => Settings.UseBloodthirstHealing && me.pctHealth < Settings.BloodthirstHealingHealthPct && me.hasAura("Enraged Regeneration")),

      // Interrupts only for PVE (not PVP) - respect both settings and overlay toggles
      new bt.Decorator(
        () => !Settings.EnablePVPRotation,
        new bt.Selector(
          new bt.Decorator(
            req => Settings.UsePummel && this.overlayToggles.interrupts.value && this.overlayToggles.pummel.value,
            spell.interrupt("Pummel"),
          ),
          new bt.Decorator(
            req => Settings.UseStormBoltInterrupt && this.overlayToggles.interrupts.value && this.overlayToggles.stormBolt.value,
            spell.interrupt("Storm Bolt"),
          ),
        ),
        new bt.Action(() => bt.Status.Success)
      )
    );
  }

  slayerRotation() {
    return new bt.Selector(
      // actions.slayer=recklessness
      spell.cast("Recklessness", req => Settings.UseRecklessness && this.overlayToggles.recklessness.value && this.shouldUseRecklessness() && this.shouldUseBurstAbility()),

      // actions.slayer+=/avatar,if=cooldown.recklessness.remains
      spell.cast("Avatar", req => Settings.UseAvatar && this.overlayToggles.avatar.value && this.shouldUseAvatar() && this.shouldUseBurstAbility() && spell.getCooldown("Recklessness").timeleft > 0),

      // AoE upkeep: keep Whirlwind buff active for cleave windows
      spell.cast("Whirlwind", on => this.getCurrentTarget(), req => this.getEnemiesInRange(8) >= 2 && me.getAuraStacks(auras.whirlwind) === 0),

      // Rampage priority: higher threshold in AoE, maintain Enrage uptime
      spell.cast("Rampage", on => this.getCurrentTarget(), req =>
        (this.getEnemiesInRange(8) >= 2 && me.powerByType(PowerType.Rage) >= 110) ||
        (this.getEnemiesInRange(8) < 2 && me.powerByType(PowerType.Rage) >= 100) ||
        !me.hasAura(auras.enrage) ||
        this.getAuraRemainingTime(auras.enrage) <= 1500
      ),
      
      // actions.slayer+=/execute,if=buff.ashen_juggernaut.up&buff.ashen_juggernaut.remains<=gcd
      spell.cast("Execute", on => this.getCurrentTarget(), req => me.hasAura("Ashen Juggernaut") && this.getAuraRemainingTime("Ashen Juggernaut") <= 1.5),
      
      // actions.slayer+=/champions_spear,if=buff.enrage.up&(cooldown.bladestorm.remains>=2|cooldown.bladestorm.remains>=16&debuff.marked_for_execution.stack=3)
      spell.cast("Champion's Spear", on => this.getCurrentTarget(), req => this.shouldUseChampionsSpear() && me.hasAura(auras.enrage) && (spell.getCooldown("Bladestorm").timeleft >= 2 || (spell.getCooldown("Bladestorm").timeleft >= 16 && this.getCurrentTarget().getAuraStacks("Marked for Execution") === 3))),
      
      // actions.slayer+=/ravager,if=buff.enrage.up (guarded for Midnight)
      spell.cast("Ravager", on => this.getCurrentTarget(), req => spell.isSpellKnown("Ravager") && me.hasAura(auras.enrage) && this.shouldUseBurstAbility()),
      
      // actions.slayer+=/bladestorm,if=buff.enrage.up&(talent.reckless_abandon&cooldown.avatar.remains>=24|talent.anger_management&cooldown.recklessness.remains>=18)
      spell.cast("Bladestorm", on => this.getCurrentTarget(), req => me.hasAura(auras.enrage) && ((this.hasTalent("Reckless Abandon") && spell.getCooldown("Avatar").timeleft >= 24) || (this.hasTalent("Anger Management") && spell.getCooldown("Recklessness").timeleft >= 18))),
      
      // actions.slayer+=/odyns_fury,if=(buff.enrage.up|talent.titanic_rage)&cooldown.avatar.remains
      spell.cast("Odyn's Fury", on => this.getCurrentTarget(), req => this.shouldUseOdynsFury() && (me.hasAura(auras.enrage) || this.hasTalent("Titanic Rage")) && spell.getCooldown("Avatar").timeleft > 0),

      // Midnight: prioritize Execute on Sudden Death procs and in execute phase
      spell.cast("Execute", on => this.getCurrentTarget(), req => me.hasAura(auras.suddenDeath) || this.isExecutePhase()),
      
      // actions.slayer+=/whirlwind,if=active_enemies>=2&talent.meat_cleaver&buff.meat_cleaver.stack=0
      spell.cast("Whirlwind", on => this.getCurrentTarget(), req => this.getEnemiesInRange(8) >= 2 && this.hasTalent("Meat Cleaver") && me.getAuraStacks(auras.whirlwind) === 0),
      
      // actions.slayer+=/execute,if=buff.sudden_death.stack=2&buff.sudden_death.remains<7
      spell.cast("Execute", on => this.getCurrentTarget(), req => me.getAuraStacks(auras.suddenDeath) === 2 && this.getAuraRemainingTime(auras.suddenDeath) < 7000),
      
      // actions.slayer+=/execute,if=buff.sudden_death.up&buff.sudden_death.remains<2
      spell.cast("Execute", on => this.getCurrentTarget(), req => me.hasAura(auras.suddenDeath) && this.getAuraRemainingTime(auras.suddenDeath) < 2000),
      
      // actions.slayer+=/execute,if=buff.sudden_death.up&buff.imminent_demise.stack<3&cooldown.bladestorm.remains<25
      spell.cast("Execute", on => this.getCurrentTarget(), req => me.hasAura(auras.suddenDeath) && me.getAuraStacks("Imminent Demise") < 3 && spell.getCooldown("Bladestorm").timeleft < 25),
      
      // actions.slayer+=/rampage,if=!buff.enrage.up|buff.slaughtering_strikes.stack>=4
      spell.cast("Rampage", on => this.getCurrentTarget(), req => !me.hasAura(auras.enrage) || me.getAuraStacks("Slaughtering Strikes") >= 4),
      
      // actions.slayer+=/crushing_blow,if=action.raging_blow.charges=2|buff.brutal_finish.up&(!debuff.champions_might.up|debuff.champions_might.up&debuff.champions_might.remains>gcd)
      spell.cast("Crushing Blow", on => this.getCurrentTarget(), req => spell.getCharges("Raging Blow") === 2 || (me.hasAura("Brutal Finish") && (!this.getCurrentTarget().hasAuraByMe("Champion's Might") || (this.getCurrentTarget().hasAuraByMe("Champion's Might") && this.getDebuffRemainingTime("Champion's Might") > 1.5)))),
      
      // actions.slayer+=/execute,if=debuff.marked_for_execution.stack=3
      spell.cast("Execute", on => this.getCurrentTarget(), req => this.getCurrentTarget().getAuraStacks("Marked for Execution") === 3),
      
      // actions.slayer+=/bloodbath,if=buff.bloodcraze.stack>=1|(talent.uproar&dot.bloodbath_dot.remains<40&talent.bloodborne)|buff.enrage.up&buff.enrage.remains<gcd
      spell.cast("Bloodbath", on => this.getCurrentTarget(), req => me.getAuraStacks(393951) >= 1 || (this.hasTalent("Uproar") && this.getDebuffRemainingTime("Bloodbath") < 40 && this.hasTalent("Bloodborne")) || (me.hasAura(auras.enrage) && this.getAuraRemainingTime(auras.enrage) < 1500)),
      
      // actions.slayer+=/raging_blow,if=buff.brutal_finish.up&buff.slaughtering_strikes.stack<5&(!debuff.champions_might.up|debuff.champions_might.up&debuff.champions_might.remains>gcd)
      spell.cast("Raging Blow", on => this.getCurrentTarget(), req => me.hasAura("Brutal Finish") && me.getAuraStacks("Slaughtering Strikes") < 5 && (!this.getCurrentTarget().hasAuraByMe("Champion's Might") || (this.getCurrentTarget().hasAuraByMe("Champion's Might") && this.getDebuffRemainingTime("Champion's Might") > 1.5))),
      
      // actions.slayer+=/bloodthirst,if=active_enemies>3
      spell.cast("Bloodthirst", on => this.getCurrentTarget(), req => this.getEnemiesInRange(8) > 3),
      
      // actions.slayer+=/rampage,if=action.raging_blow.charges<=1&rage>=100&talent.anger_management&buff.recklessness.down
      spell.cast("Rampage", on => this.getCurrentTarget(), req => spell.getCharges("Raging Blow") <= 1 && me.powerByType(PowerType.Rage) >= 100 && this.hasTalent("Anger Management") && !me.hasAura("Recklessness")),
      
      // actions.slayer+=/rampage,if=rage>=120|talent.reckless_abandon&buff.recklessness.up&buff.slaughtering_strikes.stack>=3
      spell.cast("Rampage", on => this.getCurrentTarget(), req => me.powerByType(PowerType.Rage) >= 120 || (this.hasTalent("Reckless Abandon") && me.hasAura("Recklessness") && me.getAuraStacks("Slaughtering Strikes") >= 3)),
      
      // actions.slayer+=/bloodbath,if=buff.bloodcraze.stack>=4|crit_pct_current>=85|active_enemies>2|buff.recklessness.up
      spell.cast("Bloodbath", on => this.getCurrentTarget(), req => me.getAuraStacks(393951) >= 4 || this.getCritPct() >= 85 || this.getEnemiesInRange(8) > 2 || me.hasAura("Recklessness")),
      
      // actions.slayer+=/crushing_blow
      spell.cast("Crushing Blow", on => this.getCurrentTarget()),
      
      // actions.slayer+=/bloodbath
      spell.cast("Bloodbath", on => this.getCurrentTarget()),
      
      // actions.slayer+=/raging_blow,if=buff.opportunist.up
      spell.cast("Raging Blow", on => this.getCurrentTarget(), req => me.hasAura("Opportunist")),
      
      // actions.slayer+=/bloodthirst,if=(target.health.pct<35&talent.vicious_contempt&buff.bloodcraze.stack>=2)|active_enemies>2
      spell.cast("Bloodthirst", on => this.getCurrentTarget(), req => (this.getCurrentTarget().pctHealth < 35 && this.hasTalent("Vicious Contempt") && me.getAuraStacks(393951) >= 2) || this.getEnemiesInRange(8) > 2),
      
      // Midnight: refresh Rend if missing or expiring
      spell.cast("Rend", on => this.getCurrentTarget(), req => spell.isSpellKnown("Rend") && (!this.getCurrentTarget().hasAuraByMe("Rend") || this.getDebuffRemainingTime("Rend") < 6000)),

      // actions.slayer+=/rampage,if=rage>=100&talent.anger_management&buff.recklessness.up
      spell.cast("Rampage", on => this.getCurrentTarget(), req => me.powerByType(PowerType.Rage) >= 100 && this.hasTalent("Anger Management") && me.hasAura("Recklessness")),
      
      // actions.slayer+=/bloodthirst,if=buff.bloodcraze.stack>=4|crit_pct_current>=85|buff.recklessness.up
      spell.cast("Bloodthirst", on => this.getCurrentTarget(), req => me.getAuraStacks(393951) >= 4 || this.getCritPct() >= 85 || me.hasAura("Recklessness")),
      
      // actions.slayer+=/raging_blow
      spell.cast("Raging Blow", on => this.getCurrentTarget()),
      
      // actions.slayer+=/wrecking_throw
      spell.cast("Wrecking Throw", on => this.getCurrentTarget()),
      
      // actions.slayer+=/bloodthirst
      spell.cast("Bloodthirst", on => this.getCurrentTarget()),
      
      // actions.slayer+=/rampage
      spell.cast("Rampage", on => this.getCurrentTarget()),
      
      // actions.slayer+=/execute
      spell.cast("Execute", on => this.getCurrentTarget()),
      
      // actions.slayer+=/whirlwind,if=talent.improved_whirlwind
      spell.cast("Whirlwind", on => this.getCurrentTarget(), req => this.hasTalent("Improved Whirlwind")),
      
      // actions.slayer+=/slam,if=!talent.improved_whirlwind
      spell.cast("Slam", on => this.getCurrentTarget(), req => !this.hasTalent("Improved Whirlwind")),
      
      // actions.slayer+=/storm_bolt,if=buff.bladestorm.up
      spell.cast("Storm Bolt", on => this.getCurrentTarget(), req => me.hasAura("Bladestorm"))
    );
  }

  thaneRotation() {
    return new bt.Selector(
      // Mountain Thane Midnight priority (Wowhead-aligned core order)
      spell.cast("Odyn's Fury", on => this.getCurrentTarget(), req => this.shouldUseOdynsFury()),

      // actions.thane=recklessness
      spell.cast("Recklessness", req => Settings.UseRecklessness && this.overlayToggles.recklessness.value && this.shouldUseRecklessness() && this.shouldUseBurstAbility()),
      
      // actions.thane+=/avatar
      spell.cast("Avatar", req => Settings.UseAvatar && this.overlayToggles.avatar.value && this.shouldUseAvatar() && this.shouldUseBurstAbility()),

      // During burst windows, Bloodbath is a high-value press
      spell.cast("Bloodbath", on => this.getCurrentTarget(), req => me.hasAura("Recklessness") || me.hasAura("Avatar")),
      
      // Rampage over 100 rage, if Enrage missing, or Enrage about to expire
      spell.cast("Rampage", on => this.getCurrentTarget(), req =>
        me.powerByType(PowerType.Rage) >= 100 ||
        !me.hasAura(auras.enrage) ||
        this.getAuraRemainingTime(auras.enrage) <= 1500
      ),
      
      // Thunder Blast proc aura: prioritize 2 stacks, or 1 stack during Avatar
      spell.cast("Thunder Blast", req => me.getAuraStacks(auras.thunderBlast) >= 2 || (me.getAuraStacks(auras.thunderBlast) >= 1 && me.hasAura("Avatar")), on => this.getCurrentTarget()),
      spell.cast("Thunder Clap", req => me.getAuraStacks(auras.thunderBlast) >= 2 || (me.getAuraStacks(auras.thunderBlast) >= 1 && me.hasAura("Avatar")), on => this.getCurrentTarget()),
      
      // AoE upkeep: Thunder Clap if Whirlwind buff is missing, or 6+ targets
      spell.cast("Thunder Clap", on => this.getCurrentTarget(), req =>
        (this.getEnemiesInRange(8) >= 3) ||
        (this.hasTalent("Meat Cleaver") && this.getEnemiesInRange(8) >= 2 && me.getAuraStacks(auras.whirlwind) === 0)
      ),
      
      // actions.thane+=/champions_spear,if=buff.enrage.up
      spell.cast("Champion's Spear", on => this.getCurrentTarget(), req => this.shouldUseChampionsSpear() && me.hasAura(auras.enrage) && this.shouldUseBurstAbility()),

      // Keep Execute visible in normal Thane flow (procs + execute phase)
      spell.cast("Execute", on => this.getCurrentTarget(), req => me.hasAura(auras.suddenDeath) || this.isExecutePhase()),

      // Thunder Blast proc aura: any remaining proc is still high value
      spell.cast("Thunder Blast", req => me.hasAura(auras.thunderBlast), on => this.getCurrentTarget()),
      spell.cast("Thunder Clap", req => me.hasAura(auras.thunderBlast), on => this.getCurrentTarget()),

      // Bloodthirst now has high Midnight priority
      spell.cast("Bloodthirst", on => this.getCurrentTarget()),

      // Dump rage to avoid capping even while Enraged
      spell.cast("Rampage", on => this.getCurrentTarget(), req => me.powerByType(PowerType.Rage) >= 100),
      
      // actions.thane+=/execute,if=talent.ashen_juggernaut
      spell.cast("Execute", on => this.getCurrentTarget(), req => this.hasTalent("Ashen Juggernaut")),

      // actions.thane+=/thunder_blast
      spell.cast("Thunder Blast", on => this.getCurrentTarget()),

      // actions.thane+=/execute,if=talent.ashen_juggernaut&buff.ashen_juggernaut.remains<=gcd
      spell.cast("Execute", on => this.getCurrentTarget(), req => this.hasTalent("Ashen Juggernaut") && this.getAuraRemainingTime("Ashen Juggernaut") <= 1.5),
      
      // actions.thane+=/rampage,if=talent.bladestorm&cooldown.bladestorm.remains<=gcd&!debuff.champions_might.up
      spell.cast("Rampage", on => this.getCurrentTarget(), req => this.hasTalent("Bladestorm") && spell.getCooldown("Bladestorm").timeleft <= 1.5 && !this.getCurrentTarget().hasAuraByMe("Champion's Might")),
      
      // actions.thane+=/bladestorm,if=buff.enrage.up&talent.unhinged
      spell.cast("Bladestorm", on => this.getCurrentTarget(), req => me.hasAura(auras.enrage) && this.hasTalent("Unhinged")),
      
      // actions.thane+=/bloodbath,if=buff.bloodcraze.stack>=2
      spell.cast("Bloodbath", on => this.getCurrentTarget(), req => me.getAuraStacks(393951) >= 2),
      
      // actions.thane+=/rampage,if=rage>=115&talent.reckless_abandon&buff.recklessness.up&buff.slaughtering_strikes.stack>=3
      spell.cast("Rampage", on => this.getCurrentTarget(), req => me.powerByType(PowerType.Rage) >= 115 && this.hasTalent("Reckless Abandon") && me.hasAura("Recklessness") && me.getAuraStacks("Slaughtering Strikes") >= 3),
      
      // actions.thane+=/crushing_blow
      spell.cast("Crushing Blow", on => this.getCurrentTarget()),
      
      // actions.thane+=/bloodbath
      spell.cast("Bloodbath", on => this.getCurrentTarget()),
      
      // actions.thane+=/rampage
      spell.cast("Rampage", on => this.getCurrentTarget()),
      
      // actions.thane+=/bloodthirst,if=talent.vicious_contempt&target.health.pct<35&buff.bloodcraze.stack>=2|buff.bloodcraze.stack>=3|active_enemies>=6
      spell.cast("Bloodthirst", on => this.getCurrentTarget(), req => (this.hasTalent("Vicious Contempt") && this.getCurrentTarget().pctHealth < 35 && me.getAuraStacks(393951) >= 2) || me.getAuraStacks(393951) >= 3 || this.getEnemiesInRange(8) >= 6),
      
      // actions.thane+=/raging_blow
      spell.cast("Raging Blow", on => this.getCurrentTarget()),
      
      // actions.thane+=/wrecking_throw
      spell.cast("Wrecking Throw", on => this.getCurrentTarget()),
      
      // actions.thane+=/bloodthirst
      spell.cast("Bloodthirst", on => this.getCurrentTarget()),
      
      // actions.thane+=/execute
      spell.cast("Execute", on => this.getCurrentTarget()),
      
      // actions.thane+=/thunder_clap
      spell.cast("Thunder Clap", on => this.getCurrentTarget())
    );
  }

  useTrinkets() {
    return new bt.Selector(
      common.useEquippedItemByName("Skarmorak Shard"),
    );
  }

  useRacials() {
    return new bt.Selector(
      spell.cast("Lights Judgment", on => this.getCurrentTarget(), req => this.shouldUseOnGCDRacials()),
      spell.cast("Bag of Tricks", on => this.getCurrentTarget(), req => this.shouldUseOnGCDRacials()),
      spell.cast("Berserking", on => this.getCurrentTarget(), req => me.hasAura("Recklessness")),
      spell.cast("Blood Fury", on => this.getCurrentTarget(), req => !Settings.BurstIncludeBloodFury || this.shouldUseBurstAbility()),
      spell.cast("Fireblood", on => this.getCurrentTarget()),
      spell.cast("Ancestral Call", on => this.getCurrentTarget())
    );
  }

  shouldUseRecklessness() {
    if (this.shouldUseBurstAbility()) {
      return !me.hasVisibleAura("Smothering Shadows");
    }

    if (Settings.IgnoreTimeToDeath) {
      return !me.hasVisibleAura("Smothering Shadows");
    }
    
    const target = this.getCurrentTarget();
    return target && target.timeToDeath() > Settings.MinTimeToDeath && !me.hasVisibleAura("Smothering Shadows");
  }

  shouldUseAvatar() {
    if (this.shouldUseBurstAbility()) {
      return !me.hasVisibleAura("Smothering Shadows");
    }

    if (Settings.IgnoreTimeToDeath) {
      return !me.hasVisibleAura("Smothering Shadows");
    }
    
    const target = this.getCurrentTarget();
    return target && target.timeToDeath() > Settings.MinTimeToDeath && !me.hasVisibleAura("Smothering Shadows");
  }

  handleBurstToggle() {
    // Check for keybind press using the KeyBinding system
    if (KeyBinding.isPressed("BurstToggleKeybind")) {
      
      if (!Settings.BurstModeWindow) {
        // Toggle mode: flip the state
        combat.burstToggle = !combat.burstToggle;
        console.log(`Burst toggle ${combat.burstToggle ? 'ACTIVATED' : 'DEACTIVATED'} (Toggle mode)`);
      } else {
        // Window mode: start the burst window
        combat.burstToggle = true;
        this.burstToggleTime = wow.frameTime;
        console.log(`Burst window ACTIVATED for ${Settings.BurstWindowDuration} seconds`);
      }
    }
    
    // Handle burst window timeout - always check if we're in window mode and burst is active
    if (Settings.BurstModeWindow && combat.burstToggle && this.burstToggleTime > 0) {
      const elapsed = (wow.frameTime - this.burstToggleTime) / 1000;
      
      if (elapsed >= Settings.BurstWindowDuration) {
        combat.burstToggle = false;
        this.burstToggleTime = 0; // Reset the timer
        console.log(`Burst window EXPIRED after ${elapsed.toFixed(1)}s`);
      }
    }
  }

  shouldUseBurstAbility() {
    return combat.burstToggle;
  }

  shouldUseChampionsSpear() {
    if (this.shouldUseBurstAbility()) {
      return !me.hasVisibleAura("Smothering Shadows");
    }

    if (Settings.IgnoreTimeToDeath) {
      return !me.hasVisibleAura("Smothering Shadows");
    }
    
    const target = this.getCurrentTarget();
    return target && target.timeToDeath() > Settings.MinTimeToDeath && !me.hasVisibleAura("Smothering Shadows");
  }

  shouldUseOdynsFury() {
    if (this.shouldUseBurstAbility()) {
      return !me.hasVisibleAura("Smothering Shadows");
    }

    if (Settings.IgnoreTimeToDeath) {
      return !me.hasVisibleAura("Smothering Shadows");
    }
    
    const target = this.getCurrentTarget();
    return target && target.timeToDeath() > Settings.MinTimeToDeath && !me.hasVisibleAura("Smothering Shadows");
  }

  shouldUseOnGCDRacials() {
    const target = this.getCurrentTarget();
    if (!target) return false;
    
    const timeToDeathOk = Settings.IgnoreTimeToDeath || target.timeToDeath() > Settings.MinTimeToDeath;
    
    return !me.hasAura("Recklessness") &&
           timeToDeathOk && !me.hasVisibleAura("Smothering Shadows") &&
           !me.hasAura("Avatar") &&
           me.powerByType(PowerType.Rage) < 80 &&
           !me.hasAura("Bloodbath") &&
           !me.hasAura("Crushing Blow") &&
           !me.hasAura(auras.suddenDeath) &&
           !spell.getCooldown("Bladestorm").ready &&
           (!spell.getCooldown("Execute").ready || !this.isExecutePhase());
  }

  isExecutePhase() {
    const target = this.getCurrentTarget();
    if (!target) return false;
    return (this.hasTalent("Massacre") && target.pctHealth < 35) || target.pctHealth < 20;
  }

  getCurrentTarget() {
    const targetPredicate = unit => common.validTarget(unit) && me.isWithinMeleeRange(unit) && me.isFacing(unit);
    const target = me.target;
    if (target !== null && targetPredicate(target)) {
      return target;
    }
    return combat.targets.find(targetPredicate) || null;
  }

  getCurrentTargetPVP() {
    const targetPredicate = unit => common.validTarget(unit) && me.isWithinMeleeRange(unit) && me.isFacing(unit) && !pvpHelpers.hasImmunity(unit);
    const target = me.target;
    if (target !== null && targetPredicate(target)) {
      return target;
    }
    return combat.targets.find(targetPredicate) || null;
  }

  getEnemiesInRange(range) {
    return me.getUnitsAroundCount(range);
  }

  getAuraRemainingTime(auraName) {
    const aura = me.getAura(auraName);
    return aura ? aura.remaining : 0;
  }

  getDebuffRemainingTime(debuffName) {
    const target = this.getCurrentTarget();
    if (!target) return 0;
    const debuff = target.getAuraByMe(debuffName);
    return debuff ? debuff.remaining : 0;
  }

  getAuraStacks(auraName) {
    const aura = me.getAura(auraName);
    return aura ? aura.stacks : 0;
  }

  hasTalent(talentName) {
    return me.hasAura(talentName);
  }

  getCritPct() {
    // This would need to be implemented based on available stats API
    // For now, return a reasonable estimate
    return 19;
  }

  // PVP Helper Methods

  buildPVPRotation() {
    return new bt.Selector(
      // Always Perform actions
      this.buildPVPAlwaysPerform(),
      
      // Slayer Burst (global burst toggle)
      new bt.Decorator(
        () => this.shouldUseBurstAbility(),
        this.buildSlayerBurst(),
        new bt.Action(() => bt.Status.Success)
      ),
      
      // Regular PVP Priority
      this.buildPVPRegularPriority()
    );
  }

  buildPVPAlwaysPerform() {
    return new bt.Selector(
      // Battle Shout if any party member doesn't have it
      spell.cast("Battle Shout", () => this.shouldCastBattleShoutPVP()),
      
      // Defensive stance if below health threshold
      spell.cast("Defensive Stance", () => me.pctHealth < Settings.DefensiveStanceHealthPct && !me.hasAura("Defensive Stance")),
      spell.cast("Berserker Stance", () => me.pctHealth >= Settings.DefensiveStanceHealthPct && !me.hasAura("Berserker Stance")),
      
      // Shattering Throw for Ice Block/Divine Shield
      spell.cast("Shattering Throw", on => this.findShatteringThrowTarget(), req => this.findShatteringThrowTarget() !== null),
      
      // Spell Reflect for spells in blacklist targeting us
      spell.cast(23920, () => this.shouldSpellReflectPVP()),
      
      // Pummel interrupts for PVP
      spell.interrupt("Pummel", on => this.findPummelTarget(), req => this.findPummelTarget() !== null),
      
      // Hamstring - use successful cast tracking from Spell.js
      spell.cast("Hamstring", () => {
        if (!Settings.UseHamstring) return false;
        
        const target = this.getCurrentTargetPVP();
        if (!target) return false;
        
        // Don't cast if target has movement debuffs already
        if (target.hasAura(1715) || target.hasAura(12323)) return false;
        
        // Don't cast if target has immunity or slow immunity
        if (pvpHelpers.hasImmunity(target)) return false;
        if (target.hasAura(1044)) return false; // Blessing of Freedom
        
        // Check timing based on ACTUAL successful casts from Spell.js
        const lastSuccessfulTime = spell._lastSuccessfulCastTimes.get("hamstring");
        const now = wow.frameTime;
        const timeSinceSuccess = lastSuccessfulTime ? now - lastSuccessfulTime : 999999;
        
        // Only cast every 12 seconds after successful cast
        if (lastSuccessfulTime && timeSinceSuccess < 12000) {
          return false;
        }
        
        return true;
      }),
      
      // CC enemies with major cooldowns
      spell.cast(236077, on => this.findDisarmTarget(), req => this.findDisarmTarget() !== null),
      spell.cast("Storm Bolt", on => this.findStormBoltCCTarget(), req => this.findStormBoltCCTarget() !== null),
      spell.cast("Intimidating Shout", on => this.findIntimidatingShoutTarget(), req => this.findIntimidatingShoutTarget() !== null),
      
      // Defensive abilities (excluding pummel/storm bolt interrupts)
      this.buildPVPDefensives(),
      
      // Berserker Shout if near healer and healer is disoriented
      spell.cast("Berserker Shout", () => Settings.UseBerserkerShout && this.shouldUseBerserkerShout()),
      
      // Piercing Howl if 2+ enemies in 12 yards (avoid targets with Blessing of Freedom)
      spell.cast("Piercing Howl", () => this.shouldCastPiercingHowl()),

      // Whirlwind if 2+ enemies in 12 yards
      //spell.cast("Whirlwind", () => this.getEnemiesInRange(12) >= 2 && me.getAuraStacks("Whirlwind") === 0)
    );
  }

  buildSlayerBurst() {
    return new bt.Selector(
      // CC healer with Storm Bolt
      spell.cast("Storm Bolt", on => this.findHealerForStunCC(), req => this.findHealerForStunCC() !== null),
      
      // CC current target with Storm Bolt if healer has stun DR
      spell.cast("Storm Bolt", on => this.getCurrentTargetPVP(), req => this.shouldStormBoltCurrentTarget() && this.shouldUseBurstAbility()),
      
      // Champion's Spear current target
      spell.cast("Champion's Spear", on => this.getCurrentTargetPVP(), req => this.shouldUseChampionsSpear() && this.shouldUseBurstAbility()),
      
      // Recklessness
      spell.cast("Recklessness", req => Settings.UseRecklessness && this.overlayToggles.recklessness.value && this.shouldUseBurstAbility()),
      
      // Rampage
      spell.cast("Rampage", on => this.getCurrentTargetPVP()),
      
      // Avatar
      spell.cast("Avatar", req => Settings.UseAvatar && this.overlayToggles.avatar.value && this.shouldUseBurstAbility()),
      
      // Execute if Sudden Death is up
      spell.cast("Execute", on => this.getCurrentTargetPVP(), req => me.hasAura(auras.suddenDeath)),
      
      // Rampage if no enrage or rage capped
      spell.cast("Rampage", on => this.getCurrentTargetPVP(), req => !me.hasAura(auras.enrage) || me.powerByType(PowerType.Rage) >= 110),
      
      // Bladestorm
      spell.cast("Bladestorm", on => this.getCurrentTargetPVP()),
      
      // Continue with regular priority
      this.buildPVPRegularPriority()
    );
  }

  buildPVPRegularPriority() {
    return new bt.Selector(
      // Rampage if no enrage or rage capped
      spell.cast("Rampage", on => this.getCurrentTargetPVP(), req => !me.hasAura(auras.enrage) || me.powerByType(PowerType.Rage) >= 110),
      
      // Execute if Slayer's Dominance at 3 stacks
      spell.cast("Execute", on => this.getCurrentTargetPVP(), req => this.getCurrentTargetPVP()?.getAuraStacks("Marked for Execution") === 3),
      
      // Rampage
      spell.cast("Rampage", on => this.getCurrentTargetPVP()),
      
      // Execute
      spell.cast("Execute", on => this.getCurrentTargetPVP()),
      
      // Bloodthirst at 3+ stacks of Bloodcraze
      spell.cast("Bloodthirst", on => this.getCurrentTargetPVP(), req => me.getAuraStacks(393951) >= 3),
      
      // Raging Blow
      spell.cast("Raging Blow", on => this.getCurrentTargetPVP()),
      
      // Bloodthirst
      spell.cast("Bloodthirst", on => this.getCurrentTargetPVP())
    );
  }

  buildPVPDefensives() {
    return new bt.Selector(
      // Battle Shout
      spell.cast("Battle Shout", () => !me.hasAura(auras.battleShout)),
      
      // Defensive abilities with user options
      spell.cast("Rallying Cry", () => 
        Settings.UseRallyingCry && 
        this.overlayToggles.defensives.value &&
        me.pctHealth < Settings.RallyingCryHealthPct
      ),
      spell.cast("Victory Rush", () => 
        Settings.UseVictoryRush && 
        this.overlayToggles.defensives.value &&
        me.effectiveHealthPercent < Settings.VictoryRushHealthPct
      ),
      spell.cast("Enraged Regeneration", () => 
        Settings.UseEnragedRegeneration && 
        this.overlayToggles.defensives.value &&
        me.pctHealth < Settings.EnragedRegenerationHealthPct
      ),
      spell.cast("Bloodthirst", () => 
        Settings.UseBloodthirstHealing && 
        this.overlayToggles.defensives.value &&
        me.pctHealth < Settings.BloodthirstHealingHealthPct && 
        me.hasAura("Enraged Regeneration")
      )
      // Note: Pummel and Storm Bolt interrupts are NOT included here for PVP
    );
  }

  // PVP Helper Methods

  shouldCastBattleShoutPVP() {
    const friends = me.getFriends();
    for (const friend of friends) {
      if (!friend.deadOrGhost && !friend.hasAura(auras.battleShout)) {
        return true;
      }
    }
    return false;
  }

  shouldSpellReflectPVP() {
    const enemies = me.getEnemies();
    for (const enemy of enemies) {
      if (enemy.isCastingOrChanneling && enemy.isPlayer()) {
        const spellInfo = enemy.spellInfo;
        const target = spellInfo ? spellInfo.spellTargetGuid : null;
        if (enemy.spellInfo && target && target.equals(me.guid)) {
          const spellId = enemy.spellInfo.spellCastId;
          // Check if spell should be reflected using new data
          if (pvpHelpers.shouldReflectSpell(spellId)) {
            const castRemains = enemy.spellInfo.castEnd - wow.frameTime;
            return castRemains < 1000; // Reflect within 1 second of cast completion
          }
        }
      }
    }
    return false;
  }

  findPummelTarget() {
    const enemies = me.getEnemies();
    
    // Priority 1: Enemy casting an interruptible spell within 8 yards
    for (const enemy of enemies) {
      if (enemy.isCastingOrChanneling && 
          enemy.isPlayer() && 
          me.distanceTo(enemy) <= 8 && 
          me.isWithinMeleeRange(enemy)) {
        const spellInfo = enemy.spellInfo;
        if (spellInfo) {
          const spellId = spellInfo.spellCastId;
          const interruptInfo = pvpHelpers.getInterruptInfo(spellId);
          if (interruptInfo && interruptInfo.useKick) {
            console.log(`Pummel target found: ${enemy.unsafeName} casting ${interruptInfo.name} (${interruptInfo.zone})`);
            return enemy;
          }
        }
      }
    }
    
    // Priority 2: Enemy healer within 8 yards if any enemy near me is under 50% health
    const lowHealthEnemyNearby = enemies.some(enemy => 
      enemy.isPlayer() && 
      me.distanceTo(enemy) <= 15 && 
      enemy.pctHealth < 50
    );
    
    if (lowHealthEnemyNearby) {
      for (const enemy of enemies) {
        if (enemy.isCastingOrChanneling && 
            enemy.isPlayer() && 
            enemy.isHealer() &&
            me.distanceTo(enemy) <= 8 && 
            me.isWithinMeleeRange(enemy)) {
          console.log(`Pummel healer target found: ${enemy.unsafeName} (low health enemy nearby)`);
          return enemy;
        }
      }
    }
    
    return null;
  }

  findDisarmTarget() {
    const enemies = me.getEnemies();
    for (const enemy of enemies) {
      if (enemy.isPlayer() && 
          me.isWithinMeleeRange(enemy) && 
          this.isMeleeClass(enemy) && 
          this.hasMajorCooldowns(enemy) &&
          drTracker.getDRStacks(enemy.guid, "disarm") < 2 &&
          !pvpHelpers.hasImmunity(enemy) &&
          !enemy.isCCd()) {
        return enemy;
      }
    }
    return null;
  }

  findStormBoltCCTarget() {
    const enemies = me.getEnemies();
    for (const enemy of enemies) {
      if (enemy.isPlayer() && 
          me.distanceTo(enemy) > 7 && 
          me.distanceTo(enemy) <= 30 &&
          this.isCasterClass(enemy) && 
          this.hasMajorCooldowns(enemy) &&
          drTracker.getDRStacks(enemy.guid, "stun") < 2 &&
          !pvpHelpers.hasImmunity(enemy) &&
          !enemy.isCCd()) {
        return enemy;
      }
    }
    return null;
  }

  findIntimidatingShoutTarget() {
    const enemies = me.getEnemies();
    
    // Count eligible enemies within 8 yards (not DR'd, not immune, not already CC'd)
    const eligibleEnemies = enemies.filter(enemy => 
      enemy.isPlayer() && 
      me.distanceTo(enemy) <= 8 && 
      drTracker.getDRStacks(enemy.guid, "disorient") < 2 &&
      !pvpHelpers.hasImmunity(enemy) &&
      !enemy.isCCd()
    );
    
    // Only use Intimidating Shout if we can fear 2+ enemies
    if (eligibleEnemies.length < 2) {
      return null;
    }
    
    // Prefer enemies with major cooldowns, but any eligible enemy works
    const priorityTarget = eligibleEnemies.find(enemy => this.hasMajorCooldowns(enemy));
    return priorityTarget || eligibleEnemies[0];
  }

  findHealerForStunCC() {
    const enemies = me.getEnemies();
    for (const enemy of enemies) {
      if (enemy.isPlayer() && 
          enemy.isHealer() &&
          me.distanceTo(enemy) <= 30 &&
          drTracker.getDRStacks(enemy.guid, "stun") < 2 &&
          !pvpHelpers.hasImmunity(enemy)) {
        return enemy;
      }
    }
    return null;
  }

  shouldStormBoltCurrentTarget() {
    const target = this.getCurrentTargetPVP();
    if (!target || !target.isPlayer()) return false;
    
    const healer = this.findHealerForStunCC();
    const healerHasStunDR = healer && drTracker.getDRStacks(healer.guid, "stun") >= 2;
    const targetIsNotHealer = !target.isHealer();
    
    return healerHasStunDR && targetIsNotHealer && drTracker.getDRStacks(target.guid, "stun") < 2;
  }

  shouldUseBerserkerShout() {
    if (!this.hasTalent("Berserker Shout")) return false;
    
    const friends = me.getFriends();
    for (const friend of friends) {
      if (friend.isHealer() && 
          me.distanceTo(friend) <= 12 && 
          drTracker.isCCdByCategory(friend.guid, "disorient")) {
        return true;
      }
    }
    return false;
  }

  isMeleeClass(unit) {
    if (!unit.isPlayer()) return false;
    // PowerType: 1=Rage, 2=Focus, 3=Energy, 4=ComboPoints, 5=Runes, 6=RunicPower, 12=Fury, 17=Maelstrom, 18=Chi, 19=Insanity
    const meleePowerTypes = [1, 2, 3, 4, 5, 6, 12, 17, 18, 19];
    return meleePowerTypes.includes(unit.powerType);
  }

  isCasterClass(unit) {
    if (!unit.isPlayer()) return false;
    // PowerType 0 = Mana (typically casters)
    return unit.powerType === 0;
  }

  hasMajorCooldowns(unit) {
    if (!unit.isPlayer()) return false;
    // Check for major damage cooldowns with sufficient duration
    const majorDamageCooldown = pvpHelpers.hasMajorDamageCooldown(unit, 3);
    const disarmableBuff = pvpHelpers.hasDisarmableBuff(unit, false, 3);
    return majorDamageCooldown !== null || disarmableBuff !== null;
  }

  findEnhancedCCTarget() {
    const enemies = me.getEnemies();
    for (const enemy of enemies) {
      if (!enemy.isPlayer() || me.distanceTo(enemy) > 30) continue;
      
      // Check for major damage cooldowns
      const damageCooldown = pvpHelpers.hasMajorDamageCooldown(enemy, 3);
      if (damageCooldown) {
        return { 
          unit: enemy, 
          name: enemy.unsafeName, 
          reason: `${damageCooldown.name} (${damageCooldown.remainingTime.toFixed(1)}s)` 
        };
      }
      
      // Check for disarmable buffs
      const disarmableBuff = pvpHelpers.hasDisarmableBuff(enemy, false, 3);
      if (disarmableBuff) {
        return { 
          unit: enemy, 
          name: enemy.unsafeName, 
          reason: `${disarmableBuff.name} (${disarmableBuff.remainingTime.toFixed(1)}s)` 
        };
      }
    }
    return null;
  }

  findImmuneTarget() {
    const enemies = me.getEnemies();
    for (const enemy of enemies) {
      if (enemy.isPlayer() && me.distanceTo(enemy) <= 30 && pvpHelpers.hasImmunity(enemy)) {
        return enemy;
      }
    }
    return null;
  }



  shouldCastPiercingHowl() {
    // Get enemies within 12 yards
    const enemies = me.getEnemies();
    const enemiesInRange = enemies.filter(enemy => 
      enemy.isPlayer() && 
      me.distanceTo(enemy) <= 12 &&
      !pvpHelpers.hasImmunity(enemy) &&
      !enemy.hasAura(1044) // Don't target enemies with Blessing of Freedom
    );
    
    return enemiesInRange.length >= 2;
  }

  findShatteringThrowTarget() {
    const enemies = me.getEnemies();
    for (const enemy of enemies) {
      if (enemy.isPlayer() && me.distanceTo(enemy) <= 30) {
        // Check specifically for Ice Block (45438) or Divine Shield (642)
        const hasIceBlock = enemy.hasAura(45438);
        const hasDivineShield = enemy.hasAura(642);
        
        if (hasIceBlock || hasDivineShield) {
          return enemy;
        }
      }
    }
    return null;
  }
}
