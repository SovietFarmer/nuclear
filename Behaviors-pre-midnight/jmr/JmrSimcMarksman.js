import { Behavior, BehaviorContext } from "@/Core/Behavior";
import * as bt from '@/Core/BehaviorTree';
import Specialization from '@/Enums/Specialization';
import common from '@/Core/Common';
import spell from "@/Core/Spell";
import { me } from "@/Core/ObjectManager";
import { PowerType } from "@/Enums/PowerType";
import { defaultCombatTargeting as combat } from "@/Targeting/CombatTargeting";
import { DispelPriority } from "@/Data/Dispels";
import { WoWDispelType } from "@/Enums/Auras";
import Settings from "@/Core/Settings";
import drTracker from "@/Core/DRTracker";
import pvpData, { pvpHelpers, pvpReflect, pvpInterrupts } from "@/Data/PVPData";
import { drHelpers } from "@/Data/PVPDRList";
import { toastInfo, toastSuccess, toastWarning, toastError } from '@/Extra/ToastNotification';
import CommandListener from '@/Core/CommandListener';
import colors from '@/Enums/Colors';

export class JmrSimcMarksmanBehavior extends Behavior {  
  context = BehaviorContext.Any;
  specialization = Specialization.Hunter.Marksmanship;
  version = wow.GameVersion.Retail;
  name = "Jmr SimC Marksman Hunter";

  // Runtime toggles for overlay (independent of settings)
  overlayToggles = {
    showOverlay: new imgui.MutableVariable(true),
    interrupts: new imgui.MutableVariable(true),
    trueshot: new imgui.MutableVariable(true),
    counterShot: new imgui.MutableVariable(true),
    binding: new imgui.MutableVariable(true),
    intimidation: new imgui.MutableVariable(true),
    defensives: new imgui.MutableVariable(true),
    manualTrap: new imgui.MutableVariable(true),
    chimaeralSting: new imgui.MutableVariable(true),
    huntersMark: new imgui.MutableVariable(true)
  };

  // Burst mode toggle state
  burstModeActive = false;
  
  // Manual spell casting
  spellIdInput = new imgui.MutableVariable("193455");
  
  // Target variables for APL
  currentTarget = null;
  activeEnemies = 1;

  // Aimed Shot tracking
  aimedShotCastTime = 0;

  constructor() {
    super();
    // Register for combat log events to track Aimed Shot casts
    this.eventListener = new wow.EventListener();
    this.eventListener.onEvent = this.onEvent.bind(this);
  }

  onEvent(event) {
    if (event.name === "COMBAT_LOG_EVENT_UNFILTERED") {
      const [eventData] = event.args;
      
      // Track successful Aimed Shot casts
      if (eventData.eventType === 6 && // SPELL_CAST_SUCCESS
          eventData.source.guid.equals(me.guid)) {
        const spellId = eventData.args[0];
        const aimedShotId = spell.getSpell("Aimed Shot")?.id;
        
        if (spellId === aimedShotId) {
          this.aimedShotCastTime = wow.frameTime;
        }
      }
    }
  }

  static settings = [
    {
      header: "PVP Settings",
      options: [
        { type: "checkbox", uid: "EnablePVPRotation", text: "Enable PVP Rotation", default: false },
        { type: "checkbox", uid: "UseTrueshot", text: "Use Trueshot", default: true },
        { type: "checkbox", uid: "UseCounterShot", text: "Use Counter Shot", default: true },
        { type: "checkbox", uid: "UseIntimidation", text: "Use Intimidation", default: true },
        { type: "checkbox", uid: "IntimidationHealerOnly", text: "Intimidation: Target Healers Only", default: false },
        { type: "checkbox", uid: "UseBinding", text: "Use Binding Shot", default: true },
        { type: "checkbox", uid: "UseFreezingTrap", text: "Use Freezing Trap", default: true },
        { type: "checkbox", uid: "UseTarTrap", text: "Use Tar Trap", default: true },
        { type: "checkbox", uid: "UseMastersCall", text: "Use Master's Call", default: true },
        { type: "checkbox", uid: "UseFeignDeath", text: "Use Feign Death", default: true },
        { type: "checkbox", uid: "UseConcussiveShot", text: "Use Concussive Shot", default: true },
        { type: "checkbox", uid: "UseExplosiveTrap", text: "Use High Explosive Trap", default: true },
        { type: "checkbox", uid: "UseBurstingShot", text: "Use Bursting Shot", default: true },
        { type: "checkbox", uid: "UseDefensives", text: "Use Defensive Abilities", default: true },
        { type: "checkbox", uid: "UseHuntersMark", text: "Use Hunter's Mark", default: true },
        { type: "checkbox", uid: "UseChimaeralSting", text: "Use Chimaeral Sting", default: true },
        { type: "checkbox", uid: "DrawHealerLine", text: "Draw Line to Distant/Hidden Healer", default: true }
      ]
    },
    {
      header: "Defensive Settings", 
      options: [
        { type: "checkbox", uid: "UseExhilaration", text: "Use Exhilaration", default: true },
        { type: "slider", uid: "ExhilarationHealth", text: "Exhilaration health threshold (%)", min: 20, max: 80, default: 40 },
        { type: "checkbox", uid: "UseAspectOfTheTurtle", text: "Use Aspect of the Turtle", default: true },
        { type: "slider", uid: "AspectOfTheTurtleHealth", text: "Aspect of the Turtle health threshold (%)", min: 10, max: 50, default: 25 },
        { type: "checkbox", uid: "UseSurvivalOfTheFittest", text: "Use Survival of the Fittest", default: true },
        { type: "slider", uid: "SurvivalOfTheFittestHealth", text: "Survival of the Fittest health threshold (%)", min: 30, max: 70, default: 50 },
        { type: "checkbox", uid: "UseRoarOfSacrifice", text: "Use Roar of Sacrifice", default: true },
        { type: "slider", uid: "RoarOfSacrificeHealth", text: "Roar of Sacrifice health threshold (%)", min: 40, max: 80, default: 60 }
      ]
    }
  ];

  build() {    
    return new bt.Selector(
      // Overlay rendering - runs every frame FIRST
      new bt.Action(() => {
        this.renderOverlay();
        return bt.Status.Failure; // Always continue to the rest of the rotation
      }),
      
      common.waitForNotMounted(),
      common.waitForNotSitting(),
      common.waitForCastOrChannel(),
      common.waitForTarget(),
      
      // PVP rotation takes priority if enabled
      new bt.Decorator(
        () => Settings.EnablePVPRotation,
        this.buildPVPRotation(),
        new bt.Action(() => bt.Status.Success)
      ),
      
      // Standard PVE rotation if PVP is disabled
      new bt.Decorator(
        () => !Settings.EnablePVPRotation,
        new bt.Selector(
          spell.interrupt("Counter Shot"),
          spell.dispel("Tranquilizing Shot", false, DispelPriority.Medium, false, WoWDispelType.Magic),
          spell.cast("Trueshot"),
          spell.cast("Blood Fury"),
          common.waitForFacing(),
          new bt.Action(() => {
            const spellId = wow.SpellBook.singleButtonAssistantSpellId;
            const spellName = spell.getSpell(spellId)?.name;
            if (spellId > 0) {
              //console.info(spellName);
              const target = me.target
              return spell.cast(spellName, on => target).execute({});
            }
            return bt.Status.Failure;
          })
        ),
        new bt.Action(() => bt.Status.Success)
      )
    );
  }



