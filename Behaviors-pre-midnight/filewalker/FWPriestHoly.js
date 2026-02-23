import { Behavior, BehaviorContext } from "@/Core/Behavior";
import * as bt from '@/Core/BehaviorTree';
import Specialization from '@/Enums/Specialization';
import Common from '@/Core/Common';
import Spell from "@/Core/Spell";
import { me } from "@/Core/ObjectManager";
import { PowerType } from "@/Enums/PowerType";
import { defaultCombatTargeting as combat } from "@/Targeting/CombatTargeting";
import { defaultHealTargeting as heal } from '@/Targeting/HealTargeting';
import Settings from "@/Core/Settings";

export class HolyPriestBehavior extends Behavior {
  // Define context, specialization, name, and version
  context = BehaviorContext.Any;
  specialization = Specialization.Priest.Holy;
  name = "FW Holy Priest";
  version = 1;
  
  // Define hero talent builds
  static HERO_TALENTS = {
    ORACLE: 'Oracle',
    ARCHON: 'Archon'
  };
  
  /**
   * Settings for the behavior
   */
  static settings = [
    {
      header: "Holy Priest Configuration",
      options: [
        {
          uid: "EnableDPS",
          text: "Enable DPS when healing not needed",
          type: "checkbox",
          default: true
        },
        {
          uid: "HealingThreshold",
          text: "Healing Priority Threshold %",
          type: "range",
          default: 80
        },
        {
          uid: "EmergencyThreshold",
          text: "Emergency Healing Threshold %",
          type: "range",
          default: 40
        },
        {
          uid: "SWDeathThreshold",
          text: "Shadow Word: Death Health Threshold",
          type: "range",
          default: 50
        },
        {
          uid: "HolyNovaThreshold",
          text: "Holy Nova Enemy Threshold",
          type: "range",
          default: 3
        },
        {
          uid: "UseApotheosis",
          text: "Use Apotheosis for Burst Healing",
          type: "checkbox",
          default: true
        },
        {
          uid: "UseDivineHymn",
          text: "Use Divine Hymn",
          type: "checkbox",
          default: true
        },
        {
          uid: "UseMindgames",
          text: "Use Mindgames",
          type: "checkbox",
          default: true
        },
        {
          uid: "UseGuardianSpirit",
          text: "Use Guardian Spirit",
          type: "checkbox",
          default: true
        }
      ]
    }
  ];

  /**
   * Builds the behavior tree for this specialization
   */
  build() {
    return new bt.Selector(
      Common.waitForCastOrChannel(),
      Common.waitForNotMounted(),
      this.applyBuffs(),
      // Prioritize healing when needed
      new bt.Decorator(
        () => this.shouldHeal(),
        new bt.Selector(
          this.emergencyHealing(),
          this.standardHealing(),
          this.groupHealing()
        )
      ),
      // Use DPS abilities when healing is not needed
      new bt.Decorator(
        () => Settings.EnableDPS,
        new bt.Selector(
          this.useCooldowns(),
          new bt.Decorator(
            () => this.isOracleBuild(),
            this.oracleDps()
          ),
          new bt.Decorator(
            () => this.isArchonBuild(),
            this.archonDps()
          ),
          this.standardDps()
        )
      )
    );
  }

  /**
   * Check if Oracle build is active
   */
  isOracleBuild() {
    return me.hasAura(428924); // Premonition ID
  }
  
  /**
   * Check if Archon build is active
   */
  isArchonBuild() {
    return me.hasAura(453109); // Power Surge ID
  }
  
  /**
   * Determine if we should prioritize healing
   */
  shouldHeal() {
    const priorityTarget = heal.getPriorityTarget();
    return priorityTarget && priorityTarget.health < priorityTarget.maxHealth * (Settings.HealingThreshold / 100);
  }

  /**
   * Apply basic buffs
   */
  applyBuffs() {
    return new bt.Selector(
      Spell.cast("Power Word: Fortitude", () => !me.hasAura(21562))
    );
  }

