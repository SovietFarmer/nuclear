import { Behavior, BehaviorContext } from "@/Core/Behavior";
import * as bt from '@/Core/BehaviorTree';
import Specialization from '@/Enums/Specialization';
import Common from '@/Core/Common';
import Spell from "@/Core/Spell";
import { me } from "@/Core/ObjectManager";
import { PowerType } from "@/Enums/PowerType";
import { defaultCombatTargeting as combat } from "@/Targeting/CombatTargeting";
import Settings from "@/Core/Settings";

/**
 * Behavior implementation for Elemental Shaman
 * Implementation of TWW2 Shaman Elemental Farseer APL
 */
export class ElementalShamanBehavior extends Behavior {
  // Define context, specialization, name, and version
  context = BehaviorContext.Any;
  specialization = Specialization.Shaman.Elemental;
  name = "EFW lemental Shaman";
  version = 1;
  
  // Variables used throughout the rotation
  maelstromCap = 100;
  
  /**
   * Settings for the behavior
   */
  static settings = [
    {
      header: "Elemental Shaman Configuration",
      options: [
        {
          uid: "UseAscendance",
          name: "Use Ascendance",
          type: "checkbox",
          default: true
        },
        {
          uid: "UseElementals",
          name: "Use Fire/Storm Elemental",
          type: "checkbox",
          default: true
        },
        {
          uid: "UseStormkeeper",
          name: "Use Stormkeeper",
          type: "checkbox",
          default: true
        },
        {
          uid: "UsePrimordialWave",
          name: "Use Primordial Wave",
          type: "checkbox",
          default: true
        },
        {
          uid: "AOEThreshold",
          name: "AOE Threshold",
          type: "slider",
          min: 2,
          max: 6,
          default: 2
        }
      ]
    }
  ];

  /**
   * Builds the behavior tree for this specialization
   * @returns {bt.Composite} The root node of the behavior tree
   */
  build() {
    return new bt.Selector(
      Common.waitForCastOrChannel(),
      Common.waitForNotMounted(),
      this.preCombat(),
      
      // Interrupt casts
      Spell.interrupt("Wind Shear", false),
      
      // Use defensive and utility abilities
      this.defensives(),
      
      // Enable more movement with Spiritwalker's Grace
      Spell.cast("Spiritwalker's Grace", () => me.isMoving() && combat.bestTarget && me.distanceTo(combat.bestTarget) > 6),
      
      // Main rotation selector
      new bt.Selector(
        new bt.Decorator(
          () => this.getEnemyCount() >= Settings.AOEThreshold,
          this.aoeRotation()
        ),
        this.singleTargetRotation()
      ),
      
      // Movement fillers
      new bt.Decorator(
        () => me.isMoving(),
        this.movementFillers()
      )
    );
  }


/**
   * Precombat actions
   */
preCombat() {
    return new bt.Selector(
      // Ensure Lightning Shield is up
      Spell.cast("Lightning Shield", () => !me.hasAura("Lightning Shield")),
      
      // Set up Flametongue Weapon if talented
      Spell.cast("Flametongue Weapon", () => !me.hasAura("Flametongue Weapon") && Spell.isSpellKnown("Improved Flametongue Weapon")),
      
      // Initialize Maelstrom cap based on talents
      new bt.Action(() => {
        this.maelstromCap = 100;
        
        // Add 50 if Swelling Maelstrom is talented
        if (Spell.isSpellKnown("Swelling Maelstrom")) {
          this.maelstromCap += 50;
        }
        
        // Add 25 if Primordial Capacity is talented
        if (Spell.isSpellKnown("Primordial Capacity")) {
          this.maelstromCap += 25;
        }
        
        return bt.Status.Success;
      }),
      
      // Use Stormkeeper before combat
      Spell.cast("Stormkeeper", () => !me.inCombat() && Settings.UseStormkeeper)
    );
  }
  
