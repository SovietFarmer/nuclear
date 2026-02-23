import { Behavior, BehaviorContext } from "@/Core/Behavior";
import * as bt from '@/Core/BehaviorTree';
import Specialization from '@/Enums/Specialization';
import common from '@/Core/Common';
import spell from "@/Core/Spell";
import { me } from "@/Core/ObjectManager";
import { MovementFlags } from "@/Enums/Flags";
import { DispelPriority } from "@/Data/Dispels";
import { WoWDispelType } from "@/Enums/Auras";
import { PowerType } from "@/Enums/PowerType";
import { defaultCombatTargeting as combat } from "@/Targeting/CombatTargeting";
import { defaultHealTargeting as heal } from "@/Targeting/HealTargeting";
import Settings from "@/Core/Settings";
import EvokerCommon from "@/Behaviors/EvokerCommon";

// STATUS : IMPROVED WITH DEVASTATION TEMPLATE

const auras = {
  reversion: 366155,
  echo: 364343,
  essenceBurst: 369299,
  blessingOfTheBronze: 381748,
  temporalCompression: 370583,
  callOfYsera: 369299,
  lifebind: 373267,
  dreamBreathHoT: 382614,
  engulfMark: 409786,
  cycleSprout: 371857, // Cycle of Life's sprout
  temporalBurst: 424488, // Haste buff from Tip the Scales with Temporal Burst talent
  hover: 358267,
  timeDilation: 357170,
  stasis: 370537,
  zephyr: 374227,
  emeraldCommunion: 370960,
  renewingBlaze: 374348,
  obsidianScales: 363916,
  temporalArtifice: 373862,
  flameshapersMark: 409836,
  fireBreathDamage: 357209
};

export class EvokerPreservationBehavior extends Behavior {
  name = "FW Preservation Evoker";
  context = BehaviorContext.Any;
  specialization = Specialization.Evoker.Preservation;
  version = wow.GameVersion.Retail;
  