  buildCds() {
    return new bt.Selector(
      // berserking,if=buff.trueshot.up|fight_remains<13
      spell.cast("Berserking", () => 
        me.hasVisibleAura("Trueshot")
      ),

      // blood_fury,if=buff.trueshot.up|cooldown.trueshot.remains>30
      spell.cast("Blood Fury", () => 
        me.hasVisibleAura("Trueshot") ||
        spell.getCooldown("Trueshot")?.timeleft > 30000
      ),

      // ancestral_call,if=buff.trueshot.up|cooldown.trueshot.remains>30
      spell.cast("Ancestral Call", () => 
        me.hasVisibleAura("Trueshot") ||
        spell.getCooldown("Trueshot")?.timeleft > 30000
      ),

      // fireblood,if=buff.trueshot.up|cooldown.trueshot.remains>30
      spell.cast("Fireblood", () => 
        me.hasVisibleAura("Trueshot") ||
        spell.getCooldown("Trueshot")?.timeleft > 30000
      )
    );
  }

  buildPVPRotation() {
    return new bt.Selector(
      // Always perform actions (defensive, utilities)
      this.buildPVPAlwaysPerform(),
      
      // Burst mode
      new bt.Decorator(
        () => this.burstModeActive,
        this.buildPVPBurst()
      ),
      
      // Regular PVP rotation
      this.buildPVPSustained()
    );
  }

  buildPVPAlwaysPerform() {
    return new bt.Selector(
      // Hunter's Mark maintenance
      spell.cast("Hunter's Mark", on => this.getCurrentTargetPVP(), req => 
        this.getCurrentTargetPVP() && 
        !this.getCurrentTargetPVP().hasAuraByMe("Hunter's Mark") &&
        this.getCurrentTargetPVP().isPlayer()
      ),
      
      // Master's Call if we're rooted
      spell.cast("Master's Call", () => 
        Settings.UseMastersCall &&
        me.isRooted()
      ),
      
      // Feign Death for spells we would spell reflect
      spell.cast("Feign Death", () => 
        Settings.UseFeignDeath &&
        this.overlayToggles.defensives.value &&
        this.shouldFeignDeathPVP()
      ),
      
      // Tranquilizing Shot dispels
      spell.dispel("Tranquilizing Shot", false, DispelPriority.Medium, true, WoWDispelType.Magic),
      spell.dispel("Tranquilizing Shot", false, DispelPriority.Medium, true, WoWDispelType.Enrage),
      
      // Binding Shot - enemies within range
      spell.cast("Binding Shot", on => this.findBindingShotTargetPVP(), req => 
        Settings.UseBinding &&
        this.overlayToggles.binding.value &&
        this.findBindingShotTargetPVP() !== undefined
      ),
      
      // Freezing Trap enemy healer when stunned (but not if they're our target)
      spell.cast("Freezing Trap", on => this.findFreezingTrapTargetPVP(), req => 
        Settings.UseFreezingTrap &&
        this.findFreezingTrapTargetPVP() !== undefined &&
        this.findFreezingTrapTargetPVP() !== me.target
      ),

      // Chimaeral Sting on healer
      spell.cast("Chimaeral Sting", on => this.findEnemyHealerNotCC(), req => 
        this.overlayToggles.chimaeralSting.value &&
        me.hasVisibleAura("Trueshot") &&
        this.findEnemyHealerNotCC() !== undefined
      ),
      
      // Tar Trap enemies within range
      spell.cast("Tar Trap", on => this.findTarTrapLocationPVP(), req => 
        Settings.UseTarTrap &&
        this.findTarTrapLocationPVP() !== undefined
      ),
      
      // High Explosive Trap non-healers within range with major cooldowns
      spell.cast("High Explosive Trap", on => this.findExplosiveTrapLocationPVP(), req => 
        Settings.UseExplosiveTrap &&
        this.findExplosiveTrapLocationPVP() !== undefined
      ),
      
      // Intimidation for CC
      spell.cast("Intimidation", on => this.findIntimidationTargetPVP(), req => 
        Settings.UseIntimidation &&
        this.overlayToggles.intimidation.value &&
        this.findIntimidationTargetPVP() !== undefined
      ),
      
      // Bursting Shot non-healers within range
      spell.cast("Bursting Shot", on => this.findBurstingShotTargetPVP(), req => 
        Settings.UseBurstingShot &&
        this.findBurstingShotTargetPVP() !== undefined
      ),
      
      // Concussive Shot for kiting
      spell.cast("Concussive Shot", on => this.findConcussiveShotTargetPVP(), req => 
        Settings.UseConcussiveShot &&
        this.findConcussiveShotTargetPVP() !== undefined
      ),
      
      // Counter Shot interrupt
      spell.interrupt("Counter Shot", true),

      // Interrupt enemy healers with Intimidation when Freezing Trap is almost ready
      spell.cast("Intimidation", on => this.findHealerToInterruptForTrap(), req => 
        this.findHealerToInterruptForTrap() !== undefined
      ),
      
      // Defensive abilities
      spell.cast("Exhilaration", () => 
        Settings.UseExhilaration && 
        this.overlayToggles.defensives.value &&
        me.pctHealth <= Settings.ExhilarationHealth
      ),

      spell.cast("Aspect of the Turtle", () => 
        Settings.UseAspectOfTheTurtle && 
        this.overlayToggles.defensives.value &&
        me.pctHealth <= Settings.AspectOfTheTurtleHealth
      ),

      spell.cast("Survival of the Fittest", () => 
        Settings.UseSurvivalOfTheFittest && 
        this.overlayToggles.defensives.value &&
        me.pctHealth <= Settings.SurvivalOfTheFittestHealth &&
        this.isUnderPressure()
      ),

      spell.cast("Roar of Sacrifice", () => 
        Settings.UseRoarOfSacrifice && 
        this.overlayToggles.defensives.value &&
        me.pctHealth <= Settings.RoarOfSacrificeHealth
      )
    );
  }

