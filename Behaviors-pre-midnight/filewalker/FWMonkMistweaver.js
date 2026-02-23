import { me } from "@/Core/ObjectManager";
import * as bt from '@/Core/BehaviorTree';
import Spell from "@/Core/Spell";
import { defaultHealTargeting as heal } from '@/Targeting/HealTargeting';
import { defaultCombatTargeting as combat } from '@/Targeting/CombatTargeting';
import Common from "@/Core/Common";
import Settings from "@/Core/Settings";
import Pet from "@/Core/Pet";
import { PowerType } from "@/Enums/PowerType";
import { Behavior, BehaviorContext } from "@/Core/Behavior";
import Specialization from '@/Enums/Specialization';

/**
 * Behavior implementation for Monk Mistweaver
 * SIMC-based healing priority for Mistweaver Monks
 */
export class MonkMistweaverBehavior extends Behavior {
  // Define context, specialization, name, and version
  context = BehaviorContext.Any;
  specialization = Specialization.Monk.Mistweaver;
  name = "FW Mistweaver Monk";
  version = 1.0;
  
  // Define Hero Talent builds based on key talents
  static TALENT_BUILDS = {
    MASTER_OF_HARMONY: 'master_of_harmony',
    CONDUIT_OF_CELESTIALS: 'conduit_of_celestials',
  };
  
  static settings = [
    {
      header: "Mistweaver Configuration",
      options: [
        {
          uid: "CooldownThreshold",
          text: "Cooldown Health Threshold",
          type: "slider",
          min: 0,
          max: 100,
          default: 60,
        },
        {
          uid: "EmergencyThreshold",
          text: "Emergency Health Threshold",
          type: "slider",
          min: 0,
          max: 100,
          default: 35,
        },
        {
          uid: "UseChiji",
          text: "Use Invoke Chi-Ji, the Red Crane",
          type: "checkbox",
          default: true,
        },
        {
          uid: "UseYulon",
          text: "Use Invoke Yu'lon, the Jade Serpent",
          type: "checkbox",
          default: true,
        },
        {
          uid: "UseRevival",
          text: "Use Revival",
          type: "checkbox",
          default: true,
        },
        {
          uid: "UseThunderFocusTea",
          text: "Use Thunder Focus Tea",
          type: "checkbox",
          default: true,
        },
        {
          uid: "UseCelestialConduit",
          text: "Use Celestial Conduit",
          type: "checkbox",
          default: true,
        },
        {
          uid: "UseMistweaverDPS",
          text: "Include DPS abilities",
          type: "checkbox",
          default: true,
        },
      ]
    }
  ];

  detectHeroTalent() {
    if (me.hasAura(450508)) { // Aspect of Harmony aura ID
      return MonkMistweaverBehavior.TALENT_BUILDS.MASTER_OF_HARMONY;
    } 
    else if (me.hasAura(443028)) { // Celestial Conduit aura ID
      return MonkMistweaverBehavior.TALENT_BUILDS.CONDUIT_OF_CELESTIALS;
    }
    
    // Default to detecting based on spell knowledge
    if (Spell.isSpellKnown("Aspect of Harmony")) {
      return MonkMistweaverBehavior.TALENT_BUILDS.MASTER_OF_HARMONY;
    }
    else if (Spell.isSpellKnown("Celestial Conduit")) {
      return MonkMistweaverBehavior.TALENT_BUILDS.CONDUIT_OF_CELESTIALS;
    }
    
    // Default to Master of Harmony if can't detect
    return MonkMistweaverBehavior.TALENT_BUILDS.MASTER_OF_HARMONY;
  }

  build() {
    return new bt.Selector(
    //   Common.waitForCastOrChannel(),
      Common.waitForNotMounted(),
      new bt.Action(() => {
        // Get the priorities
        this.lowestHealthAlly = this.getLowestHealthAlly();
        this.lowestHealthTank = this.getLowestHealthTank();
        this.lowestHealthDps = this.getLowestHealthDps();
        this.emergencyTarget = this.getEmergencyTarget();
        
        return bt.Status.Failure;
      }),
      this.handleEmergencyHealing(),
      this.useCooldowns(),
      this.mainHealing(),
      this.dpsRotation()
    );
  }
  
