import { Behavior, BehaviorContext } from "@/Core/Behavior";
import * as bt from "@/Core/BehaviorTree";
import common from "@/Core/Common";
import spell from "@/Core/Spell";
import { me } from "@/Core/ObjectManager";
import Settings from "@/Core/Settings";
import EvokerCommon from "@/Behaviors/EvokerCommon";
import { defaultCombatTargeting as Combat, defaultCombatTargeting as combat } from "@/Targeting/CombatTargeting";
import { PowerType } from "@/Enums/PowerType";
import Specialization from "@/Enums/Specialization";

// STATUS : TESTED, NOT OPTIMIZED

const auras = {
  prescience: 410089,
  ebonMight: 395152,
  ebonMightBuff: 395296,
  breathOfEons: 403631,
  blisteringScales: 360827, // Fixed typo in the name
  tipTheScales: 370553,
  chronomatic: 462497,
  chronoflamesProc: 409560,
  verdantEmbrace: 360995,
  hover: 358267,
  temporal: 424488, // Temporal Burst buff from Tip the Scales
  ebonMightDamageBonus: 395296, // Individual buff received from Ebon Might
  severing: 404756, // New Severing Slash
  visionsOfObsidian: 408081, // Legendary talent
  bountifulBloom: 370886 // May be useful for some builds
};

export class EvokerAugmentationBehavior extends Behavior {
  name = "FW Augmentation Evoker";
  context = BehaviorContext.Any;
  specialization = Specialization.Evoker.Augmentation;
  version = wow.GameVersion.Retail;

  static settings = [
    {
      header: "Build Selection",
      options: [
        {
          type: "dropdown",
          uid: "EvokerAugmentationBuildType",
          text: "Build Type",
          values: ["Standard", "AoE Focus", "Raid Support"],
          default: "Standard"
        }
      ]
    },
    {
      header: "Defensives",
      options: [
        { type: "checkbox", uid: "EvokerAugmentationUseObsidianScales", text: "Use Obsidian Scales", default: true },
        { type: "slider", uid: "EvokerAugmentationObsidianScalesPercent", text: "Obsidian Scales Health %", min: 0, max: 100, default: 40 },
        { type: "checkbox", uid: "EvokerAugmentationUseVerdantEmbrace", text: "Use Verdant Embrace", default: true },
        { type: "slider", uid: "EvokerAugmentationVerdantEmbracePercent", text: "Verdant Embrace Health %", min: 0, max: 100, default: 60 },
        { type: "checkbox", uid: "EvokerAugmentationUseZephyr", text: "Use Zephyr", default: true },
        { type: "slider", uid: "EvokerAugmentationZephyrEnemies", text: "Zephyr Minimum Enemies", min: 1, max: 10, default: 3 },
      ]
    },
    {
      header: "Buff Management",
      options: [
        { type: "checkbox", uid: "EvokerAugmentationSmartPrescience", text: "Smart Prescience (Auto-target DPS)", default: true },
        { type: "checkbox", uid: "EvokerAugmentationPrePullBlisteringScales", text: "Pre-Pull Blistering Scales on Tank", default: true },
        { type: "checkbox", uid: "EvokerAugmentationMaintainEbonMight", text: "Maintain Ebon Might", default: true },
      ]
    },
    {
      header: "Damage",
      options: [
        { type: "checkbox", uid: "EvokerAugmentationUseBreathOfEons", text: "Use Breath of Eons", default: true },
        { type: "checkbox", uid: "EvokerAugmentationUseTipTheScales", text: "Use Tip the Scales with Fire Breath", default: true },
        { type: "checkbox", uid: "EvokerAugmentationUseSeveringSlash", text: "Use Severing Slash", default: true },
      ]
    },
    {
      header: "Movement",
      options: [
        { type: "checkbox", uid: "EvokerAugmentationUseHover", text: "Use Hover for Movement", default: true },
      ]
    }
  ];

  // Initialize variables for rotation state tracking
  _variables = {};
  
  build() {
    return new bt.Selector(
      common.waitForNotSitting(),
      common.waitForNotMounted(),
      new bt.Action(() => EvokerCommon.handleEmpoweredSpell()),
      common.waitForCastOrChannel(),
      this.defensives(),
      spell.interrupt("Quell"),
      common.waitForTarget(),
      common.waitForFacing(),
      this.handlePrePullPreparation(),
      this.handleHover(),
      new bt.Decorator(
        ret => me.target && me.distanceTo(me.target) < 25 && combat.burstPhase,
        this.openerRotation()
      ),
      new bt.Decorator(
        ret => !spell.isGlobalCooldown(),
        this.standardRotation()
      )
    );
  }