  buildPVPBurst() {
    return new bt.Selector(
      // Trueshot
      spell.cast("Trueshot", () => 
        Settings.UseTrueshot
      ),

      spell.cast("Blood Fury", () => 
        me.hasVisibleAura("Trueshot")
      ),

      // Black Arrow (if Dark Ranger)
      spell.cast("Black Arrow", on => this.getCurrentTargetPVP(), req => 
        this.hasTalent("Black Arrow") &&
        this.getCurrentTargetPVP() !== undefined, {
        skipLineOfSightCheck: this.shouldSkipLOSCheck()
      }),

      // Rapid Fire
      spell.cast("Rapid Fire", on => this.getCurrentTargetPVP(), req => 
        this.getCurrentTargetPVP() !== undefined, {
        skipLineOfSightCheck: this.shouldSkipLOSCheck()
      }),

      // Arcane Shot with Precise Shots
      spell.cast("Arcane Shot", on => this.getCurrentTargetPVP(), req => 
        this.getCurrentTargetPVP() !== undefined &&
        me.hasVisibleAura("Precise Shots"), {
        skipLineOfSightCheck: this.shouldSkipLOSCheck()
      }),

      // Aimed Shot without Precise Shots
      spell.cast("Aimed Shot", on => this.getCurrentTargetPVP(), req => 
        this.getCurrentTargetPVP() !== undefined &&
        !me.hasVisibleAura("Precise Shots"), {
        skipLineOfSightCheck: this.shouldSkipLOSCheck()
      }),

      // Chimaeral Sting on healer
      spell.cast("Chimaeral Sting", on => this.findEnemyHealerNotCC(), req => 
        Settings.UseChimaeralSting &&
        this.overlayToggles.chimaeralSting.value &&
        this.findEnemyHealerNotCC() !== undefined
      ),

      // Volley (if Salvo)
      spell.cast("Volley", on => this.getCurrentTargetPVP(), req => 
        this.getCurrentTargetPVP() !== undefined, {
        skipLineOfSightCheck: this.shouldSkipLOSCheck()
      })
    );
  }

  buildPVPSustained() {
    return new bt.Selector(
      // Black Arrow/Kill Shot
      spell.cast("Black Arrow", on => this.getCurrentTargetPVP(), req => 
        this.hasTalent("Black Arrow") &&
        this.getCurrentTargetPVP() !== undefined, {
        skipLineOfSightCheck: this.shouldSkipLOSCheck()
      }),

      spell.cast("Kill Shot", on => this.getCurrentTargetPVP(), req => 
        this.getCurrentTargetPVP() !== undefined &&
        this.getCurrentTargetPVP().pctHealth <= 20, {
        skipLineOfSightCheck: this.shouldSkipLOSCheck()
      }),

      // Rapid Fire
      spell.cast("Rapid Fire", on => this.getCurrentTargetPVP(), req => 
        this.getCurrentTargetPVP() !== undefined, {
        skipLineOfSightCheck: this.shouldSkipLOSCheck()
      }),

      // Aimed Shot without Precise Shots
      spell.cast("Aimed Shot", on => this.getCurrentTargetPVP(), req => 
        this.getCurrentTargetPVP() !== undefined &&
        !me.hasVisibleAura("Precise Shots") &&
        me.hasVisibleAura("Streamline"), {
        skipLineOfSightCheck: this.shouldSkipLOSCheck()
      }),

      // Arcane Shot with Precise Shots
      spell.cast("Arcane Shot", on => this.getCurrentTargetPVP(), req => 
        this.getCurrentTargetPVP() !== undefined &&
        me.hasVisibleAura("Precise Shots"), {
        skipLineOfSightCheck: this.shouldSkipLOSCheck()
      }),

      // Explosive Shot
      spell.cast("Explosive Shot", on => this.getCurrentTargetPVP(), req => 
        this.getCurrentTargetPVP() !== undefined, {
        skipLineOfSightCheck: this.shouldSkipLOSCheck()
      }),

      // Steady Shot fallback
      spell.cast("Steady Shot", on => this.getCurrentTargetPVP(), req => 
        this.getCurrentTargetPVP() !== undefined, {
        skipLineOfSightCheck: this.shouldSkipLOSCheck()
      }),

      // Hunter's Mark refresh when disarmed
      spell.cast("Hunter's Mark", on => this.getCurrentTargetPVP(), req => 
        this.getCurrentTargetPVP() !== undefined &&
        me.hasAura("Disarm")
      )
    );
  }



  isTrueshotReady() {
    // variable,name=trueshot_ready,value=!talent.bullseye|fight_remains>cooldown.trueshot.duration+buff.trueshot.duration|buff.bullseye.stack=buff.bullseye.max_stack|fight_remains<25
    return true;
  }

  // Build action lists for different scenarios
  buildTrickshots() {
    return new bt.Selector(

      // explosive_shot,if=talent.precision_detonation&action.aimed_shot.in_flight&buff.trueshot.down&(!talent.shrapnel_shot|buff.lock_and_load.down)
      spell.cast("Explosive Shot", on => this.getCurrentTarget(), req => 
        this.hasTalent("Precision Detonation") &&
        // this.isAimedShotInFlight() &&
        !me.hasVisibleAura("Trueshot") &&
        (!this.hasTalent("Shrapnel Shot") || !me.hasVisibleAura("Lock and Load"))
      ),

      // volley,if=buff.double_tap.down&(!talent.shrapnel_shot|buff.lock_and_load.down)
      spell.cast("Volley", on => this.getCurrentTarget(), req => 
        !me.hasVisibleAura("Double Tap") &&
        (!this.hasTalent("Shrapnel Shot") || !me.hasVisibleAura("Lock and Load"))
      ),

      // rapid_fire,if=talent.bulletstorm&buff.bulletstorm.down&buff.trick_shots.remains>execute_time
      spell.cast("Rapid Fire", on => this.getCurrentTarget(), req => 
        this.hasTalent("Bulletstorm") &&
        !me.hasVisibleAura("Bulletstorm") &&
        this.getTrickShotsRemaining() > 2.3 // Approximate execute time
      ),

      // multishot,target_if=max:debuff.spotters_mark.down|action.aimed_shot.in_flight_to_target,if=buff.precise_shots.up&buff.moving_target.down|buff.trick_shots.down
      spell.cast("Multi-Shot", on => this.getBestMultiShotTarget(), req => 
        (me.hasVisibleAura("Precise Shots") && !me.hasVisibleAura("Moving Target")) ||
        !me.hasVisibleAura("Trick Shots")
      ),

      // trueshot,if=variable.trueshot_ready&buff.double_tap.down
      spell.cast("Trueshot", () => 
        this.isTrueshotReady() &&
        !me.hasVisibleAura("Double Tap")
      ),

      // aimed_shot,if=(buff.precise_shots.down|debuff.spotters_mark.up&buff.moving_target.up)&buff.trick_shots.up
      spell.cast("Aimed Shot", on => this.getBestAimedShotTarget(), req => 
        (!me.hasVisibleAura("Precise Shots") || 
         (this.getCurrentTarget() && this.getCurrentTarget().hasAuraByMe("Spotter's Mark") && me.hasVisibleAura("Moving Target"))) &&
        me.hasVisibleAura("Trick Shots")
      ),

      // rapid_fire,if=buff.trick_shots.remains>execute_time
      spell.cast("Rapid Fire", on => this.getCurrentTarget(), req => 
        this.getTrickShotsRemaining() > 2.3
      ),

      // explosive_shot,if=!talent.shrapnel_shot
      spell.cast("Explosive Shot", on => this.getCurrentTarget(), req => 
        !this.hasTalent("Shrapnel Shot")
      ),

      // steady_shot,if=focus+cast_regen<focus.max
      spell.cast("Steady Shot", on => this.getCurrentTarget(), req => 
        me.powerByType(PowerType.Focus) < 75
      ),

      // multishot
      spell.cast("Multi-Shot", on => this.getCurrentTarget()),
      spell.cast("Steady Shot", on => this.getCurrentTarget())
    );
  }