  /**
   * Gets the lowest health ally
   * @returns {CGUnit|null} The ally with lowest health or null if none
   */
  getLowestHealthAlly() {
    return heal.getPriorityTarget();
  }
  
  /**
   * Gets the lowest health tank
   * @returns {CGUnit|null} The tank with lowest health or null if none
   */
  getLowestHealthTank() {
    if (heal.friends.Tanks.length === 0) return null;
    
    return heal.friends.Tanks.reduce((lowest, current) => 
      current.effectiveHealthPercent < lowest.effectiveHealthPercent ? current : lowest
    );
  }
  
  /**
   * Gets the lowest health DPS
   * @returns {CGUnit|null} The DPS with lowest health or null if none
   */
  getLowestHealthDps() {
    if (heal.friends.DPS.length === 0) return null;
    
    return heal.friends.DPS.reduce((lowest, current) => 
      current.effectiveHealthPercent < lowest.effectiveHealthPercent ? current : lowest
    );
  }
  
  /**
   * Gets a target in emergency health range (below emergency threshold)
   * @returns {CGUnit|null} The target in emergency health or null if none
   */
  getEmergencyTarget() {
    const threshold = Settings.EmergencyThreshold || 35;
    
    const emergencyUnits = heal.priorityList.filter(unit => 
      unit.effectiveHealthPercent < threshold
    );
    
    if (emergencyUnits.length === 0) return null;
    
    return emergencyUnits.sort((a, b) => 
      a.effectiveHealthPercent - b.effectiveHealthPercent
    )[0];
  }
  
  /**
   * Checks if the player has enough mana to cast
   * @param {number} threshold - The percentage threshold to check against
   * @returns {boolean} True if mana is above threshold, false otherwise
   */
  hasSufficientMana(threshold) {
    return me.powerByType(PowerType.Mana) / me.maxPowerByType(PowerType.Mana) * 100 > threshold;
  }
  
  /**
   * Checks if Revival or other major cooldowns should be used
   * @returns {boolean} True if cooldowns should be used
   */
  shouldUseCooldowns() {
    // Count how many allies are below the cooldown threshold
    const threshold = Settings.CooldownThreshold || 60;
    const alliesInNeed = heal.priorityList.filter(unit => 
      unit.effectiveHealthPercent < threshold
    ).length;
    
    // More than 3 allies below threshold
    return alliesInNeed >= 3;
  }
  
  /**
   * Checks if a specific ally should get Life Cocoon
   * @param {CGUnit} ally - The ally to check
   * @returns {boolean} True if the ally should get Life Cocoon
   */
  shouldUseLifeCocoon(ally) {
    if (!ally) return false;
    
    return ally.effectiveHealthPercent < 40 && 
           (ally.inCombat() || me.inCombat());
  }