  /**
   * Emergency healing for critically low targets
   */
  emergencyHealing() {
    return new bt.Selector(
      // Apotheosis for burst healing situations
      new bt.Decorator(
        () => Settings.UseApotheosis,
        Spell.cast("Apotheosis", () => {
          // Use when multiple targets are critically low or in danger
          const criticalCount = heal.friends.All.filter(
            unit => unit.health < unit.maxHealth * (Settings.EmergencyThreshold / 100)
          ).length;
          return criticalCount >= 2 || (heal.friends.Tanks.length > 0 && 
                 heal.friends.Tanks[0].health < heal.friends.Tanks[0].maxHealth * 0.4);
        })
      ),
      
      // Guardian Spirit for life-threatening situations
      new bt.Decorator(
        () => Settings.UseGuardianSpirit,
        Spell.cast("Guardian Spirit", () => {
          const criticalTarget = heal.getPriorityTarget();
          if (criticalTarget && criticalTarget.health < criticalTarget.maxHealth * (Settings.EmergencyThreshold / 100)) {
            this._currentTarget = criticalTarget;
            return true;
          }
          return false;
        })
      ),
      
      // Divine Hymn for group-wide emergency
      new bt.Decorator(
        () => Settings.UseDivineHymn,
        Spell.cast("Divine Hymn", () => {
          const criticalCount = heal.friends.All.filter(
            unit => unit.health < unit.maxHealth * (Settings.EmergencyThreshold / 100)
          ).length;
          return criticalCount >= 3;
        })
      ),
      
      // Holy Word: Serenity for single target emergency
      Spell.cast("Holy Word: Serenity", () => {
        const criticalTarget = heal.getPriorityTarget();
        if (criticalTarget && criticalTarget.health < criticalTarget.maxHealth * (Settings.EmergencyThreshold / 100)) {
          this._currentTarget = criticalTarget;
          return true;
        }
        return false;
      }),
      
      // Flash Heal for emergency healing
      Spell.cast("Flash Heal", () => {
        const criticalTarget = heal.getPriorityTarget();
        if (criticalTarget && criticalTarget.health < criticalTarget.maxHealth * (Settings.EmergencyThreshold / 100)) {
          this._currentTarget = criticalTarget;
          return true;
        }
        return false;
      }),
      
      // Power Word: Life for emergency
      Spell.cast("Power Word: Life", () => {
        const criticalTarget = heal.getPriorityTarget();
        if (criticalTarget && criticalTarget.health < criticalTarget.maxHealth * 0.35) {
          this._currentTarget = criticalTarget;
          return true;
        }
        return false;
      })
    );
  }

  /**
   * Standard single target healing rotation
   */
  standardHealing() {
    return new bt.Selector(
      // Holy Word: Serenity
      Spell.cast("Holy Word: Serenity", () => {
        const target = heal.getPriorityTarget();
        if (target && target.health < target.maxHealth * 0.7) {
          this._currentTarget = target;
          return true;
        }
        return false;
      }),
      
      // Flash Heal when Surge of Light is active
      Spell.cast("Flash Heal", () => {
        const target = heal.getPriorityTarget();
        if (target && me.hasAura(114255) && target.health < target.maxHealth * 0.8) { // Surge of Light ID
          this._currentTarget = target;
          return true;
        }
        return false;
      }),
      
      // Prayer of Mending on tank or injured ally
      Spell.cast("Prayer of Mending", () => {
        // First check tanks
        const tank = heal.friends.Tanks.find(unit => !unit.hasAura(41635)); // Prayer of Mending buff ID
        if (tank) {
          this._currentTarget = tank;
          return true;
        }
        
        // Then check injured players
        const injured = heal.friends.All.find(unit => 
          unit.health < unit.maxHealth * 0.75 && !unit.hasAura(41635)
        );
        if (injured) {
          this._currentTarget = injured;
          return true;
        }
        
        return false;
      }),
      
      // Renew on target missing it
      Spell.cast("Renew", () => {
        const target = heal.getPriorityTarget();
        if (target && target.health < target.maxHealth * 0.85 && !target.hasAura(139)) { // Renew ID
          this._currentTarget = target;
          return true;
        }
        return false;
      }),
      
      // Flash Heal for more urgent healing
      Spell.cast("Flash Heal", () => {
        const target = heal.getPriorityTarget();
        if (target && target.health < target.maxHealth * 0.7) {
          this._currentTarget = target;
          return true;
        }
        return false;
      }),
      
      // Heal for mana-efficient healing
      Spell.cast("Heal", () => {
        const target = heal.getPriorityTarget();
        if (target && target.health < target.maxHealth * 0.9) {
          this._currentTarget = target;
          return true;
        }
        return false;
      })
    );
  }

