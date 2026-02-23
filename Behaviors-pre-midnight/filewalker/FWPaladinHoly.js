import * as bt from '@/Core/BehaviorTree';
import Common from '@/Core/Common';
import Spell from "@/Core/Spell";
import { me } from "@/Core/ObjectManager";
import { PowerType } from "@/Enums/PowerType";
import { defaultCombatTargeting as combat } from "@/Targeting/CombatTargeting";
import { defaultHealTargeting as heal } from '@/Targeting/HealTargeting';
import Settings from "@/Core/Settings";
import { Behavior, BehaviorContext } from "@/Core/Behavior";
import Specialization from "@/Enums/Specialization";

export class HolyPaladinBehavior extends Behavior {
  // Define context, specialization, name, and version
  context = BehaviorContext.Any;
  specialization = Specialization.Paladin.Holy;
  name = "FW Holy Paladin";
  version = 1;

  /**
   * Settings for the behavior
   * These will appear in the UI settings panel
   */
  static settings = [
    {
      header: "Holy Paladin Configuration",
      options: [
        {
          uid: "UseBeaconOfLight",
          text: "Use Beacon of Light",
          type: "checkbox",
          default: true
        },
        {
          uid: "LayOnHandsThreshold",
          text: "Lay on Hands HP Threshold",
          min: 5,
          max: 35,
          default: 25
        },
        {
          uid: "WordOfGloryThreshold",
          text: "Word of Glory HP Threshold",
          min: 45,
          max: 90,
          default: 65
        },
        {
          uid: "UseAvengingWrath",
          text: "Use Avenging Wrath",
          type: "checkbox",
          default: true
        },
        {
          uid: "UseDivineToll",
          text: "Use Divine Toll",
          type: "checkbox",
          default: true
        },
        {
          uid: "UseTyrsDeliverance",
          text: "Use Tyr's Deliverance",
          type: "checkbox",
          default: true
        },
        {
          uid: "UseHolyPrism",
          text: "Use Holy Prism",
          type: "checkbox",
          default: true
        }
      ]
    }
  ];

  /**
   * Detect active Hero Talent from the HeroTalents.txt reference
   */
  detectHeroTalent() {
    if (me.hasAura(431377)) {
      return "herald_of_the_sun"; // Dawnlight
    } else if (me.hasAura(432459)) {
      return "lightsmith"; // Holy Armaments
    }
    
    return "none";
  }

  /**
   * Check if the specific hero talent build is active
   * @returns {boolean} - True if the Herald of the Sun build is active
   */
  isHeraldOfTheSun() {
    return this.detectHeroTalent() === "herald_of_the_sun";
  }

  /**
   * Check if the specific hero talent build is active
   * @returns {boolean} - True if the Lightsmith build is active
   */
  isLightsmith() {
    return this.detectHeroTalent() === "lightsmith";
  }

  /**
   * Builds the behavior tree for Holy Paladin
   * This is the main entry point for the behavior
   * @returns {bt.Composite} The root node of the behavior tree
   */
  build() {
    return new bt.Selector(
      // Skip if casting or channeling
      Common.waitForCastOrChannel(),
      
      // Skip if mounted
      Common.waitForNotMounted(),
      
      // Main selector for choosing rotation
      new bt.Selector(
        // Combat section
        new bt.Decorator(
          () => me.inCombat(),
          this.combatRotation()
        ),
        
        // Out of combat section
        new bt.Decorator(
          () => !me.inCombat(),
          this.outOfCombatRotation()
        )
      )
    );
  }
  
  /**
   * Check if Word of Glory should be used based on health threshold
   * @returns {boolean} True if WoG should be used
   */
  shouldUseWordOfGlory() {
    const target = heal.getPriorityTarget();
    return target && target.health < target.maxHealth * (Settings.WordOfGloryThreshold / 100);
  }
  
  /**
   * Check if Lay on Hands should be used based on health threshold
   * @returns {boolean} True if LoH should be used
   */
  shouldUseLayOnHands() {
    const target = heal.getPriorityTarget();
    return target && target.health < target.maxHealth * (Settings.LayOnHandsThreshold / 100);
  }
  
  /**
   * Check if we have enough Holy Power for a spender
   * @returns {boolean} True if we have 3+ Holy Power
   */
  hasHolyPower() {
    return me.powerByType(PowerType.HolyPower) >= 3 || me.hasAura(223819); // Divine Purpose proc
  }
  
  /**
   * Get the priority healing target
   * @returns {CGUnit} The priority healing target
   */
  getPriorityTarget() {
    return heal.getPriorityTarget() || me;
  }

  /**
   * Combat rotation logic
   * @returns {bt.Composite} The combat rotation sequence
   */
  combatRotation() {
    return new bt.Selector(
      // Emergency defensive cooldowns
      this.emergencyCooldowns(),
      
      // Maintain Beacon of Light
      this.maintainBeacon(),
      
      // Major offensive and defensive cooldowns
      this.majorCooldowns(),
      
      // Holy Power spenders
      this.holyPowerSpenders(),
      
      // Holy Power builders
      this.holyPowerBuilders(),
      
      // Fillers
      this.fillerSpells()
    );
  }
  