  /**
   * Defensive cooldowns and racials
   */
  defensives() {
    return new bt.Selector(
      // Blood Fury (Orc)
      Spell.cast("Blood Fury", () => {
        return !Spell.isSpellKnown("Ascendance") || 
               me.hasAura("Ascendance") || 
               Spell.getCooldown("Ascendance").timeleft > 50000;
      }),
      
      // Berserking (Troll)
      Spell.cast("Berserking", () => {
        return !Spell.isSpellKnown("Ascendance") || me.hasAura("Ascendance");
      }),
      
      // Fireblood (Dark Iron Dwarf)
      Spell.cast("Fireblood", () => {
        return !Spell.isSpellKnown("Ascendance") || 
               me.hasAura("Ascendance") || 
               Spell.getCooldown("Ascendance").timeleft > 50000;
      }),
      
      // Ancestral Call (Mag'har Orc)
      Spell.cast("Ancestral Call", () => {
        return !Spell.isSpellKnown("Ascendance") || 
               me.hasAura("Ascendance") || 
               Spell.getCooldown("Ascendance").timeleft > 50000;
      }),
      
      // Nature's Swiftness
      Spell.cast("Nature's Swiftness")
    );
  }
  
  /**
   * Movement utility methods
   */
  movementFillers() {
    return new bt.Selector(
      // AOE movement fillers
      new bt.Decorator(
        () => this.getEnemyCount() >= Settings.AOEThreshold,
        new bt.Selector(
          Spell.cast("Flame Shock", () => this.getRefreshableFlameShockTarget() !== null),
          Spell.cast("Frost Shock")
        )
      ),
      
      // Single target movement fillers
      new bt.Selector(
        Spell.cast("Flame Shock", () => {
          const target = me.targetUnit;
          if (!target) return false;
          
          const flameShock = target.getAura("Flame Shock");
          return flameShock && flameShock.remaining < 4000;
        }),
        Spell.cast("Flame Shock", () => me.distanceTo(me.targetUnit) > 6),
        Spell.cast("Frost Shock")
      )
    );
  }
  
  /**
   * Utility method to count enemies with Flame Shock
   */
  countFlameShockTargets() {
    let count = 0;
    combat.targets.forEach(unit => {
      if (unit && unit.hasAura("Flame Shock")) {
        count++;
      }
    });
    return count;
  }
  
  /**
   * Find a target that needs Flame Shock refreshed
   */
  getRefreshableFlameShockTarget() {
    for (const unit of combat.targets) {
      if (!unit) continue;
      
      const flameShock = unit.getAura("Flame Shock");
      if (!flameShock || flameShock.remaining < 4000) {
        return unit;
      }
    }
    return null;
  }
  
  /**
   * Get the number of enemies for AOE decisions
   */
  getEnemyCount() {
    return combat.targets.length;
  }
  
  /**
   * Check if using Farseer hero talent build
   */
  isFarseerBuild() {
    // Check for Call of the Ancestors talent which identifies Farseer build
    return me.hasAura("Call of the Ancestors") || Spell.isSpellKnown("Call of the Ancestors");
  }