  static settings = [
    {
      header: "Build Selection",
      options: [
        {
          type: "dropdown",
          uid: "EvokerPreservationBuildType",
          text: "Build Type",
          values: ["Echo (Chronowarden)", "Echo (Flameshaper)", "Emerald Blossom"],
          default: "Echo (Chronowarden)"
        }
      ]
    },
    {
      header: "Single Target Healing",
      options: [
        {
          type: "slider",
          uid: "EvokerPreservationReversionPercent",
          text: "Reversion Percent",
          min: 0,
          max: 100,
          default: 70
        },
        {
          type: "slider",
          uid: "EvokerPreservationLivingFlamePercent",
          text: "Living Flame Percent",
          min: 0,
          max: 100,
          default: 70
        },
        {type: "slider", uid: "EvokerPreservationEchoPercent", text: "Echo Percent", min: 0, max: 100, default: 70},
        {
          type: "slider",
          uid: "EvokerPreservationVerdantEmbracePercent",
          text: "Verdant Embrace Percent",
          min: 0,
          max: 100,
          default: 70
        },
        {type: "checkbox", uid: "EvokerPreservationUseTimeDilation", text: "Use Time Dilation", default: true},
      ]
    },
    {
      header: "AoE Healing",
      options: [
        {
          type: "slider",
          uid: "EvokerPreservationEmeraldCommunionCount",
          text: "Emerald Communion Minimum Targets",
          min: 1,
          max: 10,
          default: 2
        },
        {
          type: "slider",
          uid: "EvokerPreservationEmeraldCommunionPercent",
          text: "Emerald Communion Health Percent",
          min: 0,
          max: 100,
          default: 50
        },
        {
          type: "slider",
          uid: "EvokerPreservationRewindCount",
          text: "Rewind Minimum Targets",
          min: 1,
          max: 10,
          default: 5
        },
        {
          type: "slider",
          uid: "EvokerPreservationRewindPercent",
          text: "Rewind Health Percent",
          min: 0,
          max: 100,
          default: 70
        },
        {
          type: "slider",
          uid: "EvokerPreservationDreamBreathCount",
          text: "Dream Breath Minimum Targets",
          min: 1,
          max: 10,
          default: 3
        },
        {
          type: "slider",
          uid: "EvokerPreservationDreamBreathPercent",
          text: "Dream Breath Health Percent",
          min: 0,
          max: 100,
          default: 85
        },
        {
          type: "slider",
          uid: "EvokerPreservationEmeraldBlossomCount",
          text: "Emerald Blossom Minimum Targets",
          min: 1,
          max: 10,
          default: 3
        },
        {
          type: "slider",
          uid: "EvokerPreservationEmeraldBlossomPercent",
          text: "Emerald Blossom Health Percent",
          min: 0,
          max: 100,
          default: 80
        },
        {
          type: "slider",
          uid: "EvokerPreservationSpiritbloomCount",
          text: "Spiritbloom Minimum Targets",
          min: 1,
          max: 10,
          default: 3
        },
        {
          type: "slider",
          uid: "EvokerPreservationSpiritbloomPercent",
          text: "Spiritbloom Health Percent",
          min: 0,
          max: 100,
          default: 80
        },
        {
          type: "slider",
          uid: "EvokerPreservationTemporalAnomalyCount",
          text: "Temporal Anomaly Minimum Targets",
          min: 1,
          max: 10,
          default: 3
        },
        {
          type: "slider",
          uid: "EvokerPreservationDreamFlightCount",
          text: "Dream Flight Minimum Targets",
          min: 1,
          max: 10,
          default: 5
        },
        {
          type: "slider",
          uid: "EvokerPreservationDreamFlightPercent",
          text: "Dream Flight Health Percent",
          min: 0,
          max: 100,
          default: 60
        }
      ]
    },
    {
      header: "Cooldown Management",
      options: [
        {
          type: "checkbox",
          uid: "EvokerPreservationUseStasis",
          text: "Use Stasis",
          default: true
        },
        {
          type: "dropdown",
          uid: "EvokerPreservationStasisCombo",
          text: "Stasis Combo",
          values: ["Green Combo", "Echo Pre Pull", "Spot Healing", "Flameshaper Combo"],
          default: "Green Combo"
        },
        {
          type: "checkbox",
          uid: "EvokerPreservationUseDreamFlight",
          text: "Use Dream Flight",
          default: true
        },
        {
          type: "checkbox",
          uid: "EvokerPreservationUseZephyr",
          text: "Use Zephyr for AoE Damage",
          default: true
        },
        {
          type: "checkbox",
          uid: "EvokerPreservationBlessingOfBronze",
          text: "Cast Blessing of the Bronze",
          default: true
        },
      ]
    },
    {
      header: "Defensives",
      options: [
        {type: "checkbox", uid: "EvokerPreservationUseRenewingBlaze", text: "Use Renewing Blaze", default: true},
        {type: "checkbox", uid: "EvokerPreservationUseObsidianScales", text: "Use Obsidian Scales", default: true},
      ]
    },
    {
      header: "Damage",
      options: [
        {type: "checkbox", uid: "EvokerPreservationUseDeepBreath", text: "Use Deep Breath", default: true},
        {
          type: "slider",
          uid: "EvokerPreservationDeepBreathMinTargets",
          text: "Deep Breath Minimum Targets",
          min: 1,
          max: 10,
          default: 3
        },
        {
          type: "checkbox",
          uid: "EvokerPreservationUseEngulfInDamage",
          text: "Use Engulf in Damage Rotation",
          default: true
        },
      ]
    },
    {
      header: "Movement",
      options: [
        {
          type: "checkbox",
          uid: "EvokerPreservationUseHover",
          text: "Use Hover for Movement",
          default: true
        }
      ]
    },
    {
      header: "Set Bonuses",
      options: [
        { 
          type: "checkbox", 
          uid: "EvokerPreservation4PreviousSet", 
          text: "Use Last Tier 4 Set Bonuses", 
          default: true 
        },
        { 
          type: "checkbox", 
          uid: "EvokerPreservation4Set", 
          text: "Use Current 4 Set Bonuses", 
          default: true 
        },
      ]
    }
  ];

