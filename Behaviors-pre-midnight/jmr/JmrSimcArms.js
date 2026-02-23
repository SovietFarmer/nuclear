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
import ToastNotification, { toast, toastInfo, toastSuccess, toastWarning, toastError } from '@/Extra/ToastNotification';

export class WarriorArmsNewBehavior extends Behavior {
  context = BehaviorContext.Any;
  specialization = Specialization.Warrior.Arms;
  version = wow.GameVersion.Retail;
  name = "Jmr SimC Warrior Arms";

  // Runtime toggles for overlay (independent of settings)
  overlayToggles = {
    showOverlay: new imgui.MutableVariable(true),
    interrupts: new imgui.MutableVariable(true),
    avatar: new imgui.MutableVariable(true),
    warbreaker: new imgui.MutableVariable(true),
    colossusSmash: new imgui.MutableVariable(true),
    pummel: new imgui.MutableVariable(true),
    stormBolt: new imgui.MutableVariable(true),
    shockwave: new imgui.MutableVariable(true),
    intimidatingShout: new imgui.MutableVariable(true),
    defensives: new imgui.MutableVariable(true)
  };

  // Note: Burst mode uses Combat.burstToggle value and Combat.toggleBurst() method for proper persistence
  
  // Intervene follow-up tracking
  lastInterveneOnStunnedHealerTime = 0;
  
  // Manual spell casting
  spellIdInput = new imgui.MutableVariable("1161");
  
  // Timing trackers (now using Spell.js _lastSuccessfulCastTimes instead)

