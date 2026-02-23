import { Behavior, BehaviorContext } from "@/Core/Behavior"; // Fixed import to include BehaviorContext
import * as bt from '@/Core/BehaviorTree';
import Specialization from '@/Enums/Specialization';
import Common from '@/Core/Common';
import Spell from "@/Core/Spell";
import { me } from "@/Core/ObjectManager";
import { PowerType } from "@/Enums/PowerType";
import { defaultCombatTargeting as combat } from "@/Targeting/CombatTargeting";
import { defaultHealTargeting as heal } from '@/Targeting/HealTargeting';
import Settings from "@/Core/Settings";

/**
 * Discipline Priest Behavior Implementation
 * This behavior focuses primarily on damage output while keeping Atonement active
 */
export class DisciplinePriestBehavior extends Behavior {
  // Define context, specialization, name, and version
  context = BehaviorContext.Any; // Now this will be defined
  specialization = Specialization.Priest.Discipline; // 256
  name = "Discipline Priest";
  version = 1;
  
  // Spell IDs from priestSpells in spellIDs.js
  static SPELL_IDS = {
    // Basic spells
    POWER_WORD_SHIELD: 17,
    FLASH_HEAL: 2061,
    SHADOW_WORD_PAIN: 589,
    POWER_WORD_RADIANCE: 194509,
    PENANCE: 47540,
    DARK_REPRIMAND: 400169, // Shadow version of Penance
    POWER_WORD_SOLACE: 129250,
    SMITE: 585,
    DIVINE_STAR: 110744,
    HALO: 120517,
    SHADOW_COVENANT: 314867,
    RAPTURE: 47536,
    POWER_INFUSION: 10060,
    PAIN_SUPPRESSION: 33206,
    SHADOW_WORD_DEATH: 32379,
    MINDGAMES: 375901,
    MINDBENDER: 123040,
    SHADOWFIEND: 34433,
    PURGE_THE_WICKED: 204213,
    POWER_WORD_BARRIER: 62618,
    EVANGELISM: 472433,
    SCHISM: 424509,
    ULTIMATE_PENITENCE: 421453,
    MIND_BLAST: 8092,
    RENEW: 139,
    LEAP_OF_FAITH: 73325,

    // Auras
    ATONEMENT: 194384,
    POWER_OF_THE_DARK_SIDE: 198069,
    BORROWED_TIME: 390692,
    RAPTURE_BUFF: 47536,
    SHADOW_COVENANT_BUFF: 322105,
    HARSH_DISCIPLINE: 373183,
    POWER_WORD_SHIELD_BUFF: 17,
    TWIST_OF_FATE: 390978,
    
    // Hero Talents
    PREMONITION: 428924, // Oracle
    ENTROPIC_RIFT: 447444, // Voidweaver
    VOID_BLAST: 450405,
    
    // Premonition spells
    PREMONITION_OF_INSIGHT: 428933,
    PREMONITION_OF_PIETY: 428930,
    PREMONITION_OF_SOLACE: 428934,
    PREMONITION_OF_CLAIRVOYANCE: 440725
  };
  
  /**
   * Settings for the behavior
   * These will appear in the UI settings panel
   */
  static settings = [
    {
      header: "Discipline Priest Configuration",
      options: [
        {
          uid: "damageOnly", 
          text: "Focus on Damage Only", 
          type: "checkbox", 
          default: false
        },
        {
          uid: "swDeathThreshold", 
          text: "SW: Death Health Threshold", 
          type: "range", 
          default: 50
        },
        {
          uid: "useRapture", 
          text: "Use Rapture", 
          type: "checkbox", 
          default: true
        },
        {
          uid: "usePainSuppression", 
          text: "Use Pain Suppression", 
          type: "checkbox", 
          default: true
        },
        {
          uid: "painSuppressionHealth", 
          text: "Pain Suppression Health %", 
          type: "range", 
          default: 40
        },
        {
          uid: "mindbenderWithCooldowns", 
          text: "Mindbender with Cooldowns", 
          type: "checkbox", 
          default: true
        },
        {
          uid: "maintainAtonement", 
          text: "Maintain Atonement", 
          type: "checkbox", 
          default: true
        },
        {
          uid: "useShieldOnCooldown", 
          text: "Shield on Cooldown", 
          type: "checkbox", 
          default: true
        },
        {
            uid: "useUltimatePenitence", 
            text: "Use Ultimate Penitence", 
            type: "checkbox", 
            default: true
          },
          
          // Ultimate Penitence threshold setting
          {
            uid: "ultimatePenitenceEnemies", 
            text: "Ultimate Penitence Min Enemies", 
            type: "range", 
            default: 3
          }
      ]
    }
  ];