  /**
   * Emergency and defensive cooldowns
   */
  emergencyCooldowns() {
    return new bt.Selector(
      // Lay on Hands for emergency healing
      Spell.cast("Lay on Hands", () => {
        const target = this.getPriorityTarget();
        return Settings.UseLayOnHands && 
               target && 
               target.health < target.maxHealth * (Settings.LayOnHandsThreshold / 100) &&
               !target.hasAura(25771); // Forbearance
      }),
      
      // Divine Shield for personal survival
      Spell.cast("Divine Shield", () => {
        return me.health < me.maxHealth * 0.25 && 
               !me.hasAura(25771) && // Forbearance
               !me.hasAura(642); // Already shielded
      }),
      
      // Blessing of Protection for allies
      Spell.cast("Blessing of Protection", () => {
        const target = this.getPriorityTarget();
        return target && 
               target !== me && 
               target.health < target.maxHealth * 0.4 && 
               !target.hasAura(25771); // Forbearance
      })
    );
  }
  
  /**
   * Maintain Beacon of Light
   */
  maintainBeacon() {
    return new bt.Selector(
      // Beacon of Light on tank
      Spell.cast("Beacon of Light", () => {
        if (!Settings.UseBeaconOfLight) return false;
        
        // Find tank without beacon
        const tanks = heal.friends.Tanks;
        for (const tank of tanks) {
          if (tank && !tank.hasAura(53563)) { // Beacon of Light
            me.targetUnit = tank;
            return true;
          }
        }
        return false;
      }),
      
      // Beacon of Faith if talented
      Spell.cast("Beacon of Faith", () => {
        if (!Settings.UseBeaconOfLight || !Spell.isSpellKnown("Beacon of Faith")) return false;
        
        // Find second tank without beacon
        const tanks = heal.friends.Tanks;
        let beaconCount = 0;
        let targetTank = null;
        
        for (const tank of tanks) {
          if (tank && tank.hasAura(53563)) { // Beacon of Light
            beaconCount++;
          } else if (tank && !tank.hasAura(156910)) { // Beacon of Faith
            targetTank = tank;
          }
        }
        
        if (targetTank && beaconCount >= 1) {
          me.targetUnit = targetTank;
          return true;
        }
        return false;
      })
    );
  }

  /**
   * Major cooldowns
   */
  majorCooldowns() {
    return new bt.Selector(
      // Avenging Wrath or Avenging Crusader when needed
      Spell.cast("Avenging Wrath", () => {
        return Settings.UseAvengingWrath && 
               me.inCombat() && 
               heal.friends.All.some(unit => unit.health < unit.maxHealth * 0.7) &&
               !me.hasAura(31884) && // Avenging Wrath
               !me.hasAura(216331); // Avenging Crusader
      }),
      
      // Avenging Crusader (if talented)
      Spell.cast("Avenging Crusader", () => {
        return Settings.UseAvengingWrath && 
               Spell.isSpellKnown("Avenging Crusader") &&
               me.inCombat() && 
               heal.friends.All.some(unit => unit.health < unit.maxHealth * 0.7) &&
               !me.hasAura(31884) && // Avenging Wrath
               !me.hasAura(216331); // Avenging Crusader
      }),
      
      // Divine Toll
      Spell.cast("Divine Toll", () => {
        return Settings.UseDivineToll && 
               me.inCombat() && 
               heal.friends.All.some(unit => unit.health < unit.maxHealth * 0.7);
      }),
      
      // Tyr's Deliverance
      Spell.cast("Tyr's Deliverance", () => {
        return Settings.UseTyrsDeliverance && 
               me.inCombat() && 
               heal.friends.All.filter(unit => unit.health < unit.maxHealth * 0.8).length >= 3;
      }),
      
      // Holy Prism
      Spell.cast("Holy Prism", () => {
        const target = this.getPriorityTarget();
        return Settings.UseHolyPrism && 
               target && 
               target.health < target.maxHealth * 0.8;
      }),
      
      // Barrier of Faith
      Spell.cast("Barrier of Faith", () => {
        const target = this.getPriorityTarget();
        return Spell.isSpellKnown("Barrier of Faith") && 
               target && 
               target.health < target.maxHealth * 0.7;
      })
    );
  }
  