  /**
   * AOE rotation for 2+ targets
   */
  aoeRotation() {
    return new bt.Selector(
      // Summon elementals
      this.summonElementals(),
      
      // Use Stormkeeper
      Spell.cast("Stormkeeper", () => Settings.UseStormkeeper),
      
      // Liquid Magma Totem - spread Flame Shocks for Pwave
      Spell.cast("Liquid Magma Totem", () => {
        if (!Spell.isSpellKnown("Liquid Magma Totem")) return false;
        
        const primordialWaveCD = Spell.getCooldown("Primordial Wave").timeleft;
        const ascendanceCD = Spell.getCooldown("Ascendance").timeleft;
        const activeFlameShocks = this.countFlameShockTargets();
        const activeEnemies = this.getEnemyCount();
        
        return (primordialWaveCD < 5000 || !Spell.isSpellKnown("Primordial Wave")) && 
               (activeFlameShocks <= activeEnemies - 3 || 
                activeFlameShocks < Math.min(3, activeEnemies)) && 
               ascendanceCD > 10000;
      }),
      
      // Apply Flame Shock for Primordial Wave
      Spell.cast("Flame Shock", () => {
        const target = this.getLightningRodTarget(); 
        if (!target) return false;
        
        const primordialWaveCD = Spell.getCooldown("Primordial Wave").timeleft;
        const ascendanceCD = Spell.getCooldown("Ascendance").timeleft;
        
        return primordialWaveCD < 1000 && 
               !target.hasAura("Flame Shock") && 
               (Spell.isSpellKnown("Primordial Wave") || this.getEnemyCount() <= 3) && 
               ascendanceCD > 10000;
      }),
      
      // Use Primordial Wave
      Spell.cast("Primordial Wave", () => {
        if (!Settings.UsePrimordialWave) return false;
        
        const lmtCD = Spell.getCooldown("Liquid Magma Totem").timeleft;
        const activeFlameShocks = this.countFlameShockTargets();
        const maxTargets = Math.min(6, this.getEnemyCount());
        
        return activeFlameShocks >= maxTargets || 
               lmtCD > 15000 || 
               !Spell.isSpellKnown("Liquid Magma Totem");
      }),
      
      // Use Ancestral Swiftness
      Spell.cast("Ancestral Swiftness"),
      
      // Use Ascendance
      Spell.cast("Ascendance", () => {
        if (!Settings.UseAscendance) return false;
        
        const hasFirstAscendant = Spell.isSpellKnown("First Ascendant");
        const fightRemains = combat.getAverageTimeToDeath();
        const hasSpymastersWeb = me.hasAura("Spymasters Web");
        const hasFuryOfStorms = me.hasAura("Fury of Storms");
        const hasTalentFuryOfStorms = Spell.isSpellKnown("Fury of the Storms");
        
        // First condition from APL
        const condition1 = hasFirstAscendant || 
                          fightRemains > 200 || 
                          fightRemains < 90 || 
                          hasSpymastersWeb;
                          
        // Second condition from APL
        const condition2 = hasFuryOfStorms || !hasTalentFuryOfStorms;
        
        return condition1 && condition2;
      }),
      
      // Use Tempest with Surge of Power
      Spell.cast("Tempest", () => {
        const target = this.getLightningRodTarget();
        if (!target) return false;
        
        // Check Arc Discharge stacks
        const arcDischarge = me.getAura("Arc Discharge");
        const arcDischargeStacks = arcDischarge ? arcDischarge.stacks : 0;
        
        return arcDischargeStacks < 2 && 
               (me.hasAura("Surge of Power") || !Spell.isSpellKnown("Surge of Power"));
      }),
      
      // Lightning Bolt with Stormkeeper and Surge of Power for 2 targets
      Spell.cast("Lightning Bolt", () => {
        return me.hasAura("Stormkeeper") && 
               me.hasAura("Surge of Power") && 
               this.getEnemyCount() === 2;
      }),
      
      // Chain Lightning for 6+ targets with Surge of Power
      Spell.cast("Chain Lightning", () => {
        return this.getEnemyCount() >= 6 && me.hasAura("Surge of Power");
      }),
      
      // Chain Lightning with Storm Frenzy
      Spell.cast("Chain Lightning", () => {
        const stormFrenzy = me.getAura("Storm Frenzy");
        const stormFrenzyStacks = stormFrenzy ? stormFrenzy.stacks : 0;
        
        return stormFrenzyStacks === 2 && 
               !Spell.isSpellKnown("Surge of Power") && 
               me.powerByType(PowerType.Maelstrom) < this.maelstromCap - 
                  (15 + (me.hasAura("Stormkeeper") ? 1 : 0) * 
                   this.getEnemyCount() * this.getEnemyCount());
      }),
      
      // Use Lava Burst with Lava Surge and Fusion of Elements Fire
      Spell.cast("Lava Burst", () => {
        const target = combat.bestTarget;
        if (!target || !target.hasAura("Flame Shock")) return false;
        
        return Spell.getCharges("Lava Burst") > 0 && 
               me.hasAura("Lava Surge") && 
               me.hasAura("Fusion of Elements Fire") && 
               !me.hasAura("Master of the Elements") && 
               (me.powerByType(PowerType.Maelstrom) > 52 - 5 * (Spell.isSpellKnown("Eye of the Storm") ? 1 : 0) && 
               (me.hasAura("Echoes of Great Sundering ES") || !Spell.isSpellKnown("Echoes of Great Sundering")));
      }),
      
      // Spend Maelstrom when close to cap, with MotE, or Ascendance about to expire
      this.aoeSpender(),
      
      // Use Icefury for Fusion of Elements
      Spell.cast("Icefury", () => {
        return Spell.isSpellKnown("Fusion of Elements") && 
               !me.hasAura("Fusion of Elements Nature") && 
               !me.hasAura("Fusion of Elements Fire") && 
               (this.getEnemyCount() <= 4 || 
                !Spell.isSpellKnown("Elemental Blast") || 
                !Spell.isSpellKnown("Echoes of Great Sundering"));
      }),
      
      // Use Lava Burst with MotE on 2-3 targets
      Spell.cast("Lava Burst", () => {
        const target = combat.bestTarget;
        if (!target || !target.hasAura("Flame Shock")) return false;
        
        return this.getEnemyCount() <= 3 && 
               Spell.getCharges("Lava Burst") > 0 && 
               me.hasAura("Lava Surge") && 
               !me.hasAura("Master of the Elements") && 
               Spell.isSpellKnown("Master of the Elements");
      }),
      
      // Lava Burst usage for Farseer build on 2-3 targets
      Spell.cast("Lava Burst", () => {
        const target = combat.bestTarget;
        if (!target || !target.hasAura("Flame Shock") || target.getAura("Flame Shock").remaining <= 2000) return false;
        
        return !me.hasAura("Master of the Elements") && 
               Spell.isSpellKnown("Master of the Elements") && 
               (me.hasAura("Stormkeeper") || 
                me.hasAura("Tempest") || 
                me.powerByType(PowerType.Maelstrom) > 82 - 10 * (Spell.isSpellKnown("Eye of the Storm") ? 1 : 0) || 
                (me.powerByType(PowerType.Maelstrom) > 52 - 5 * (Spell.isSpellKnown("Eye of the Storm") ? 1 : 0) && 
                 (me.hasAura("Echoes of Great Sundering EB") || !Spell.isSpellKnown("Elemental Blast")))) && 
               this.getEnemyCount() <= 3 && 
               !Spell.isSpellKnown("Lightning Rod") && 
               this.isFarseerBuild();
      }),
      
      // Use Flame Shock with Fusion of Elements Fire
      Spell.cast("Flame Shock", () => {
        const target = this.getLightningRodTarget();
        if (!target) return false;
        
        return this.countFlameShockTargets() === 0 && 
               me.hasAura("Fusion of Elements Fire") && 
               (!Spell.isSpellKnown("Elemental Blast") || 
                (!Spell.isSpellKnown("Echoes of Great Sundering") && 
                 this.getEnemyCount() > 1 + (Spell.isSpellKnown("Tempest") ? 1 : 0)));
      }),
      
      // Frost Shock with Icefury
      Spell.cast("Frost Shock", () => {
        return me.hasAura("Icefury") && 
               !me.hasAura("Ascendance") && 
               !me.hasAura("Stormkeeper") && 
               this.isFarseerBuild();
      }),
      
      // Default filler
      Spell.cast("Chain Lightning")
    );
  }
  