  /**
   * Handles emergency healing situations
   * @returns {bt.Selector} The emergency healing selector
   */
  handleEmergencyHealing() {
    return new bt.Selector(
      // Life Cocoon for emergency target
      Spell.cast("Life Cocoon", () => {
        if (!this.emergencyTarget) return false;
        if (this.emergencyTarget.hasAura(116849)) return false; // Already has Life Cocoon
        return this.shouldUseLifeCocoon(this.emergencyTarget);
      }),
      
      // Thunder Focus Tea for emergency healing
      Spell.cast("Thunder Focus Tea", () => {
        if (!Settings.UseThunderFocusTea) return false;
        if (!this.emergencyTarget) return false;
        if (me.hasAura(116680)) return false; // Already have Thunder Focus Tea
        return this.emergencyTarget.effectiveHealthPercent < 45;
      }),
      
      // Vivify with Thunder Focus Tea for emergency
      Spell.cast("Vivify", () => {
        if (!this.emergencyTarget) return false;
        if (!me.hasAura(116680)) return false; // Thunder Focus Tea
        return this.emergencyTarget.effectiveHealthPercent < 40;
      }),
      
      // Enveloping Mist with Thunder Focus Tea for emergency
      Spell.cast("Enveloping Mist", () => {
        if (!this.emergencyTarget) return false;
        if (!me.hasAura(116680)) return false; // Thunder Focus Tea
        if (this.emergencyTarget.hasAura(124682)) return false; // Already has Enveloping Mist
        return this.emergencyTarget.effectiveHealthPercent < 40;
      }),
      
      // Revival for multiple emergency targets
      Spell.cast("Revival", () => {
        if (!Settings.UseRevival) return false;
        const emergencyCount = heal.priorityList.filter(unit => 
          unit.effectiveHealthPercent < Settings.EmergencyThreshold
        ).length;
        return emergencyCount >= 3;
      }),
      
      // Invoke Chi-Ji for emergency healing
      Spell.cast("Invoke Chi-Ji, the Red Crane", () => {
        if (!Settings.UseChiji) return false;
        const emergencyCount = heal.priorityList.filter(unit => 
          unit.effectiveHealthPercent < Settings.EmergencyThreshold
        ).length;
        return emergencyCount >= 2;
      }),
      
      // Invoke Yu'lon for emergency healing
      Spell.cast("Invoke Yu'lon, the Jade Serpent", () => {
        if (!Settings.UseYulon) return false;
        const emergencyCount = heal.priorityList.filter(unit => 
          unit.effectiveHealthPercent < Settings.EmergencyThreshold
        ).length;
        return emergencyCount >= 2;
      })
    );
  }
  
  /**
   * Handles cooldown usage
   * @returns {bt.Selector} The cooldown selector
   */
  useCooldowns() {
    return new bt.Selector(
      // Celestial Conduit (if talented)
      Spell.cast("Celestial Conduit", () => {
        if (!Settings.UseCelestialConduit) return false;
        if (!Spell.isSpellKnown("Celestial Conduit")) return false;
        return this.shouldUseCooldowns();
      }),
      
      // Yu'lon or Chi-Ji based on talent
      Spell.cast("Invoke Yu'lon, the Jade Serpent", () => {
        if (!Settings.UseYulon) return false;
        if (Pet.yulon && Pet.yulon.up) return false;
        if (Spell.isSpellKnown("Invoke Chi-Ji, the Red Crane")) return false;
        return this.shouldUseCooldowns();
      }),
      
      Spell.cast("Invoke Chi-Ji, the Red Crane", () => {
        if (!Settings.UseChiji) return false;
        if (Pet.chiji && Pet.chiji.up) return false;
        return this.shouldUseCooldowns();
      }),
      
      // Revival when multiple allies are low
      Spell.cast("Revival", () => {
        if (!Settings.UseRevival) return false;
        return this.shouldUseCooldowns();
      }),
      
      // Life Cocoon on tank
      Spell.cast("Life Cocoon", () => {
        if (!this.lowestHealthTank) return false;
        if (this.lowestHealthTank.hasAura(116849)) return false; // Already has Life Cocoon
        return this.lowestHealthTank.effectiveHealthPercent < 50;
      }),
      
      // Mana Tea when low on mana
      Spell.cast("Mana Tea", () => {
        return me.hasAura(115867) && me.powerByType(PowerType.Mana) / me.maxPowerByType(PowerType.Mana) < 0.4;
      }),
      
      // Thunder Focus Tea when useful
      Spell.cast("Thunder Focus Tea", () => {
        if (!Settings.UseThunderFocusTea) return false;
        if (me.hasAura(116680)) return false; // Already have Thunder Focus Tea
        return true; // Will be used in the main rotation
      }),
      
      // Use Sheilun's Gift if talented and we have clouds
      Spell.cast("Sheilun's Gift", () => {
        if (!Spell.isSpellKnown("Sheilun's Gift")) return false;
        if (this.lowestHealthAlly && this.lowestHealthAlly.effectiveHealthPercent < 70) return true;
        return false;
      })
    );
  }
  
