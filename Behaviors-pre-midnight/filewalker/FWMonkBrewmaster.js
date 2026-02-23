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
 * Behavior implementation for Monk Brewmaster
 * Based on SimC APL
 */
export class MonkBrewmasterBehavior extends Behavior {
  // Define context, specialization, name, and version
  context = BehaviorContext.Any;
  specialization = Specialization.Monk.Brewmaster;
  name = "FW Monk Brewmaster";
  version = 1;
  
  // Static aura/spell IDs from monkSpells
  static auras = {
    // Core Brewmaster auras
    aspect_of_harmony: 450711,
    aspect_of_harmony_accumulator: 450521,
    aspect_of_harmony_damage: 450763,
    weapons_of_order: 387184,
    weapons_of_order_debuff: 387179,
    blackout_combo: 228563,
    charred_passions: 386963,
    breath_of_fire_dot: 123725,
    elusive_brawler: 195630,
    purified_chi: 325092,
    celestial_brew: 322507,
    shuffle: 322120,
    light_stagger: 124275,
    moderate_stagger: 124274,
    heavy_stagger: 124273,
    
    // Hero talent checks
    celestial_conduit: 414143, // Conduit of the Celestials key talent
    aspect_of_harmony: 450711, // Master of Harmony key talent
    flurry_strikes: 451021,    // Shado-Pan key talent
    
    // Additional relevant auras
    fortifying_brew: 120954,
    dampen_harm: 122278,
    rushing_jade_wind: 116847,
    exploding_keg: 325153,
    invoke_niuzao: 132578,
    diffuse_magic: 122783
  };
  