  build() {
    if (!this._variables) {
      this.initializeVariables();
    }

    // Determine build type
    const buildType = Settings.EvokerPreservationBuildType || "Echo (Chronowarden)";
    const isEchoBuild = buildType.includes("Echo");
    const isFlameshaperBuild = buildType === "Echo (Flameshaper)";
    const isEmeraldBlossomBuild = buildType === "Emerald Blossom";

    return new bt.Selector(
      common.waitForNotSitting(),
      common.waitForNotMounted(),
      new bt.Action(() => EvokerCommon.handleEmpoweredSpell()),
      spell.cast("Blessing of the Bronze", on => me,
        req => Settings.EvokerPreservationBlessingOfBronze && !me.hasAura(auras.blessingOfTheBronze)
      ),
      common.waitForCastOrChannel(),
      this.defensives(),
      spell.interrupt("Quell"),
      //common.waitForTarget(),
      //common.waitForFacing(),
      //this.hover(),
      this.handleStasis(),
      
      // Core rotation based on build
      new bt.Decorator(
        ret => !spell.isGlobalCooldown(),
        new bt.Selector(
          // Emergency healing
          spell.cast("Rewind", on => me, 
            req => this.countPriorityTargets(Settings.EvokerPreservationRewindPercent) >= Settings.EvokerPreservationRewindCount),
          
          // Major cooldowns
          this.majorCooldowns(isEchoBuild, isEmeraldBlossomBuild),
          
          // Build-specific rotations
          isEchoBuild ? 
            this.echoBuildRotation(isFlameshaperBuild) : 
            (isEmeraldBlossomBuild ? this.emeraldBlossomBuildRotation() : this.generalHealing()),
          
          // Dispels and utility
          spell.dispel("Naturalize", true, DispelPriority.Low, false, WoWDispelType.Magic, WoWDispelType.Poison),
          spell.interrupt("Tail Swipe"),
       
          this.dpsRotation(isFlameshaperBuild)
        )
      )
    );
  }

  defensives() {
    return new bt.Selector(
      spell.cast("Renewing Blaze", on => me,
        req => Settings.EvokerPreservationUseRenewingBlaze && 
               (me.pctHealth < 50 || 
               combat.targets.filter(unit => unit.isTanking() && me.isWithinMeleeRange(unit)).length > 1)
      ),
      
      spell.cast("Obsidian Scales", on => me,
        req => Settings.EvokerPreservationUseObsidianScales &&
               (me.pctHealth < 40 || 
               combat.targets.filter(unit => unit.isTanking() && me.isWithinMeleeRange(unit)).length > 1) &&
               !me.hasAura(auras.renewingBlaze)
      )
    );
  }

  hover() {
    return new bt.Selector(
      spell.cast("Hover", on => me,
        req => Settings.EvokerPreservationUseHover && 
              !me.hasAura(auras.hover) && 
              me.isMoving() && 
              (me.isCastingOrChanneling || me.hasAura(auras.stasis) || 
               this.countPriorityTargets(60) >= 3)
      )
    );
  }

  majorCooldowns(isEchoBuild, isEmeraldBlossomBuild) {
    return new bt.Selector(
      // Zephyr for AoE damage reduction
      spell.cast("Zephyr", on => me, 
        req => Settings.EvokerPreservationUseZephyr && 
               (this.countPriorityTargets(50) >= 3 || 
                this.isHighDamageSituation())
      ),
      
      // Dream Flight for stacked raid healing
      spell.cast("Dream Flight", 
        on => this.findBestPositionForDreamFlight(), 
        req => Settings.EvokerPreservationUseDreamFlight && 
               this.countPriorityTargets(Settings.EvokerPreservationDreamFlightPercent) >= 
               Settings.EvokerPreservationDreamFlightCount
      ),
      
      // Emerald Communion for deep healing and mana
      spell.cast("Emerald Communion", on => me, 
        req => (me.pctPowerByType(PowerType.Mana) < 70 || 
               this.countPriorityTargets(Settings.EvokerPreservationEmeraldCommunionPercent) >= 
               Settings.EvokerPreservationEmeraldCommunionCount || 
               me.hasAura(auras.lifebind)) && 
               !me.hasAura(auras.emeraldCommunion)
      ),
      
      // Time Dilation as an external for tanks or emergency
      spell.cast("Time Dilation", on => {
        if (!Settings.EvokerPreservationUseTimeDilation) return null;

        // Prioritize tanks in dangerous situations
        const tank = heal.friends.Tanks.find(unit => {
          if (unit.pctHealth > 60) return false;
          
          const enemiesOnTank = combat.targets.filter(enemy => 
            enemy.target && enemy.target.guid.equals(unit.guid)).length;
            
          const dangerousSpellOnTank = combat.targets.some(enemy =>
            enemy.isCastingOrChanneling &&
            enemy.spellInfo &&
            enemy.spellInfo.spellTargetGuid &&
            enemy.spellInfo.spellTargetGuid.equals(unit.guid)
          );
          
          return (enemiesOnTank >= 2 || dangerousSpellOnTank);
        });
        
        if (tank) return tank;
        
        // Target with maximum beneficial auras for value
        const targetWithAuras = heal.priorityList.find(unit => 
          unit.auras.filter(aura => aura.isHelpful).length >= 3 && 
          unit.pctHealth < 70
        );
        
        return targetWithAuras;
      })
    );
  }