  buildCleave() {
    return new bt.Selector(
      spell.cast("Steady Shot", on => this.getCurrentTarget()),
      // explosive_shot,if=talent.precision_detonation&action.aimed_shot.in_flight&(buff.trueshot.down|!talent.windrunner_quiver)
      spell.cast("Explosive Shot", on => this.getCurrentTarget(), req => 
        this.hasTalent("Precision Detonation") &&
        this.isAimedShotInFlight() &&
        (!me.hasVisibleAura("Trueshot") || !this.hasTalent("Windrunner Quiver"))
      ),

      // black_arrow,if=buff.precise_shots.up&buff.moving_target.down&variable.trueshot_ready
      spell.cast("Black Arrow", on => this.getCurrentTarget(), req => 
        this.hasTalent("Black Arrow") &&
        me.hasVisibleAura("Precise Shots") &&
        !me.hasVisibleAura("Moving Target") &&
        this.isTrueshotReady()
      ),

      // volley,if=(talent.double_tap&buff.double_tap.down|!talent.aspect_of_the_hydra)&(buff.precise_shots.down|buff.moving_target.up)
      spell.cast("Volley", on => this.getCurrentTarget(), req => 
        (this.hasTalent("Double Tap") && !me.hasVisibleAura("Double Tap") || !this.hasTalent("Aspect of the Hydra")) &&
        (!me.hasVisibleAura("Precise Shots") || me.hasVisibleAura("Moving Target"))
      ),

      // rapid_fire,if=talent.bulletstorm&buff.bulletstorm.down&(!talent.double_tap|buff.double_tap.up|!talent.aspect_of_the_hydra&buff.trick_shots.remains>execute_time)&(buff.precise_shots.down|buff.moving_target.up|!talent.volley)
      spell.cast("Rapid Fire", on => this.getCurrentTarget(), req => 
        this.hasTalent("Bulletstorm") &&
        !me.hasVisibleAura("Bulletstorm") &&
        (!this.hasTalent("Double Tap") || me.hasVisibleAura("Double Tap") || 
         (!this.hasTalent("Aspect of the Hydra") && this.getTrickShotsRemaining() > 2.3)) &&
        (!me.hasVisibleAura("Precise Shots") || me.hasVisibleAura("Moving Target") || !this.hasTalent("Volley"))
      ),

      // trueshot,if=variable.trueshot_ready&(buff.double_tap.down|!talent.volley)
      spell.cast("Trueshot", () => 
        this.isTrueshotReady() &&
        (!me.hasVisibleAura("Double Tap") || !this.hasTalent("Volley"))
      ),

      // kill_shot,target_if=max:debuff.spotters_mark.down|action.aimed_shot.in_flight_to_target|max_prio_damage,if=talent.headshot&buff.precise_shots.up&(debuff.spotters_mark.down|buff.moving_target.down)|!talent.headshot&buff.razor_fragments.up
      spell.cast("Kill Shot", on => this.getBestKillShotTarget(), req => 
        (this.hasTalent("Headshot") && me.hasVisibleAura("Precise Shots") && 
         (!this.getCurrentTarget()?.hasAuraByMe("Spotter's Mark") || !me.hasVisibleAura("Moving Target"))) ||
        (!this.hasTalent("Headshot") && me.hasVisibleAura("Razor Fragments"))
      ),

      // aimed_shot,target_if=max:debuff.spotters_mark.up,if=(buff.precise_shots.down|debuff.spotters_mark.up&buff.moving_target.up)&full_recharge_time<action.rapid_fire.execute_time+cast_time
      spell.cast("Aimed Shot", on => this.getBestAimedShotTarget(), req => 
        (!me.hasVisibleAura("Precise Shots") || 
         (this.getCurrentTarget()?.hasAuraByMe("Spotter's Mark") && me.hasVisibleAura("Moving Target"))) &&
        this.getAimedShotFullRechargeTime() < (2.3 + 2.5) // Rapid Fire execute + Aimed Shot cast time
      ),

      // rapid_fire,if=!talent.bulletstorm|buff.bulletstorm.stack<=10|talent.aspect_of_the_hydra
      spell.cast("Rapid Fire", on => this.getCurrentTarget(), req => 
        !this.hasTalent("Bulletstorm") ||
        (me.getAuraStacks ? (me.getAuraStacks("Bulletstorm") || 0) : 0) <= 10 ||
        this.hasTalent("Aspect of the Hydra")
      ),

      // aimed_shot,target_if=max:debuff.spotters_mark.up|max_prio_damage,if=buff.precise_shots.down|debuff.spotters_mark.up&buff.moving_target.up
      spell.cast("Aimed Shot", on => this.getBestAimedShotTarget(), req => 
        !me.hasVisibleAura("Precise Shots") ||
        (this.getCurrentTarget()?.hasAuraByMe("Spotter's Mark") && me.hasVisibleAura("Moving Target"))
      ),

      // arcane_shot,target_if=max:debuff.spotters_mark.down|action.aimed_shot.in_flight_to_target|max_prio_damage,if=buff.precise_shots.up&(debuff.spotters_mark.down|buff.moving_target.down)
      spell.cast("Arcane Shot", on => this.getBestArcaneShotTarget(), req => 
        me.hasVisibleAura("Precise Shots") &&
        (!this.getCurrentTarget()?.hasAuraByMe("Spotter's Mark") || !me.hasVisibleAura("Moving Target"))
      ),

      // explosive_shot,if=talent.precision_detonation|buff.trueshot.down
      spell.cast("Explosive Shot", on => this.getCurrentTarget(), req => 
        this.hasTalent("Precision Detonation") || !me.hasVisibleAura("Trueshot")
      ),

      // steady_shot
      spell.cast("Steady Shot", on => this.getCurrentTarget())
    );
  }