  // Helper functions to detect hero talents
  isOracle() {
    return me.hasAura(this.constructor.SPELL_IDS.PREMONITION); // Oracle Hero Talent
  }

  isVoidweaver() {
    return me.hasAura(this.constructor.SPELL_IDS.ENTROPIC_RIFT); // Voidweaver Hero Talent
  }

  /**
   * Builds the behavior tree for this specialization
   * This is the main entry point for the behavior
   * @returns {bt.Composite} The root node of the behavior tree
   */
  build() {
    return new bt.Selector(
      // Check for ongoing casts/channels
      Common.waitForCastOrChannel(),
      
      // Don't run rotation while mounted
      Common.waitForNotMounted(),
      
      // Defensive cooldowns (always check regardless of target)
      this.defensiveCooldowns(),
      
      // Check if we have a valid target
      new bt.Action(() => {
        if (!this.getTarget()) {
          return bt.Status.Success; // Skip rotation if no target
        }
        return bt.Status.Failure; // Continue rotation if we have a target
      }),
      
      // Main rotation selector
      new bt.Selector(
        // Maintain Atonement if enabled
        new bt.Decorator(
          () => Settings.maintainAtonement && !Settings.damageOnly,
          this.maintainAtonement()
        ),
        
        // Major cooldowns
        new bt.Decorator(
          () => this.shouldUseCooldowns(),
          this.useCooldowns()
        ),
        
        // Oracle Hero Talent abilities
        new bt.Decorator(
          () => this.isOracle(),
          this.oracleRotation()
        ),
        
        // Voidweaver Hero Talent abilities
        new bt.Decorator(
          () => this.isVoidweaver(),
          this.voidweaverRotation()
        ),
        
        // AoE rotation for 3+ targets
        new bt.Decorator(
          () => this.getEnemyCount() >= 3,
          this.aoeRotation()
        ),
        
        // Single-target rotation
        this.singleTargetRotation()
      )
    );
  }

  /**
   * Returns the current target, prioritizing the player's target if valid
   * @returns {CGUnit|null} The current target or null if none
   */
  getTarget() {
    const target = me.target;
    if (target && !target.deadOrGhost && me.canAttack(target)) {
      return target;
    }
    return combat.bestTarget;
  }

  /**
   * Get the number of enemies in range for AOE consideration
   * @returns {number} The count of enemies
   */
  getEnemyCount() {
    return combat.targets.filter(unit => unit.distanceTo(me) <= 40).length;
  }

  /**
   * Determines if offensive cooldowns should be used
   * @returns {boolean} True if cooldowns should be used
   */
  shouldUseCooldowns() {
    const target = this.getTarget();
    if (!target) return false;
    
    // Don't use cooldowns on low-health targets
    const ttd = target.timeToDeath ? target.timeToDeath() : undefined;
    if (ttd !== undefined && ttd < 10) return false;
    
    // Don't use cooldowns on enemies below 20% health
    if (target.health / target.maxHealth < 0.2) return false;
    
    return true;
  }

  /**
   * Defensive cooldowns that should be used regardless of target
   */
  defensiveCooldowns() {
    return new bt.Selector(
      // Pain Suppression (self) when low health
      Spell.cast("Pain Suppression", () => {
        return Settings.usePainSuppression && 
               me.health / me.maxHealth * 100 < Settings.painSuppressionHealth && 
               !me.hasAura("Pain Suppression");
      }),
      
      // Use Power Word: Shield on cooldown if enabled
      Spell.cast("Power Word: Shield", () => {
        return Settings.useShieldOnCooldown && 
               !me.hasAura("Power Word: Shield") && 
               !me.hasAura("Weakened Soul");
      }),

      // Use Desperate Prayer when health drops below 50%
      Spell.cast("Desperate Prayer", () => {
        return me.health / me.maxHealth < 0.5;
      })
    );
  }