  handleStasis() {
    if (!Settings.EvokerPreservationUseStasis) return bt.Status.Failure;
    
    const stasisCombo = Settings.EvokerPreservationStasisCombo;
    
    // Activate Stasis when we have 3 stored spells
    if (me.hasAura(auras.stasis) && me.getAura(auras.stasis).stacks >= 3) {
      this.setVariable("cast_stasis_spell", true);
      return spell.cast("Stasis", on => me);
    }
    
    // Only start a new Stasis if we don't already have one active
    if (me.hasAura(auras.stasis)) return bt.Status.Failure;
    
    switch(stasisCombo) {
      case "Green Combo":
        return spell.cast("Stasis", on => me, 
          req => spell.getCooldown("Temporal Anomaly").timeleft === 0 && 
                 spell.getCooldown("Dream Breath").timeleft === 0 && 
                 spell.getCooldown("Spiritbloom").timeleft === 0 &&
                 !this.hasVariable("cast_stasis_spell")
        );
      
      case "Echo Pre Pull":
        return spell.cast("Stasis", on => me, 
          req => !me.inCombat() && 
                 spell.getCooldown("Temporal Anomaly").timeleft === 0 &&
                 !this.hasVariable("cast_stasis_spell")
        );
      
      case "Spot Healing":
        return spell.cast("Stasis", on => me, 
          req => heal.friends.Tanks.some(unit => unit.pctHealth < 80) && 
                 spell.getCooldown("Echo").timeleft === 0 && 
                 spell.getCooldown("Reversion").timeleft === 0 &&
                 !this.hasVariable("cast_stasis_spell")
        );
      
      case "Flameshaper Combo":
        return spell.cast("Stasis", on => me, 
          req => Settings.EvokerPreservationBuildType === "Echo (Flameshaper)" && 
                 spell.getCooldown("Dream Breath").timeleft === 0 && 
                 spell.getCooldown("Engulf").timeleft === 0 &&
                 !this.hasVariable("cast_stasis_spell")
        );
      
      default:
        return bt.Status.Failure;
    }
  }

  echoBuildRotation(isFlameshaperBuild) {
    return new bt.Selector(
      // Temporal Anomaly for Echo distribution
      spell.cast("Temporal Anomaly", on => me, 
        req => this.countTargetsInRange(me, 30) >= Settings.EvokerPreservationTemporalAnomalyCount && 
               !me.hasAura(auras.temporalArtifice)
      ),
      
      // Apply Echo to targets that need it
      spell.cast("Echo", on => {
        const target = heal.priorityList.find(unit => 
          !unit.hasAura(auras.echo) && 
          unit.predictedHealthPercent < Settings.EvokerPreservationEchoPercent &&
          unit.distanceTo(me) <= 30
        );
        return target;
      }),
      
      // Lifebind setup with Verdant Embrace
      spell.cast("Verdant Embrace", on => {
        // Prioritize targets with Echo for Lifebind setup
        const targetWithEcho = heal.priorityList.find(unit => 
          unit.hasAura(auras.echo) && 
          unit.predictedHealthPercent < Settings.EvokerPreservationVerdantEmbracePercent &&
          unit.distanceTo(me) <= 40
        );
        
        // If no target with Echo, use on any target that needs healing
        return targetWithEcho || heal.priorityList.find(unit => 
          unit.predictedHealthPercent < Settings.EvokerPreservationVerdantEmbracePercent &&
          unit.distanceTo(me) <= 40
        );
      }),
      
      // Tip the Scales for instant empowered spells
      spell.cast("Tip the Scales", on => me, 
        req => {
          // Use during high damage or movement
          const needBurstHealing = this.countPriorityTargets(50) >= 3;
          const hasTemporalCompression = me.hasAura(auras.temporalCompression) && 
                                         me.getAura(auras.temporalCompression).stacks >= 5;
          
          return (me.isMoving() && needBurstHealing) || hasTemporalCompression;
        }),
      
      // Dream Breath for HoT and burst healing
      this.castEmpoweredDreamBreath(),
      
      // Spiritbloom for burst healing
      this.castEmpoweredSpiritbloom(),
      
      // Flameshaper-specific: Engulf targeting
      isFlameshaperBuild ? spell.cast("Engulf", on => {
        // Target units with Dream Breath HoT
        return heal.priorityList.find(unit => 
          unit.hasAura(auras.dreamBreathHoT) && 
          !unit.hasAura(auras.flameshapersMark) &&
          unit.distanceTo(me) <= 40
        );
      }) : bt.Status.Failure,
      
      // Flameshaper-specific: Consume Flames
      isFlameshaperBuild ? spell.cast("Consume Flames", on => me, 
        req => heal.priorityList.some(unit => unit.hasAura(auras.flameshapersMark))
      ) : bt.Status.Failure,
      
      // Reversion for tank and general maintenance healing
      spell.cast("Reversion", on => this.findBestReversionTarget()),
      
      // Living Flame healing
      spell.cast("Living Flame", on => {
        const target = heal.priorityList.find(unit => 
          unit.predictedHealthPercent < Settings.EvokerPreservationLivingFlamePercent &&
          unit.distanceTo(me) <= 25
        );
        return target;
      })
    );
  }