  buildDrst() {
    return new bt.Selector(
      spell.cast("Steady Shot", on => this.getCurrentTarget()),
      // explosive_shot,if=talent.precision_detonation&action.aimed_shot.in_flight&buff.trueshot.down&buff.lock_and_load.down
      spell.cast("Explosive Shot", on => this.getCurrentTarget(), req => 
        this.hasTalent("Precision Detonation") &&
        this.isAimedShotInFlight() &&
        !me.hasVisibleAura("Trueshot") &&
        !me.hasVisibleAura("Lock and Load")
      ),

      // volley,if=buff.double_tap.down
      spell.cast("Volley", on => this.getCurrentTarget(), req => 
        !me.hasVisibleAura("Double Tap")
      ),

      // black_arrow,if=!talent.headshot|talent.headshot&buff.precise_shots.up&(debuff.spotters_mark.down|buff.moving_target.down)
      spell.cast("Black Arrow", on => this.getCurrentTarget(), req => 
        !this.hasTalent("Headshot") ||
        (this.hasTalent("Headshot") && me.hasVisibleAura("Precise Shots") &&
         (!this.getCurrentTarget()?.hasAuraByMe("Spotter's Mark") || !me.hasVisibleAura("Moving Target")))
      ),

      // aimed_shot,if=buff.trueshot.up&buff.precise_shots.down|buff.lock_and_load.up&buff.moving_target.up
      spell.cast("Aimed Shot", on => this.getCurrentTarget(), req => 
        (me.hasVisibleAura("Trueshot") && !me.hasVisibleAura("Precise Shots")) ||
        (me.hasVisibleAura("Lock and Load") && me.hasVisibleAura("Moving Target"))
      ),

      // rapid_fire,if=!buff.deathblow.react
      spell.cast("Rapid Fire", on => this.getCurrentTarget(), req => 
        !me.hasVisibleAura("Deathblow")
      ),

      // trueshot,if=variable.trueshot_ready&buff.double_tap.down&buff.deathblow.down
      spell.cast("Trueshot", () => 
        this.isTrueshotReady() &&
        !me.hasVisibleAura("Double Tap") &&
        !me.hasVisibleAura("Deathblow")
      ),

      // arcane_shot,if=buff.precise_shots.up&(debuff.spotters_mark.down|buff.moving_target.down)
      spell.cast("Arcane Shot", on => this.getCurrentTarget(), req => 
        me.hasVisibleAura("Precise Shots") &&
        (!this.getCurrentTarget()?.hasAuraByMe("Spotter's Mark") || !me.hasVisibleAura("Moving Target"))
      ),

      // aimed_shot,if=buff.precise_shots.down|debuff.spotters_mark.up&buff.moving_target.up
      spell.cast("Aimed Shot", on => this.getCurrentTarget(), req => 
        !me.hasVisibleAura("Precise Shots") ||
        (this.getCurrentTarget()?.hasAuraByMe("Spotter's Mark") && me.hasVisibleAura("Moving Target"))
      ),

      // explosive_shot,if=talent.shrapnel_shot&buff.lock_and_load.down
      spell.cast("Explosive Shot", on => this.getCurrentTarget(), req => 
        this.hasTalent("Shrapnel Shot") &&
        !me.hasVisibleAura("Lock and Load")
      ),

      // steady_shot
      spell.cast("Steady Shot", on => this.getCurrentTarget())
    );
  }

  buildSentst() {
    return new bt.Selector(
      spell.cast("Steady Shot", on => this.getCurrentTarget()),
      // explosive_shot,if=talent.precision_detonation&action.aimed_shot.in_flight&buff.trueshot.down
      spell.cast("Explosive Shot", on => this.getCurrentTarget(), req => 
        this.hasTalent("Precision Detonation") &&
        this.isAimedShotInFlight() &&
        !me.hasVisibleAura("Trueshot")
      ),

      // volley,if=buff.double_tap.down
      spell.cast("Volley", on => this.getCurrentTarget(), req => 
        !me.hasVisibleAura("Double Tap")
      ),

      // trueshot,if=variable.trueshot_ready&buff.double_tap.down
      spell.cast("Trueshot", () => 
        this.isTrueshotReady() &&
        !me.hasVisibleAura("Double Tap")
      ),

      // rapid_fire,if=talent.lunar_storm&buff.lunar_storm_cooldown.down
      spell.cast("Rapid Fire", on => this.getCurrentTarget(), req => 
        this.hasTalent("Lunar Storm") &&
        !me.hasVisibleAura("Lunar Storm Cooldown")
      ),

      // kill_shot,if=talent.headshot&buff.precise_shots.up&(debuff.spotters_mark.down|buff.moving_target.down)|!talent.headshot&buff.razor_fragments.up
      spell.cast("Kill Shot", on => this.getCurrentTarget(), req => 
        (this.hasTalent("Headshot") && me.hasVisibleAura("Precise Shots") &&
         (!this.getCurrentTarget()?.hasAuraByMe("Spotter's Mark") || !me.hasVisibleAura("Moving Target"))) ||
        (!this.hasTalent("Headshot") && me.hasVisibleAura("Razor Fragments"))
      ),

      // arcane_shot,if=buff.precise_shots.up&(debuff.spotters_mark.down|buff.moving_target.down)
      spell.cast("Arcane Shot", on => this.getCurrentTarget(), req => 
        me.hasVisibleAura("Precise Shots") &&
        (!this.getCurrentTarget()?.hasAuraByMe("Spotter's Mark") || !me.hasVisibleAura("Moving Target"))
      ),

      // aimed_shot,if=(buff.precise_shots.down|debuff.spotters_mark.up&buff.moving_target.up)&full_recharge_time<action.rapid_fire.execute_time+cast_time
      spell.cast("Aimed Shot", on => this.getCurrentTarget(), req => 
        (!me.hasVisibleAura("Precise Shots") ||
         (this.getCurrentTarget()?.hasAuraByMe("Spotter's Mark") && me.hasVisibleAura("Moving Target"))) &&
        this.getAimedShotFullRechargeTime() < (2.3 + 2.5)
      ),

      // rapid_fire
      spell.cast("Rapid Fire", on => this.getCurrentTarget()),

      // aimed_shot,if=buff.precise_shots.down|debuff.spotters_mark.up&buff.moving_target.up
      spell.cast("Aimed Shot", on => this.getCurrentTarget(), req => 
        !me.hasVisibleAura("Precise Shots") ||
        (this.getCurrentTarget()?.hasAuraByMe("Spotter's Mark") && me.hasVisibleAura("Moving Target"))
      ),

      // explosive_shot,if=talent.precision_detonation|buff.trueshot.down
      spell.cast("Explosive Shot", on => this.getCurrentTarget(), req => 
        this.hasTalent("Precision Detonation") || !me.hasVisibleAura("Trueshot")
      ),

      // steady_shot
      spell.cast("Steady Shot", on => this.getCurrentTarget())
    );
  }

  // Helper methods
  getCurrentTarget() {
    return me.target;
  }

  getCurrentTargetPVP() {
    return me.target;
  }

  getEnemiesInRange(range) {
    return me.getUnitsAroundCount(range);
  }

  hasTalent(talentName) {
    // Check for talent-related auras that indicate the talent is active
    return me.hasAura(talentName);
  }

  isAimedShotInFlight() {
    const currentTime = wow.frameTime;
    const timeSinceAimedShot = currentTime - this.aimedShotCastTime;
    
    // Check if Aimed Shot was successfully cast within the last 1 second (travel time)
    const withinTimeWindow = timeSinceAimedShot > 0 && timeSinceAimedShot <= 1000;
    
    // Check if Aimed Shot was our last successful cast (ignoring Auto Shot)
    const lastCastWasAimedShot = this.getLastNonAutoShotCast() === "Aimed Shot";
    
    // Consider Aimed Shot "in flight" if either condition is met
    return withinTimeWindow || (lastCastWasAimedShot && timeSinceAimedShot <= 2000);
  }