  /**
   * Group healing rotation
   */
  groupHealing() {
    return new bt.Selector(
      // Holy Word: Sanctify for group healing
      Spell.cast("Holy Word: Sanctify", () => {
        const injuredCount = heal.friends.All.filter(unit => 
          unit.health < unit.maxHealth * 0.8
        ).length;
        return injuredCount >= 3;
      }),
      
      // Circle of Healing
      Spell.cast("Circle of Healing", () => {
        const injuredCount = heal.friends.All.filter(unit => 
          unit.health < unit.maxHealth * 0.85
        ).length;
        return injuredCount >= 3;
      }),
      
      // Prayer of Healing
      Spell.cast("Prayer of Healing", () => {
        const injuredCount = heal.friends.All.filter(unit => 
          unit.health < unit.maxHealth * 0.8
        ).length;
        return injuredCount >= 3;
      }),
      
      // Holy Nova for close range group healing
      Spell.cast("Holy Nova", () => {
        const closeInjuredCount = heal.friends.All.filter(unit => 
          unit.distanceTo(me) < 12 &&
          unit.health < unit.maxHealth * 0.9
        ).length;
        return closeInjuredCount >= 3;
      })
    );
  }

  /**
   * Logic for using major cooldowns
   */
  useCooldowns() {
    return new bt.Selector(
      // Mindgames
      new bt.Decorator(
        () => Settings.UseMindgames,
        Spell.cast("Mindgames", () => {
          const target = combat.bestTarget;
          if (target && this.shouldUseOffensiveCDs()) {
            this._currentTarget = target;
            return true;
          }
          return false;
        })
      ),
      
      // Divine Word
      Spell.cast("Divine Word", () => this.shouldUseOffensiveCDs())
    );
  }

  /**
   * Oracle build DPS rotation
   */
  oracleDps() {
    return new bt.Selector(
      // Premonition (Oracle specific)
      Spell.cast("Premonition", () => !me.hasAura(428924)), // Premonition ID
      
      // Holy Word: Chastise
      Spell.cast("Holy Word: Chastise", () => {
        const target = combat.bestTarget;
        if (target) {
          this._currentTarget = target;
          return true;
        }
        return false;
      }),
      
      // AoE with Holy Nova
      new bt.Decorator(
        () => this.getEnemyCount() >= Settings.HolyNovaThreshold,
        Spell.cast("Holy Nova")
      ),
      
      // Standard DPS rotation
      this.standardDps()
    );
  }

  /**
   * Archon build DPS rotation
   */
  archonDps() {
    return new bt.Selector(
      // Halo (popular with Archon build)
      Spell.cast("Halo", () => {
        const enemies = combat.targets.filter(unit => unit.distanceTo(me) <= 30);
        return enemies.length >= 2;
      }),
      
      // Holy Word: Chastise
      Spell.cast("Holy Word: Chastise", () => {
        const target = combat.bestTarget;
        if (target) {
          this._currentTarget = target;
          return true;
        }
        return false;
      }),
      
      // AoE with Holy Nova
      new bt.Decorator(
        () => this.getEnemyCount() >= Settings.HolyNovaThreshold,
        Spell.cast("Holy Nova")
      ),
      
      // Standard DPS rotation
      this.standardDps()
    );
  }

  /**
   * Standard DPS rotation for all builds
   */
  standardDps() {
    return new bt.Selector(
      // Holy Fire (keep on cooldown)
      Spell.cast("Holy Fire", () => {
        const target = combat.bestTarget;
        if (target && !target.hasAura(14914)) { // Holy Fire ID
          this._currentTarget = target;
          return true;
        }
        return false;
      }),
      
      // Shadow Word: Death for targets below 20%
      Spell.cast("Shadow Word: Death", () => {
        const target = combat.bestTarget;
        if (target && target.health < target.maxHealth * 0.2 && 
            me.health > me.maxHealth * (Settings.SWDeathThreshold / 100)) {
          this._currentTarget = target;
          return true;
        }
        return false;
      }),
      
      // Shadow Word: Pain if not applied
      Spell.cast("Shadow Word: Pain", () => {
        const target = combat.bestTarget;
        if (target && !target.hasAura(589)) { // Shadow Word: Pain ID
          this._currentTarget = target;
          return true;
        }
        return false;
      }),
      
      // Smite as filler
      Spell.cast("Smite", () => {
        const target = combat.bestTarget;
        if (target) {
          this._currentTarget = target;
          return true;
        }
        return false;
      })
    );
  }

  /**
   * Determine if offensive cooldowns should be used
   */
  shouldUseOffensiveCDs() {
    const target = this.getCurrentTarget();
    if (!target) return false;
    
    // Don't use CDs if the target is about to die
    const ttd = target.timeToDeath();
    if (ttd !== undefined && ttd < 15) return false;
    
    // Don't use CDs on low-health targets
    if (target.health < target.maxHealth * 0.2) return false;
    
    return true;
  }

  /**
   * Get the current target, preferring combat's best target
   */
  getCurrentTarget() {
    return combat.bestTarget;
  }

  /**
   * Get the number of enemies in range for AoE abilities
   */
  getEnemyCount() {
    return combat.targets.filter(unit => unit.distanceTo(me) <= 8).length;
  }
}