  emeraldBlossomBuildRotation() {
    return new bt.Selector(
      // Use Emerald Blossom as the core healing mechanic
      spell.cast("Emerald Blossom",
        on => this.findBestEmeraldBlossomTarget(),
        req => this.countTargetsForEmeraldBlossom() >= Settings.EvokerPreservationEmeraldBlossomCount && 
               spell.getTimeSinceLastCast("Emerald Blossom") > 2000
      ),
      
      // Dream Breath with Call of Ysera
      this.castEmpoweredDreamBreath(),
      
      // Verdant Embrace for Call of Ysera and spot healing
      spell.cast("Verdant Embrace", on => heal.priorityList.find(unit => 
        unit.predictedHealthPercent < Settings.EvokerPreservationVerdantEmbracePercent &&
        unit.distanceTo(me) <= 40
      )),
      
      // Spiritbloom for moderate damage on raid
      this.castEmpoweredSpiritbloom(),
      
      // Reversion for tank maintenance
      spell.cast("Reversion", on => this.findBestReversionTarget()),
      
      // Echo for additional utility
      spell.cast("Echo", on => heal.priorityList.find(unit => 
        !unit.hasAura(auras.echo) && 
        unit.predictedHealthPercent < Settings.EvokerPreservationEchoPercent &&
        unit.distanceTo(me) <= 30
      )),
      
      // Temporal Anomaly for additional echo
      spell.cast("Temporal Anomaly", on => me, 
        req => this.countPriorityTargets(80) >= Settings.EvokerPreservationTemporalAnomalyCount &&
               !me.hasAura(auras.temporalArtifice)
      )
    );
  }

  generalHealing() {
    // Generic healing rotation with core abilities
    return new bt.Selector(
      // Reversion on tanks or low health targets
      spell.cast("Reversion", on => this.findBestReversionTarget()),
      
      // Dream Breath for HoT application
      this.castEmpoweredDreamBreath(),
      
      // Spiritbloom for burst
      this.castEmpoweredSpiritbloom(),
      
      // Verdant Embrace for spot healing
      spell.cast("Verdant Embrace", on => heal.priorityList.find(unit => 
        unit.predictedHealthPercent < Settings.EvokerPreservationVerdantEmbracePercent &&
        unit.distanceTo(me) <= 40
      )),
      
      // Echo for additional healing
      spell.cast("Echo", on => heal.priorityList.find(unit => 
        !unit.hasAura(auras.echo) && 
        unit.predictedHealthPercent < Settings.EvokerPreservationEchoPercent &&
        unit.distanceTo(me) <= 30
      )),
      
      // Living Flame for single target healing
      spell.cast("Living Flame", on => {
        const target = heal.priorityList.find(unit => 
          unit.predictedHealthPercent < Settings.EvokerPreservationLivingFlamePercent &&
          unit.distanceTo(me) <= 25
        );
        return target;
      })
    );
  }

  dpsRotation(isFlameshaperBuild) {
    // Check if healing is needed before doing damage
    const needsHealing = heal.priorityList.some(unit => unit.predictedHealthPercent < 85);
    if (needsHealing) return bt.Status.Failure;
    
    return new bt.Selector(
      // Fire Breath for damage
      this.castEmpoweredFireBreath(),
      
      // Engulf for Flameshaper build
      isFlameshaperBuild && Settings.EvokerPreservationUseEngulfInDamage ? 
        spell.cast("Engulf", on => {
          const target = combat.bestTarget;
          return target && target.hasAura(auras.fireBreathDamage) ? target : null;
        }) : bt.Status.Failure,
      
      // Deep Breath for AoE damage
      spell.cast("Deep Breath",
        on => {
          const bestTarget = EvokerCommon.findBestDeepBreathTarget();
          return bestTarget.unit ? bestTarget.unit.position : null;
        },
        req => {
          if (!Settings.EvokerPreservationUseDeepBreath) return false;
          const bestTarget = EvokerCommon.findBestDeepBreathTarget();
          return combat.targets.length >= 2 && bestTarget.count >= Settings.EvokerPreservationDeepBreathMinTargets;
        }
      ),
      
      // Disintegrate with Essence Burst procs
      spell.cast("Disintegrate",
        on => combat.bestTarget,
        req => {
          const essenceBurst = me.getAura(auras.essenceBurst);
          return essenceBurst && (essenceBurst.stacks === 2 || essenceBurst.remaining < 2000);
        }
      ),
      
      // Living Flame as filler DPS
      spell.cast("Living Flame", on => combat.bestTarget),
      
      // Azure Strike during movement
      spell.cast("Azure Strike", on => combat.bestTarget, req => me.isMoving())
    );
  }