  getLastNonAutoShotCast() {
    // Get recent successful spells and filter out Auto Shot (spell ID 75)
    const recentSpells = spell.getLastSuccessfulSpells(5, false);
    
    for (const spellData of recentSpells.reverse()) { // Most recent first
      if (spellData.spellName !== "Auto Shot") {
        return spellData.spellName;
      }
    }
    
    return null;
  }

  getTrickShotsRemaining() {
    const aura = me.getAura("Trick Shots");
    return aura ? aura.remaining / 1000 : 0;
  }

  getFocusAfterCast(spellName) {
    const spellObj = spell.getSpell(spellName);
    const currentFocus = me.powerByType(PowerType.Focus) || 0;
    const spellCost = spellObj?.cost || 0;
    return currentFocus - spellCost;
  }

  getAimedShotFullRechargeTime() {
    const aimedShot = spell.getSpell("Aimed Shot");
    return aimedShot ? aimedShot.charges.duration : 0;
  }

  // Target selection helpers
  getBestMultiShotTarget() {
    return this.getCurrentTarget(); // Simplified
  }

  getBestAimedShotTarget() {
    return this.getCurrentTarget(); // Simplified
  }

  getBestArcaneShotTarget() {
    return this.getCurrentTarget(); // Simplified
  }

  getBestKillShotTarget() {
    return this.getCurrentTarget(); // Simplified
  }

  findEnemyHealerNotCC() {
    const enemies = me.getEnemies(40);
    for (const enemy of enemies) {
      if (enemy.isPlayer() && 
          me.distanceTo(enemy) <= 40 &&
          enemy.isHealer() &&
          !enemy.isCCd()) {
        return enemy;
      }
    }
    return null;
  }

  shouldFeignDeathPVP() {
    // Check if we should feign death to avoid spell reflects or incoming damage
    const enemies = me.getEnemies(40);
    for (const enemy of enemies) {
      if (enemy.isPlayer() && 
          me.distanceTo(enemy) <= 40 &&
          enemy.isCastingOrChanneling) {
        const spellBeingCast = enemy.currentCastOrChannel;
        if (spellBeingCast && pvpReflect[spellBeingCast]) {
          return true;
        }
      }
    }
    return false;
  }

  findBindingShotTargetPVP() {
    // First priority: enemies within 10y of us
    const enemiesNearUs = me.getEnemies(40).filter(enemy => 
      enemy.isPlayer() && 
      me.distanceTo(enemy) <= 10 &&
      !pvpHelpers.hasImmunity(enemy) &&
      !enemy.hasVisibleAura("Binding Shot") // Don't cast if already bound
    );
    
    if (enemiesNearUs.length > 0) {
      return enemiesNearUs[0];
    }

    // Second priority: enemies within 10y of our healer
    const friends = me.getFriends(40);
    const healers = friends.filter(member => member.isHealer());
    if (healers.length > 0) {
      const healer = healers[0];
      const enemiesNearHealer = me.getEnemies().filter(enemy => 
        enemy.isPlayer() && 
        healer.distanceTo(enemy) <= 10 &&
        !pvpHelpers.hasImmunity(enemy) &&
        !enemy.hasVisibleAura("Binding Shot")
      );
      
      if (enemiesNearHealer.length > 0) {
        return enemiesNearHealer[0];
      }
    }

    return null;
  }

  findFreezingTrapTargetPVP() {
    const nearbyEnemies = me.getEnemies(40);

    for (const unit of nearbyEnemies) {
      if (unit.isHealer() && (unit.isStunned() || unit.isRooted()) && unit.canCC() && unit.getDR("incapacitate") === 0) {
        if (unit.isStunned() || unit.isRooted()) {
          const stunAuras = unit.auras.filter(aura => 
            aura.isDebuff && (drHelpers.getCategoryBySpellID(aura.spellId) === "stun" || drHelpers.getCategoryBySpellID(aura.spellId) === "root")
          );

          for (const stunAura of stunAuras) {
            if (stunAura.remaining <= 3000 && stunAura.remaining > 0) {
              return unit;
            }
          }
        }
      }
    }

    return undefined;
  }

  findTarTrapLocationPVP() {
    const enemies = me.getEnemies(40);
    for (const enemy of enemies) {
      if (enemy.isPlayer() && 
          me.distanceTo(enemy) <= 10 &&
          !enemy.hasAura("Tar Trap")) {
        return enemy;
      }
    }
    return null;
  }

  findIntimidationTargetPVP() {
    // If healer only mode is enabled, only target healers
    if (Settings.IntimidationHealerOnly) {
      for (const enemy of me.getEnemies(40)) {
        if (!enemy.isHealer()) continue;
        if (pvpHelpers.hasImmunity(enemy)) continue;
        if (me.distanceTo(enemy) > 30) continue; // Intimidation range
        
        if (drTracker.getDRStacks(enemy.guid, "stun") < 2) {
          return enemy;
        }
      }
      return undefined;
    }

    // Normal mode: First priority: enemies with major cooldowns up
    for (const enemy of me.getEnemies()) {
      if (!enemy.isPlayer() || pvpHelpers.hasImmunity(enemy)) continue;
      if (me.distanceTo(enemy) > 30) continue; // Intimidation range
      
      if (this.hasMajorCooldowns(enemy) && drTracker.getDRStacks(enemy.guid, "stun") < 2) {
        return enemy;
      }
    }

    // Second priority: enemy healer if no stun DR
    for (const enemy of me.getEnemies()) {
      if (!enemy.isPlayer() || !enemy.isHealer()) continue;
      if (pvpHelpers.hasImmunity(enemy)) continue;
      if (me.distanceTo(enemy) > 30) continue;
      
      if (drTracker.getDRStacks(enemy.guid, "stun") < 2) {
        return enemy;
      }
    }

    return undefined;
  }

  findConcussiveShotTargetPVP() {
    const meleeClasses = ["Paladin", "Rogue", "Hunter", "Warrior", "Monk", "Demon Hunter", "Death Knight"];
    const validTargets = [];
    
    // Collect all valid targets with their distances
    for (const enemy of me.getEnemies()) {
      if (!enemy.isPlayer()) continue;
      if (pvpHelpers.hasImmunity(enemy)) continue;
      if (enemy.hasVisibleAura("Concussive Shot")) continue; // Skip if already slowed
      
      const distance = me.distanceTo(enemy);
      if (distance > 40) continue;
      
      // Check if enemy is a melee class (within 30y) or any enemy under 30% health
      const isMeleeClass = meleeClasses.some(className => enemy.hasAura && enemy.hasAura(className));
      const isCloseEnough = distance <= 30; // Close range for melee threat
      
      // Add to valid targets if: (melee class within 30y) OR (any enemy under 30% health)
      if ((isMeleeClass && isCloseEnough) || enemy.pctHealth <= 30) {
        validTargets.push({ enemy, distance });
      }
    }
    
    // Sort by distance (closest first) and return the closest
    if (validTargets.length > 0) {
      validTargets.sort((a, b) => a.distance - b.distance);
      return validTargets[0].enemy;
    }
    
    return null;
  }