  /**
   * Holy Power spenders
   */
  holyPowerSpenders() {
    return new bt.Selector(
      // Word of Glory for emergency healing
      Spell.cast("Word of Glory", () => {
        const target = this.getPriorityTarget();
        return this.hasHolyPower() && 
               target && 
               target.health < target.maxHealth * (Settings.WordOfGloryThreshold / 100);
      }),
      
      // Light of Dawn for AoE healing
      Spell.cast("Light of Dawn", () => {
        return this.hasHolyPower() && 
               heal.friends.All.filter(unit => unit.health < unit.maxHealth * 0.9).length >= 3;
      }),
      
      // Eternal Flame if talented (Herald of the Sun)
      Spell.cast("Eternal Flame", () => {
        const target = this.getPriorityTarget();
        return this.hasHolyPower() && 
               this.isHeraldOfTheSun() && 
               Spell.isSpellKnown("Eternal Flame") &&
               target && 
               target.health < target.maxHealth * 0.85 &&
               !target.hasAura(156322); // Eternal Flame
      }),
      
      // Word of Glory as default HP spender
      Spell.cast("Word of Glory", () => {
        const target = this.getPriorityTarget();
        return this.hasHolyPower() && 
               target && 
               target.health < target.maxHealth * 0.9;
      })
    );
  }

  /**
   * Holy Power builders
   */
  holyPowerBuilders() {
    return new bt.Selector(
      // Holy Shock as main Holy Power builder
      Spell.cast("Holy Shock", () => {
        const target = this.getPriorityTarget();
        return target && target.health < target.maxHealth * 0.95;
      }),
      
      // Crusader Strike - only use if below max Holy Power
      Spell.cast("Crusader Strike", () => {
        return me.powerByType(PowerType.HolyPower) < 5 && 
               me.health > me.maxHealth * 0.7 && 
               combat.bestTarget && 
               me.distanceTo(combat.bestTarget) < 5;
      }),
      
      // Judgment - only use if Crusader's Might is talented
      Spell.cast("Judgment", () => {
        return me.powerByType(PowerType.HolyPower) < 5 && 
               Spell.isSpellKnown(196926) && // Crusader's Might talent
               combat.bestTarget;
      }),
      
      // Hammer of Wrath when available
      Spell.cast("Hammer of Wrath", () => {
        return me.powerByType(PowerType.HolyPower) < 5 && 
               combat.bestTarget && 
               (combat.bestTarget.health < combat.bestTarget.maxHealth * 0.2 || 
                me.hasAura(31884) || // Avenging Wrath
                me.hasAura(216331) || // Avenging Crusader
                me.hasAura(392939)); // Veneration buff
      })
    );
  }
  
  /**
   * Filler spells when nothing else to cast
   */
  fillerSpells() {
    return new bt.Selector(
      // Flash of Light with Infusion of Light proc
      Spell.cast("Flash of Light", () => {
        const target = this.getPriorityTarget();
        return target && 
               me.hasAura(54149) && // Infusion of Light
               target.health < target.maxHealth * 0.85;
      }),
      
      // Holy Light with Infusion of Light proc
      Spell.cast("Holy Light", () => {
        const target = this.getPriorityTarget();
        return target && 
               me.hasAura(54149) && // Infusion of Light
               target.health < target.maxHealth * 0.9;
      }),
      
      // Flash of Light for emergency
      Spell.cast("Flash of Light", () => {
        const target = this.getPriorityTarget();
        return target && 
               target.health < target.maxHealth * 0.7;
      }),
      
      // Holy Light as mana-efficient filler
      Spell.cast("Holy Light", () => {
        const target = this.getPriorityTarget();
        return target && 
               target.health < target.maxHealth * 0.9;
      }),
      
      // Judgment to keep on cooldown
      Spell.cast("Judgment", () => {
        return combat.bestTarget && me.powerByType(PowerType.HolyPower) < 5;
      }),
      
      // Crusader Strike as filler when near enemies
      Spell.cast("Crusader Strike", () => {
        return combat.bestTarget && 
               me.distanceTo(combat.bestTarget) < 5 && 
               me.powerByType(PowerType.HolyPower) < 5;
      })
    );
  }

  /**
   * Out of combat rotation
   */
  outOfCombatRotation() {
    return new bt.Selector(
      // Maintain Beacon of Light
      this.maintainBeacon(),
      
      // Resurrection
      Spell.cast("Redemption", () => {
        // Only try to resurrect if we have a dead target
        return me.targetUnit && me.targetUnit.deadOrGhost && !me.targetUnit.isEnemy;
      }),
      
      // Heal party members out of combat
      Spell.cast("Holy Shock", () => {
        const target = this.getPriorityTarget();
        return target && target.health < target.maxHealth * 0.8;
      }),
      
      // Word of Glory for out of combat healing
      Spell.cast("Word of Glory", () => {
        const target = this.getPriorityTarget();
        return this.hasHolyPower() && 
               target && 
               target.health < target.maxHealth * 0.9;
      }),
      
      // Flash of Light for quick healing
      Spell.cast("Flash of Light", () => {
        const target = this.getPriorityTarget();
        return target && 
               target.health < target.maxHealth * 0.8;
      }),
      
      // Holy Light to conserve mana
      Spell.cast("Holy Light", () => {
        const target = this.getPriorityTarget();
        return target && 
               target.health < target.maxHealth * 0.95;
      })
    );
  }
}