  castEmpoweredDreamBreath() {
    // Determine best empower level based on context
    const getEmpowerLevel = () => {
      // If we're already empowering, consider increasing the level
      if (EvokerCommon.isEmpowering("Dream Breath")) {
        const currentLevel = me.spellInfo.empowerLevel || 1;
        
        // Increase empower level based on more detailed conditions
        if (currentLevel === 1 && this.countPriorityTargets(60) >= 3) {
          return 3; // Go for max level if multiple targets need healing
        }
        if (currentLevel === 1 && this.countPriorityTargets(80) >= 2) {
          return 2; // Go for medium level if some targets need healing
        }
        return currentLevel; // Otherwise keep current level
      }
      
      // Initial empower level determination
      if (me.hasAura(auras.callOfYsera)) return 1; // Fast cast for HoT with Call of Ysera
      
      // Emergency healing or AoE
      if (this.countPriorityTargets(60) >= 3) return 3;
      
      // General healing
      if (this.countPriorityTargets(80) >= 2) return 2;
      
      // Single target or spot healing
      return 1;
    };
    
    // Check if we're already casting
    if (me.isCastingOrChanneling && EvokerCommon.isEmpowering("Dream Breath")) {
      return new bt.Action(() => bt.Status.Running);
    }
    
    return EvokerCommon.castEmpowered(
      "Dream Breath", 
      getEmpowerLevel(), 
      on => {
        const validTargets = heal.priorityList.filter(unit => 
          unit.distanceTo(me) <= 30 &&
          me.isFacing(unit));
        return validTargets.length > 0 ? validTargets[0] : null;
      }, 
      req => {
        // Consider Call of Ysera buff in the decision
        const hasCallOfYsera = me.hasAura(auras.callOfYsera);
        
        // For HoT (rank 1) we're less strict about health thresholds
        const validTargetsForHoT = heal.priorityList.filter(unit =>
          unit.distanceTo(me) <= 30 &&
          me.isFacing(unit) &&
          unit.predictedHealthPercent < 90
        );
        
        // For burst healing (higher ranks) we use the setting threshold
        const validTargetsForBurst = heal.priorityList.filter(unit =>
          unit.distanceTo(me) <= 30 &&
          me.isFacing(unit) &&
          unit.predictedHealthPercent < Settings.EvokerPreservationDreamBreathPercent
        );
        
        // With Call of Ysera, we prefer rank 1 for efficient HoT application
        if (hasCallOfYsera) {
          return validTargetsForHoT.length >= 1;
        } else {
          // For burst healing, we want more targets below the threshold
          return validTargetsForBurst.length >= Settings.EvokerPreservationDreamBreathCount;
        }
      }
    );
  }
  
  castEmpoweredSpiritbloom() {
    // Determine best empower level based on context
    const getEmpowerLevel = () => {
      // If we're already empowering, consider the current situation
      if (EvokerCommon.isEmpowering("Spiritbloom")) {
        const currentLevel = me.spellInfo.empowerLevel || 1;
        
        // Check if conditions justify increasing empower level
        if (currentLevel < 3 && this.countPriorityTargets(70) >= 4) {
          return 3; // Go for max level if multiple targets need healing
        }
        if (currentLevel < 2 && this.countPriorityTargets(70) >= 2) {
          return 2; // Go for medium level if some targets need healing
        }
        return currentLevel; // Otherwise keep current level
      }
      
      // Initial empower level determination
      // Higher empower level for more targets
      if (this.countPriorityTargets(70) >= 4) return 3;
      
      // Lower empower level for fewer targets
      if (this.countPriorityTargets(70) >= 2) return 2;
      
      // Single target
      return 1;
    };
    
    // Check if we're already casting
    if (me.isCastingOrChanneling && EvokerCommon.isEmpowering("Spiritbloom")) {
      return new bt.Action(() => bt.Status.Running);
    }
    
    return EvokerCommon.castEmpowered(
      "Spiritbloom", 
      getEmpowerLevel(), 
      on => {
        // If we have Lifebind active, cast on ourselves to duplicate healing
        if (me.hasAura(auras.lifebind)) {
          return me;
        }
        
        // Otherwise target the most injured player
        return heal.priorityList[0];
      }, 
      req => {
        // Check if we have Lifebind active for the combo
        if (me.hasAura(auras.lifebind)) {
          return true;
        }
        
        // For regular use, check if enough targets are low enough
        const validTargets = heal.priorityList.filter(unit =>
          unit.distanceTo(me) <= 30 &&
          unit.predictedHealthPercent < Settings.EvokerPreservationSpiritbloomPercent
        );
        
        return validTargets.length >= Settings.EvokerPreservationSpiritbloomCount;
      }
    );
  }
  