  static settings = [
    {
      header: "Stance Management",
      options: [
        { type: "slider", uid: "DefensiveStanceHealthPct", text: "Defensive Stance Health %", min: 30, max: 80, default: 60 }
      ]
    },
    {
      header: "PVP Settings",
      options: [
        { type: "checkbox", uid: "EnablePVPRotation", text: "Enable PVP Rotation", default: false },
        { type: "checkbox", uid: "UseIgnorePain", text: "Use Ignore Pain", default: true },
        { type: "slider", uid: "IgnorePainHealthPct", text: "Ignore Pain Health %", min: 70, max: 95, default: 90 },
        { type: "slider", uid: "IgnorePainRage", text: "Ignore Pain Min Rage", min: 80, max: 100, default: 90 },
        { type: "checkbox", uid: "UseImpendingVictory", text: "Use Impending Victory", default: true },
        { type: "slider", uid: "ImpendingVictoryHealthPct", text: "Impending Victory Health % (normal)", min: 60, max: 80, default: 70 },
        { type: "slider", uid: "ImpendingVictoryNoHealerHealthPct", text: "Impending Victory Health % (no healer)", min: 70, max: 90, default: 80 },
        { type: "checkbox", uid: "UseHamstring", text: "Use Hamstring", default: true },
        { type: "slider", uid: "HamstringCooldown", text: "Hamstring Cooldown (seconds)", min: 8, max: 20, default: 12 },
        { type: "checkbox", uid: "UseSweepingStrikes", text: "Use Sweeping Strikes", default: true },
        { type: "checkbox", uid: "UseShockwave", text: "Use Shockwave", default: true },
        { type: "checkbox", uid: "UseIntimidatingShout", text: "Use Intimidating Shout", default: true },
        { type: "checkbox", uid: "UseChampionsSpear", text: "Use Champion's Spear in Burst", default: true },
        { type: "checkbox", uid: "UsePiercingHowl", text: "Use Piercing Howl", default: true },
        { type: "checkbox", uid: "UseProtectiveIntervene", text: "Use Protective Intervene for healers under rogue CC", default: true }
      ]
    },
    {
      header: "Defensive Abilities",
      options: [
        { type: "checkbox", uid: "UseRallyingCry", text: "Use Rallying Cry", default: true },
        { type: "slider", uid: "RallyingCryHealthPct", text: "Rallying Cry Health %", min: 10, max: 50, default: 30 },
        { type: "checkbox", uid: "UseDieByTheSword", text: "Use Die by the Sword", default: true },
        { type: "slider", uid: "DieByTheSwordHealthPct", text: "Die by the Sword Health %", min: 10, max: 50, default: 30 },
        { type: "checkbox", uid: "UseVictoryRush", text: "Use Victory Rush", default: true },
        { type: "slider", uid: "VictoryRushHealthPct", text: "Victory Rush Health %", min: 30, max: 90, default: 70 }
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
        { type: "checkbox", uid: "UseAvatar", text: "Use Avatar", default: true },
        { type: "checkbox", uid: "UseWarbreaker", text: "Use Warbreaker", default: true },
        { type: "checkbox", uid: "UseColossusSmash", text: "Use Colossus Smash", default: true }
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
      // Overlay rendering - runs every frame FIRST
      new bt.Action(() => {
        this.renderOverlay();
        
        // Manual spell casting with RightArrow
        if (imgui.isKeyPressed(imgui.Key.RightArrow)) {
          const target = me.targetUnit || me;
          const spellId = parseInt(this.spellIdInput.value, 10);
          const spellObject = spell.getSpell(spellId);

          if (spellObject) {
            const spellName = spellObject.name || "Unknown Spell";
            console.info(`Casting spell "${spellName}" (ID: ${spellId}) on ${target.unsafeName}`);
            spell.castPrimitive(spellObject, target);
          } else {
            console.info(`Spell ID ${spellId} not found. Please enter a valid spell ID.`);
          }
        }
        
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
          
          // Trinkets and racials
          new bt.Decorator(
            () => this.shouldUseCooldowns() && me.hasVisibleAura("Avatar"),
            this.useTrinkets(),
            new bt.Action(() => bt.Status.Success)
          ),
          new bt.Decorator(
            () => this.shouldUseCooldowns() && me.hasVisibleAura("Avatar"),
            this.useRacials(),
            new bt.Action(() => bt.Status.Success)
          ),
          
          // Variable calculations
          new bt.Action(() => {
            this.executePhase = this.isExecutePhase();
            return bt.Status.Failure;
          }),
          
          // Talent-based rotations
          new bt.Decorator(
            () => !this.hasTalent("Slayer's Dominance") && this.getEnemiesInRange(10) > 2,
            this.colossusAoe(),
            new bt.Action(() => bt.Status.Success)
          ),
          new bt.Decorator(
            () => !this.hasTalent("Slayer's Dominance") && this.executePhase,
            this.colossusExecute(),
            new bt.Action(() => bt.Status.Success)
          ),
          new bt.Decorator(
            () => !this.hasTalent("Slayer's Dominance") && this.getEnemiesInRange(10) === 2 && !this.executePhase,
            this.colossusSweep(),
            new bt.Action(() => bt.Status.Success)
          ),
          new bt.Decorator(
            () => !this.hasTalent("Slayer's Dominance"),
            this.colossusSt(),
            new bt.Action(() => bt.Status.Success)
          ),
          new bt.Decorator(
            () => this.hasTalent("Slayer's Dominance") && this.getEnemiesInRange(10) > 2,
            this.slayerAoe(),
            new bt.Action(() => bt.Status.Success)
          ),
          new bt.Decorator(
            () => this.hasTalent("Slayer's Dominance") && this.executePhase,
            this.slayerExecute(),
            new bt.Action(() => bt.Status.Success)
          ),
          new bt.Decorator(
            () => this.hasTalent("Slayer's Dominance") && this.getEnemiesInRange(10) === 2 && !this.executePhase,
            this.slayerSweep(),
            new bt.Action(() => bt.Status.Success)
          ),
          new bt.Decorator(
            () => this.hasTalent("Slayer's Dominance"),
            this.slayerSt(),
            new bt.Action(() => bt.Status.Success)
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

    // Handle burst mode toggle with 'X' key (using proper Combat.toggleBurst() method)
    if (imgui.isKeyPressed(imgui.Key.X)) {
      combat.toggleBurst();
      console.info("Arms Warrior Burst Mode:", combat.burstToggle ? "ACTIVATED" : "DEACTIVATED");
      //console.info(`[DEBUG] X pressed - combat.burstToggle: ${combat.burstToggle}, PVPRotation enabled: ${Settings.EnablePVPRotation}, target: ${me.target?.unsafeName || 'none'}`);
      
      // Toast notification for burst mode
      if (combat.burstToggle) {
        if (Settings.EnablePVPRotation) {
          toastSuccess("BURST MODE ACTIVATED!", 1.3, 2500);
        } else {
          toastError("Burst enabled, but PVP Rotation is disabled in settings!", 1.5, 4000);
        }
      } else {
        toastInfo("Burst mode deactivated", 1.0, 1500);
      }
    }

    const viewport = imgui.getMainViewport();
    if (!viewport) {
      return;
    }
    
    const workPos = viewport.workPos;
    const workSize = viewport.workSize;
    
    // Position overlay in top-right corner, make it larger for PvP controls
    const overlaySize = { x: 280, y: Settings.EnablePVPRotation ? 450 : 300 };
    const overlayPos = { 
      x: workPos.x + workSize.x - overlaySize.x - 20, 
      y: workPos.y + 20 
    };

    imgui.setNextWindowPos(overlayPos, imgui.Cond.FirstUseEver);
    imgui.setNextWindowSize(overlaySize, imgui.Cond.FirstUseEver);
    
    // Make background more opaque
    imgui.setNextWindowBgAlpha(0.50);

    // Removed unused isBurstMode variable (was referencing old this.burstModeActive)
    
    // Window flags for overlay behavior
    const windowFlags = 
      imgui.WindowFlags.NoResize |
      imgui.WindowFlags.AlwaysAutoResize;

    const windowTitle = Settings.EnablePVPRotation ? "Arms Warrior PVP Controls" : "Arms Warrior Controls";
    if (imgui.begin(windowTitle, this.overlayToggles.showOverlay, windowFlags)) {
      
      // PVP Mode indicator
      if (Settings.EnablePVPRotation) {
        imgui.spacing();
        imgui.pushStyleColor(imgui.Col.Text, { r: 1.0, g: 0.2, b: 0.2, a: 1.0 });
        imgui.text("PVP MODE ACTIVE");
        imgui.popStyleColor();
        
        // Burst Mode Toggle - prominent display (using Combat.burstToggle)
        const burstColor = combat.burstToggle ? 
           { r: 0.2, g: 1.0, b: 0.2, a: 1.0 } : { r: 1.0, g: 0.2, b: 0.2, a: 1.0 };
        imgui.pushStyleColor(imgui.Col.Text, burstColor);
        const burstText = combat.burstToggle ? "BURST ACTIVE (Press X)" : "BURST OFF (Press X)";
        imgui.text(burstText);
        imgui.popStyleColor();
        
        // Warning if burst is enabled but PVP rotation is disabled
        if (combat.burstToggle && !Settings.EnablePVPRotation) {
          imgui.pushStyleColor(imgui.Col.Text, { r: 1.0, g: 0.6, b: 0.0, a: 1.0 });
          imgui.text("WARNING: Enable PVP Rotation in settings!");
          imgui.popStyleColor();
        }
        imgui.separator();

        // Build info
        if (imgui.collapsingHeader("Build Info", imgui.TreeNodeFlags.DefaultOpen)) {
          imgui.indent();
          const buildType = this.hasTalent("Demolish") ? "Colossus" : 
                           this.hasTalent("Slayer's Dominance") ? "Slayer" : "Unknown";
          imgui.textColored({ r: 0.2, g: 0.8, b: 1.0, a: 1.0 }, `Build: ${buildType}`);
          
          if (this.hasTalent("Demolish")) {
            const mightStacks = me.getAuraStacks("Colossal Might");
            imgui.textColored({ r: 1.0, g: 1.0, b: 0.2, a: 1.0 }, `Colossal Might: ${mightStacks}/10`);
          }
          imgui.unindent();
        }

        // PVP Target Info
        if (imgui.collapsingHeader("PVP Targets")) {
          imgui.indent();
          
          // Shattering Throw targets
          const shatterTarget = this.findShatteringThrowTarget();
          if (shatterTarget) {
            imgui.textColored({ r: 1.0, g: 0.0, b: 0.0, a: 1.0 }, `Shattering Throw: ${shatterTarget.unsafeName}`);
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
          
          // Show if current target has Blessing of Freedom
          const currentTarget = this.getCurrentTargetPVP();
          if (currentTarget && currentTarget.hasVisibleAura(1044)) {
            imgui.textColored({ r: 1.0, g: 1.0, b: 0.2, a: 1.0 }, `${currentTarget.unsafeName} has Freedom`);
          }
          
          // Show healer under rogue CC for Intervene
          const healerUnderCC = this.findHealerUnderRogueCC();
          if (healerUnderCC) {
            const ccType = healerUnderCC.hasAura(1833) ? "Cheap Shot" :
                          healerUnderCC.hasAura(408) ? "Kidney Shot" : 
                          healerUnderCC.hasAura(703) ? "Garrote" : "CC";
            imgui.textColored({ r: 1.0, g: 0.0, b: 0.0, a: 1.0 }, `Intervene: ${healerUnderCC.unsafeName} (${ccType})`);
          }
          
          imgui.unindent();
        }

        // CC Abilities
        if (imgui.collapsingHeader("CC Abilities", imgui.TreeNodeFlags.DefaultOpen)) {
          imgui.indent();
          
          const stormBoltColor = this.overlayToggles.stormBolt.value ?
            { r: 0.2, g: 0.8, b: 1.0, a: 1.0 } : { r: 0.6, g: 0.6, b: 0.6, a: 1.0 };
          imgui.pushStyleColor(imgui.Col.Text, stormBoltColor);
          imgui.checkbox("Storm Bolt", this.overlayToggles.stormBolt);
          imgui.popStyleColor();
          
          const shockwaveColor = this.overlayToggles.shockwave.value ?
            { r: 0.2, g: 0.8, b: 1.0, a: 1.0 } : { r: 0.6, g: 0.6, b: 0.6, a: 1.0 };
          imgui.pushStyleColor(imgui.Col.Text, shockwaveColor);
          imgui.checkbox("Shockwave", this.overlayToggles.shockwave);
          imgui.popStyleColor();
          
          const intimidatingColor = this.overlayToggles.intimidatingShout.value ?
            { r: 0.2, g: 0.8, b: 1.0, a: 1.0 } : { r: 0.6, g: 0.6, b: 0.6, a: 1.0 };
          imgui.pushStyleColor(imgui.Col.Text, intimidatingColor);
          imgui.checkbox("Intimidating Shout", this.overlayToggles.intimidatingShout);
          imgui.popStyleColor();
          
          imgui.unindent();
        }

        // Defensives
        if (imgui.collapsingHeader("Defensives")) {
          imgui.indent();
          
          const defensiveColor = this.overlayToggles.defensives.value ?
            { r: 0.2, g: 1.0, b: 0.2, a: 1.0 } : { r: 1.0, g: 0.2, b: 0.2, a: 1.0 };
          imgui.pushStyleColor(imgui.Col.Text, defensiveColor);
          imgui.checkbox("Defensives", this.overlayToggles.defensives);
          imgui.popStyleColor();
          
          imgui.unindent();
        }
      }
      
      // Major Cooldowns section - collapsible
      if (imgui.collapsingHeader("Major Cooldowns", imgui.TreeNodeFlags.DefaultOpen)) {
        imgui.indent();
        
        // Avatar toggle
        const avatarColor = this.overlayToggles.avatar.value ? 
          { r: 0.2, g: 1.0, b: 0.2, a: 1.0 } : { r: 1.0, g: 0.2, b: 0.2, a: 1.0 };
        imgui.pushStyleColor(imgui.Col.Text, avatarColor);
        imgui.checkbox("Avatar", this.overlayToggles.avatar);
        imgui.popStyleColor();
        
        // Warbreaker toggle  
        const warbreakerColor = this.overlayToggles.warbreaker.value ?
          { r: 0.2, g: 1.0, b: 0.2, a: 1.0 } : { r: 1.0, g: 0.2, b: 0.2, a: 1.0 };
        imgui.pushStyleColor(imgui.Col.Text, warbreakerColor);
        imgui.checkbox("Warbreaker", this.overlayToggles.warbreaker);
        imgui.popStyleColor();

        // Colossus Smash toggle  
        const colossusColor = this.overlayToggles.colossusSmash.value ?
          { r: 0.2, g: 1.0, b: 0.2, a: 1.0 } : { r: 1.0, g: 0.2, b: 0.2, a: 1.0 };
        imgui.pushStyleColor(imgui.Col.Text, colossusColor);
        imgui.checkbox("Colossus Smash", this.overlayToggles.colossusSmash);
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

      // Quick controls section - always visible
      imgui.spacing();
      imgui.separator();
      
      // Quick controls
      if (imgui.button("Enable All", { x: 120, y: 0 })) {
        Object.values(this.overlayToggles).forEach(toggle => {
          if (toggle !== this.overlayToggles.showOverlay) {
            toggle.value = true;
          }
        });
      }
      
      imgui.sameLine();
      
      if (imgui.button("Disable All", { x: 120, y: 0 })) {
        Object.values(this.overlayToggles).forEach(toggle => {
          if (toggle !== this.overlayToggles.showOverlay) {
            toggle.value = false;
          }
        });
      }
      
      imgui.end();
    }
  }

  buildDefensives() {
    return new bt.Selector(
      // Battle Shout
      spell.cast("Battle Shout", () => !me.hasAura("Battle Shout")),
      
      // Defensive abilities with user options
      spell.cast("Rallying Cry", () => Settings.UseRallyingCry && me.pctHealth < Settings.RallyingCryHealthPct),
      spell.cast("Die by the Sword", () => Settings.UseDieByTheSword && me.pctHealth < Settings.DieByTheSwordHealthPct),
      spell.cast("Victory Rush", () => Settings.UseVictoryRush && me.pctHealth < Settings.VictoryRushHealthPct),
      
      // Interrupts (respect both settings and overlay toggles)
      spell.interrupt("Pummel"),
      spell.interrupt("Storm Bolt")
    );
  }

  useTrinkets() {
    return new bt.Selector(
      common.useEquippedItemByName("Skyterror's Corrosive Organ"),
    );
  }

  useRacials() {
    return new bt.Selector(
      spell.cast("Light's Judgment", on => this.getCurrentTarget(), req => !this.getCurrentTarget().hasAuraByMe("Colossus Smash") && spell.getCooldown("Mortal Strike").timeleft > 0),
      spell.cast("Bag of Tricks", on => this.getCurrentTarget(), req => !this.getCurrentTarget().hasAuraByMe("Colossus Smash") && spell.getCooldown("Mortal Strike").timeleft > 0),
      spell.cast("Berserking", on => this.getCurrentTarget(), req => me.hasAura("Avatar") && (this.getTargetTimeToDie() > 180 || (this.getTargetTimeToDie() < 180 && this.isExecutePhase()) || this.getTargetTimeToDie() < 20)),
      spell.cast("Blood Fury", on => this.getCurrentTarget(), req => this.getCurrentTarget().hasAuraByMe("Colossus Smash")),
      spell.cast("Fireblood", on => this.getCurrentTarget(), req => this.getCurrentTarget().hasAuraByMe("Colossus Smash")),
      spell.cast("Ancestral Call", on => this.getCurrentTarget(), req => this.getCurrentTarget().hasAuraByMe("Colossus Smash"))
    );
  }

  colossusAoe() {
    return new bt.Selector(
      // actions.colossus_aoe=cleave,if=!dot.deep_wounds.remains
      spell.cast("Cleave", on => this.getCurrentTarget(), req => this.getDebuffRemainingTime("Deep Wounds") <= 0),
      // actions.colossus_aoe+=/thunder_clap,if=!dot.rend.remains
      spell.cast("Thunder Clap", on => this.getCurrentTarget(), req => this.getDebuffRemainingTime("Rend") <= 0),
      // actions.colossus_aoe+=/thunderous_roar
      spell.cast("Thunderous Roar", on => this.getCurrentTarget()),
      // actions.colossus_aoe+=/avatar
      spell.cast("Avatar", req => Settings.UseAvatar && this.overlayToggles.avatar.value && this.shouldUseCooldowns()),
      // actions.colossus_aoe+=/sweeping_strikes
      spell.cast("Sweeping Strikes"),
      // actions.colossus_aoe+=/warbreaker
      spell.cast("Warbreaker", req => Settings.UseWarbreaker && this.overlayToggles.warbreaker.value),
      // actions.colossus_aoe+=/ravager
      spell.cast("Ravager", on => this.getCurrentTarget()),
      // actions.colossus_aoe+=/champions_spear
      spell.cast("Champion's Spear", on => this.getCurrentTarget(), req => this.shouldUseCooldowns()),
      // actions.colossus_aoe+=/colossus_smash
      spell.cast("Colossus Smash", req => Settings.UseColossusSmash && this.overlayToggles.colossusSmash.value),
      // actions.colossus_aoe+=/cleave
      spell.cast("Cleave", on => this.getCurrentTarget()),
      // actions.colossus_aoe+=/bladestorm,if=talent.unhinged|talent.merciless_bonegrinder
      spell.cast("Bladestorm", on => this.getCurrentTarget(), req => this.hasTalent("Unhinged") || this.hasTalent("Merciless Bonegrinder")),
      // actions.colossus_aoe+=/thunder_clap,if=dot.rend.remains<5
      spell.cast("Thunder Clap", on => this.getCurrentTarget(), req => this.getDebuffRemainingTime("Rend") < 5),
      // actions.colossus_aoe+=/demolish,if=buff.colossal_might.stack=10&(debuff.colossus_smash.remains>=2|cooldown.colossus_smash.remains>=7)
      spell.cast("Demolish", on => this.getCurrentTarget(), req => me.getAuraStacks("Colossal Might") === 10 && (this.getDebuffRemainingTime("Colossus Smash") >= 2 || spell.getCooldown("Colossus Smash").timeleft >= 7) || spell.getCooldown("Warbreaker").timeleft >= 7),
      // actions.colossus_aoe+=/mortal_strike
      spell.cast("Mortal Strike", on => this.getCurrentTarget()),
      // actions.colossus_aoe+=/overpower
      spell.cast("Overpower", on => this.getCurrentTarget()),
      // actions.colossus_aoe+=/thunder_clap
      spell.cast("Thunder Clap", on => this.getCurrentTarget()),
      // actions.colossus_aoe+=/skullsplitter
      spell.cast("Skullsplitter", on => this.getCurrentTarget()),
      // actions.colossus_aoe+=/execute
      spell.cast("Execute", on => this.getCurrentTarget()),
      // actions.colossus_aoe+=/bladestorm
      spell.cast("Bladestorm", on => this.getCurrentTarget()),
      // actions.colossus_aoe+=/wrecking_throw
      spell.cast("Wrecking Throw", on => this.getCurrentTarget()),
      // actions.colossus_aoe+=/whirlwind
      spell.cast("Whirlwind", on => this.getCurrentTarget())
    );
  }

  colossusExecute() {
    return new bt.Selector(
      // actions.colossus_execute=sweeping_strikes,if=active_enemies=2
      spell.cast("Sweeping Strikes", req => this.getEnemiesInRange(8) === 2),
      // actions.colossus_execute+=/rend,if=dot.rend.remains<=gcd&!talent.bloodletting
      spell.cast("Rend", on => this.getCurrentTarget(), req => this.getDebuffRemainingTime("Rend") <= 1.5 && !this.hasTalent("Bloodletting")),
      // actions.colossus_execute+=/thunderous_roar
      spell.cast("Thunderous Roar", on => this.getCurrentTarget()),
      // actions.colossus_execute+=/champions_spear
      spell.cast("Champion's Spear", on => this.getCurrentTarget(), req => this.shouldUseCooldowns()),
      // actions.colossus_execute+=/ravager,if=cooldown.colossus_smash.remains<=gcd
      spell.cast("Ravager", on => this.getCurrentTarget(), req => spell.getCooldown("Colossus Smash").timeleft <= 1.5 || spell.getCooldown("Warbreaker").timeleft <= 1.5),
      // actions.colossus_execute+=/avatar
      spell.cast("Avatar", req => Settings.UseAvatar && this.overlayToggles.avatar.value && this.shouldUseCooldowns()),
      // actions.colossus_execute+=/colossus_smash
      spell.cast("Colossus Smash", req => Settings.UseColossusSmash && this.overlayToggles.colossusSmash.value),
      // actions.colossus_execute+=/warbreaker
      spell.cast("Warbreaker", req => Settings.UseWarbreaker && this.overlayToggles.warbreaker.value),
      // actions.colossus_execute+=/execute,if=buff.juggernaut.remains<=gcd&talent.juggernaut
      spell.cast("Execute", on => this.getCurrentTarget(), req => this.getAuraRemainingTime("Juggernaut") <= 1.5 && this.hasTalent("Juggernaut")),
      // actions.colossus_execute+=/skullsplitter,if=rage<40
      spell.cast("Skullsplitter", on => this.getCurrentTarget(), req => me.powerByType(PowerType.Rage) < 40),
      // actions.colossus_execute+=/demolish,if=debuff.colossus_smash.up
      spell.cast("Demolish", on => this.getCurrentTarget(), req => this.getCurrentTarget().hasAuraByMe("Colossus Smash")),
      // actions.colossus_execute+=/mortal_strike,if=debuff.executioners_precision.stack=2&!buff.ravager.up|!talent.executioners_precision|talent.battlelord&debuff.executioners_precision.stack>0
      spell.cast("Mortal Strike", on => this.getCurrentTarget(), req => (this.getDebuffStacks("Executioner's Precision") === 2 && !me.hasAura("Ravager")) || !this.hasTalent("Executioner's Precision") || (this.hasTalent("Battlelord") && this.getDebuffStacks("Executioner's Precision") > 0)),
      // actions.colossus_execute+=/overpower,if=rage<90
      spell.cast("Overpower", on => this.getCurrentTarget(), req => me.powerByType(PowerType.Rage) < 90),
      // actions.colossus_execute+=/execute,if=rage>=40&talent.executioners_precision
      spell.cast("Execute", on => this.getCurrentTarget(), req => me.powerByType(PowerType.Rage) >= 40 && this.hasTalent("Executioner's Precision")),
      // actions.colossus_execute+=/overpower
      spell.cast("Overpower", on => this.getCurrentTarget()),
      // actions.colossus_execute+=/bladestorm
      spell.cast("Bladestorm", on => this.getCurrentTarget()),
      // actions.colossus_execute+=/wrecking_throw
      spell.cast("Wrecking Throw", on => this.getCurrentTarget()),
      // actions.colossus_execute+=/execute
      spell.cast("Execute", on => this.getCurrentTarget())
    );
  }

  colossusSt() {
    return new bt.Selector(
      // actions.colossus_st=rend,if=dot.rend.remains<=gcd
      spell.cast("Rend", on => this.getCurrentTarget(), req => this.getDebuffRemainingTime("Rend") <= 1.5),
      // actions.colossus_st+=/thunderous_roar
      spell.cast("Thunderous Roar", on => this.getCurrentTarget()),
      // actions.colossus_st+=/ravager,if=cooldown.colossus_smash.remains<=gcd
      spell.cast("Ravager", on => this.getCurrentTarget(), req => spell.getCooldown("Colossus Smash").timeleft <= 1.5 || spell.getCooldown("Warbreaker").timeleft <= 1.5),
      // actions.colossus_st+=/champions_spear
      spell.cast("Champion's Spear", on => this.getCurrentTarget(), req => this.shouldUseCooldowns()),
      // actions.colossus_st+=/avatar,if=raid_event.adds.in>15
      spell.cast("Avatar", req => Settings.UseAvatar && this.overlayToggles.avatar.value && this.shouldUseCooldowns()),
      // actions.colossus_st+=/colossus_smash
      spell.cast("Colossus Smash", req => Settings.UseColossusSmash && this.overlayToggles.colossusSmash.value),
      // actions.colossus_st+=/warbreaker
      spell.cast("Warbreaker", req => Settings.UseWarbreaker && this.overlayToggles.warbreaker.value),
      // actions.colossus_st+=/mortal_strike
      spell.cast("Mortal Strike", on => this.getCurrentTarget()),
      // actions.colossus_st+=/demolish
      spell.cast("Demolish", on => this.getCurrentTarget()),
      // actions.colossus_st+=/skullsplitter
      spell.cast("Skullsplitter", on => this.getCurrentTarget()),
      // actions.colossus_st+=/execute
      spell.cast("Execute", on => this.getCurrentTarget()),
      // actions.colossus_st+=/overpower
      spell.cast("Overpower", on => this.getCurrentTarget()),
      // actions.colossus_st+=/wrecking_throw
      spell.cast("Wrecking Throw", on => this.getCurrentTarget()),
      // actions.colossus_st+=/rend,if=dot.rend.remains<=gcd*5
      spell.cast("Rend", on => this.getCurrentTarget(), req => this.getDebuffRemainingTime("Rend") <= 7.5),
      // actions.colossus_st+=/slam
      spell.cast("Slam", on => this.getCurrentTarget())
    );
  }

  colossusSweep() {
    return new bt.Selector(
      // actions.colossus_sweep=thunder_clap,if=!dot.rend.remains&!buff.sweeping_strikes.up
      spell.cast("Thunder Clap", on => this.getCurrentTarget(), req => this.getDebuffRemainingTime("Rend") <= 0 && !me.hasAura("Sweeping Strikes")),
      // actions.colossus_sweep+=/rend,if=dot.rend.remains<=gcd&buff.sweeping_strikes.up
      spell.cast("Rend", on => this.getCurrentTarget(), req => this.getDebuffRemainingTime("Rend") <= 1.5 && me.hasAura("Sweeping Strikes")),
      // actions.colossus_sweep+=/thunderous_roar
      spell.cast("Thunderous Roar", on => this.getCurrentTarget()),
      // actions.colossus_sweep+=/sweeping_strikes
      spell.cast("Sweeping Strikes"),
      // actions.colossus_sweep+=/champions_spear
      spell.cast("Champion's Spear", on => this.getCurrentTarget(), req => this.shouldUseCooldowns()),
      // actions.colossus_sweep+=/ravager,if=cooldown.colossus_smash.ready
      spell.cast("Ravager", on => this.getCurrentTarget(), req => spell.getCooldown("Colossus Smash").ready || spell.getCooldown("Warbreaker").ready),
      // actions.colossus_sweep+=/avatar
      spell.cast("Avatar", req => Settings.UseAvatar && this.overlayToggles.avatar.value && this.shouldUseCooldowns()),
      // actions.colossus_sweep+=/colossus_smash
      spell.cast("Colossus Smash", req => Settings.UseColossusSmash && this.overlayToggles.colossusSmash.value),
      // actions.colossus_sweep+=/warbreaker
      spell.cast("Warbreaker", req => Settings.UseWarbreaker && this.overlayToggles.warbreaker.value),
      // actions.colossus_sweep+=/mortal_strike
      spell.cast("Mortal Strike", on => this.getCurrentTarget()),
      // actions.colossus_sweep+=/demolish,if=debuff.colossus_smash.up
      spell.cast("Demolish", on => this.getCurrentTarget(), req => this.getCurrentTarget().hasAuraByMe("Colossus Smash")),
      // actions.colossus_sweep+=/overpower
      spell.cast("Overpower", on => this.getCurrentTarget()),
      // actions.colossus_sweep+=/execute
      spell.cast("Execute", on => this.getCurrentTarget()),
      // actions.colossus_sweep+=/whirlwind,if=talent.fervor_of_battle
      spell.cast("Whirlwind", on => this.getCurrentTarget(), req => this.hasTalent("Fervor of Battle")),
      // actions.colossus_sweep+=/cleave,if=talent.fervor_of_battle
      spell.cast("Cleave", on => this.getCurrentTarget(), req => this.hasTalent("Fervor of Battle")),
      // actions.colossus_sweep+=/thunder_clap,if=dot.rend.remains<=8&buff.sweeping_strikes.down
      spell.cast("Thunder Clap", on => this.getCurrentTarget(), req => this.getDebuffRemainingTime("Rend") <= 8 && !me.hasAura("Sweeping Strikes")),
      // actions.colossus_sweep+=/wrecking_throw,if=!buff.sweeping_strikes.up
      spell.cast("Wrecking Throw", on => this.getCurrentTarget(), req => !me.hasAura("Sweeping Strikes")),
      // actions.colossus_sweep+=/rend,if=dot.rend.remains<=5
      spell.cast("Rend", on => this.getCurrentTarget(), req => this.getDebuffRemainingTime("Rend") <= 5),
      // actions.colossus_sweep+=/slam
      spell.cast("Slam", on => this.getCurrentTarget())
    );
  }

  slayerAoe() {
    return new bt.Selector(
      // actions.slayer_aoe=thunder_clap,if=!dot.rend.remains
      spell.cast("Thunder Clap", on => this.getCurrentTarget(), req => this.getDebuffRemainingTime("Rend") <= 0),
      // actions.slayer_aoe+=/sweeping_strikes
      spell.cast("Sweeping Strikes"),
      // actions.slayer_aoe+=/thunderous_roar
      spell.cast("Thunderous Roar", on => this.getCurrentTarget()),
      // actions.slayer_aoe+=/avatar
      spell.cast("Avatar", req => Settings.UseAvatar && this.overlayToggles.avatar.value && this.shouldUseCooldowns()),
      // actions.slayer_aoe+=/champions_spear
      spell.cast("Champion's Spear", on => this.getCurrentTarget(), req => this.shouldUseCooldowns()),
      // actions.slayer_aoe+=/ravager,if=cooldown.colossus_smash.remains<=gcd
      spell.cast("Ravager", on => this.getCurrentTarget(), req => spell.getCooldown("Colossus Smash").timeleft <= 1.5 || spell.getCooldown("Warbreaker").timeleft <= 1.5),
      // actions.slayer_aoe+=/warbreaker
      spell.cast("Warbreaker", req => Settings.UseWarbreaker && this.overlayToggles.warbreaker.value),
      // actions.slayer_aoe+=/colossus_smash
      spell.cast("Colossus Smash", req => Settings.UseColossusSmash && this.overlayToggles.colossusSmash.value),
      // actions.slayer_aoe+=/cleave
      spell.cast("Cleave", on => this.getCurrentTarget()),
      // actions.slayer_aoe+=/execute,if=buff.sudden_death.up&buff.imminent_demise.stack<3|buff.juggernaut.remains<3&talent.juggernaut
      spell.cast("Execute", on => this.getCurrentTarget(), req => (me.hasAura("Sudden Death") && me.getAuraStacks("Imminent Demise") < 3) || (this.getAuraRemainingTime("Juggernaut") < 3 && this.hasTalent("Juggernaut"))),
      // actions.slayer_aoe+=/bladestorm
      spell.cast("Bladestorm", on => this.getCurrentTarget()),
      // actions.slayer_aoe+=/overpower,if=buff.sweeping_strikes.up&(buff.opportunist.up|talent.dreadnaught&!talent.juggernaut)
      spell.cast("Overpower", on => this.getCurrentTarget(), req => me.hasAura("Sweeping Strikes") && (me.hasAura("Opportunist") || (this.hasTalent("Dreadnaught") && !this.hasTalent("Juggernaut")))),
      // actions.slayer_aoe+=/mortal_strike,if=buff.sweeping_strikes.up
      spell.cast("Mortal Strike", on => this.getCurrentTarget(), req => me.hasAura("Sweeping Strikes")),
      // actions.slayer_aoe+=/execute,if=buff.sweeping_strikes.up&debuff.executioners_precision.stack<2&talent.executioners_precision|debuff.marked_for_execution.up
      spell.cast("Execute", on => this.getCurrentTarget(), req => (me.hasAura("Sweeping Strikes") && this.getDebuffStacks("Executioner's Precision") < 2 && this.hasTalent("Executioner's Precision")) || this.getCurrentTarget().hasAuraByMe("Marked for Execution")),
      // actions.slayer_aoe+=/skullsplitter,if=buff.sweeping_strikes.up
      spell.cast("Skullsplitter", on => this.getCurrentTarget(), req => me.hasAura("Sweeping Strikes")),
      // actions.slayer_aoe+=/overpower,if=buff.opportunist.up|talent.dreadnaught
      spell.cast("Overpower", on => this.getCurrentTarget(), req => me.hasAura("Opportunist") || this.hasTalent("Dreadnaught")),
      // actions.slayer_aoe+=/mortal_strike
      spell.cast("Mortal Strike", on => this.getCurrentTarget()),
      // actions.slayer_aoe+=/overpower
      spell.cast("Overpower", on => this.getCurrentTarget()),
      // actions.slayer_aoe+=/thunder_clap
      spell.cast("Thunder Clap", on => this.getCurrentTarget()),
      // actions.slayer_aoe+=/execute
      spell.cast("Execute", on => this.getCurrentTarget()),
      // actions.slayer_aoe+=/wrecking_throw
      spell.cast("Wrecking Throw", on => this.getCurrentTarget()),
      // actions.slayer_aoe+=/whirlwind
      spell.cast("Whirlwind", on => this.getCurrentTarget()),
      // actions.slayer_aoe+=/skullsplitter
      spell.cast("Skullsplitter", on => this.getCurrentTarget()),
      // actions.slayer_aoe+=/slam
      spell.cast("Slam", on => this.getCurrentTarget()),
      // actions.slayer_aoe+=/storm_bolt,if=buff.bladestorm.up
      spell.cast("Storm Bolt", on => this.getCurrentTarget(), req => me.hasAura("Bladestorm"))
    );
  }

  slayerExecute() {
    return new bt.Selector(
      // actions.slayer_execute=sweeping_strikes,if=active_enemies=2
      spell.cast("Sweeping Strikes", req => this.getEnemiesInRange(8) === 2),
      // actions.slayer_execute+=/rend,if=dot.rend.remains<=gcd&!talent.bloodletting
      spell.cast("Rend", on => this.getCurrentTarget(), req => this.getDebuffRemainingTime("Rend") <= 1.5 && !this.hasTalent("Bloodletting")),
      // actions.slayer_execute+=/thunderous_roar
      spell.cast("Thunderous Roar", on => this.getCurrentTarget()),
      // actions.slayer_execute+=/avatar,if=cooldown.colossus_smash.remains<=5|debuff.colossus_smash.up
      spell.cast("Avatar", req => Settings.UseAvatar && this.overlayToggles.avatar.value && this.shouldUseCooldowns() && (spell.getCooldown("Colossus Smash").timeleft <= 5 || spell.getCooldown("Warbreaker").timeleft <= 5 || this.getCurrentTarget().hasAuraByMe("Colossus Smash"))),
      // actions.slayer_execute+=/champions_spear,if=debuff.colossus_smash.up|buff.avatar.up
      spell.cast("Champion's Spear", on => this.getCurrentTarget(), req => this.shouldUseCooldowns() && (this.getCurrentTarget().hasAuraByMe("Colossus Smash") || me.hasAura("Avatar"))),
      // actions.slayer_execute+=/ravager,if=cooldown.colossus_smash.remains<=gcd
      spell.cast("Ravager", on => this.getCurrentTarget(), req => spell.getCooldown("Colossus Smash").timeleft <= 1.5),
      // actions.slayer_execute+=/warbreaker
      spell.cast("Warbreaker", req => Settings.UseWarbreaker && this.overlayToggles.warbreaker.value),
      // actions.slayer_execute+=/colossus_smash
      spell.cast("Colossus Smash", req => Settings.UseColossusSmash && this.overlayToggles.colossusSmash.value),
      // actions.slayer_execute+=/execute,if=buff.juggernaut.remains<=gcd*2&talent.juggernaut
      spell.cast("Execute", on => this.getCurrentTarget(), req => this.getAuraRemainingTime("Juggernaut") <= 3.0 && this.hasTalent("Juggernaut")),
      // actions.slayer_execute+=/bladestorm,if=(debuff.executioners_precision.stack=2&(debuff.colossus_smash.remains>4|cooldown.colossus_smash.remains>15))|!talent.executioners_precision
      spell.cast("Bladestorm", on => this.getCurrentTarget(), req => (this.getDebuffStacks("Executioner's Precision") === 2 && (this.getDebuffRemainingTime("Colossus Smash") > 4 || spell.getCooldown("Colossus Smash").timeleft > 15)) || !this.hasTalent("Executioner's Precision")),
      // actions.slayer_execute+=/skullsplitter,if=rage<=40
      spell.cast("Skullsplitter", on => this.getCurrentTarget(), req => me.powerByType(PowerType.Rage) <= 40),
      // actions.slayer_execute+=/overpower,if=buff.overpower.stack<2&buff.opportunist.up&talent.opportunist&(talent.bladestorm|talent.ravager&rage<85)
      spell.cast("Overpower", on => this.getCurrentTarget(), req => me.getAuraStacks("Overpower") < 2 && me.hasAura("Opportunist") && this.hasTalent("Opportunist") && (this.hasTalent("Bladestorm") || (this.hasTalent("Ravager") && me.powerByType(PowerType.Rage) < 85))),
      // actions.slayer_execute+=/mortal_strike,if=dot.rend.remains<2|debuff.executioners_precision.stack=2&!buff.ravager.up
      spell.cast("Mortal Strike", on => this.getCurrentTarget(), req => this.getDebuffRemainingTime("Rend") < 2 || (this.getDebuffStacks("Executioner's Precision") === 2 && !me.hasAura("Ravager"))),
      // actions.slayer_execute+=/overpower,if=rage<=40&buff.overpower.stack<2&talent.fierce_followthrough
      spell.cast("Overpower", on => this.getCurrentTarget(), req => me.powerByType(PowerType.Rage) <= 40 && me.getAuraStacks("Overpower") < 2 && this.hasTalent("Fierce Followthrough")),
      // actions.slayer_execute+=/execute
      spell.cast("Execute", on => this.getCurrentTarget()),
      // actions.slayer_execute+=/overpower
      spell.cast("Overpower", on => this.getCurrentTarget()),
      // actions.slayer_execute+=/wrecking_throw
      spell.cast("Wrecking Throw", on => this.getCurrentTarget()),
      // actions.slayer_execute+=/storm_bolt,if=buff.bladestorm.up
      spell.cast("Storm Bolt", on => this.getCurrentTarget(), req => me.hasAura("Bladestorm"))
    );
  }

  slayerSt() {
    return new bt.Selector(
      // actions.slayer_st=rend,if=dot.rend.remains<=gcd
      spell.cast("Rend", on => this.getCurrentTarget(), req => this.getDebuffRemainingTime("Rend") <= 1.5),
      // actions.slayer_st+=/thunderous_roar
      spell.cast("Thunderous Roar", on => this.getCurrentTarget()),
      // actions.slayer_st+=/avatar,if=cooldown.colossus_smash.remains<=5|debuff.colossus_smash.up
      spell.cast("Avatar", req => Settings.UseAvatar && this.overlayToggles.avatar.value && this.shouldUseCooldowns() && (spell.getCooldown("Colossus Smash").timeleft <= 5 || spell.getCooldown("Warbreaker").timeleft <= 5 || this.getCurrentTarget().hasAuraByMe("Colossus Smash"))),
      // actions.slayer_st+=/champions_spear,if=debuff.colossus_smash.up|buff.avatar.up
      spell.cast("Champion's Spear", on => this.getCurrentTarget(), req => this.shouldUseCooldowns() && (this.getCurrentTarget().hasAuraByMe("Colossus Smash") || me.hasAura("Avatar"))),
      // actions.slayer_st+=/ravager,if=cooldown.colossus_smash.remains<=gcd
      spell.cast("Ravager", on => this.getCurrentTarget(), req => spell.getCooldown("Colossus Smash").timeleft <= 1.5 || spell.getCooldown("Warbreaker").timeleft <= 1.5),
      // actions.slayer_st+=/colossus_smash
      spell.cast("Colossus Smash", req => Settings.UseColossusSmash && this.overlayToggles.colossusSmash.value),
      // actions.slayer_st+=/warbreaker
      spell.cast("Warbreaker", req => Settings.UseWarbreaker && this.overlayToggles.warbreaker.value),
      // actions.slayer_st+=/execute,if=buff.juggernaut.remains<=gcd*2&talent.juggernaut|buff.sudden_death.stack=2|buff.sudden_death.remains<=gcd*3|debuff.marked_for_execution.stack=3
      spell.cast("Execute", on => this.getCurrentTarget(), req => (this.getAuraRemainingTime("Juggernaut") <= 3.0 && this.hasTalent("Juggernaut")) || me.getAuraStacks("Sudden Death") === 2 || this.getAuraRemainingTime("Sudden Death") <= 4.5 || this.getCurrentTarget().getAuraStacks("Marked for Execution") === 3),
      // actions.slayer_st+=/overpower,if=buff.opportunist.up
      spell.cast("Overpower", on => this.getCurrentTarget(), req => me.hasAura("Opportunist")),
      // actions.slayer_st+=/mortal_strike
      spell.cast("Mortal Strike", on => this.getCurrentTarget()),
      // actions.slayer_st+=/bladestorm,if=(cooldown.colossus_smash.remains>=gcd*4|cooldown.warbreaker.remains>=gcd*4)|debuff.colossus_smash.remains>=gcd*4
      spell.cast("Bladestorm", on => this.getCurrentTarget(), req => (spell.getCooldown("Colossus Smash").timeleft >= 6.0 || spell.getCooldown("Warbreaker").timeleft >= 6.0) || this.getDebuffRemainingTime("Colossus Smash") >= 6.0),
      // actions.slayer_st+=/skullsplitter
      spell.cast("Skullsplitter", on => this.getCurrentTarget()),
      // actions.slayer_st+=/overpower
      spell.cast("Overpower", on => this.getCurrentTarget()),
      // actions.slayer_st+=/rend,if=dot.rend.remains<=8
      spell.cast("Rend", on => this.getCurrentTarget(), req => this.getDebuffRemainingTime("Rend") <= 8),
      // actions.slayer_st+=/execute,if=!talent.juggernaut
      spell.cast("Execute", on => this.getCurrentTarget(), req => !this.hasTalent("Juggernaut")),
      // actions.slayer_st+=/wrecking_throw
      spell.cast("Wrecking Throw", on => this.getCurrentTarget()),
      // actions.slayer_st+=/cleave
      spell.cast("Cleave", on => this.getCurrentTarget()),
      // actions.slayer_st+=/slam
      spell.cast("Slam", on => this.getCurrentTarget()),
      // actions.slayer_st+=/storm_bolt,if=buff.bladestorm.up
      spell.cast("Storm Bolt", on => this.getCurrentTarget(), req => me.hasAura("Bladestorm"))
    );
  }

  slayerSweep() {
    return new bt.Selector(
      // actions.slayer_sweep=thunder_clap,if=!dot.rend.remains&!buff.sweeping_strikes.up
      spell.cast("Thunder Clap", on => this.getCurrentTarget(), req => this.getDebuffRemainingTime("Rend") <= 0 && !me.hasAura("Sweeping Strikes")),
      // actions.slayer_sweep+=/thunderous_roar
      spell.cast("Thunderous Roar", on => this.getCurrentTarget()),
      // actions.slayer_sweep+=/sweeping_strikes
      spell.cast("Sweeping Strikes"),
      // actions.slayer_sweep+=/rend,if=dot.rend.remains<=gcd
      spell.cast("Rend", on => this.getCurrentTarget(), req => this.getDebuffRemainingTime("Rend") <= 1.5),
      // actions.slayer_sweep+=/champions_spear
      spell.cast("Champion's Spear", on => this.getCurrentTarget(), req => this.shouldUseCooldowns()),
      // actions.slayer_sweep+=/avatar
      spell.cast("Avatar", req => Settings.UseAvatar && this.overlayToggles.avatar.value && this.shouldUseCooldowns()),
      // actions.slayer_sweep+=/colossus_smash
      spell.cast("Colossus Smash", req => Settings.UseColossusSmash && this.overlayToggles.colossusSmash.value),
      // actions.slayer_sweep+=/warbreaker
      spell.cast("Warbreaker", req => Settings.UseWarbreaker && this.overlayToggles.warbreaker.value),
      // actions.slayer_sweep+=/skullsplitter,if=buff.sweeping_strikes.up
      spell.cast("Skullsplitter", on => this.getCurrentTarget(), req => me.hasAura("Sweeping Strikes")),
      // actions.slayer_sweep+=/execute,if=buff.juggernaut.remains<=gcd*2|debuff.marked_for_execution.stack=3|buff.sudden_death.stack=2|buff.sudden_death.remains<=gcd*3
      spell.cast("Execute", on => this.getCurrentTarget(), req => this.getAuraRemainingTime("Juggernaut") <= 3.0 || this.getCurrentTarget().getAuraStacks("Marked for Execution") === 3 || me.getAuraStacks("Sudden Death") === 2 || this.getAuraRemainingTime("Sudden Death") <= 4.5),
      // actions.slayer_sweep+=/bladestorm,if=(cooldown.colossus_smash.remains>=gcd*4|cooldown.warbreaker.remains>=gcd*4)|debuff.colossus_smash.remains>=gcd*4
      spell.cast("Bladestorm", on => this.getCurrentTarget(), req => (spell.getCooldown("Colossus Smash").timeleft >= 6.0 || spell.getCooldown("Warbreaker").timeleft >= 6.0) || this.getDebuffRemainingTime("Colossus Smash") >= 6.0),
      // actions.slayer_sweep+=/overpower,if=buff.opportunist.up
      spell.cast("Overpower", on => this.getCurrentTarget(), req => me.hasAura("Opportunist")),
      // actions.slayer_sweep+=/mortal_strike
      spell.cast("Mortal Strike", on => this.getCurrentTarget()),
      // actions.slayer_sweep+=/overpower
      spell.cast("Overpower", on => this.getCurrentTarget()),
      // actions.slayer_sweep+=/thunder_clap,if=dot.rend.remains<=8&buff.sweeping_strikes.down
      spell.cast("Thunder Clap", on => this.getCurrentTarget(), req => this.getDebuffRemainingTime("Rend") <= 8 && !me.hasAura("Sweeping Strikes")),
      // actions.slayer_sweep+=/rend,if=dot.rend.remains<=5
      spell.cast("Rend", on => this.getCurrentTarget(), req => this.getDebuffRemainingTime("Rend") <= 5),
      // actions.slayer_sweep+=/cleave,if=talent.fervor_of_battle&!buff.overpower.up
      spell.cast("Cleave", on => this.getCurrentTarget(), req => this.hasTalent("Fervor of Battle") && !me.hasAura("Overpower")),
      // actions.slayer_sweep+=/whirlwind,if=talent.fervor_of_battle
      spell.cast("Whirlwind", on => this.getCurrentTarget(), req => this.hasTalent("Fervor of Battle")),
      // actions.slayer_sweep+=/execute,if=!talent.juggernaut
      spell.cast("Execute", on => this.getCurrentTarget(), req => !this.hasTalent("Juggernaut")),
      // actions.slayer_sweep+=/wrecking_throw,if=!buff.sweeping_strikes.up
      spell.cast("Wrecking Throw", on => this.getCurrentTarget(), req => !me.hasAura("Sweeping Strikes")),
      // actions.slayer_sweep+=/slam
      spell.cast("Slam", on => this.getCurrentTarget()),
      // actions.slayer_sweep+=/storm_bolt,if=buff.bladestorm.up
      spell.cast("Storm Bolt", on => this.getCurrentTarget(), req => me.hasAura("Bladestorm"))
    );
  }

  getCurrentTarget() {
    const targetPredicate = unit => common.validTarget(unit) && me.isWithinMeleeRange(unit) && me.isFacing(unit);
    const target = me.target;
    if (target !== null && targetPredicate(target)) {
      return target;
    }
    return combat.targets.find(targetPredicate) || null;
  }

  getEnemiesInRange(range) {
    return me.getUnitsAroundCount(range);
  }

  shouldUseCooldowns() {
    if (Settings.IgnoreTimeToDeath) {
      return !me.hasAura("Smothering Shadows");
    }
    
    const target = this.getCurrentTarget();
    return target && target.timeToDeath() > Settings.MinTimeToDeath && !me.hasAura("Smothering Shadows");
  }

  getAuraRemainingTime(auraName) {
    const aura = me.getAura(auraName);
    return aura ? aura.remaining : 0;
  }

  getDebuffRemainingTime(debuffName) {
    const target = this.getCurrentTarget();
    if (!target) return 0;
    const debuff = target.getAura(debuffName);
    return debuff ? debuff.remaining : 0;
  }

  getDebuffStacks(debuffName) {
    const target = this.getCurrentTarget();
    if (!target) return 0;
    const debuff = target.getAura(debuffName);
    return debuff ? debuff.stacks : 0;
  }

  getAuraStacks(auraName) {
    const aura = me.getAura(auraName);
    return aura ? aura.stacks : 0;
  }

  hasTalent(talentName) {
    return me.hasAura(talentName);
  }

  isExecutePhase() {
    const target = this.getCurrentTarget();
    if (!target) return false;
    return (this.hasTalent("Massacre") && target.pctHealth < 35) || target.pctHealth < 20;
  }

  getGCD() {
    return 1.5;
  }

  getTargetTimeToDie() {
    const target = this.getCurrentTarget();
    return target ? target.timeToDeath() : 0;
  }

  // PVP Rotation Methods - Single flat selector with everything in one place
  buildPVPRotation() {
    return new bt.Selector(
      // === ALWAYS PERFORM ACTIONS FIRST ===
      
      // === HIGH PRIORITY CC (Major Cooldowns) ===
      
      // === AVATAR-ENHANCED CC (Highest Priority during Avatar) ===
      // Storm Bolt healer during Avatar
      spell.cast("Storm Bolt", on => this.findHealerForStunCC(), req => 
        me.hasVisibleAura(389748) &&
        this.findHealerForStunCC() !== null &&
        this.overlayToggles.stormBolt.value
      ),
      
      // Storm Bolt current target during Avatar if healer has DR
      spell.cast("Storm Bolt", on => this.getCurrentTargetPVP(), req => 
        me.hasVisibleAura(389748) &&
        this.shouldStormBoltCurrentTarget() &&
        this.overlayToggles.stormBolt.value
      ),
      
      // === REGULAR CC (Major Cooldowns) ===
      // Disarm enemies with major cooldowns
      spell.cast(236077, on => this.findDisarmTarget(), req => this.findDisarmTarget() !== null),
      
      // Storm Bolt CC enemies with major cooldowns  
      spell.cast("Storm Bolt", on => this.findStormBoltCCTarget(), req => this.findStormBoltCCTarget() !== null),
      
      // Storm Bolt healer priority (when not in Avatar)
      spell.cast("Storm Bolt", on => this.findHealerForStunCC(), req => 
        !me.hasVisibleAura(389748) &&
        this.findHealerForStunCC() !== null &&
        this.overlayToggles.stormBolt.value
      ),
      
      // Intimidating Shout for multi-target fear
      spell.cast("Intimidating Shout", on => this.findIntimidatingShoutTarget(), req => this.findIntimidatingShoutTarget() !== null),
      
      // Hamstring for slowing enemies (high priority after CC)
      spell.cast("Hamstring", () => {
        if (!Settings.UseHamstring) {
          return false;
        }
        
        const target = this.getCurrentTargetPVP();
        if (!target) {
          return false;
        }
        
        // Don't cast if target has movement debuffs already
        if (target.hasVisibleAura(1715) || target.hasVisibleAura(12323)) {
          return false;
        }
        
        // Don't cast if target has immunity or slow immunity
        if (pvpHelpers.hasImmunity(target)) {
          return false;
        }
        if (target.hasVisibleAura(1044)) { // Blessing of Freedom
          return false;
        }
        
        // Check timing based on ACTUAL successful casts from Spell.js
        const lastSuccessfulTime = spell._lastSuccessfulCastTimes.get("hamstring");
        const now = wow.frameTime;
        const timeSinceSuccess = lastSuccessfulTime ? now - lastSuccessfulTime : 999999;
        
        // Only cast every X seconds after successful cast (user configurable)
        if (lastSuccessfulTime && timeSinceSuccess < (Settings.HamstringCooldown * 1000)) {
          return false;
        }
        
        console.log(`Hamstring ready - target: ${target.unsafeName}, timeSince: ${(timeSinceSuccess/1000).toFixed(1)}s`);
        return true;
      }),
      
      // Battle Shout
      spell.cast("Battle Shout", () => !me.hasAura("Battle Shout")),
      
      // Stance management
      spell.cast("Defensive Stance", () => 
        me.pctHealth < Settings.DefensiveStanceHealthPct && 
        !me.hasAura("Defensive Stance") &&
        this.overlayToggles.defensives.value
      ),
      spell.cast("Battle Stance", () => 
        me.pctHealth > (Settings.DefensiveStanceHealthPct + 10) && 
        me.hasAura("Defensive Stance")
      ),
      
      // Interrupts and CC
      spell.interrupt("Pummel"),
      
      // Shattering Throw for Ice Block/Divine Shield
      spell.cast("Shattering Throw", on => this.findShatteringThrowTarget(), req => this.findShatteringThrowTarget() !== null),
      
      // Protective Intervene for friendly healers under rogue CC
      spell.cast("Intervene", on => this.findHealerUnderRogueCC(), req => 
        Settings.UseProtectiveIntervene &&
        this.findHealerUnderRogueCC() !== null &&
        this.overlayToggles.defensives.value
      ),

      // Protective Intervene for friendly healers under hunter stun
      spell.cast("Intervene", on => this.findHealerUnderHunterStun(), req => 
        Settings.UseProtectiveIntervene &&
        this.findHealerUnderHunterStun() !== null &&
        this.overlayToggles.defensives.value,
        ret => {
          if (ret === bt.Status.Success) {
            this.lastInterveneOnStunnedHealerTime = wow.frameTime;
          }
        }
      ),

      // Spell Reflection for incoming casts
      spell.cast("Spell Reflection", () => 
        this.shouldSpellReflectPVP()
      ),

      // Hamstring moved to higher priority position after CC abilities
      

      
      // Defensive abilities
      spell.cast("Ignore Pain", () => 
        Settings.UseIgnorePain &&
        this.overlayToggles.defensives.value &&
        me.pctHealth < Settings.IgnorePainHealthPct &&
        me.powerByType(PowerType.Rage) >= Settings.IgnorePainRage &&
        !me.hasAura("Ignore Pain")
      ),
      spell.cast("Die by the Sword", () => 
        Settings.UseDieByTheSword &&
        this.overlayToggles.defensives.value &&
        me.pctHealth < 40 &&
        this.shouldUseDieByTheSword()
      ),
      spell.cast("Victory Rush", on => this.getCurrentTargetPVP(), req => 
        Settings.UseImpendingVictory &&
        this.overlayToggles.defensives.value &&
        this.shouldUseImpendingVictory()
      ),
      spell.cast("Rallying Cry", () => 
        Settings.UseRallyingCry && 
        this.overlayToggles.defensives.value &&
        me.pctHealth < Settings.RallyingCryHealthPct
      ),
      
      // Storm Bolt interrupts
      spell.interrupt("Storm Bolt"),
      
      // Piercing Howl
      spell.cast("Piercing Howl", () => Settings.UsePiercingHowl && this.shouldCastPiercingHowl()),

      // === BURST ACTIONS (SLAYER BUILD) ===
      // Rend if target missing it - Slayer
      spell.cast("Rend", on => this.getCurrentTargetPVP(), req => 
        combat.burstToggle &&
        this.hasTalent("Slayer's Dominance") &&
        me.target &&
        !this.getCurrentTargetPVP()?.hasAuraByMe("Rend")
      ),
      
      // Champion's Spear - Slayer
      spell.cast("Champion's Spear", on => this.getCurrentTargetPVP(), req => 
        combat.burstToggle &&
        this.hasTalent("Slayer's Dominance") &&
        me.target &&
        Settings.UseChampionsSpear
      ),
      
      // Avatar - Slayer
      spell.cast("Avatar", req => 
        combat.burstToggle &&
        this.hasTalent("Slayer's Dominance") &&
        me.target &&
        Settings.UseAvatar &&
        this.overlayToggles.avatar.value
      ),
      
      // Blood Fury - Slayer
      spell.cast("Blood Fury", req => 
        combat.burstToggle &&
        this.hasTalent("Slayer's Dominance") &&
        me.target
      ),
      

      
      // Colossus Smash - Slayer
      spell.cast("Colossus Smash", req => 
        combat.burstToggle &&
        this.hasTalent("Slayer's Dominance") &&
        me.target &&
        Settings.UseColossusSmash &&
        this.overlayToggles.colossusSmash.value
      ),
      
      // Warbreaker - Slayer
      spell.cast("Warbreaker", req => 
        combat.burstToggle &&
        this.hasTalent("Slayer's Dominance") &&
        me.target &&
        Settings.UseWarbreaker &&
        this.overlayToggles.warbreaker.value
      ),
      
      // Thunderous Roar - Slayer
      spell.cast("Thunderous Roar", on => this.getCurrentTargetPVP(), req => 
        combat.burstToggle &&
        this.hasTalent("Slayer's Dominance") &&
        me.target
      ),
      
      // Sharpened Blade - Slayer
      spell.cast("Sharpened Blade", on => this.getCurrentTargetPVP(), req => 
        combat.burstToggle &&
        this.hasTalent("Slayer's Dominance") &&
        me.target
      ),
      
      // Mortal Strike - Slayer
      spell.cast("Mortal Strike", on => this.getCurrentTargetPVP(), req => 
        combat.burstToggle &&
        this.hasTalent("Slayer's Dominance") &&
        me.target
      ),
      
      // Overpower with 2 charges - Slayer
      spell.cast("Overpower", on => this.getCurrentTargetPVP(), req => 
        combat.burstToggle &&
        this.hasTalent("Slayer's Dominance") &&
        me.target &&
        spell.getCharges("Overpower") >= 2
      ),
      
      // Execute with Sudden Death - Slayer
      spell.cast("Execute", on => this.getCurrentTargetPVP(), req => 
        combat.burstToggle &&
        this.hasTalent("Slayer's Dominance") &&
        me.target &&
        me.hasAura("Sudden Death")
      ),
      
      // Overpower - Slayer
      spell.cast("Overpower", on => this.getCurrentTargetPVP(), req => 
        combat.burstToggle &&
        this.hasTalent("Slayer's Dominance") &&
        me.target
      ),
      
      // Bladestorm - Slayer
      spell.cast("Bladestorm", on => this.getCurrentTargetPVP(), req => 
        combat.burstToggle &&
        this.hasTalent("Slayer's Dominance") &&
        me.target
      ),

      // === BURST ACTIONS (COLOSSUS BUILD) ===
      // Champion's Spear - Colossus
      spell.cast("Champion's Spear", on => this.getCurrentTargetPVP(), req => 
        combat.burstToggle &&
        !this.hasTalent("Slayer's Dominance") &&
        me.target &&
        Settings.UseChampionsSpear &&
        me.getAuraStacks(440989) == 10
      ),
      
      // Avatar - Colossus
      spell.cast("Avatar", req => 
        combat.burstToggle &&
        !this.hasTalent("Slayer's Dominance") &&
        me.target &&
        me.getAuraStacks(440989) == 10 && 
        spell.getCooldown(436358).timeleft < 1000
      ),
      
      // Blood Fury - Colossus
      spell.cast("Blood Fury", req => 
        combat.burstToggle &&
        !this.hasTalent("Slayer's Dominance") &&
        me.target &&
        me.getAuraStacks(440989) == 10 && 
        spell.getCooldown(436358).timeleft < 1000
      ),
      
      // Colossus Smash - Colossus
      spell.cast("Colossus Smash", req => 
        combat.burstToggle &&
        !this.hasTalent("Slayer's Dominance") &&
        me.target &&
        Settings.UseColossusSmash &&
        this.overlayToggles.colossusSmash.value &&
        me.getAuraStacks(440989) == 10 &&
        spell.getCooldown(436358).timeleft < 1000
      ),
      
      // Warbreaker - Colossus
      spell.cast("Warbreaker", req => 
        combat.burstToggle &&
        !this.hasTalent("Slayer's Dominance") &&
        me.target &&
        Settings.UseWarbreaker &&
        this.overlayToggles.warbreaker.value &&
        me.getAuraStacks(440989) == 10 &&
        spell.getCooldown(436358).timeleft < 1000
      ),
      
      // Thunderous Roar - Colossus
      spell.cast("Thunderous Roar", on => this.getCurrentTargetPVP(), req => 
        combat.burstToggle &&
        !this.hasTalent("Slayer's Dominance") &&
        me.target &&
        me.getAuraStacks(440989) == 10 && 
        spell.getCooldown(436358).timeleft < 1000
      ),
      

      
      // Demolish - Colossus
      spell.cast("Demolish", on => this.getCurrentTargetPVP(), req => 
        combat.burstToggle &&
        !this.hasTalent("Slayer's Dominance") &&
        me.target &&
        me.getAuraStacks(440989) == 10 && 
        this.getCurrentTargetPVP().hasVisibleAura(208086)
      ),
      
      // Mortal Strike - Colossus
      spell.cast("Mortal Strike", on => this.getCurrentTargetPVP(), req => 
        combat.burstToggle &&
        !this.hasTalent("Slayer's Dominance") &&
        me.target &&
        spell.getCooldown(436358).timeleft > 40000
      ),
      
      // Bladestorm - Colossus
      spell.cast("Bladestorm", on => this.getCurrentTargetPVP(), req => 
        combat.burstToggle &&
        !this.hasTalent("Slayer's Dominance") &&
        me.target &&
        spell.getCooldown(436358).timeleft > 40000
      ),

      // === REGULAR PRIORITY ACTIONS ===
      // Sweeping Strikes if 2+ enemies
      spell.cast("Sweeping Strikes", () => 
        Settings.UseSweepingStrikes &&
        this.getEnemiesInRange(8) >= 2 &&
        !me.hasAura("Sweeping Strikes")
      ),
      
      // Mortal Strike if target missing critical debuffs
      spell.cast("Mortal Strike", on => this.getCurrentTargetPVP(), req => 
        this.targetMissingCriticalDebuffs()
      ),
      
      // Execute with Sudden Death (Slayer build)
      spell.cast("Execute", on => this.getCurrentTargetPVP(), req => 
        me.hasAura("Sudden Death") && 
        this.hasTalent("Slayer's Dominance")
      ),
      
      // Thunder Clap if 3+ enemies without Rend
      spell.cast("Thunder Clap", on => this.getCurrentTargetPVP(), req => 
        this.getEnemiesInRange(8) >= 3 &&
        this.getEnemiesWithoutRend() >= 3
      ),
      
      // Rend on nearby enemy without Rend (if < 3 enemies)
      spell.cast("Rend", on => this.getNearbyEnemyWithoutRend(), req => 
        this.getEnemiesInRange(8) < 3 &&
        this.getNearbyEnemyWithoutRend() !== null
      ),
      
      // Mortal Strike
      spell.cast("Mortal Strike", on => this.getCurrentTargetPVP()),
      
      // Overpower
      spell.cast("Overpower", on => this.getCurrentTargetPVP()),
      
      // Execute
      spell.cast("Execute", on => this.getCurrentTargetPVP()),
      
      // Slam
      spell.cast("Slam", on => this.getCurrentTargetPVP())
    );
  }

  buildPVPAlwaysPerform() {
    // Use the same simple bt.Selector approach as Fury for reliable CC
    return new bt.Selector(
      // Battle Shout
      spell.cast("Battle Shout", () => !me.hasAura("Battle Shout")),
      
      // Stance management (Defensive/Battle instead of Defensive/Berserker like Fury)
      spell.cast("Defensive Stance", () => 
        me.pctHealth < Settings.DefensiveStanceHealthPct && 
        !me.hasAura("Defensive Stance") &&
        this.overlayToggles.defensives.value
      ),
      spell.cast("Battle Stance", () => 
        me.pctHealth > (Settings.DefensiveStanceHealthPct + 10) && 
        me.hasAura("Defensive Stance")
      ),
      
      // Shattering Throw for Ice Block/Divine Shield
      spell.cast("Shattering Throw", on => this.findShatteringThrowTarget(), req => this.findShatteringThrowTarget() !== null),
      
      // Protective Intervene for friendly healers under rogue CC
      spell.cast("Intervene", on => this.findHealerUnderRogueCC(), req => 
        Settings.UseProtectiveIntervene &&
        this.findHealerUnderRogueCC() !== null &&
        this.overlayToggles.defensives.value
      ),

             // Protective Intervene for friendly healers under hunter stun
       spell.cast("Intervene", on => this.findHealerUnderHunterStun(), req => 
         Settings.UseProtectiveIntervene &&
         this.findHealerUnderHunterStun() !== null &&
         this.overlayToggles.defensives.value,
         ret => {
           if (ret === bt.Status.Success) {
             this.lastInterveneOnStunnedHealerTime = wow.frameTime;
             console.info(`[Arms] Successfully intervened stunned healer - preparing follow-up Spell Reflect`);
           }
         }
       ),
       
       // High-priority Spell Reflect after successful Intervene on stunned healer
       spell.cast(23920, () => 
         this.shouldSpellReflectAfterIntervene() ||
         this.shouldSpellReflectPVP(),
         ret => {
           if (ret === bt.Status.Success && this.lastInterveneOnStunnedHealerTime > 0) {
             console.info(`[Arms] Successfully cast follow-up Spell Reflect after Intervene`);
             this.lastInterveneOnStunnedHealerTime = 0; // Reset to prevent repeated casts
           }
         }
       ),
      
      // Pummel interrupts for PVP
      spell.interrupt("Pummel"),
      
      // Hamstring is handled in main PVP rotation for better priority
      
      // CC enemies with major cooldowns - SAME AS FURY
      spell.cast(236077, on => this.findDisarmTarget(), req => this.findDisarmTarget() !== null),
      spell.cast("Storm Bolt", on => this.findStormBoltCCTarget(), req => this.findStormBoltCCTarget() !== null),
      spell.cast("Intimidating Shout", on => this.findIntimidatingShoutTarget(), req => this.findIntimidatingShoutTarget() !== null),
      
      // Defensive abilities
      spell.cast("Ignore Pain", () => 
        Settings.UseIgnorePain &&
        this.overlayToggles.defensives.value &&
        me.pctHealth < Settings.IgnorePainHealthPct &&
        me.powerByType(PowerType.Rage) >= Settings.IgnorePainRage &&
        !me.hasAura("Ignore Pain")
      ),
      spell.cast("Die by the Sword", () => 
        Settings.UseDieByTheSword &&
        this.overlayToggles.defensives.value &&
        me.pctHealth < 40 &&
        this.shouldUseDieByTheSword()
      ),
      spell.cast("Victory Rush", on => this.getCurrentTargetPVP(), req => 
        Settings.UseImpendingVictory &&
        this.overlayToggles.defensives.value &&
        this.shouldUseImpendingVictory()
      ),
      spell.cast("Rallying Cry", () => 
        Settings.UseRallyingCry && 
        this.overlayToggles.defensives.value &&
        me.pctHealth < Settings.RallyingCryHealthPct
      ),
      
      // Storm Bolt interrupts
      spell.interrupt("Storm Bolt"),
      
      // Piercing Howl
      spell.cast("Piercing Howl", () => Settings.UsePiercingHowl && this.shouldCastPiercingHowl()),
    );
  }

  buildPVPRegularPriority() {
    return new bt.Selector(
      // Sweeping Strikes if 2+ enemies
      spell.cast("Sweeping Strikes", () => 
        Settings.UseSweepingStrikes &&
        this.getEnemiesInRange(8) >= 2 &&
        !me.hasAura("Sweeping Strikes")
      ),
      
      // Hamstring (with enhanced logic handled in buildPVPAlwaysPerform)
      // Note: Hamstring is now handled by the advanced logic in buildPVPAlwaysPerform
      
      // Mortal Strike if target missing critical debuffs
      spell.cast("Mortal Strike", on => this.getCurrentTargetPVP(), req => 
        this.targetMissingCriticalDebuffs()
      ),
      
      // Execute with Sudden Death (Slayer build)
      spell.cast("Execute", on => this.getCurrentTargetPVP(), req => 
        me.hasAura("Sudden Death") && 
        this.hasTalent("Slayer's Dominance")
      ),
      
      // Thunder Clap if 3+ enemies without Rend
      spell.cast("Thunder Clap", on => this.getCurrentTargetPVP(), req => 
        this.getEnemiesInRange(8) >= 3 &&
        this.getEnemiesWithoutRend() >= 3
      ),
      
      // Rend on nearby enemy without Rend (if < 3 enemies)
      spell.cast("Rend", on => this.getNearbyEnemyWithoutRend(), req => 
        this.getEnemiesInRange(8) < 3 &&
        this.getNearbyEnemyWithoutRend() !== null
      ),
      
      // Overpower with 2 charges
      spell.cast("Overpower", on => this.getCurrentTargetPVP(), req => 
        spell.getCharges("Overpower") >= 2
      ),
      
      // Mortal Strike
      spell.cast("Mortal Strike", on => this.getCurrentTargetPVP()),
      
      // Execute conditions (Colossus build)
      spell.cast("Execute", on => this.getCurrentTargetPVP(), req => 
        !this.hasTalent("Slayer's Dominance") &&
        (me.powerByType(PowerType.Rage) > 40 || me.hasAura("Sudden Death"))
      ),
      
      // Overpower
      spell.cast("Overpower", on => this.getCurrentTargetPVP()),
      
      // Execute
      spell.cast("Execute", on => this.getCurrentTargetPVP()),
      
      // Slam
      spell.cast("Slam", on => this.getCurrentTargetPVP())
    );
  }



  buildColossusBurst() {
    return new bt.Selector(
      // Champion's Spear
      spell.cast("Champion's Spear", on => this.getCurrentTargetPVP(), req => 
        Settings.UseChampionsSpear &&
        me.getAuraStacks(440989) == 10
      ),
      
      // Avatar
      spell.cast("Avatar", req => me.getAuraStacks(440989) == 10 && spell.getCooldown(436358).timeleft < 1000),
      
      // Blood Fury
      spell.cast("Blood Fury", req => me.getAuraStacks(440989) == 10 && spell.getCooldown(436358).timeleft < 1000),
      
      // Colossus Smash
      spell.cast("Colossus Smash", req => 
        Settings.UseColossusSmash && 
        this.overlayToggles.colossusSmash.value &&
        me.getAuraStacks(440989) == 10 &&
        spell.getCooldown(436358).timeleft < 1000
      ),
      
      // Warbreaker
      spell.cast("Warbreaker", req => 
        Settings.UseWarbreaker && 
        this.overlayToggles.warbreaker.value &&
        me.getAuraStacks(440989) == 10 &&
        spell.getCooldown(436358).timeleft < 1000
      ),
      
      // Thunderous Roar
      spell.cast("Thunderous Roar", on => this.getCurrentTargetPVP(), req => me.getAuraStacks(440989) == 10 && spell.getCooldown(436358).timeleft < 1000),
      
      // CC sequence
      this.buildCCSequence(),
      
      // Demolish
      spell.cast("Demolish", on => this.getCurrentTargetPVP(), req => me.getAuraStacks(440989) == 10 && this.getCurrentTargetPVP().hasVisibleAura(208086)),
      
      // Mortal Strike
      spell.cast("Mortal Strike", on => this.getCurrentTargetPVP(), req => spell.getCooldown(436358).timeleft > 40000),

      // Bladestorm
      spell.cast("Bladestorm", on => this.getCurrentTargetPVP(), req => spell.getCooldown(436358).timeleft > 40000),
      
      // Always fall back to regular rotation if no burst abilities are available
      new bt.Action(() => bt.Status.Failure)
    );
  }

  buildSlayerBurst() {
    return new bt.Selector(
      this.buildPVPAlwaysPerform(),
      spell.cast("Sweeping Strikes", () => 
        Settings.UseSweepingStrikes &&
        this.getEnemiesInRange(8) >= 2 &&
        !me.hasAura("Sweeping Strikes")
      ),
      // Rend if target missing it
      spell.cast("Rend", on => this.getCurrentTargetPVP(), req => 
        !this.getCurrentTargetPVP()?.hasAuraByMe("Rend")
      ),
      
      // Champion's Spear
      spell.cast("Champion's Spear", on => this.getCurrentTargetPVP(), req => 
        Settings.UseChampionsSpear
      ),
      
      // Avatar
      spell.cast("Avatar", req => 
        Settings.UseAvatar && 
        this.overlayToggles.avatar.value
      ),

      // Blood Fury
      spell.cast("Blood Fury"),
      
      // CC with Avatar buff
      new bt.Decorator(
        () => me.hasAura("Avatar"),
        this.buildCCSequence()
      ),
      
      // Colossus Smash
      spell.cast("Colossus Smash", req => 
        Settings.UseColossusSmash && 
        this.overlayToggles.colossusSmash.value
      ),
      
      // Warbreaker
      spell.cast("Warbreaker", req => 
        Settings.UseWarbreaker && 
        this.overlayToggles.warbreaker.value
      ),
      
      // Thunderous Roar
      spell.cast("Thunderous Roar", on => this.getCurrentTargetPVP()),
      
      // Sharpened Blade
      spell.cast("Sharpened Blade", on => this.getCurrentTargetPVP()),
      
      // Mortal Strike
      spell.cast("Mortal Strike", on => this.getCurrentTargetPVP()),
      
      // Overpower with 2 charges
      spell.cast("Overpower", on => this.getCurrentTargetPVP(), req => 
        spell.getCharges("Overpower") >= 2
      ),
      
      // Execute with Sudden Death
      spell.cast("Execute", on => this.getCurrentTargetPVP(), req => 
        me.hasAura("Sudden Death")
      ),
      
      // Overpower
      spell.cast("Overpower", on => this.getCurrentTargetPVP()),
      
      // Bladestorm
      spell.cast("Bladestorm", on => this.getCurrentTargetPVP()),
      
      // Always fall back to regular rotation if no burst abilities are available
      new bt.Action(() => bt.Status.Failure)
    );
  }

  buildCCSequence() {
    return new bt.Selector(
      // CC healer with Storm Bolt during burst
      spell.cast("Storm Bolt", on => this.findHealerForStunCC(), req => 
        this.findHealerForStunCC() !== null &&
        this.overlayToggles.stormBolt.value
      ),
      
      // CC current target with Storm Bolt if healer has stun DR
      spell.cast("Storm Bolt", on => this.getCurrentTargetPVP(), req => 
        this.shouldStormBoltCurrentTarget() &&
        this.overlayToggles.stormBolt.value
      ),

      // Allow fallback if no CC abilities are available
      new bt.Action(() => bt.Status.Failure)
    );
  }

  // PVP Helper Methods
  getCurrentTargetPVP() {
    const targetEnemyPredicate = unit => common.validTarget(unit) && me.isWithinMeleeRange(unit) && me.isFacing(unit) && !pvpHelpers.hasImmunity(unit) && unit.isPlayer();
    const targetPredicate = unit => common.validTarget(unit) && me.isWithinMeleeRange(unit) && me.isFacing(unit) && !pvpHelpers.hasImmunity(unit);
    const target = me.target;
    if (target !== null && targetPredicate(target)) {
      return target;
    }
    return combat.targets.find(targetEnemyPredicate) || null;
  }

  targetMissingCriticalDebuffs() {
    const target = this.getCurrentTargetPVP();
    if (!target) return false;
    
    return !target.hasAuraByMe("Mortal Wounds") || 
           !target.hasAuraByMe("Deep Wounds");
  }

  getEnemiesWithoutRend() {
    const enemies = combat.targets.filter(unit => 
      me.distanceTo(unit) <= 8 && 
      !unit.hasAuraByMe("Rend")
    );
    return enemies.length;
  }

  getNearbyEnemyWithoutRend() {
    return combat.targets.find(unit => 
      me.distanceTo(unit) <= 8 && 
      !unit.hasAuraByMe("Rend")
    ) || null;
  }

  shouldUseDieByTheSword() {
    // Check if enemy team has major cooldowns up and they're not CC'd
    const enemies = me.getEnemies();
    
    for (const enemy of enemies) {
      if (!enemy.isPlayer() || me.distanceTo(enemy) > 20) continue;
      
      // Check if enemy has major offensive cooldowns using advanced detection
      if (this.hasMajorCooldowns(enemy)) {
        // Check if they're not CC'd using DR tracker
        const isStunned = drTracker.isCCdByCategory(enemy.guid, "stun");
        const isDisoriented = drTracker.isCCdByCategory(enemy.guid, "disorient");
        const isIncapacitated = enemy.hasAura("Polymorph") || enemy.hasAura("Cyclone");
        
        if (!isStunned && !isDisoriented && !isIncapacitated) {
          return true;
        }
      }
    }
    
    return false;
  }

  shouldUseImpendingVictory() {
    const friendlyHealer = this.findFriendlyHealer();
    
    if (!friendlyHealer) {
      // No friendly healer detected, use at higher health threshold
      return me.effectiveHealthPercent < Settings.ImpendingVictoryNoHealerHealthPct;
    }
    
    // Check if our healer is not in LOS or is CC'd
    const healerNotInLOS = !me.withinLineOfSight(friendlyHealer);
    const healerCCd = drTracker.isCCdByCategory(friendlyHealer.guid, "stun") ||
                      drTracker.isCCdByCategory(friendlyHealer.guid, "disorient") ||
                      friendlyHealer.hasAura("Polymorph") ||
                      friendlyHealer.hasAura("Cyclone") ||
                      friendlyHealer.hasAura("Fear") ||
                      friendlyHealer.hasAura("Intimidating Shout");
    
    if (healerNotInLOS || healerCCd) {
      // Our healer is unavailable, use at higher health threshold
      return me.effectiveHealthPercent < Settings.ImpendingVictoryNoHealerHealthPct;
    }
    
    // Our healer is available, use normal threshold
    return me.effectiveHealthPercent < Settings.ImpendingVictoryHealthPct;
  }

  findShatteringThrowTarget() {
    const enemies = me.getEnemies();
    for (const enemy of enemies) {
      if (enemy.isPlayer() && me.distanceTo(enemy) <= 30) {
        // Check for Ice Block (45438), Divine Shield (642), or Divine Protection (498)
        const hasIceBlock = enemy.hasAura(45438);
        const hasDivineShield = enemy.hasAura(642);
        const hasBlessingOfProtection = enemy.hasAura(1022);
        
        if (hasIceBlock || hasDivineShield || hasBlessingOfProtection) {
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
          drTracker.getDRStacks(enemy.guid, "disarm") < 2 &&
          !pvpHelpers.hasImmunity(enemy) &&
          !enemy.isCCd()) {
        
        // Check for major damage cooldowns (like Priest does)
        const majorCooldown = pvpHelpers.hasMajorDamageCooldown(enemy, 3);
        const disarmableBuff = pvpHelpers.hasDisarmableBuff(enemy, false, 3);
        
        if (disarmableBuff) {
          //console.log(`[Arms] Disarm target found: ${enemy.unsafeName} - ${majorCooldown ? `Major CD: ${majorCooldown.name}` : ''} ${disarmableBuff ? `Disarmable: ${disarmableBuff.name}` : ''}`);
          return enemy;
        }
      }
    }
    return null;
  }

  findStormBoltCCTarget() {
    const enemies = me.getEnemies();
    for (const enemy of enemies) {
      if (enemy.isPlayer() && 
          me.distanceTo(enemy) > 7 && 
          me.distanceTo(enemy) <= 20 &&
          drTracker.getDRStacks(enemy.guid, "stun") < 2 &&
          !pvpHelpers.hasImmunity(enemy) &&
          !enemy.isCCd()) {
        
        // Check for major damage cooldowns (like Priest does)
        const majorCooldown = pvpHelpers.hasMajorDamageCooldown(enemy, 3);
        
        if (majorCooldown) {
          console.log(`[Arms] Storm Bolt CC target found: ${enemy.unsafeName} - Major CD: ${majorCooldown.name} (${majorCooldown.remainingTime.toFixed(1)}s remaining)`);
          return enemy;
        }
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



  shouldCastPiercingHowl() {
    // Get enemies within 12 yards
    const enemies = me.getEnemies();
    const enemiesInRange = enemies.filter(enemy => 
      enemy.isPlayer() && 
      me.distanceTo(enemy) <= 12 &&
      !pvpHelpers.hasImmunity(enemy) &&
      !enemy.hasVisibleAura(1044) // Don't target enemies with Blessing of Freedom
    );
    
    return enemiesInRange.length >= 2;
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



  shouldSpellReflectAfterIntervene() {
    // Cast Spell Reflect within 2.5 seconds after successful Intervene on stunned healer
    const timeSinceIntervene = wow.frameTime - this.lastInterveneOnStunnedHealerTime;
    
    // Reset timer if too much time has passed (failsafe)
    if (this.lastInterveneOnStunnedHealerTime > 0 && timeSinceIntervene > 2500) {
      this.lastInterveneOnStunnedHealerTime = 0;
      return false;
    }
    
    const shouldReflect = this.lastInterveneOnStunnedHealerTime > 0 && 
                         timeSinceIntervene <= 2500 && 
                         !spell.isOnCooldown(23920) &&
                         !me.hasAura("Spell Reflection");
    
    if (shouldReflect) {
      console.info(`[Arms] Casting follow-up Spell Reflect (${timeSinceIntervene}ms after Intervene)`);
      return true;
    }
    
    return false;
  }

  hasMajorCooldowns(unit) {
    if (!unit.isPlayer()) return false;
    // Check for major damage cooldowns with sufficient duration (like Priest does)
    const majorDamageCooldown = pvpHelpers.hasMajorDamageCooldown(unit);
    const disarmableBuff = pvpHelpers.hasDisarmableBuff(unit, false);
    
    // Debug logging to see what's happening
    if (majorDamageCooldown || disarmableBuff) {
      console.log(`[Arms] Major cooldowns detected on ${unit.unsafeName}: ${majorDamageCooldown ? `Damage CD: ${majorDamageCooldown.name}` : ''} ${disarmableBuff ? `Disarmable: ${disarmableBuff.name}` : ''}`);
    }
    
    return majorDamageCooldown || disarmableBuff;
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

  findHealerForStunCC() {
    const enemies = me.getEnemies();
    for (const enemy of enemies) {
      if (enemy.isPlayer() && 
          enemy.isHealer() &&
          me.distanceTo(enemy) <= 30 &&
          drTracker.getDRStacks(enemy.guid, "stun") == 0 &&
          !pvpHelpers.hasImmunity(enemy)) {
        return enemy;
      }
    }
    return null;
  }

  findFriendlyHealer() {
    const friends = me.getFriends();
    for (const friend of friends) {
      if (friend.isPlayer() && 
          friend.isHealer() &&
          me.distanceTo(friend) <= 40) {
        return friend;
      }
    }
    return null;
  }

  findHealerUnderRogueCC() {
    const friends = me.getFriends();
    for (const friend of friends) {
      if (friend.isPlayer() && 
          friend.isHealer() &&
          me.distanceTo(friend) <= 25) { // Intervene range
        
        // Check for specific rogue CC debuffs
        const hasCheapShot = friend.hasVisibleAura(1833);   // Cheap Shot
        const hasKidneyShot = friend.hasVisibleAura(408);   // Kidney Shot  
        const hasGarrote = friend.hasVisibleAura(703);      // Garrote (silence)
        
        if (hasCheapShot || hasKidneyShot || hasGarrote) {
          console.info(`[Arms] Found healer ${friend.unsafeName} under rogue CC - attempting Intervene`);
          return friend;
        }
      }
    }
    return null;
  }

  findHealerUnderHunterStun() {
    const friends = me.getFriends();
    for (const friend of friends) {
      if (friend.isPlayer() && friend.isHealer() && me.distanceTo(friend) <= 25) {
        const hasIntimidation = friend.hasAura("Intimidation");

        if (hasIntimidation) {
          console.info(`[Arms] Found healer ${friend.unsafeName} under Hunter Stun - attempting Intervene`);
          return friend;
        }
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

  shouldStormBoltCurrentTarget() {
    const target = this.getCurrentTargetPVP();
    if (!target || !target.isPlayer()) return false;
    
    const healer = this.findHealerForStunCC();
    const healerHasStunDR = healer && drTracker.getDRStacks(healer.guid, "stun") >= 1;
    const targetIsNotHealer = !target.isHealer();
    
    return healerHasStunDR && targetIsNotHealer && drTracker.getDRStacks(target.guid, "stun") < 1 && target.isPlayer();
  }
}