  isUnderPressure() {
    const enemies = me.getEnemies();
    for (const enemy of enemies) {
        if (enemy.isPlayer() && me.distanceTo(enemy) <= 40 && me.withinLineOfSight(enemy)) {
            const spellInfo = enemy.spellInfo;
            const target = spellInfo.spellTargetGuid;
            if (target && target.equals(me.guid)) {
                return true;
            }
        }
    }
    return false;
  }

  findExplosiveTrapLocationPVP() {
    // Target non-healers within 10y with major cooldowns up
    const enemies = me.getEnemies();
    for (const enemy of enemies) {
      if (enemy.isPlayer() && 
          me.distanceTo(enemy) <= 10 &&
          !enemy.isHealer() &&
          pvpHelpers.hasMajorDamageCooldown(enemy) &&
          !enemy.hasAura("High Explosive Trap")) {
        return enemy;
      }
    }
    return null;
  }

  findBurstingShotTargetPVP() {
    // Non-healers within 8y of us
    for (const enemy of me.getEnemies()) {
      if (!enemy.isPlayer() || enemy.isHealer()) continue;
      if (pvpHelpers.hasImmunity(enemy)) continue;
      if (!me.isFacing(enemy)) continue;
      if (me.distanceTo(enemy) <= 8) {
        return enemy;
      }
    }
    return undefined;
  }

  hasMajorCooldowns(unit) {
    const majorDamageCooldown = pvpHelpers.hasMajorDamageCooldown(unit, 3);
    return majorDamageCooldown !== undefined;
  }

  shouldSkipLOSCheck() {
    // Skip LOS check if our target has aura 393480 (Hunter's Mark or similar tracking effect)
    return me.target && me.target.hasAuraByMe && me.target.hasAuraByMe(393480);
  }

  findHealerToInterruptForTrap() {
    // Only interrupt enemy healers when Freezing Trap is almost ready
    const freezingTrapCooldown = spell.getCooldown("Freezing Trap");
    if (!freezingTrapCooldown || freezingTrapCooldown.timeleft > 1000) {
      return null; // Freezing Trap not ready soon enough
    }

    // Look for enemy healers that are casting and can be interrupted
    for (const enemy of me.getEnemies()) {
      if (!enemy.isPlayer()) continue;
      if (!enemy.isHealer()) continue;
      if (pvpHelpers.hasImmunity(enemy)) continue;
      if (me.distanceTo(enemy) > 30) continue; // Intimidation range
      
      // Check if they're casting something interruptible
      if (enemy.isCastingOrChanneling && enemy.isInterruptible) {
        const spellBeingCast = enemy.currentCastOrChannel;
        if (spellBeingCast && pvpInterrupts[spellBeingCast]) {
          // Only interrupt important spells (heals, CC, major damage)
          const interruptInfo = pvpInterrupts[spellBeingCast];
          if (interruptInfo.category === "heal" || 
              interruptInfo.category === "cc" || 
              interruptInfo.category === "damage") {
            return enemy;
          }
        }
      }
    }
    
    return null;
  }