  /**
   * Maintain Atonement on tank/self/group as needed
   */
  maintainAtonement() {
    return new bt.Selector(
      // Power Word: Shield to apply Atonement to tank/self if not present
      Spell.cast("Power Word: Shield", () => {
        const target = heal.priorityList[0] || me;
        return target && !target.hasAura("Power Word: Shield") && 
               !target.hasAura("Weakened Soul") && 
               (!target.hasAura("Atonement") || 
                target.getAura("Atonement").remains < 3);
      }),
      
      // Power Word: Radiance for group Atonement if many need it
      Spell.cast("Power Word: Radiance", () => {
        // Only cast if we have multiple people without Atonement and ability is ready
        const atonementCount = heal.friends.All.filter(unit => unit.hasAura("Atonement")).length;
        return atonementCount < Math.floor(heal.friends.All.length * 0.6) && 
               !me.hasAura("Rapture");
      }),
      
      // Flash Heal for Atonement in emergency
      Spell.cast("Flash Heal", () => {
        const target = heal.priorityList[0];
        return target && 
               target.health / target.maxHealth < 0.6 && 
               !target.hasAura("Atonement");
      })
    );
  }

  /**
   * Use major cooldowns when appropriate
   */
  useCooldowns() {
    return new bt.Selector(
      // Mindbender/Shadowfiend for mana and damage
      Spell.cast("Mindbender", () => {
        // Cast with major CDs when we have a burst window
        return Settings.mindbenderWithCooldowns && 
               me.powerByType(PowerType.Mana) / me.maxPowerByType(PowerType.Mana) < 0.8;
      }),
      
      // Shadowfiend fallback if Mindbender not talented
      Spell.cast("Shadowfiend", () => {
        // Cast Shadowfiend if Mindbender not available
        return !Spell.isSpellKnown("Mindbender") && 
               me.powerByType(PowerType.Mana) / me.maxPowerByType(PowerType.Mana) < 0.8;
      }),
      
      // Use Power Infusion for burst damage window
      Spell.cast("Power Infusion", () => {
        return !me.hasAura("Power Infusion");
      }),
      
      // Rapture for major healing/shielding
      Spell.cast("Rapture", () => {
        return Settings.useRapture && 
               heal.friends.All.filter(unit => unit.health / unit.maxHealth < 0.7).length >= 3;
      }),
      
       // Ultimate Penitence (if talented AND enabled in settings)
       Spell.cast("Ultimate Penitence", () => {
        // Check if the ability is known and enabled in settings
        return Spell.isSpellKnown("Ultimate Penitence") && 
               Settings.useUltimatePenitence && 
               this.getEnemyCount() >= Settings.ultimatePenitenceEnemies;
      }),
      
      // Evangelism to extend Atonement
      Spell.cast("Evangelism", () => {
        const atonementCount = heal.friends.All.filter(unit => unit.hasAura("Atonement")).length;
        return Spell.isSpellKnown("Evangelism") && 
               atonementCount >= Math.min(5, heal.friends.All.length * 0.8);
      })
    );
  }

  /**
   * Oracle Hero Talent rotation (focuses on Premonition abilities)
   */
  oracleRotation() {
    return new bt.Selector(
      // Use Premonition abilities based on what's available currently
      Spell.cast("Premonition of Clairvoyance", () => {
        return Spell.isSpellKnown("Premonition of Clairvoyance") && 
               me.hasAura("Premonition of Solace");
      }),
      
      // Premonition of Insight for cooldown reduction
      Spell.cast("Premonition of Insight", () => {
        return Spell.isSpellKnown("Premonition of Insight") && 
               !me.hasAura("Premonition of Insight") && 
               !me.hasAura("Premonition of Piety") && 
               !me.hasAura("Premonition of Solace");
      }),
      
      // Premonition of Piety for healing boost
      Spell.cast("Premonition of Piety", () => {
        return Spell.isSpellKnown("Premonition of Piety") && 
               !me.hasAura("Premonition of Insight") && 
               !me.hasAura("Premonition of Piety") && 
               !me.hasAura("Premonition of Solace") && 
               heal.friends.All.filter(unit => unit.health / unit.maxHealth < 0.7).length >= 2;
      }),
      
      // Premonition of Solace for shielding and damage reduction
      Spell.cast("Premonition of Solace", () => {
        return Spell.isSpellKnown("Premonition of Solace") && 
               !me.hasAura("Premonition of Insight") && 
               !me.hasAura("Premonition of Piety") && 
               !me.hasAura("Premonition of Solace");
      })
    );
  }