  /**
   * Helper method to get target with min Lightning Rod duration
   */
  getLightningRodTarget() {
    let minTarget = null;
    let minRemaining = Infinity;
    
    for (const unit of combat.targets) {
      if (!unit) continue;
      
      const lightningRod = unit.getAura("Lightning Rod");
      const remaining = lightningRod ? lightningRod.remaining : 0;
      
      if (remaining < minRemaining) {
        minRemaining = remaining;
        minTarget = unit;
      }
    }
    
    return minTarget;
  }
  
  /**
   * Maelstrom spender for AOE rotation
   */
  aoeSpender() {
    return new bt.Selector(
      // Earthquake with high Maelstrom, MotE, or Ascendance about to expire
      Spell.cast("Earthquake", () => {
        // Check for prerequisites
        const hasEGS_ES = me.hasAura("Echoes of Great Sundering ES");
        const hasEGS_EB = me.hasAura("Echoes of Great Sundering EB");
        const noEGS = !Spell.isSpellKnown("Echoes of Great Sundering");
        const activeEnemies = this.getEnemyCount();
        const hasTempest = Spell.isSpellKnown("Tempest");
        const fightRemains = combat.getAverageTimeToDeath();
        
        // Check conditions
        const highMaelstrom = me.powerByType(PowerType.Maelstrom) > 
                             this.maelstromCap - 10 * (activeEnemies + 1);
        const hasMotE = me.hasAura("Master of the Elements");
        const ascendanceExpiring = me.hasAura("Ascendance") && 
                                  me.getAura("Ascendance").remaining < 3000;
        const shortFight = fightRemains < 5;
        
        // Check EGS conditions
        const egsCondition = hasEGS_ES || hasEGS_EB || 
                            (noEGS && (!Spell.isSpellKnown("Elemental Blast") || 
                                      activeEnemies > 1 + (hasTempest ? 1 : 0)));
        
        return (highMaelstrom || hasMotE || ascendanceExpiring || shortFight) && egsCondition;
      }),
      
      // Elemental Blast alternative spender
      Spell.cast("Elemental Blast", () => {
        const target = this.getLightningRodTarget();
        if (!target) return false;
        
        // Check for prerequisites
        const activeEnemies = this.getEnemyCount();
        const hasTempest = Spell.isSpellKnown("Tempest");
        const hasEGS = Spell.isSpellKnown("Echoes of Great Sundering");
        const hasEGS_EB = me.hasAura("Echoes of Great Sundering EB");
        const fightRemains = combat.getAverageTimeToDeath();
        
        // Check conditions
        const highMaelstrom = me.powerByType(PowerType.Maelstrom) > 
                             this.maelstromCap - 10 * (activeEnemies + 1);
        const hasMotE = me.hasAura("Master of the Elements");
        const ascendanceExpiring = me.hasAura("Ascendance") && 
                                  me.getAura("Ascendance").remaining < 3000;
        const shortFight = fightRemains < 5;
        
        // Check EGS conditions for EB
        const egsCondition = (activeEnemies <= 1 + (hasTempest ? 1 : 0) || 
                             (hasEGS && !hasEGS_EB));
        
        return (highMaelstrom || hasMotE || ascendanceExpiring || shortFight) && egsCondition;
      }),
      
      // Earth Shock alternative spender
      Spell.cast("Earth Shock", () => {
        const target = this.getLightningRodTarget();
        if (!target) return false;
        
        // Check for prerequisites
        const activeEnemies = this.getEnemyCount();
        const hasEGS = Spell.isSpellKnown("Echoes of Great Sundering");
        const hasEGS_ES = me.hasAura("Echoes of Great Sundering ES");
        const fightRemains = combat.getAverageTimeToDeath();
        
        // Check conditions
        const highMaelstrom = me.powerByType(PowerType.Maelstrom) > 
                             this.maelstromCap - 10 * (activeEnemies + 1);
        const hasMotE = me.hasAura("Master of the Elements");
        const ascendanceExpiring = me.hasAura("Ascendance") && 
                                  me.getAura("Ascendance").remaining < 3000;
        const shortFight = fightRemains < 5;
        
        return (highMaelstrom || hasMotE || ascendanceExpiring || shortFight) && 
               hasEGS && !hasEGS_ES;
      })
    );
  }
  