  renderOverlay() {
    // Safety check
    if (!me) return;
    
    if (!this.overlayToggles.showOverlay.value) {
      return;
    }

    // Handle burst mode toggle with 'X' key
    if (imgui.isKeyPressed(imgui.Key.X)) {
      this.burstModeActive = !this.burstModeActive;
      console.log("Marksman Burst Mode:", this.burstModeActive ? "ACTIVATED" : "DEACTIVATED");
    }

    const viewport = imgui.getMainViewport();
    if (!viewport) {
      return;
    }
    
    const workPos = viewport.workPos;
    const workSize = viewport.workSize;
    
    // Position overlay in top-right corner
    const overlaySize = { x: 280, y: Settings.EnablePVPRotation ? 450 : 300 };
    const overlayPos = { 
      x: workPos.x + workSize.x - overlaySize.x - 20, 
      y: workPos.y + 20 
    };

    imgui.setNextWindowPos(overlayPos, imgui.Cond.FirstUseEver);
    imgui.setNextWindowSize(overlaySize, imgui.Cond.FirstUseEver);
    
    // Make background more opaque
    imgui.setNextWindowBgAlpha(0.50);
    
    // Window flags for overlay behavior
    const windowFlags = 
      imgui.WindowFlags.NoResize |
      imgui.WindowFlags.AlwaysAutoResize;

    const windowTitle = Settings.EnablePVPRotation ? "Marksman PVP Controls" : "Marksman Controls";
    if (imgui.begin(windowTitle, this.overlayToggles.showOverlay, windowFlags)) {
      
      // PVP Mode indicator
      if (Settings.EnablePVPRotation) {
        imgui.spacing();
        imgui.pushStyleColor(imgui.Col.Text, { r: 1.0, g: 0.2, b: 0.2, a: 1.0 });
        imgui.text("PVP MODE ACTIVE");
        imgui.popStyleColor();
        
        // Burst Mode Toggle
        const burstColor = this.burstModeActive ? 
          { r: 1.0, g: 0.2, b: 0.2, a: 1.0 } : { r: 0.2, g: 1.0, b: 0.2, a: 1.0 };
        imgui.pushStyleColor(imgui.Col.Text, burstColor);
        const burstText = this.burstModeActive ? "BURST ACTIVE (Press X)" : "BURST READY (Press X)";
        imgui.text(burstText);
        imgui.popStyleColor();
        imgui.separator();

        // Resources Info
        if (imgui.collapsingHeader("Resources", imgui.TreeNodeFlags.DefaultOpen)) {
          imgui.indent();
          const focus = me.powerByType(PowerType.Focus) || 0;
          const maxFocus = me.maxPowerByType(PowerType.Focus) || 100;
          imgui.textColored({ r: 0.2, g: 0.8, b: 1.0, a: 1.0 }, `Focus: ${focus}/${maxFocus}`);
          
          // Precise Shots stacks
          const preciseShotsStacks = me.getAuraStacks ? me.getAuraStacks("Precise Shots") || 0 : 0;
          if (preciseShotsStacks > 0) {
            imgui.textColored({ r: 1.0, g: 0.2, b: 0.2, a: 1.0 }, `Precise Shots: ${preciseShotsStacks}`);
          }

          // Streamline stacks
          const streamlineStacks = me.getAuraStacks ? me.getAuraStacks("Streamline") || 0 : 0;
          if (streamlineStacks > 0) {
            imgui.textColored({ r: 0.2, g: 1.0, b: 0.2, a: 1.0 }, `Streamline: ${streamlineStacks}`);
          }

          // Trueshot status
          if (me.hasVisibleAura("Trueshot")) {
            const trueshotRemaining = me.getAura("Trueshot")?.remaining || 0;
            imgui.textColored({ r: 1.0, g: 0.8, b: 0.2, a: 1.0 }, `Trueshot: ${Math.ceil(trueshotRemaining / 1000)}s`);
          } else {
            const trueshotCooldown = spell.getCooldown("Trueshot");
            if (trueshotCooldown && trueshotCooldown.timeleft > 0) {
              imgui.textColored({ r: 0.8, g: 0.8, b: 0.8, a: 1.0 }, `Trueshot: ${Math.ceil(trueshotCooldown.timeleft / 1000)}s CD`);
            } else {
              imgui.textColored({ r: 0.2, g: 1.0, b: 0.2, a: 1.0 }, "Trueshot: READY");
            }
          }
          
          imgui.unindent();
        }

        // CC Abilities
        if (imgui.collapsingHeader("CC Abilities", imgui.TreeNodeFlags.DefaultOpen)) {
          imgui.indent();
          
          // Intimidation toggle
          const intimidationColor = this.overlayToggles.intimidation.value ? 
            { r: 0.2, g: 1.0, b: 0.2, a: 1.0 } : { r: 1.0, g: 0.2, b: 0.2, a: 1.0 };
          imgui.pushStyleColor(imgui.Col.Text, intimidationColor);
          imgui.checkbox("Intimidation", this.overlayToggles.intimidation);
          imgui.popStyleColor();
          
          // Binding Shot toggle
          const bindingColor = this.overlayToggles.binding.value ? 
            { r: 0.2, g: 1.0, b: 0.2, a: 1.0 } : { r: 1.0, g: 0.2, b: 0.2, a: 1.0 };
          imgui.pushStyleColor(imgui.Col.Text, bindingColor);
          imgui.checkbox("Binding Shot", this.overlayToggles.binding);
          imgui.popStyleColor();
          
          // Manual Trap toggle
          const trapColor = this.overlayToggles.manualTrap.value ? 
            { r: 0.2, g: 1.0, b: 0.2, a: 1.0 } : { r: 1.0, g: 0.2, b: 0.2, a: 1.0 };
          imgui.pushStyleColor(imgui.Col.Text, trapColor);
          imgui.checkbox("Manual Trap (H key)", this.overlayToggles.manualTrap);
          imgui.popStyleColor();
          
          // Chimaeral Sting toggle
          const stingColor = this.overlayToggles.chimaeralSting.value ? 
            { r: 0.2, g: 1.0, b: 0.2, a: 1.0 } : { r: 1.0, g: 0.2, b: 0.2, a: 1.0 };
          imgui.pushStyleColor(imgui.Col.Text, stingColor);
          imgui.checkbox("Chimaeral Sting", this.overlayToggles.chimaeralSting);
          imgui.popStyleColor();
          
          imgui.unindent();
        }
      }

      // Major Cooldowns section - always visible
      if (imgui.collapsingHeader("Major Cooldowns", imgui.TreeNodeFlags.DefaultOpen)) {
        imgui.indent();
        
        // Trueshot toggle
        const trueshotColor = this.overlayToggles.trueshot.value ? 
          { r: 0.2, g: 1.0, b: 0.2, a: 1.0 } : { r: 1.0, g: 0.2, b: 0.2, a: 1.0 };
        imgui.pushStyleColor(imgui.Col.Text, trueshotColor);
        imgui.checkbox("Trueshot", this.overlayToggles.trueshot);
        imgui.popStyleColor();
        
        imgui.unindent();
      }
      
      // Interrupt section - always visible
      if (imgui.collapsingHeader("Interrupts")) {
        imgui.indent();
        
        // Counter Shot toggle
        const counterShotColor = this.overlayToggles.interrupts.value ? 
          { r: 0.2, g: 1.0, b: 0.2, a: 1.0 } : { r: 1.0, g: 0.2, b: 0.2, a: 1.0 };
        imgui.pushStyleColor(imgui.Col.Text, counterShotColor);
        imgui.checkbox("Counter Shot", this.overlayToggles.interrupts);
        imgui.popStyleColor();
        
        imgui.unindent();
      }
      
      // Defensive section - always visible
      if (imgui.collapsingHeader("Defensives")) {
        imgui.indent();
        
        // Defensives toggle
        const defensiveColor = this.overlayToggles.defensives.value ? 
          { r: 0.2, g: 1.0, b: 0.2, a: 1.0 } : { r: 1.0, g: 0.2, b: 0.2, a: 1.0 };
        imgui.pushStyleColor(imgui.Col.Text, defensiveColor);
        imgui.checkbox("Defensive Abilities", this.overlayToggles.defensives);
        imgui.popStyleColor();
        
        imgui.unindent();
      }
    }
    imgui.end();

    // Draw healer line if enabled (must be after imgui.end())
    if (Settings.DrawHealerLine) {
      this.drawHealerLine();
    }
  }

  drawHealerLine() {
    // Find the nearest friend healer
    const healer = this.findNearestFriendHealer();
    if (!healer) return;

    const distance = me.distanceTo(healer);
    const hasLOS = me.withinLineOfSight(healer);
    
    // Only draw line if healer is distant (>40y) or not in line of sight
    if (distance <= 40 && hasLOS) return;

    // Get screen positions
    const playerScreenPos = wow.WorldFrame.getScreenCoordinates(me.position);
    const healerScreenPos = wow.WorldFrame.getScreenCoordinates(healer.position);
    
    if (!playerScreenPos || !healerScreenPos || 
        playerScreenPos.x === -1 || healerScreenPos.x === -1) return;

    // Draw line to healer with color based on reason
    const canvas = imgui.getBackgroundDrawList();
    let healerLineColor;
    
    if (!hasLOS) {
      // Yellow for no line of sight
      healerLineColor = colors.yellow || 0xFFFF00FF;
    } else if (distance > 40) {
      // Yellow for too far
      healerLineColor = colors.yellow || 0xFFFF00FF;
    } else {
      // Default lime green (shouldn't happen with current logic)
      healerLineColor = colors.lime || 0x00FF00FF;
    }
    
    canvas.addLine(
      playerScreenPos,
      healerScreenPos,
      healerLineColor,
      4 // Thick line for visibility
    );

    // Add distance text at midpoint with reason
    let reasonText = "";
    if (!hasLOS) {
      reasonText = " (No LOS)";
    } else if (distance > 40) {
      reasonText = " (Too Far)";
    }
    
    const distanceText = `Healer: ${Math.round(distance)}y${reasonText}`;
    const midX = (playerScreenPos.x + healerScreenPos.x) / 2;
    const midY = (playerScreenPos.y + healerScreenPos.y) / 2;
    
    canvas.addText(
      distanceText,
      { x: midX, y: midY },
      colors.white || 0xFFFFFFFF,
      null,
      12
    );
  }

  findNearestFriendHealer() {
    // Get all living friendly healers
    const friends = me.getFriends();
    const healers = friends.filter(friend => 
      friend.isHealer() && !friend.deadOrGhost
    );
    
    if (healers.length === 0) return null;
    if (healers.length === 1) return healers[0];
    
    // Sort by distance if multiple healers
    healers.sort((a, b) => me.distanceTo(a) - me.distanceTo(b));
    return healers[0];
  }

  // Required behavior methods
  getDescription() {
    return "Marksman Hunter rotation based on SimC APL with PVP support";
  }

  getDisplayName() {
    return this.name;
  }
}