  /**
   * Voidweaver Hero Talent rotation (focuses on Entropic Rift and Void damage)
   */
  voidweaverRotation() {
    return new bt.Selector(
      // Mind Blast to apply/refresh Entropic Rift
      Spell.cast("Mind Blast", () => {
        return !me.hasAura("Entropic Rift") || 
               me.getAura("Entropic Rift").remains < 3;
      }),
      
      // Use Void Blast when Entropic Rift is active (replaces Smite)
      Spell.cast("Void Blast", () => {
        return me.hasAura("Entropic Rift");
      })
    );
  }

  /**
   * AoE rotation for 3+ targets
   */
  aoeRotation() {
    return new bt.Selector(
      // Shadow Covenant if talented
      Spell.cast("Shadow Covenant", () => {
        return Spell.isSpellKnown("Shadow Covenant") && 
               !me.hasAura("Shadow Covenant") && 
               this.getEnemyCount() >= 4;
      }),
      
      // Divine Star AoE damage
      Spell.cast("Divine Star", () => {
        return Spell.isSpellKnown("Divine Star") && 
               this.getEnemyCount() >= 3;
      }),
      
      // Halo for widespread AoE
      Spell.cast("Halo", () => {
        return Spell.isSpellKnown("Halo") && 
               this.getEnemyCount() >= 3;
      }),
      
      // Penance for AoE with Harsh Discipline
      Spell.cast("Penance", () => {
        return me.hasAura("Harsh Discipline") || 
               me.hasAura("Power of the Dark Side");
      }),
      
      // Shadow Word: Pain when moving
      Spell.cast("Shadow Word: Pain", () => {
        const target = this.getTarget();
        return target && 
               me.isMoving() && 
               (!target.hasAura("Shadow Word: Pain") || 
                target.getAura("Shadow Word: Pain").remains < 4.8);
      }),
      
      // Mind Blast for priority damage
      Spell.cast("Mind Blast", () => {
        return Spell.isSpellKnown("Mind Blast");
      }),
      
      // Shadow Word: Death for execute damage
      Spell.cast("Shadow Word: Death", () => {
        const target = this.getTarget();
        return target && 
               target.health / target.maxHealth < 0.2 && 
               me.health / me.maxHealth * 100 > Settings.swDeathThreshold;
      }),
      
      // Regular Penance if nothing else is available
      Spell.cast("Penance"),
      
      // Holy Nova for spammable AoE
      Spell.cast("Holy Nova", () => {
        return this.getEnemyCount() >= 3 && 
               me.distanceTo(this.getTarget()) <= 12;
      }),
      
      // Smite as filler
      Spell.cast("Smite")
    );
  }

  /**
   * Single-target damage rotation
   */
  singleTargetRotation() {
    return new bt.Selector(
      // Schism for damage amplification
      Spell.cast("Schism", () => {
        return Spell.isSpellKnown("Schism") && 
               !me.getTarget().hasAura("Schism");
      }),
      
      // Mindgames for damage/healing reversal
      Spell.cast("Mindgames", () => {
        return Spell.isSpellKnown("Mindgames");
      }),
      
      // Shadow Word: Pain if not active
      Spell.cast("Shadow Word: Pain", () => {
        const target = this.getTarget();
        return !target.hasAura("Shadow Word: Pain") || 
               target.getAura("Shadow Word: Pain").remains < 4.8;
      }),
      
      // Mind Blast on cooldown
      Spell.cast("Mind Blast", () => {
        return Spell.isSpellKnown("Mind Blast");
      }),
      
      // Shadow Word: Death for execute damage
      Spell.cast("Shadow Word: Death", () => {
        const target = this.getTarget();
        return target.health / target.maxHealth < 0.2 && 
               me.health / me.maxHealth * 100 > Settings.swDeathThreshold;
      }),
      
      // Penance with Power of the Dark Side proc
      Spell.cast("Penance", () => {
        return me.hasAura("Power of the Dark Side") || 
               me.hasAura("Harsh Discipline");
      }),
      
      // Regular Penance
      Spell.cast("Penance"),
      
      // Divine Star if talented
      Spell.cast("Divine Star", () => {
        return Spell.isSpellKnown("Divine Star");
      }),
      
      // Smite as filler
      Spell.cast("Smite")
    );
  }
}