  /**
   * Main healing rotation
   * @returns {bt.Selector} The main healing selector
   */
  mainHealing() {
    return new bt.Selector(
      // Renewing Mist on cooldown
      Spell.cast("Renewing Mist", () => {
        return this.lowestHealthAlly && this.lowestHealthAlly.effectiveHealthPercent < 95;
      }),
      
      // Enveloping Mist for low health targets
      Spell.cast("Enveloping Mist", () => {
        if (!this.lowestHealthAlly) return false;
        if (this.lowestHealthAlly.hasAura(124682)) return false; // Already has Enveloping Mist
        return this.lowestHealthAlly.effectiveHealthPercent < 65;
      }),
      
      // Vivify for moderate healing
      Spell.cast("Vivify", () => {
        return this.lowestHealthAlly && this.lowestHealthAlly.effectiveHealthPercent < 85;
      }),
      
      // Refreshing Jade Wind for AoE healing
      Spell.cast("Refreshing Jade Wind", () => {
        // Count allies within range that need healing
        const alliesNeedingHealing = heal.priorityList.filter(unit => 
          unit.effectiveHealthPercent < 90 && me.distanceTo(unit) <= 10
        ).length;
        
        return alliesNeedingHealing >= 3;
      }),
      
      // Soothing Mist if nothing else to do
      Spell.cast("Soothing Mist", () => {
        if (me.hasAura(115175)) return false; // Already channeling
        return this.lowestHealthAlly && this.lowestHealthAlly.effectiveHealthPercent < 95;
      }),
      
      // Jadefire Stomp for AoE healing
      Spell.cast("Jadefire Stomp", () => {
        if (!Spell.isSpellKnown("Jadefire Stomp")) return false;
        
        // Count allies within range that need healing
        const alliesNeedingHealing = heal.priorityList.filter(unit => 
          unit.effectiveHealthPercent < 90 && me.distanceTo(unit) <= 30
        ).length;
        
        return alliesNeedingHealing >= 3;
      })
    );
  }

  /**
   * DPS rotation for when all allies are healthy
   * @returns {bt.Selector} The DPS selector
   */
  dpsRotation() {
    return new bt.Selector(
      // Only DPS if setting enabled
      new bt.Decorator(
        () => Settings.UseMistweaverDPS,
        new bt.Selector(
          // Rising Sun Kick if talented (or Rushing Wind Kick)
          Spell.cast("Rising Sun Kick", () => {
            if (!Spell.isSpellKnown("Rising Sun Kick") && !Spell.isSpellKnown("Rushing Wind Kick")) return false;
            return true;
          }),
          
          // Blackout Kick
          Spell.cast("Blackout Kick", () => {
            return me.hasAura(202090); // Teachings of the Monastery
          }),
          
          // Spinning Crane Kick for multiple enemies
          Spell.cast("Spinning Crane Kick", () => {
            return me.hasAura(438443) || combat.targets.length >= 3; // Dance of Chi-Ji or 3+ enemies
          }),
          
          // Tiger Palm to build Teachings of the Monastery
          Spell.cast("Tiger Palm", () => {
            return me.powerByType(PowerType.Mana) / me.maxPowerByType(PowerType.Mana) > 0.7;
          }),
          
          // Crackling Jade Lightning as filler
          Spell.cast("Crackling Jade Lightning", () => {
            return me.hasAura(467317) || me.powerByType(PowerType.Mana) / me.maxPowerByType(PowerType.Mana) > 0.9; // Jade Empowerment
          })
        ),
        new bt.Action(() => bt.Status.Failure)
      )
    );
  }
  
  /**
   * Determine which hero talent is active: Master of Harmony or Conduit of the Celestials
   * @returns {string} The active hero talent build
   */
  getActiveBuild() {
    return this.detectHeroTalent();
  }
}