  defensives() {
    return new bt.Selector(
      spell.cast("Obsidian Scales", on => me,
        req => Settings.EvokerAugmentationUseObsidianScales && 
               me.pctHealth < Settings.EvokerAugmentationObsidianScalesPercent
      ),
      spell.cast("Verdant Embrace", on => me,
        req => Settings.EvokerAugmentationUseVerdantEmbrace && 
               me.pctHealth < Settings.EvokerAugmentationVerdantEmbracePercent
      ),
      spell.cast("Zephyr", on => me,
        req => Settings.EvokerAugmentationUseZephyr && 
               combat.targets.length >= Settings.EvokerAugmentationZephyrEnemies
      )
    );
  }

  handleHover() {
    return spell.cast("Hover", on => me,
      req => Settings.EvokerAugmentationUseHover && 
             me.isMoving() && 
             !me.hasAura(auras.hover) && 
             combat.bestTarget && 
             combat.bestTarget.distanceTo(me) > 10
    );
  }

  handlePrePullPreparation() {
    return new bt.Sequence(
      spell.cast("Blistering Scales", 
        on => this.findTank(),
        req => Settings.EvokerAugmentationPrePullBlisteringScales && 
               !me.inCombat && 
               this.findTank() && 
               !this.findTank().hasAura(auras.blisteringScales)
      )
    );
  }

  findTank() {
    // Get all party members
    const partyMembers = wow.Party.getGroupUnits;
    if(!partyMembers)
      return;
    // Find tanks (we'll check for tank role via unit properties)
    for (const unit of partyMembers) {
      if (unit && unit !== me && unit.isTank && unit.isTank()) {
        return unit;
      }
    }
    
    return null;
  }

  findDpsTargets(count = 1) {
    // Get all party members
    const partyMembers = wow.Party.getGroupUnits;
    if(!partyMembers || !Array.isArray(partyMembers)) {
      return [];  // Return empty array instead of undefined
    }
    
    // Filter to find DPS (anyone who is not a tank or healer)
    // First prioritize DPS without any Prescience
    let dps = [];
    for (const unit of partyMembers) {
      if (unit && unit !== me && 
          !(unit.isTank && unit.isTank()) && 
          !(unit.isHealer && unit.isHealer()) &&
          !unit.hasAura(auras.prescience)) {
        dps.push(unit);
      }
      
      // Break early if we found enough
      if (dps.length >= count) break;
    }
    
    // If we don't have enough, add DPS whose Prescience is about to expire
    if (dps.length < count) {
      for (const unit of partyMembers) {
        if (dps.length >= count) break;
        
        if (unit && unit !== me && 
            !(unit.isTank && unit.isTank()) && 
            !(unit.isHealer && unit.isHealer()) &&
            unit.hasAura(auras.prescience) && 
            unit.getAura(auras.prescience).remainingMs < 3000 &&
            !dps.some(existingUnit => existingUnit.guid.equals(unit.guid))) {
          dps.push(unit);
        }
      }
    }
    
    // If we still don't have enough, consider any remaining party members
    if (dps.length < count) {
      for (const unit of partyMembers) {
        if (dps.length >= count) break;
        
        if (unit && unit !== me && 
            !(unit.isTank && unit.isTank()) && 
            !(unit.isHealer && unit.isHealer()) &&
            !dps.some(existingUnit => existingUnit.guid.equals(unit.guid))) {
          dps.push(unit);
        }
      }
    }
    
    return dps;
  }

  applySmartPrescience() {
    if (!Settings.EvokerAugmentationSmartPrescience) return new bt.Action(() => bt.Status.Failure);
    
    return spell.cast("Prescience", 
      on => {
        // Fixed ternary operator and added better error handling
        const dpsTargets = this.findDpsTargets(1);
        const target = dpsTargets && dpsTargets.length > 0 ? dpsTargets[0] : null;
        return target;
      },
      req => {
        const dpsTargets = this.findDpsTargets(1);
        return dpsTargets && dpsTargets.length > 0;
      }
    );
  }