  // Settings for the behavior
  static settings = [
    {
      header: "Brewmaster Configuration",
      options: [
        {
          uid: "max_damage",
          text: "Maximum Damage",
          type: "checkbox",
          default: false
        },
        {
          uid: "purify_for_celestial",
          text: "Purify for Celestial Brew",
          type: "checkbox",
          default: true
        },
        {
          uid: "purify_stagger_currhp",
          text: "Purify at Stagger % of Current HP",
          type: "slider",
          min: 0,
          max: 100,
          default: 30
        },
        {
          uid: "purify_stagger_maxhp",
          text: "Purify at Stagger % of Max HP",
          type: "slider",
          min: 0,
          max: 100,
          default: 15
        },
        {
          uid: "vivify_percent",
          text: "Vivify at Health %",
          type: "slider",
          min: 0,
          max: 100,
          default: 60
        },
        {
          uid: "eh_percent",
          text: "Expel Harm at Health %",
          type: "slider",
          min: 0,
          max: 100,
          default: 75
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
      this.precombat(),
      new bt.Action(() => {
        // This action ensures we have a valid target
        if (this.getCurrentTarget() === null) {
          return bt.Status.Success;
        }
        return bt.Status.Failure;
      }),
      this.interrupt(),
      this.defensives(),
      this.staggerManagement(),
      this.racials(),
    //   this.trinkets(),
      this.resourceManagement(),
      this.mainRotation()
    );
  }

  /**
   * Pre-combat actions
   */
  precombat() {
    return new bt.Selector(
      Spell.cast("Chi Burst", () => Spell.isSpellKnown("Chi Burst"))
    );
  }

  /**
   * Interrupts
   */
  interrupt() {
    return new bt.Selector(
      Spell.cast("Spear Hand Strike", () => {
        const target = this.getCurrentTarget();
        return target && target.isCastingOrChanneling && target.isInterruptible;
      })
    );
  }

  /**
   * Defensive cooldowns
   */
  defensives() {
    return new bt.Selector(
      Spell.cast("Fortifying Brew", () => me.pctHealth < 50 && this.isTanking() && !me.hasAura(MonkBrewmasterBehavior.auras.dampen_harm)),
      Spell.cast("Dampen Harm", () => me.pctHealth < 70 && this.isTanking() && !me.hasAura(MonkBrewmasterBehavior.auras.fortifying_brew)),
      Spell.cast("Diffuse Magic", () => me.pctHealth < 80 && this.isHighMagicDamage()),
      Spell.cast("Vivify", () => me.pctHealth <= Settings.vivify_percent && me.hasAura("Vivacious Vivification")),
      Spell.cast("Expel Harm", () => me.pctHealth < Settings.eh_percent && this.getGiftOfTheOxOrbs() > 3)
    );
  }

  /**
   * Stagger management with Purifying Brew and Celestial Brew
   */
  staggerManagement() {
    return new bt.Selector(
      // Purify for Celestial Brew when appropriate
      Spell.cast("Purifying Brew", () => 
        Settings.purify_for_celestial && 
        (
          Spell.getChargesFractional("Purifying Brew") > 1.8 ||
          (me.hasAura(MonkBrewmasterBehavior.auras.purified_chi) && this.getAuraRemainingTime(MonkBrewmasterBehavior.auras.purified_chi) < 1.5) ||
          (Spell.getCooldown("Celestial Brew").timeleft < 3 && Spell.getChargesFractional("Purifying Brew") > 1.5)
        ) &&
        !me.hasAura(MonkBrewmasterBehavior.auras.blackout_combo)
      ),
      
      // Purify based on stagger level
      Spell.cast("Purifying Brew", () => 
        !me.hasAura(MonkBrewmasterBehavior.auras.blackout_combo) && 
        (
          (me.hasAura(MonkBrewmasterBehavior.auras.heavy_stagger) && this.getStaggerPercent() > Settings.purify_stagger_currhp) ||
          (me.hasAura(MonkBrewmasterBehavior.auras.moderate_stagger) && this.getStaggerPercent() > Settings.purify_stagger_maxhp * 1.5) ||
          (this.isTanking() && me.hasAura(MonkBrewmasterBehavior.auras.heavy_stagger))
        )
      )
    );
  }

  /**
   * Racial abilities
   */
  racials() {
    return new bt.Selector(
      Spell.cast("Blood Fury"),
      Spell.cast("Berserking"),
      Spell.cast("Arcane Torrent"),
      Spell.cast("Lights Judgment"),
      Spell.cast("Fireblood"),
      Spell.cast("Ancestral Call"),
      Spell.cast("Bag of Tricks")
    );
  }

  /**
   * Trinket usage
   */
  trinkets() {
    return new bt.Selector(
      Common.useEquippedItemByName("Tome of Lights Devotion"),
      Common.useEquippedItemByName("Grim Codex")
    );
  }

  /**
   * Resource management and key defensive abilities
   */
  resourceManagement() {
    return new bt.Selector(
      // Black Ox Brew for energy
      Spell.cast("Black Ox Brew", () => me.power < 40),
      
      // Celestial Brew with Aspect of Harmony based on SIMC conditions
      Spell.cast("Celestial Brew", () => 
        this.getAspectOfHarmonyValue() > 0.3 * me.maxHealth &&
        me.hasAura(MonkBrewmasterBehavior.auras.weapons_of_order) &&
        !me.hasAura(MonkBrewmasterBehavior.auras.aspect_of_harmony_damage)
      ),
      
      Spell.cast("Celestial Brew", () => 
        this.getAspectOfHarmonyValue() > 0.3 * me.maxHealth &&
        !Spell.isSpellKnown("Weapons of Order") &&
        !me.hasAura(MonkBrewmasterBehavior.auras.aspect_of_harmony_damage)
      ),
      
      Spell.cast("Celestial Brew", () => 
        this.getFightRemains() < 20 && this.getFightRemains() > 14 &&
        this.getAspectOfHarmonyValue() > 0.2 * me.maxHealth
      ),
      
      Spell.cast("Celestial Brew", () => 
        this.getAspectOfHarmonyValue() > 0.3 * me.maxHealth &&
        Spell.getCooldown("Weapons of Order").timeleft > 20 &&
        !me.hasAura(MonkBrewmasterBehavior.auras.aspect_of_harmony_damage)
      )
    );
  }

  /**
   * Main rotation
   */
  mainRotation() {
    return new bt.Selector(
      // Core rotation following SIMC APL order
      Spell.cast("Blackout Kick"),
      Spell.cast("Chi Burst"),
      Spell.cast("Weapons of Order"),
      
      // Rising Sun Kick based on talent
      Spell.cast("Rising Sun Kick", () => !this.hasTalent("Fluidity of Motion")),
      
      // Tiger Palm with Blackout Combo
      Spell.cast("Tiger Palm", () => me.hasAura(MonkBrewmasterBehavior.auras.blackout_combo)),
      
      // Keg Smash with Scalding Brew
      Spell.cast("Keg Smash", () => this.hasTalent("Scalding Brew")),
      
      // Spinning Crane Kick with conditions
      Spell.cast("Spinning Crane Kick", () => 
        this.hasTalent("Charred Passions") && 
        this.hasTalent("Scalding Brew") && 
        me.hasAura(MonkBrewmasterBehavior.auras.charred_passions) &&
        this.getAuraRemainingTime(MonkBrewmasterBehavior.auras.charred_passions) < 3 &&
        this.getDebuffRemainingTime(MonkBrewmasterBehavior.auras.breath_of_fire_dot) < 9 &&
        this.getEnemyCount() > 4
      ),
      
      // Rising Sun Kick with Fluidity of Motion
      Spell.cast("Rising Sun Kick", () => this.hasTalent("Fluidity of Motion")),
      
      // Purifying Brew without Blackout Combo
      Spell.cast("Purifying Brew", () => !me.hasAura(MonkBrewmasterBehavior.auras.blackout_combo)),
      
      // Breath of Fire with complex conditions
      Spell.cast("Breath of Fire", () => 
        (!me.hasAura(MonkBrewmasterBehavior.auras.charred_passions) && 
         (!this.hasTalent("Scalding Brew") || this.getEnemyCount() < 5)) ||
        !this.hasTalent("Charred Passions") ||
        (this.getDebuffRemainingTime(MonkBrewmasterBehavior.auras.breath_of_fire_dot) < 3 && 
         this.hasTalent("Scalding Brew"))
      ),
      
      // Rest of the core rotation
      Spell.cast("Exploding Keg"),
      Spell.cast("Keg Smash"),
      Spell.cast("Rushing Jade Wind"),
      Spell.cast("Invoke Niuzao, the Black Ox"),
      
      // Energy pooling for Tiger Palm
      Spell.cast("Tiger Palm", () => 
        me.power > 40 - Spell.getCooldown("Keg Smash").timeleft * this.getEnergyRegen()
      ),
      
      // Energy pooling for Spinning Crane Kick
      Spell.cast("Spinning Crane Kick", () => 
        me.power > 40 - Spell.getCooldown("Keg Smash").timeleft * this.getEnergyRegen()
      )
    );
  }

  // Helper methods

  /**
   * Get the current target for attacking
   * @returns {CGUnit} The current target or null if none is valid
   */
  getCurrentTarget() {
    const target = me.target;
    if (target && Common.validTarget(target)) {
      return target;
    }
    return combat.bestTarget;
  }

  /**
   * Get the count of enemies in melee range
   * @returns {number} The number of enemies in range
   */
  getEnemyCount() {
    return me.getUnitsAroundCount(8);
  }

  /**
   * Get the remaining time of an aura on the player
   * @param {number} auraId - The ID of the aura to check
   * @returns {number} The remaining time in seconds
   */
  getAuraRemainingTime(auraId) {
    const aura = me.getAura(auraId);
    return aura ? aura.remaining / 1000 : 0;
  }

  /**
   * Get the remaining time of a debuff on the current target
   * @param {number} auraId - The ID of the debuff to check
   * @returns {number} The remaining time in seconds
   */
  getDebuffRemainingTime(auraId) {
    const target = this.getCurrentTarget();
    if (!target) return 0;
    
    const debuff = target.getAuraByMe(auraId);
    return debuff ? debuff.remaining / 1000 : 0;
  }

  /**
   * Get the current stagger percentage
   * @returns {number} The stagger as a percentage of max health
   */
  getStaggerPercent() {
    // Estimate based on stagger level
    if (me.hasAura(MonkBrewmasterBehavior.auras.heavy_stagger)) return 45;
    if (me.hasAura(MonkBrewmasterBehavior.auras.moderate_stagger)) return 25;
    if (me.hasAura(MonkBrewmasterBehavior.auras.light_stagger)) return 10;
    return 0;
  }

  /**
   * Check if the player is currently being targeted by enemies
   * @returns {boolean} True if the player is being targeted
   */
  isTanking() {
    const enemies = me.getEnemies(15);
    for (const enemy of enemies) {
      if (enemy.targetGuid && enemy.targetGuid.equals(me.guid)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Check if the player is facing high magic damage
   * @returns {boolean} True if high magic damage is detected
   */
  isHighMagicDamage() {
    // This would need implementation based on debuffs, enemy types, etc.
    // Simple implementation for now
    return false;
  }

  /**
   * Get the current energy regeneration rate
   * @returns {number} The energy regen rate
   */
  getEnergyRegen() {
    // This is a simplified approximation - would need haste calculation
    return 10;
  }

  /**
   * Check if the player has a specific talent
   * @param {string} talentName - The name of the talent to check
   * @returns {boolean} True if the player has the talent
   */
  hasTalent(talentName) {
    return me.hasAura(talentName);
  }

  /**
   * Get the value of Aspect of Harmony accumulator
   * @returns {number} The current value of the accumulator
   */
  getAspectOfHarmonyValue() {
    // This would need implementation to get actual value
    // For now, estimate based on stagger level and health
    if (me.hasAura(MonkBrewmasterBehavior.auras.aspect_of_harmony_accumulator)) {
      if (me.hasAura(MonkBrewmasterBehavior.auras.heavy_stagger)) {
        return me.maxHealth * 0.4;
      } else if (me.hasAura(MonkBrewmasterBehavior.auras.moderate_stagger)) {
        return me.maxHealth * 0.25;
      } else {
        return me.maxHealth * 0.15;
      }
    }
    return 0;
  }

  /**
   * Get the number of Gift of the Ox orbs available
   * @returns {number} The number of orbs
   */
  getGiftOfTheOxOrbs() {
    // Would need implementation to count actual orbs
    return 0;
  }

  /**
   * Get the estimated remaining time in the current fight
   * @returns {number} The estimated time in seconds
   */
  getFightRemains() {
    const target = this.getCurrentTarget();
    return target?.timeToDeath() || 100;
  }

  /**
   * Check if the player has the Master of Harmony hero talent
   * @returns {boolean} True if the player has the talent
   */
  hasHeroTalent() {
    return me.hasAura(MonkBrewmasterBehavior.auras.aspect_of_harmony);
  }
}