  castEmpoweredFireBreath() {
    // Determine best empower level based on context
    const getEmpowerLevel = () => {
      // If we're already empowering, consider the current empower level
      if (EvokerCommon.isEmpowering("Fire Breath")) {
        const currentLevel = me.spellInfo.empowerLevel || 1;
        
        // Check if conditions justify increasing empower level
        if (currentLevel < 3 && combat.targets.length >= 4) {
          return 3; // Go for max level if many targets
        }
        if (currentLevel < 2 && combat.targets.length >= 2) {
          return 2; // Go for medium level if some targets
        }
        return currentLevel; // Otherwise keep current level
      }
      
      // Initial empower level determination
      // Higher empower level for more targets
      if (combat.targets.length >= 4) return 3;
      
      // Medium empower for a few targets
      if (combat.targets.length >= 2) return 2;
      
      // Low empower for single target
      return 1;
    };
    
    // Check if we're already casting
    if (me.isCastingOrChanneling && EvokerCommon.isEmpowering("Fire Breath")) {
      return new bt.Action(() => bt.Status.Running);
    }
    
    return EvokerCommon.castEmpowered(
      "Fire Breath", 
      getEmpowerLevel(), 
      on => combat.bestTarget, 
      req => {
        // Only cast when no immediate healing is needed
        if (this.countPriorityTargets(75) > 0) return false;
        
        // Cast on cooldown for Essence Burst procs and damage
        return spell.getCooldown("Fire Breath").timeleft === 0;
      }
    );
  }
  
  findBestReversionTarget() {
    // First check if there's a target without Reversion that needs healing
    const targetNeedingHealing = heal.priorityList.find(unit => 
      !unit.hasAura(auras.reversion) && 
      unit.predictedHealthPercent < Settings.EvokerPreservationReversionPercent &&
      unit.distanceTo(me) <= 40
    );
    
    if (targetNeedingHealing) return targetNeedingHealing;
    
    // If we have max charges, prioritize tanks
    if (spell.getCharges("Reversion") === 2) {
      const tankWithoutAura = heal.friends.Tanks.find(unit => 
        !unit.hasAura(auras.reversion) &&
        unit.distanceTo(me) <= 40
      );
      
      if (tankWithoutAura) return tankWithoutAura;
      
      // Then prioritize healers
      const healerWithoutAura = heal.friends.Healers.find(unit => 
        !unit.hasAura(auras.reversion) &&
        unit.distanceTo(me) <= 40
      );
      
      if (healerWithoutAura) return healerWithoutAura;
    }
    
    return null;
  }
  
  findBestEmeraldBlossomTarget() {
    // Find the unit that will affect the most injured allies
    return heal.priorityList.reduce((bestTarget, currentUnit) => {
      if (!currentUnit || currentUnit.distanceTo(me) > 40) return bestTarget;
      
      const currentCount = this.countTargetsInRange(currentUnit, 10, 
        Settings.EvokerPreservationEmeraldBlossomPercent);
      
      const bestCount = bestTarget ? 
        this.countTargetsInRange(bestTarget, 10, Settings.EvokerPreservationEmeraldBlossomPercent) : 0;
      
      // Check if we've already spawned a Cycle of Life sprout
      const hasCycleSprout = heal.priorityList.some(unit => unit.hasAura(auras.cycleSprout));
      
      // If we have a sprout, prioritize targets with higher counts
      if (hasCycleSprout) {
        return currentCount > bestCount ? currentUnit : bestTarget;
      } else {
        // For setting up Cycle of Life, prefer central positions with medium count
        if (currentCount >= 2 && currentUnit.isInRaid()) {
          return currentUnit;
        }
        return currentCount > bestCount ? currentUnit : bestTarget;
      }
    }, null);
  }
  