  openerRotation() {
    return new bt.Selector(
      // Prescience on top DPS
      this.applySmartPrescience(),
      
      // Apply Ebon Might if not active
      spell.cast("Ebon Might", on => me, 
        req => Settings.EvokerAugmentationMaintainEbonMight && 
               !me.hasAura(auras.ebonMightBuff)
      ),
      
      // Tip the Scales + Fire Breath combo for maximum damage
      spell.cast("Tip the Scales", on => me, 
        req => Settings.EvokerAugmentationUseTipTheScales && 
               me.hasAura(auras.ebonMightBuff) &&
               spell.getCooldown("Fire Breath").timeleft === 0
      ),
      
      this.castEmpoweredFireBreath(),
      
      // Breath of Eons - major damage cooldown
      spell.cast("Breath of Eons", on => me.target, 
        req => Settings.EvokerAugmentationUseBreathOfEons && 
               me.hasAura(auras.ebonMightBuff) &&
               combat.targets.length >= 1
      ),
      
      // Severing Slash when available
      spell.cast("Severing Slash", on => me.target, 
        req => Settings.EvokerAugmentationUseSeveringSlash && 
               me.hasAura(auras.ebonMightBuff)
      ),
      
      // Upheaval for AoE damage
      spell.cast("Upheaval", on => me.target, 
        req => me.hasAura(auras.ebonMightBuff) && 
               combat.targets.length >= 2
      ),
      
      // Eruption for essence spending
      spell.cast("Eruption", on => me.target, 
        req => me.hasAura(auras.ebonMightBuff) && 
               me.powerByType(PowerType.Essence) >= 2
      )
    );
  }

  standardRotation() {
    const buildType = Settings.EvokerAugmentationBuildType || "Standard";
    
    return new bt.Selector(
      // Always check for GCD
      new bt.Decorator(ret => spell.isGlobalCooldown(), new bt.Action(() => bt.Status.Failure)),
      
      // Maintain Prescience on DPS - high priority
      this.applySmartPrescience(),
      
      // Maintain Ebon Might as our key buff
      spell.cast("Ebon Might", on => me, 
        req => {
          if (!Settings.EvokerAugmentationMaintainEbonMight) return false;
          
          const ebonMightBuff = me.getAura(auras.ebonMightBuff);
          return !ebonMightBuff || ebonMightBuff.remainingMs < 4000;
        }
      ),
      
      // Situational: Use defensive or utility abilities
      
      // Tip the Scales when off CD for Fire Breath empowering
      spell.cast("Tip the Scales", on => me, 
        req => Settings.EvokerAugmentationUseTipTheScales && 
               me.hasAura(auras.ebonMightBuff) &&
               spell.getCooldown("Fire Breath").timeleft === 0 &&
               combat.targets.length >= (buildType === "AoE Focus" ? 2 : 1)
      ),
      
      // Fire Breath - our main damage ability
      this.castEmpoweredFireBreath(),
      
      // Breath of Eons on cooldown during Ebon Might
      spell.cast("Breath of Eons", on => me.target,
        req => Settings.EvokerAugmentationUseBreathOfEons && 
               me.hasAura(auras.ebonMightBuff) &&
               combat.targets.length >= 1
      ),
      
      // Severing Slash when available (new addition)
      spell.cast("Severing Slash", on => me.target, 
        req => Settings.EvokerAugmentationUseSeveringSlash && 
               me.hasAura(auras.ebonMightBuff)
      ),
      
      // AoE damage based on build
      spell.cast("Upheaval", on => me.target, 
        req => me.hasAura(auras.ebonMightBuff) && 
               combat.targets.length >= (buildType === "AoE Focus" ? 1 : 2)
      ),
      
      // Spend Essence on Eruption during Ebon Might
      spell.cast("Eruption", on => me.target, 
        req => me.hasAura(auras.ebonMightBuff) && 
               me.powerByType(PowerType.Essence) >= (buildType === "AoE Focus" ? 1 : 2)
      ),
      
      // Use Chronoflames procs immediately
      spell.cast("Chronoflames", on => me.target, 
        req => me.hasAura(auras.chronoflamesProc)
      ),
      
      // Living Flame to build Essence
      spell.cast("Living Flame", on => me.target, 
        req => me.powerByType(PowerType.Essence) < 5 || 
               (!spell.getCooldown("Eruption").ready && 
                !spell.getCooldown("Upheaval").ready)
      ),
      
      // Fallback: Azure Strike when moving
      spell.cast("Azure Strike", on => me.target, 
        req => me.isMoving()
      )
    );
  }

  // Optimized empowered Fire Breath implementation
  castEmpoweredFireBreath() {
    // Determine best empower level based on context
    const getEmpowerLevel = () => {
      // If we're already empowering, consider the current situation
      if (EvokerCommon.isEmpowering("Fire Breath")) {
        const currentLevel = me.spellInfo.empowerLevel || 1;
        
        // If we have Tip the Scales, we want maximum empower
        if (me.hasAura(auras.tipTheScales)) return 3;
        
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
      // With Tip the Scales, always go maximum
      if (me.hasAura(auras.tipTheScales)) return 3;
      
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
        // With Tip the Scales, cast as soon as possible
        if (me.hasAura(auras.tipTheScales)) return true;
        
        // Cast when we have Ebon Might for increased damage
        if (me.hasAura(auras.ebonMightBuff)) return true;
        
        // Cast on cooldown for Essence Burst procs and basic damage
        return spell.getCooldown("Fire Breath").timeleft === 0;
      }
    );
  }
}