  /**
   * Summon elementals
   */
  summonElementals() {
    return new bt.Selector(
      // Fire Elemental
      Spell.cast("Fire Elemental", () => Settings.UseElementals),
      
      // Storm Elemental
      Spell.cast("Storm Elemental", () => {
        return Settings.UseElementals && 
               (!me.hasAura("Storm Elemental") || !Spell.isSpellKnown("Echo of the Elementals"));
      })
    );
  }

  /**
   * Single target rotation
   */
  singleTargetRotation() {
    return new bt.Selector(
      // Summon elementals
      this.summonElementals(),
      
      // Use Stormkeeper
      Spell.cast("Stormkeeper", () => {
        if (!Settings.UseStormkeeper) return false;
        
        return !Spell.isSpellKnown("Fury of the Storms") || 
               Spell.getCooldown("Primordial Wave").timeleft < 1000 || 
               !Spell.isSpellKnown("Primordial Wave");
      }),
      
      // Apply Flame Shock if not up
      Spell.cast("Liquid Magma Totem", () => {
        const target = me.targetUnit;
        if (!target) return false;
        
        return !target.hasAura("Flame Shock") && 
               !me.hasAura("Surge of Power") && 
               !me.hasAura("Master of the Elements");
      }),
      
      Spell.cast("Flame Shock", () => {
        const target = me.targetUnit;
        if (!target) return false;
        
        return !target.hasAura("Flame Shock") && 
               !me.hasAura("Surge of Power") && 
               !me.hasAura("Master of the Elements");
      }),
      
      // Use Primordial Wave
      Spell.cast("Primordial Wave", () => Settings.UsePrimordialWave),
      
      // Use Ancestral Swiftness
      Spell.cast("Ancestral Swiftness"),
      
      // Use Ascendance
      Spell.cast("Ascendance", () => {
        if (!Settings.UseAscendance) return false;
        
        const hasFirstAscendant = Spell.isSpellKnown("First Ascendant");
        const fightRemains = combat.getAverageTimeToDeath();
        const hasSpymastersWeb = me.hasAura("Spymasters Web");
        const hasFuryOfStorms = me.hasAura("Fury of Storms");
        const hasTalentFuryOfStorms = Spell.isSpellKnown("Fury of the Storms");
        const primordialWaveCD = Spell.getCooldown("Primordial Wave").timeleft;
        
        // First condition from APL
        const condition1 = hasFirstAscendant || 
                           fightRemains > 200 || 
                           fightRemains < 80 || 
                           hasSpymastersWeb;
                          
        // Second condition from APL
        const condition2 = hasFuryOfStorms || !hasTalentFuryOfStorms;
        
        // Third condition from APL
        const condition3 = primordialWaveCD > 25000 || !Spell.isSpellKnown("Primordial Wave");
        
        return condition1 && condition2 && condition3;
      }),
      
      // Use Tempest with Surge of Power
      Spell.cast("Tempest", () => me.hasAura("Surge of Power")),
      
      // Use Lightning Bolt with Surge of Power
      Spell.cast("Lightning Bolt", () => me.hasAura("Surge of Power")),
      
      // Use Tempest with Storm Frenzy
      Spell.cast("Tempest", () => {
        const stormFrenzy = me.getAura("Storm Frenzy");
        const stormFrenzyStacks = stormFrenzy ? stormFrenzy.stacks : 0;
        
        return stormFrenzyStacks === 2 && !Spell.isSpellKnown("Surge of Power");
      }),
      
      // Maintain Flame Shock with Erupting Lava
      Spell.cast("Liquid Magma Totem", () => {
        const target = me.targetUnit;
        if (!target) return false;
        
        const flameShock = target.getAura("Flame Shock");
        
        return flameShock && flameShock.remaining < 4000 && 
               !me.hasAura("Master of the Elements") && 
               Spell.isSpellKnown("Erupting Lava");
      }),
      
      Spell.cast("Flame Shock", () => {
        const target = me.targetUnit;
        if (!target) return false;
        
        const flameShock = target.getAura("Flame Shock");
        
        return flameShock && flameShock.remaining < 4000 && 
               !me.hasAura("Surge of Power") && 
               !me.hasAura("Master of the Elements") && 
               Spell.isSpellKnown("Erupting Lava");
      }),
      
      // Maelstrom spenders
      this.singleTargetSpender(),
      
      // Use Icefury
      Spell.cast("Icefury", () => {
        return !me.hasAura("Fusion of Elements Nature") && 
               !me.hasAura("Fusion of Elements Fire");
      }),
      
      // Use Lava Burst for Master of the Elements
      Spell.cast("Lava Burst", () => {
        const target = me.targetUnit;
        if (!target || !target.hasAura("Flame Shock") || target.getAura("Flame Shock").remaining < 2000) {
          return false;
        }
        
        const hasMoTE = Spell.isSpellKnown("Master of the Elements");
        const hasLavaSurge = me.hasAura("Lava Surge");
        const hasTempest = me.hasAura("Tempest");
        const hasStormkeeper = me.hasAura("Stormkeeper");
        const lavaBurstCharges = Spell.getCharges("Lava Burst");
        const highMaelstrom = me.powerByType(PowerType.Maelstrom) > 82 - 10 * (Spell.isSpellKnown("Eye of the Storm") ? 1 : 0);
        const mediumMaelstrom = me.powerByType(PowerType.Maelstrom) > 52 - 5 * (Spell.isSpellKnown("Eye of the Storm") ? 1 : 0);
        const hasEGS_EB = me.hasAura("Echoes of Great Sundering EB");
        const hasEB = Spell.isSpellKnown("Elemental Blast");
        
        return !me.hasAura("Master of the Elements") && 
               (!hasMoTE || 
                hasLavaSurge || 
                hasTempest || 
                hasStormkeeper || 
                lavaBurstCharges > 1.8 || 
                highMaelstrom || 
                (mediumMaelstrom && (hasEGS_EB || !hasEB)));
      }),
      
      // Use Frost Shock with Icefury
      Spell.cast("Frost Shock", () => {
        return me.hasAura("IcefuryDmg") && 
               !me.hasAura("Ascendance") && 
               !me.hasAura("Stormkeeper") && 
               this.isFarseerBuild();
      }),
      
      // Lightning Bolt for Storm Elemental
      Spell.cast("Lightning Bolt", () => {
        const stormElemental = me.hasAura("Storm Elemental");
        const windGust = me.getAura("Wind Gust");
        const windGustStacks = windGust ? windGust.stacks : 0;
        
        return stormElemental && windGustStacks < 4;
      }),
      
      // Default filler
      Spell.cast("Lightning Bolt")
    );
  }
  