  findBestPositionForDreamFlight() {
    // Find the position that will affect the most injured allies
    const bestTarget = heal.priorityList.reduce((bestTarget, currentUnit) => {
      if (!currentUnit || currentUnit.distanceTo(me) > 40) return bestTarget;
      
      const currentCount = this.countTargetsInRange(currentUnit, 12, 
        Settings.EvokerPreservationDreamFlightPercent);
      
      const bestCount = bestTarget ? 
        this.countTargetsInRange(bestTarget, 12, Settings.EvokerPreservationDreamFlightPercent) : 0;
        
      return currentCount > bestCount ? currentUnit : bestTarget;
    }, null);
    
    return bestTarget || me;
  }
  
  countPriorityTargets(healthPercent) {
    return heal.priorityList.filter(unit => 
      unit.predictedHealthPercent < healthPercent &&
      unit.distanceTo(me) <= 40
    ).length;
  }
  
  countTargetsInRange(centerUnit, range, healthPercentThreshold = 100) {
    return heal.priorityList.filter(unit => 
      unit.distanceTo(centerUnit) <= range &&
      unit.predictedHealthPercent < healthPercentThreshold
    ).length;
  }
  
  countTargetsForEmeraldBlossom() {
    const center = this.findBestEmeraldBlossomTarget() || me;
    return this.countTargetsInRange(center, 10, Settings.EvokerPreservationEmeraldBlossomPercent);
  }
  
  isHighDamageSituation() {
    // Check for signs of high incoming damage
    
    // Multiple enemies casting dangerous spells
    const dangerousCasts = combat.targets.filter(unit => 
      unit.isCastingOrChanneling && 
      unit.spellInfo && 
      !unit.isInterruptible
    ).length;
    
    // Multiple targets taking high damage
    const targetsLosingHealth = heal.priorityList.filter(unit => 
      unit.health < unit.healthMax * 0.7 && 
      unit.healthPercent < unit.previousHealthPercent
    ).length;
    
    // Tanks under pressure
    const tanksInDanger = heal.friends.Tanks.filter(unit => 
      unit.pctHealth < 50 || 
      unit.incomingDamage > unit.health * 0.3
    ).length;
    
    return dangerousCasts >= 2 || targetsLosingHealth >= 3 || tanksInDanger >= 1;
  }
  
  hasSetBonus(tier, pieces) {
    if (tier === 1 && pieces === 4) {
      // Check for previous tier 4pc bonus
      return Settings.EvokerPreservation4PreviousSet;
    } else if (tier === 2 && pieces === 4) {
      // Check for current tier 4pc bonus
      return Settings.EvokerPreservation4Set;
    }
    
    // Default to false for any other combinations
    return false;
  }
  
  /**
   * Checks if a specific variable exists for spell or game state tracking
   * 
   * @param {string} variableName - The name of the variable to check
   * @returns {boolean} True if the variable exists and is set, false otherwise
   */
  hasVariable(variableName) {
    // Initialize variables object if it doesn't exist
    if (!this._variables) {
      this._variables = {};
    }
    
    // Convert variable names to strings for consistent lookup
    const key = variableName.toString();
    
    // Return true if the variable exists, false otherwise
    return this._variables[key] === true;
  }
  
  /**
   * Sets a variable for tracking spell states or conditions
   * 
   * @param {string} variableName - The name of the variable to set
   * @param {boolean} value - The value to set (true or false)
   */
  setVariable(variableName, value = true) {
    // Initialize variables object if it doesn't exist
    if (!this._variables) {
      this._variables = {};
    }
    
    // Convert variable names to strings for consistent lookup
    const key = variableName.toString();
    
    // Set the variable
    this._variables[key] = value === true;
  }
  
  /**
   * Clears a variable
   * 
   * @param {string} variableName - The name of the variable to clear
   */
  clearVariable(variableName) {
    // Initialize variables object if it doesn't exist
    if (!this._variables) {
      this._variables = {};
    }
    
    // Convert variable names to strings for consistent lookup
    const key = variableName.toString();
    
    // Remove the variable
    delete this._variables[key];
  }
  
  /**
   * Initializes the variables system for the rotation
   * This should be called when the behavior starts
   */
  initializeVariables() {
    // Create the variables storage if it doesn't exist
    this._variables = {};
    
    // Set initial values for key variables
    this.setVariable("cast_stasis_spell", false);
  }
}