  /**
   * Maelstrom spender for single target rotation
   */
  singleTargetSpender() {
    return new bt.Selector(
      // Earthquake with Echoes of Great Sundering
      Spell.cast("Earthquake", () => {
        // Check if we have either of the EGS buffs
        const hasEGS_ES = me.hasAura("Echoes of Great Sundering ES");
        const hasEGS_EB = me.hasAura("Echoes of Great Sundering EB");
        
        // Check Maelstrom and MotE
        const highMaelstrom = me.powerByType(PowerType.Maelstrom) > this.maelstromCap - 15;
        const hasMotE = me.hasAura("Master of the Elements");
        
        return (hasEGS_ES || hasEGS_EB) && (highMaelstrom || hasMotE);
      }),
      
      // Elemental Blast
      Spell.cast("Elemental Blast", () => {
        const highMaelstrom = me.powerByType(PowerType.Maelstrom) > this.maelstromCap - 15;
        const hasMotE = me.hasAura("Master of the Elements");
        
        return highMaelstrom || hasMotE;
      }),
      
      // Earth Shock
      Spell.cast("Earth Shock", () => {
        const highMaelstrom = me.powerByType(PowerType.Maelstrom) > this.maelstromCap - 15;
        const hasMotE = me.hasAura("Master of the Elements");
        
        return highMaelstrom || hasMotE;
      }),
      
      // Earthquake for Tempest/Stormkeeper with Surge of Power
      Spell.cast("Earthquake", () => {
        // Check if we have either of the EGS buffs
        const hasEGS_ES = me.hasAura("Echoes of Great Sundering ES");
        const hasEGS_EB = me.hasAura("Echoes of Great Sundering EB");
        
        // Check our other conditions
        const hasTempest = me.hasAura("Tempest");
        const hasStormkeeper = me.hasAura("Stormkeeper");
        const hasSoP = Spell.isSpellKnown("Surge of Power");
        const noMotE = !Spell.isSpellKnown("Master of the Elements");
        
        return (hasEGS_ES || hasEGS_EB) && 
               (hasTempest || hasStormkeeper) && 
               hasSoP && noMotE;
      }),
      
      // Elemental Blast for Tempest/Stormkeeper with Surge of Power
      Spell.cast("Elemental Blast", () => {
        // Check our conditions
        const hasTempest = me.hasAura("Tempest");
        const hasStormkeeper = me.hasAura("Stormkeeper");
        const hasSoP = Spell.isSpellKnown("Surge of Power");
        const noMotE = !Spell.isSpellKnown("Master of the Elements");
        
        return (hasTempest || hasStormkeeper) && hasSoP && noMotE;
      }),
      
      // Earth Shock for Tempest/Stormkeeper with Surge of Power
      Spell.cast("Earth Shock", () => {
        // Check our conditions
        const hasTempest = me.hasAura("Tempest");
        const hasStormkeeper = me.hasAura("Stormkeeper");
        const hasSoP = Spell.isSpellKnown("Surge of Power");
        const noMotE = !Spell.isSpellKnown("Master of the Elements");
        
        return (hasTempest || hasStormkeeper) && hasSoP && noMotE;
      }),
      
      // Use Tempest
      Spell.cast("Tempest")
    );
  }
}