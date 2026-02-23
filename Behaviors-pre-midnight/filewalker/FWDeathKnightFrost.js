import { Behavior, BehaviorContext } from "@/Core/Behavior";
import * as bt from '@/Core/BehaviorTree';
import Specialization from '@/Enums/Specialization';
import Common from '@/Core/Common';
import Spell from "@/Core/Spell";
import { me } from "@/Core/ObjectManager";
import { PowerType } from "@/Enums/PowerType";
import { defaultCombatTargeting as combat } from "@/Targeting/CombatTargeting";
import Settings from "@/Core/Settings";

const auras = {
    // Key hero talent identifiers
    REAPERS_MARK: 439843,         // Deathbringer
    RIDERS_CHAMPION: 444005,      // Rider of the Apocalypse
    
    // Core DK spells and buffs
    BREATH_OF_SINDRAGOSA: 152279,
    PILLAR_OF_FROST: 51271,
    EMPOWER_RUNE_WEAPON: 47568,
    KILLING_MACHINE: 51128,
    RIME: 59052,
    FROST_FEVER: 55095,
    UNHOLY_STRENGTH: 53365,
    RAZORICE: 51714,
    DEATH_AND_DECAY: 43265,
    
    // Talents
    GATHERING_STORM: 194912,
    BITING_COLD: 377056,
    UNLEASHED_FRENZY: 376905,
    ICY_TALONS: 194878,
    BONEGRINDER: 377098,
    OBLITERATION: 281238,
    ASHEN_JUGGERNAUT: 48792,
    COLD_HEART: 281208,
    RAGE_OF_THE_FROZEN_CHAMPION: 377076,
    ICEBREAKER: 392950,
    BIND_IN_DARKNESS: 440031,
    WITHER_AWAY: 441894,
    SHATTERING_BLADE: 207057,
    CLEAVING_STRIKES: 316916,
    GLACIAL_ADVANCE: 194913,
    SHATTERED_FROST: 455993,
    
    // Rider of the Apocalypse talent buffs
    A_FEAST_OF_SOULS: 444072,
    APOCALYPSE_NOW: 444040,
    
    // Deathbringer talent buffs
    EXTERMINATE: 441378,
    DARK_TALONS: 436687,
    
    // Other buffs
    SMOTHERING_OFFENSE: 435005,
    REAPERS_MARK_DEBUFF: 439950
  };
/**
 * Behavior implementation for Death Knight Frost
 * Based on SIMC APL as of March 5 2025 - 04347cf
 */
export class DeathKnightFrostBehavior extends Behavior {
  context = BehaviorContext.Any;
  specialization = Specialization.DeathKnight.Frost;
  name = "FW Frost Death Knight";
  version = 1;

  // Aura IDs for easy reference
  

  // Settings with default values from SIMC APL
  static settings = [
    {
      header: "Frost Death Knight Settings",
      options: [
        {
            uid: "useCD",
            text: "Use Cooldowns",
            type: "checkbox",
            default: true
          },
        {
          uid: "bos_rp",
          text: "Breath RP Threshold",
          type: "slider",
          min: 40,
          max: 100,
          default: 65
        },
        {
          uid: "erw_breath_rp_trigger",
          text: "ERW Breath RP Trigger",
          type: "slider",
          min: 30,
          max: 100,
          default: 70
        },
        {
          uid: "erw_breath_rune_trigger",
          text: "ERW Breath Rune Trigger",
          type: "slider",
          min: 0,
          max: 6,
          default: 3
        },
        {
          uid: "oblit_rune_pooling",
          text: "Obliteration Rune Pooling",
          type: "slider",
          min: 2,
          max: 6,
          default: 4
        },
        {
          uid: "breath_rime_rp_threshold",
          text: "Breath Rime RP Threshold",
          type: "slider",
          min: 20,
          max: 100,
          default: 60
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
      Common.waitForNotMounted(),
      Common.waitForCastOrChannel(),
      new bt.Action(() => {
        // Return success if we don't have a valid target
        if (this.getCurrentTarget() === null) {
          return bt.Status.Success;
        }
        return bt.Status.Failure;
      }),
      // Interrupt
      Spell.interrupt("Mind Freeze", false),
      
      // High priority actions
      Spell.cast("Anti-Magic Shell", () => 
        me.runicPowerDeficit > 40 && 
        !this.hasTalent("Breath of Sindragosa") || 
        (this.hasTalent("Breath of Sindragosa") && 
        this.getVariable("true_breath_cooldown") > 
        Spell.getCooldown("Anti-Magic Shell").duration)
      ),

      // Trinkets
    //   this.useTrinkets(),
      
      // Maintain Frost Fever
      Spell.cast("Howling Blast", () => 
        !this.getCurrentTarget().hasAuraByMe(auras.FROST_FEVER) && 
        this.getEnemyCount() >= 2 && 
        (!this.hasTalent("Breath of Sindragosa") || !me.hasAura(auras.BREATH_OF_SINDRAGOSA)) &&
        (!this.hasTalent("Obliteration") || this.hasTalent("Wither Away") || 
        this.hasTalent("Obliteration") && (!Spell.getCooldown("Pillar of Frost").ready || 
        me.hasAura(auras.PILLAR_OF_FROST) && !me.hasAura(auras.KILLING_MACHINE)))
      ),

      // Cooldowns
      this.useCooldowns(),
      
      // Racial abilities
      this.useRacials(),
      
      // Cold Heart handling
      new bt.Decorator(
        () => this.hasTalent("Cold Heart") && 
              (!me.hasAura(auras.KILLING_MACHINE) || this.hasTalent("Breath of Sindragosa")) && 
              ((this.getDebuffStacks("Razorice") === 5 || !this.hasRuneforgeRazorice() && 
              !this.hasTalent("Glacial Advance") && !this.hasTalent("Avalanche") && 
              !this.hasTalent("Arctic Assault"))),
        this.coldHeartActions()
      ),
      
      // Main action lists based on state
      new bt.Decorator(
        () => me.hasAura(auras.BREATH_OF_SINDRAGOSA),
        this.breathActions()
      ),
      new bt.Decorator(
        () => this.hasTalent("Obliteration") && me.hasAura(auras.PILLAR_OF_FROST) && !me.hasAura(auras.BREATH_OF_SINDRAGOSA),
        this.obliterationActions()
      ),
      new bt.Decorator(
        () => this.getEnemyCount() >= 2,
        this.aoeActions()
      ),
      this.singleTargetActions()
    );
  }

  /**
   * Get the current valid target
   * @returns {wow.CGUnit | null} The current target or null if none
   */
  getCurrentTarget() {
    const target = me.targetUnit;
    if (target && !target.deadOrGhost && me.canAttack(target)) {
      return target;
    }
    return combat.bestTarget;
  }

  /**
   * Get the number of enemies in range
   * @returns {number} The number of enemies
   */
  getEnemyCount() {
    return combat.targets.length;
  }

  /**
   * Check if we have a specific talent
   * @param {string} talentName - The name of the talent to check
   * @returns {boolean} True if we have the talent
   */
  hasTalent(talentName) {
    // Check for specific spellID based on talent name
    const talentIds = {
      "Breath of Sindragosa": 152279,
      "Obliteration": 281238,
      "Pillar of Frost": 51271,
      "Empower Rune Weapon": 47568,
      "Cold Heart": 281208,
      "Glacial Advance": 194913,
      "Avalanche": 207142,
      "Arctic Assault": 456230,
      "Gathering Storm": 194912,
      "Biting Cold": 377056,
      "Icebreaker": 392950,
      "Rage of the Frozen Champion": 377076,
      "Shattered Frost": 455993,
      "Shattering Blade": 207057,
      "Cleaving Strikes": 316916,
      "Wither Away": 441894,
      "Bind in Darkness": 440031,
      "Unholy Ground": 374265,
      "The Long Winter": 456240,
      "Enduring Strength": 377190,
      "A Feast of Souls": 444072,
      "Apocalypse Now": 444040,
      "Unleashed Frenzy": 376905,
      "Icy Talons": 194878,
      "Bonegrinder": 377098,
      "Frostwyrm's Fury": 279302
    };

    const id = talentIds[talentName];
    if (id) {
      return Spell.isSpellKnown(id);
    }
    
    // Fallback to checking if we have the spell
    return Spell.isSpellKnown(talentName);
  }

  /**
   * Check if the player is using the Deathbringer hero talent
   * @returns {boolean} True if using Deathbringer
   */
  isDeathbringer() {
    return me.hasAura(auras.REAPERS_MARK);
  }

  /**
   * Check if the player is using the Rider of the Apocalypse hero talent
   * @returns {boolean} True if using Rider of the Apocalypse
   */
  isRiderOfTheApocalypse() {
    return me.hasAura(auras.RIDERS_CHAMPION);
  }

  /**
   * Get the number of debuff stacks on the target
   * @param {string} debuffName - The name of the debuff
   * @returns {number} Number of stacks
   */
  getDebuffStacks(debuffName) {
    const target = this.getCurrentTarget();
    if (!target) return 0;
    
    if (debuffName === "Razorice") {
      return target.getAuraStacks(auras.RAZORICE) || 0;
    }
    
    return target.getAuraStacks(debuffName) || 0;
  }

  /**
   * Check if we have the Razorice runeforge
   * @returns {boolean} True if we have Razorice
   */
  hasRuneforgeRazorice() {
    // Since we can't directly check for runeforge, we approximate
    // by checking if the target has the debuff and we've been in combat
    const target = this.getCurrentTarget();
    return target && target.hasAura(auras.RAZORICE) && me.inCombat();
  }

  /**
   * Helper method to check if we have Fallen Crusader runeforge
   * @returns {boolean} Whether we have Fallen Crusader
   */
  hasRuneforgeFallenCrusader() {
    // Since we can't directly check for runeforge, we approximate
    // Look for the Unholy Strength proc which is a sign of Fallen Crusader
    return me.hasAura(auras.UNHOLY_STRENGTH);
  }

  /**
   * Get SIMC variable values
   * @param {string} name - The name of the variable
   * @returns {boolean|number} The value of the variable
   */
  getVariable(name) {
    switch (name) {
      case "st_planning":
        return this.getEnemyCount() === 1;
      case "adds_remain":
        return this.getEnemyCount() > 1;
      case "use_breath":
        return this.getVariable("st_planning") || this.getEnemyCount() >= 2;
      case "sending_cds":
        return this.getVariable("st_planning") || this.getVariable("adds_remain");
      case "rime_buffs":
        return me.hasAura(auras.RIME) && (
          this.getVariable("static_rime_buffs") || 
          (this.hasTalent("Avalanche") && !this.hasTalent("Arctic Assault") && 
          this.getDebuffStacks("Razorice") < 5)
        );
      case "rp_buffs":
        return (this.hasTalent("Unleashed Frenzy") && 
                (this.getAuraRemainingTime(auras.UNLEASHED_FRENZY) < 4.5 || 
                this.getAuraStacks(auras.UNLEASHED_FRENZY) < 3)) || 
               (this.hasTalent("Icy Talons") && 
                (this.getAuraRemainingTime(auras.ICY_TALONS) < 4.5 || 
                this.getAuraStacks(auras.ICY_TALONS) < (3 + (2 * (this.hasTalent("Smothering Offense") ? 1 : 0)) + 
                (2 * (this.hasTalent("Dark Talons") ? 1 : 0)))));
      case "cooldown_check":
        return (!this.hasTalent("Breath of Sindragosa") || me.hasAura(auras.BREATH_OF_SINDRAGOSA)) && 
               (this.hasTalent("Pillar of Frost") && me.hasAura(auras.PILLAR_OF_FROST) && 
               (this.hasTalent("Obliteration") && this.getAuraRemainingTime(auras.PILLAR_OF_FROST) > 10 || 
               !this.hasTalent("Obliteration")) || !this.hasTalent("Pillar of Frost") && 
               me.hasAura(auras.EMPOWER_RUNE_WEAPON) || !this.hasTalent("Pillar of Frost") && 
               !this.hasTalent("Empower Rune Weapon") || this.getEnemyCount() >= 2 && 
               me.hasAura(auras.PILLAR_OF_FROST));
      case "static_rime_buffs":
        return this.hasTalent("Rage of the Frozen Champion") || 
               this.hasTalent("Icebreaker") || 
               this.hasTalent("Bind in Darkness");
      case "breath_rp_cost":
        return 17; // Static value from SIMC
      case "true_breath_cooldown":
        return Spell.getCooldown("Breath of Sindragosa").timeleft > 
               Spell.getCooldown("Pillar of Frost").timeleft ? 
               Spell.getCooldown("Breath of Sindragosa").timeleft : 
               Spell.getCooldown("Pillar of Frost").timeleft;
      case "breath_rp_threshold":
        const setting = Settings.bos_rp || 65;
        return setting;
      case "erw_breath_rp_trigger":
        return Settings.erw_breath_rp_trigger || 70;
      case "erw_breath_rune_trigger":
        return Settings.erw_breath_rune_trigger || 3;
      case "oblit_rune_pooling":
        return Settings.oblit_rune_pooling || 4;
      case "breath_rime_rp_threshold":
        return Settings.breath_rime_rp_threshold || 60;
      case "ga_priority":
        return (!this.hasTalent("Shattered Frost") && this.hasTalent("Shattering Blade") && 
                this.getEnemyCount() >= 4) || 
               (!this.hasTalent("Shattered Frost") && !this.hasTalent("Shattering Blade") && 
                this.getEnemyCount() >= 2);
      case "breath_dying":
        const rpCost = this.getVariable("breath_rp_cost");
        return me.runicPowerDeficit > (100 - rpCost*2*1.5) && 
               me.runeTimeTo(2) > me.runicPower / rpCost;
      case "fwf_buffs":
        const target = this.getCurrentTarget();
        return (this.getAuraRemainingTime(auras.PILLAR_OF_FROST) < 1.5 || 
               (me.hasAura(auras.UNHOLY_STRENGTH) && 
               this.getAuraRemainingTime(auras.UNHOLY_STRENGTH) < 1.5) || 
               (this.hasTalent("Bonegrinder") && me.hasAura(auras.BONEGRINDER) && 
               this.getAuraRemainingTime(auras.BONEGRINDER) < 1.5)) && 
               (this.getEnemyCount() > 1 || this.getDebuffStacks("Razorice") === 5 || 
               !this.hasRuneforgeRazorice() && 
               (!this.hasTalent("Glacial Advance") || !this.hasTalent("Avalanche") || 
               !this.hasTalent("Arctic Assault")) || this.hasTalent("Shattering Blade"));
      case "pooling_runes":
        return me.runes < this.getVariable("oblit_rune_pooling") && 
               this.hasTalent("Obliteration") && 
               (!this.hasTalent("Breath of Sindragosa") || 
               this.getVariable("true_breath_cooldown") > 0) && 
               Spell.getCooldown("Pillar of Frost").timeleft < 
               this.getVariable("oblit_pooling_time");
      case "pooling_runic_power":
        return (this.hasTalent("Breath of Sindragosa") && 
               (this.getVariable("true_breath_cooldown") < 
               this.getVariable("breath_pooling_time"))) || 
               (this.hasTalent("Obliteration") && 
               (!this.hasTalent("Breath of Sindragosa") || 
               Spell.getCooldown("Breath of Sindragosa").timeleft > 30) && 
               me.runicPower < 35 && 
               Spell.getCooldown("Pillar of Frost").timeleft < 
               this.getVariable("oblit_pooling_time"));
    }
    return false;
  }

  /**
   * Get the remaining time on an aura
   * @param {number} auraId - The ID of the aura
   * @returns {number} Remaining time in seconds
   */
  getAuraRemainingTime(auraId) {
    const aura = me.getAura(auraId);
    return aura ? aura.remaining / 1000 : 0;
  }

  /**
   * Get the number of stacks on an aura
   * @param {number} auraId - The ID of the aura
   * @returns {number} Number of stacks
   */
  getAuraStacks(auraId) {
    const aura = me.getAura(auraId);
    return aura ? aura.stacks : 0;
  }

  /**
   * Use trinkets based on conditions
   * @returns {bt.Composite} Action to use trinkets
   */
  useTrinkets() {
    return new bt.Selector(
      Common.useEquippedItemByName("Treacherous Transmitter", () => 
        Spell.getCooldown("Pillar of Frost").timeleft < 6 && 
        this.getVariable("sending_cds") && this.trinketCondition()
      ),
      Common.useEquippedItemByName(1, () => 
        this.trinket1Condition() && me.hasAura(auras.PILLAR_OF_FROST) && 
        this.getAuraRemainingTime(auras.PILLAR_OF_FROST) > 5
      ),
      Common.useEquippedItemByName(2, () => 
        this.trinket2Condition() && me.hasAura(auras.PILLAR_OF_FROST) && 
        this.getAuraRemainingTime(auras.PILLAR_OF_FROST) > 5
      )
    );
  }

  /**
   * Helper method for trinket 1 condition
   * @returns {boolean} Whether trinket 1 should be used
   */
  trinket1Condition() {
    // This is a simplified implementation of the trinket logic
    return me.hasAura(auras.PILLAR_OF_FROST) || 
           me.hasAura(auras.BREATH_OF_SINDRAGOSA);
  }

  /**
   * Helper method for trinket 2 condition
   * @returns {boolean} Whether trinket 2 should be used
   */
  trinket2Condition() {
    // This is a simplified implementation of the trinket logic
    return me.hasAura(auras.PILLAR_OF_FROST) || 
           me.hasAura(auras.BREATH_OF_SINDRAGOSA);
  }

  /**
   * General trinket condition
   */
  trinketCondition() {
    return this.getVariable("sending_cds") || 
           (!this.hasTalent("Breath of Sindragosa") || 
           Spell.getCooldown("Breath of Sindragosa").timeleft < 6);
  }

  /**
   * Use racial abilities based on conditions
   * @returns {bt.Composite} Action to use racial abilities
   */
  useRacials() {
    return new bt.Selector(
      Spell.cast("Blood Fury", () => this.getVariable("cooldown_check")),
      Spell.cast("Berserking", () => this.getVariable("cooldown_check")),
      Spell.cast("Arcane Pulse", () => this.getVariable("cooldown_check")),
      Spell.cast("Lights Judgment", () => this.getVariable("cooldown_check")),
      Spell.cast("Ancestral Call", () => this.getVariable("cooldown_check")),
      Spell.cast("Fireblood", () => this.getVariable("cooldown_check")),
      Spell.cast("Bag of Tricks", () => {
        if (this.hasTalent("Obliteration")) {
          return !me.hasAura(auras.PILLAR_OF_FROST) && 
                 me.hasAura(auras.UNHOLY_STRENGTH);
        } else {
          return me.hasAura(auras.PILLAR_OF_FROST) && 
                 (me.hasAura(auras.UNHOLY_STRENGTH) && 
                 this.getAuraRemainingTime(auras.UNHOLY_STRENGTH) < 4.5 || 
                 this.getAuraRemainingTime(auras.PILLAR_OF_FROST) < 4.5);
        }
      })
    );
  }

  /**
   * Use major cooldowns based on conditions
   * @returns {bt.Composite} Action to use cooldowns
   */
  // Replace the useCooldowns() method with this improved version
useCooldowns() {
    return new bt.Selector(
      // Potion
      new bt.Action(() => {
        // Potion usage would go here if we had the API
        return bt.Status.Failure;
      }),
      
      // Pillar of Frost - Simplified to ensure it triggers reliably
      Spell.cast("Pillar of Frost", () => {
        // Basic condition - always use when available if cooldowns are enabled
        if (!Settings.useCD) return false;
        
        // Don't use if saving for Breath
        if (this.hasTalent("Breath of Sindragosa") && 
            Spell.getCooldown("Breath of Sindragosa").ready &&
            me.runicPower < this.getVariable("breath_rp_threshold")) {
          return false;
        }
        
        // Use with valid target in combat
        const target = this.getCurrentTarget();
        return target && me.inCombat();
      }),
      
      // Empower Rune Weapon - Less dependent on Pillar of Frost
      Spell.cast("Empower Rune Weapon", () => {
        if (!Settings.useCD) return false;
        
        // For Obliteration build
        if (this.hasTalent("Obliteration") && !this.hasTalent("Breath of Sindragosa")) {
          // Use with Pillar if possible, otherwise use it when below 3 runes
          return me.hasAura(auras.PILLAR_OF_FROST) || me.runes <= 2;
        } 
        // For Breath of Sindragosa build
        else if (this.hasTalent("Breath of Sindragosa")) {
          // During Breath, use when resources are low
          if (me.hasAura(auras.BREATH_OF_SINDRAGOSA)) {
            return me.runicPower < 40 || 
                  (me.runicPower < this.getVariable("erw_breath_rp_trigger") && 
                  me.runes < this.getVariable("erw_breath_rune_trigger"));
          }
          // Before Breath, use to prepare resources
          else if (Spell.getCooldown("Breath of Sindragosa").ready &&
                  me.runicPower < this.getVariable("breath_rp_threshold")) {
            return true;
          }
        } 
        // For any other build
        else {
          return me.runes < 4;
        }
        
        return false;
      }),
      
      // Abomination Limb - Unchanged
      Spell.cast("Abomination Limb", () => {
        if (this.hasTalent("Obliteration")) {
          return !me.hasAura(auras.PILLAR_OF_FROST) && 
                this.getVariable("sending_cds") && 
                (!this.isDeathbringer() || 
                Spell.getCooldown("Reaper's Mark").timeleft < 5);
        } else {
          return this.getVariable("sending_cds");
        }
      }),
      
      // Remorseless Winter - Unchanged
      Spell.cast("Remorseless Winter", () => {
        const rwBuffs = this.hasTalent("Gathering Storm") || this.hasTalent("Biting Cold");
        return rwBuffs && this.getVariable("sending_cds") && 
              (!this.hasTalent("Arctic Assault") || !me.hasAura(auras.PILLAR_OF_FROST)) && 
              (Spell.getCooldown("Pillar of Frost").timeleft > 20 || 
              Spell.getCooldown("Pillar of Frost").timeleft < 1.5 * 3 || 
              (this.getAuraStacks(auras.GATHERING_STORM) === 10 && 
              this.getAuraRemainingTime("Remorseless Winter") < 1.5));
      }),
      
      // Chill Streak - Unchanged
      Spell.cast("Chill Streak", () => 
        this.getVariable("sending_cds") && 
        (!this.hasTalent("Arctic Assault") || !me.hasAura(auras.PILLAR_OF_FROST))
      ),
      
      // Breath of Sindragosa - Unchanged
      Spell.cast("Breath of Sindragosa", () => 
        !me.hasAura(auras.BREATH_OF_SINDRAGOSA) && 
        Settings.useCD &&
        me.runicPower > this.getVariable("breath_rp_threshold") && 
        (me.runes < 2 || me.runicPower > 80) && 
        (Spell.getCooldown("Pillar of Frost").ready && 
        this.getVariable("use_breath"))
      ),
      
      // Reaper's Mark - Unchanged
      Spell.cast("Reaper's Mark", () => {
        const target = this.getCurrentTarget();
        return (target.isBoss || target.timeToDeath() > 13) && 
              !target.hasAura(auras.REAPERS_MARK_DEBUFF) && 
              (me.hasAura(auras.PILLAR_OF_FROST) || 
              Spell.getCooldown("Pillar of Frost").timeleft > 5);
      }),
      
      Spell.cast(47568, () => { // Using spell ID 47568 for Empower Rune Weapon
        if (!Settings.useCD) return false;
        
        // Very simple conditions - use when we need resources
        if (me.hasAura(auras.PILLAR_OF_FROST)) {
          return true; // Always use during Pillar
        }
        
        // Use for resource generation when low
        if (me.runes < 3) {
          return true;
        }
        
        return false;
      }),
      
      // Direct implementation for Frostwyrm's Fury
      // Must be placed before the useCooldowns() method call in the main sequence
      Spell.cast(279302, () => { // Using spell ID 279302 for Frostwyrm's Fury
        if (!Settings.useCD) return false;
        
        // Very simple condition - just use with Pillar
        if (me.hasAura(auras.PILLAR_OF_FROST)) {
          return true;
        }
        
        return false;
      }),

      // Frostwyrm's Fury - Simplified logic
      Spell.cast("Frostwyrm's Fury", () => {
        if (!Settings.useCD) return false;
        
        // If we have Rider of the Apocalypse with Apocalypse Now
        if (this.isRiderOfTheApocalypse() && this.hasTalent("Apocalypse Now")) {
          return me.hasAura(auras.PILLAR_OF_FROST) || me.hasAura(auras.BREATH_OF_SINDRAGOSA);
        }
        
        // For single target
        if (this.getEnemyCount() === 1) {
          return me.hasAura(auras.PILLAR_OF_FROST) && 
                this.getAuraRemainingTime(auras.PILLAR_OF_FROST) < 4;
        }
        
        // For AoE
        if (this.getEnemyCount() >= 2) {
          return me.hasAura(auras.PILLAR_OF_FROST);
        }
        
        return false;
      }),
      
      // Raise Dead - Unchanged
      Spell.cast("Raise Dead", () => me.hasAura(auras.PILLAR_OF_FROST)),
      
      // Frostscythe - Unchanged
      Spell.cast("Frostscythe", () => !me.hasAura(auras.KILLING_MACHINE) && 
                                    !me.hasAura(auras.PILLAR_OF_FROST)),
      
      // Death and Decay - Unchanged
      new bt.Action(() => {
        // This could be Spell.cast("Death and Decay", ...) in practice
        // but we don't have a way to cast DnD in the simple spell interface
        // so we would need to create a custom implementation
        return bt.Status.Failure;
      })
    );
  }

  /**
   * Cold Heart action list
   * @returns {bt.Composite} Action list for Cold Heart
   */
  coldHeartActions() {
    return new bt.Selector(
      // actions.cold_heart+=/chains_of_ice,if=fight_remains<gcd&(rune<2|!buff.killing_machine.up&(!main_hand.2h&buff.cold_heart.stack>=4|main_hand.2h&buff.cold_heart.stack>8)|buff.killing_machine.up&(!main_hand.2h&buff.cold_heart.stack>8|main_hand.2h&buff.cold_heart.stack>10))
      Spell.cast("Chains of Ice", () => {
        const target = this.getCurrentTarget();
        if (target.timeToDeath() < 1.5) {
          if (me.runes < 2) return true;
          if (!me.hasAura(auras.KILLING_MACHINE) && 
              (!me.mainHand2H && this.getAuraStacks(auras.COLD_HEART) >= 4 || 
               me.mainHand2H && this.getAuraStacks(auras.COLD_HEART) > 8)) {
            return true;
          }
          if (me.hasAura(auras.KILLING_MACHINE) && 
              (!me.mainHand2H && this.getAuraStacks(auras.COLD_HEART) > 8 || 
               me.mainHand2H && this.getAuraStacks(auras.COLD_HEART) > 10)) {
            return true;
          }
        }
        return false;
      }),
      
      // actions.cold_heart+=/chains_of_ice,if=!talent.obliteration&buff.pillar_of_frost.up&buff.cold_heart.stack>=10&(buff.pillar_of_frost.remains<gcd*(1+(talent.frostwyrms_fury&cooldown.frostwyrms_fury.ready))|buff.unholy_strength.up&buff.unholy_strength.remains<gcd)
      Spell.cast("Chains of Ice", () => 
        !this.hasTalent("Obliteration") && 
        me.hasAura(auras.PILLAR_OF_FROST) && 
        this.getAuraStacks(auras.COLD_HEART) >= 10 && 
        (this.getAuraRemainingTime(auras.PILLAR_OF_FROST) < 1.5 * 
        (1 + (this.hasTalent("Frostwyrm's Fury") && 
        Spell.getCooldown("Frostwyrm's Fury").ready ? 1 : 0)) || 
        me.hasAura(auras.UNHOLY_STRENGTH) && 
        this.getAuraRemainingTime(auras.UNHOLY_STRENGTH) < 1.5)
      ),
      
      // actions.cold_heart+=/chains_of_ice,if=!talent.obliteration&death_knight.runeforge.fallen_crusader&!buff.pillar_of_frost.up&cooldown.pillar_of_frost.remains>15&(buff.cold_heart.stack>=10&buff.unholy_strength.up|buff.cold_heart.stack>=13)
      Spell.cast("Chains of Ice", () => 
        !this.hasTalent("Obliteration") && 
        this.hasRuneforgeFallenCrusader() && 
        !me.hasAura(auras.PILLAR_OF_FROST) && 
        Spell.getCooldown("Pillar of Frost").timeleft > 15 && 
        (this.getAuraStacks(auras.COLD_HEART) >= 10 && 
        me.hasAura(auras.UNHOLY_STRENGTH) || 
        this.getAuraStacks(auras.COLD_HEART) >= 13)
      ),
      
      // actions.cold_heart+=/chains_of_ice,if=!talent.obliteration&!death_knight.runeforge.fallen_crusader&buff.cold_heart.stack>=10&!buff.pillar_of_frost.up&cooldown.pillar_of_frost.remains>20
      Spell.cast("Chains of Ice", () => 
        !this.hasTalent("Obliteration") && 
        !this.hasRuneforgeFallenCrusader() && 
        this.getAuraStacks(auras.COLD_HEART) >= 10 && 
        !me.hasAura(auras.PILLAR_OF_FROST) && 
        Spell.getCooldown("Pillar of Frost").timeleft > 20
      ),
      
      // actions.cold_heart+=/chains_of_ice,if=talent.obliteration&!buff.pillar_of_frost.up&(buff.cold_heart.stack>=14&buff.unholy_strength.up|buff.cold_heart.stack>=19|cooldown.pillar_of_frost.remains<3&buff.cold_heart.stack>=14)
      Spell.cast("Chains of Ice", () => 
        this.hasTalent("Obliteration") && 
        !me.hasAura(auras.PILLAR_OF_FROST) && 
        (this.getAuraStacks(auras.COLD_HEART) >= 14 && 
        me.hasAura(auras.UNHOLY_STRENGTH) || 
        this.getAuraStacks(auras.COLD_HEART) >= 19 || 
        Spell.getCooldown("Pillar of Frost").timeleft < 3 && 
        this.getAuraStacks(auras.COLD_HEART) >= 14)
      )
    );
  }

  /**
   * Breath of Sindragosa rotation
   * @returns {bt.Composite} Action list for Breath of Sindragosa
   */
  breathActions() {
    return new bt.Selector(
      // actions.breath+=/obliterate,cycle_targets=1,if=buff.killing_machine.stack=2
      Spell.cast("Obliterate", () => 
        me.hasAura(auras.KILLING_MACHINE) && 
        this.getAuraStacks(auras.KILLING_MACHINE) === 2
      ),
      
      // actions.breath+=/soul_reaper,if=fight_remains>5&target.time_to_pct_35<5&target.time_to_die>5&runic_power>50
      Spell.cast("Soul Reaper", () => {
        const target = this.getCurrentTarget();
        return target.timeToDeath() > 5 && 
               target.timeToDeath() > 5 && 
               me.runicPower > 50;
      }),
      
      // actions.breath+=/howling_blast,if=(variable.rime_buffs|!buff.killing_machine.up&buff.pillar_of_frost.up&talent.obliteration&!buff.bonegrinder_frost.up)&runic_power>(variable.breath_rime_rp_threshold-(talent.rage_of_the_frozen_champion*6))|!dot.frost_fever.ticking
      Spell.cast("Howling Blast", () => {
        const target = this.getCurrentTarget();
        return (this.getVariable("rime_buffs") || 
               !me.hasAura(auras.KILLING_MACHINE) && 
               me.hasAura(auras.PILLAR_OF_FROST) && 
               this.hasTalent("Obliteration") && 
               !me.hasAura(auras.BONEGRINDER)) && 
               me.runicPower > (this.getVariable("breath_rime_rp_threshold") - 
               (this.hasTalent("Rage of the Frozen Champion") ? 6 : 0)) || 
               !target.hasAuraByMe(auras.FROST_FEVER);
      }),
      
      // actions.breath+=/horn_of_winter,if=rune<2&runic_power.deficit>30&(!buff.empower_rune_weapon.up|runic_power<variable.breath_rp_cost*2*gcd.max)
      Spell.cast("Horn of Winter", () => 
        me.runes < 2 && me.runicPowerDeficit > 30 && 
        (!me.hasAura(auras.EMPOWER_RUNE_WEAPON) || 
        me.runicPower < this.getVariable("breath_rp_cost") * 2 * 1.5)
      ),
      
      // actions.breath+=/obliterate,cycle_targets=1,if=buff.killing_machine.up|runic_power.deficit>20
      Spell.cast("Obliterate", () => 
        me.hasAura(auras.KILLING_MACHINE) || me.runicPowerDeficit > 20
      ),
      
      // actions.breath+=/soul_reaper,if=fight_remains>5&target.time_to_pct_35<5&target.time_to_die>5&active_enemies=1&rune>2
      Spell.cast("Soul Reaper", () => {
        const target = this.getCurrentTarget();
        return target.timeToDeath() > 5 && 
               target.timeToDeath() > 5 && 
               this.getEnemyCount() === 1 && 
               me.runes > 2;
      }),
      
      // actions.breath+=/remorseless_winter,if=variable.breath_dying
      Spell.cast("Remorseless Winter", () => this.getVariable("breath_dying")),
      
      // actions.breath+=/any_dnd,if=!death_and_decay.ticking&(variable.st_planning&talent.unholy_ground&runic_power.deficit>=10&!talent.obliteration|variable.breath_dying)
      new bt.Action(() => {
        // Death and Decay casting would go here
        return bt.Status.Failure;
      }),
      
      // actions.breath+=/howling_blast,if=variable.breath_dying
      Spell.cast("Howling Blast", () => this.getVariable("breath_dying")),
      
      // actions.breath+=/arcane_torrent,if=runic_power<60
      Spell.cast("Arcane Torrent", () => me.runicPower < 60),
      
      // actions.breath+=/howling_blast,if=buff.rime.up
      Spell.cast("Howling Blast", () => me.hasAura(auras.RIME))
    );
  }

  /**
   * Obliteration rotation
   * @returns {bt.Composite} Action list for Obliteration
   */
  obliterationActions() {
    return new bt.Selector(
      // actions.obliteration+=/obliterate,cycle_targets=1,if=buff.killing_machine.up&(buff.exterminate.up|fight_remains<gcd*2)
      Spell.cast("Obliterate", () => 
        me.hasAura(auras.KILLING_MACHINE) && 
        (me.hasAura(auras.EXTERMINATE) || 
        this.getCurrentTarget().timeToDeath() < 1.5 * 2)
      ),
      
      // actions.obliteration+=/howling_blast,if=buff.killing_machine.stack<2&buff.pillar_of_frost.remains<gcd&variable.rime_buffs
      Spell.cast("Howling Blast", () => 
        this.getAuraStacks(auras.KILLING_MACHINE) < 2 && 
        this.getAuraRemainingTime(auras.PILLAR_OF_FROST) < 1.5 && 
        this.getVariable("rime_buffs")
      ),
      
      // actions.obliteration+=/glacial_advance,if=buff.killing_machine.stack<2&buff.pillar_of_frost.remains<gcd&!buff.death_and_decay.up&variable.ga_priority
      Spell.cast("Glacial Advance", () => 
        this.getAuraStacks(auras.KILLING_MACHINE) < 2 && 
        this.getAuraRemainingTime(auras.PILLAR_OF_FROST) < 1.5 && 
        !me.hasAura(auras.DEATH_AND_DECAY) && 
        this.getVariable("ga_priority")
      ),
      
      // actions.obliteration+=/frost_strike,cycle_targets=1,if=buff.killing_machine.stack<2&buff.pillar_of_frost.remains<gcd&!buff.death_and_decay.up
      Spell.cast("Frost Strike", () => 
        this.getAuraStacks(auras.KILLING_MACHINE) < 2 && 
        this.getAuraRemainingTime(auras.PILLAR_OF_FROST) < 1.5 && 
        !me.hasAura(auras.DEATH_AND_DECAY)
      ),
      
      // actions.obliteration+=/frost_strike,cycle_targets=1,if=debuff.razorice.stack=5&talent.shattering_blade&talent.a_feast_of_souls&buff.a_feast_of_souls.up
      Spell.cast("Frost Strike", () => {
        const target = this.getCurrentTarget();
        return this.getDebuffStacks("Razorice") === 5 && 
               this.hasTalent("Shattering Blade") && 
               this.hasTalent("A Feast of Souls") && 
               me.hasAura(auras.A_FEAST_OF_SOULS);
      }),
      
      // actions.obliteration+=/soul_reaper,if=fight_remains>5&target.time_to_pct_35<5&target.time_to_die>5&active_enemies=1&rune>2&!buff.killing_machine.up
      Spell.cast("Soul Reaper", () => {
        const target = this.getCurrentTarget();
        return target.timeToDeath() > 5 && 
               target.timeToDeath() > 5 && 
               this.getEnemyCount() === 1 && 
               me.runes > 2 && 
               !me.hasAura(auras.KILLING_MACHINE);
      }),
      
      // actions.obliteration+=/obliterate,cycle_targets=1,if=buff.killing_machine.up
      Spell.cast("Obliterate", () => me.hasAura(auras.KILLING_MACHINE)),
      
      // actions.obliteration+=/soul_reaper,if=fight_remains>5&target.time_to_pct_35<5&target.time_to_die>5&rune>2
      Spell.cast("Soul Reaper", () => {
        const target = this.getCurrentTarget();
        return target.timeToDeath() > 5 && 
               target.timeToDeath() > 5 && 
               me.runes > 2;
      }),
      
      // actions.obliteration+=/howling_blast,cycle_targets=1,if=!buff.killing_machine.up&(!dot.frost_fever.ticking)
      Spell.cast("Howling Blast", () => {
        const target = this.getCurrentTarget();
        return !me.hasAura(auras.KILLING_MACHINE) && 
               !target.hasAuraByMe(auras.FROST_FEVER);
      }),
      
      // actions.obliteration+=/glacial_advance,cycle_targets=1,if=(variable.ga_priority|debuff.razorice.stack<5)&(!death_knight.runeforge.razorice&(debuff.razorice.stack<5|debuff.razorice.remains<gcd*3)|((variable.rp_buffs|rune<2)&active_enemies>1))
      Spell.cast("Glacial Advance", () => {
        const target = this.getCurrentTarget();
        return (this.getVariable("ga_priority") || 
               this.getDebuffStacks("Razorice") < 5) && 
               (!this.hasRuneforgeRazorice() && 
               (this.getDebuffStacks("Razorice") < 5 || 
               target.getAuraRemainingTime(auras.RAZORICE) < 1.5 * 3) || 
               ((this.getVariable("rp_buffs") || me.runes < 2) && 
               this.getEnemyCount() > 1));
      }),
      
      // actions.obliteration+=/frost_strike,cycle_targets=1,if=(rune<2|variable.rp_buffs|debuff.razorice.stack=5&talent.shattering_blade)&!variable.pooling_runic_power&(!talent.glacial_advance|active_enemies=1|talent.shattered_frost)
      Spell.cast("Frost Strike", () => {
        const target = this.getCurrentTarget();
        return (me.runes < 2 || this.getVariable("rp_buffs") || 
               this.getDebuffStacks("Razorice") === 5 && 
               this.hasTalent("Shattering Blade")) && 
               !this.getVariable("pooling_runic_power") && 
               (!this.hasTalent("Glacial Advance") || 
               this.getEnemyCount() === 1 || this.hasTalent("Shattered Frost"));
      }),
      
      // actions.obliteration+=/howling_blast,if=buff.rime.up
      Spell.cast("Howling Blast", () => me.hasAura(auras.RIME)),
      
      // actions.obliteration+=/frost_strike,cycle_targets=1,if=!variable.pooling_runic_power&(!talent.glacial_advance|active_enemies=1|talent.shattered_frost)
      Spell.cast("Frost Strike", () => 
        !this.getVariable("pooling_runic_power") && 
        (!this.hasTalent("Glacial Advance") || 
        this.getEnemyCount() === 1 || this.hasTalent("Shattered Frost"))
      ),
      
      // actions.obliteration+=/glacial_advance,cycle_targets=1,if=!variable.pooling_runic_power&variable.ga_priority
      Spell.cast("Glacial Advance", () => 
        !this.getVariable("pooling_runic_power") && 
        this.getVariable("ga_priority")
      ),
      
      // actions.obliteration+=/frost_strike,cycle_targets=1,if=!variable.pooling_runic_power
      Spell.cast("Frost Strike", () => !this.getVariable("pooling_runic_power")),
      
      // actions.obliteration+=/horn_of_winter,if=rune<3
      Spell.cast("Horn of Winter", () => me.runes < 3),
      
      // actions.obliteration+=/arcane_torrent,if=rune<1&runic_power<30
      Spell.cast("Arcane Torrent", () => me.runes < 1 && me.runicPower < 30),
      
      // actions.obliteration+=/howling_blast,if=!buff.killing_machine.up
      Spell.cast("Howling Blast", () => !me.hasAura(auras.KILLING_MACHINE))
    );
  }

  /**
   * AoE rotation for 2+ targets
   * @returns {bt.Composite} Action list for AoE
   */
  aoeActions() {
    return new bt.Selector(
      // actions.aoe+=/obliterate,if=buff.killing_machine.up&talent.cleaving_strikes&buff.death_and_decay.up
      Spell.cast("Obliterate", () => 
        me.hasAura(auras.KILLING_MACHINE) && 
        this.hasTalent("Cleaving Strikes") && 
        me.hasAura(auras.DEATH_AND_DECAY)
      ),
      
      // actions.aoe+=/frost_strike,cycle_targets=1,if=!variable.pooling_runic_power&debuff.razorice.stack=5&talent.shattering_blade&(talent.shattered_frost|active_enemies<4)
      Spell.cast("Frost Strike", () => {
        const target = this.getCurrentTarget();
        return !this.getVariable("pooling_runic_power") && 
               this.getDebuffStacks("Razorice") === 5 && 
               this.hasTalent("Shattering Blade") && 
               (this.hasTalent("Shattered Frost") || this.getEnemyCount() < 4);
      }),
      
      // actions.aoe+=/howling_blast,cycle_targets=1,if=!dot.frost_fever.ticking
      Spell.cast("Howling Blast", () => {
        const target = this.getCurrentTarget();
        return !target.hasAuraByMe(auras.FROST_FEVER);
      }),
      
      // actions.aoe+=/howling_blast,if=buff.rime.up
      Spell.cast("Howling Blast", () => me.hasAura(auras.RIME)),
      
      // actions.aoe+=/obliterate,if=buff.killing_machine.stack>0
      Spell.cast("Obliterate", () => me.hasAura(auras.KILLING_MACHINE)),
      
      // actions.aoe+=/glacial_advance,cycle_targets=1,if=!variable.pooling_runic_power&(variable.ga_priority|debuff.razorice.stack<5)
      Spell.cast("Glacial Advance", () => 
        !this.getVariable("pooling_runic_power") && 
        (this.getVariable("ga_priority") || this.getDebuffStacks("Razorice") < 5)
      ),
      
      // actions.aoe+=/frost_strike,cycle_targets=1,if=!variable.pooling_runic_power
      Spell.cast("Frost Strike", () => !this.getVariable("pooling_runic_power")),
      
      // actions.aoe+=/obliterate
      Spell.cast("Obliterate"),
      
      // actions.aoe+=/horn_of_winter,if=rune<2&runic_power.deficit>25&(!talent.breath_of_sindragosa|variable.true_breath_cooldown>cooldown.horn_of_winter.duration-15)
      Spell.cast("Horn of Winter", () => 
        me.runes < 2 && me.runicPowerDeficit > 25 && 
        (!this.hasTalent("Breath of Sindragosa") || 
        this.getVariable("true_breath_cooldown") > 
        Spell.getCooldown("Horn of Winter").duration - 15)
      ),
      
      // actions.aoe+=/arcane_torrent,if=runic_power.deficit>25
      Spell.cast("Arcane Torrent", () => me.runicPowerDeficit > 25)
    );
  }

  /**
   * Single target rotation
   * @returns {bt.Composite} Action list for single target
   */
  singleTargetActions() {
    return new bt.Selector(
      // actions.single_target+=/frost_strike,if=talent.a_feast_of_souls&debuff.razorice.stack=5&talent.shattering_blade&buff.a_feast_of_souls.up
      Spell.cast("Frost Strike", () => {
        const target = this.getCurrentTarget();
        return this.hasTalent("A Feast of Souls") && 
               this.getDebuffStacks("Razorice") === 5 && 
               this.hasTalent("Shattering Blade") && 
               me.hasAura(auras.A_FEAST_OF_SOULS);
      }),
      
      // actions.single_target+=/obliterate,if=buff.killing_machine.stack=2|buff.exterminate.up
      Spell.cast("Obliterate", () => 
        this.getAuraStacks(auras.KILLING_MACHINE) === 2 || 
        me.hasAura(auras.EXTERMINATE)
      ),
      
      // actions.single_target+=/frost_strike,if=(debuff.razorice.stack=5&talent.shattering_blade)|(rune<2&!talent.icebreaker)
      Spell.cast("Frost Strike", () => 
        (this.getDebuffStacks("Razorice") === 5 && 
        this.hasTalent("Shattering Blade")) || 
        (me.runes < 2 && !this.hasTalent("Icebreaker"))
      ),
      
      // actions.single_target+=/soul_reaper,if=fight_remains>5&target.time_to_pct_35<5&target.time_to_die>5&!buff.killing_machine.react
      Spell.cast("Soul Reaper", () => {
        const target = this.getCurrentTarget();
        return target.timeToDeath() > 5 && 
               target.timeToDeath() > 5 && 
               !me.hasAura(auras.KILLING_MACHINE);
      }),
      
      // actions.single_target+=/howling_blast,if=variable.rime_buffs
      Spell.cast("Howling Blast", () => this.getVariable("rime_buffs")),
      
      // actions.single_target+=/obliterate,if=buff.killing_machine.up&!variable.pooling_runes
      Spell.cast("Obliterate", () => 
        me.hasAura(auras.KILLING_MACHINE) && 
        !this.getVariable("pooling_runes")
      ),
      
      // actions.single_target+=/soul_reaper,if=fight_remains>5&target.time_to_pct_35<5&target.time_to_die>5&rune>2
      Spell.cast("Soul Reaper", () => {
        const target = this.getCurrentTarget();
        return target.timeToDeath() > 5 && 
               target.timeToDeath() > 5 && 
               me.runes > 2;
      }),
      
      // actions.single_target+=/frost_strike,if=!variable.pooling_runic_power&(variable.rp_buffs|(!talent.shattering_blade&runic_power.deficit<20))
      Spell.cast("Frost Strike", () => 
        !this.getVariable("pooling_runic_power") && 
        (this.getVariable("rp_buffs") || 
        (!this.hasTalent("Shattering Blade") && me.runicPowerDeficit < 20))
      ),
      
      // actions.single_target+=/howling_blast,if=buff.rime.up
      Spell.cast("Howling Blast", () => me.hasAura(auras.RIME)),
      
      // actions.single_target+=/frost_strike,if=!variable.pooling_runic_power&!(main_hand.2h|talent.shattering_blade)
      Spell.cast("Frost Strike", () => 
        !this.getVariable("pooling_runic_power") && 
        !(me.mainHand2H || this.hasTalent("Shattering Blade"))
      ),
      
      // actions.single_target+=/obliterate,if=!variable.pooling_runes&main_hand.2h
      Spell.cast("Obliterate", () => 
        !this.getVariable("pooling_runes") && me.mainHand2H
      ),
      
      // actions.single_target+=/frost_strike,if=!variable.pooling_runic_power
      Spell.cast("Frost Strike", () => !this.getVariable("pooling_runic_power")),
      
      // actions.single_target+=/obliterate,if=!variable.pooling_runes
      Spell.cast("Obliterate", () => !this.getVariable("pooling_runes")),
      
      // actions.single_target+=/howling_blast,if=!dot.frost_fever.ticking
      Spell.cast("Howling Blast", () => {
        const target = this.getCurrentTarget();
        return !target.hasAuraByMe(auras.FROST_FEVER);
      }),
      
      // actions.single_target+=/horn_of_winter,if=rune<2&runic_power.deficit>25&(!talent.breath_of_sindragosa|variable.true_breath_cooldown>cooldown.horn_of_winter.duration-15)
      Spell.cast("Horn of Winter", () => 
        me.runes < 2 && me.runicPowerDeficit > 25 && 
        (!this.hasTalent("Breath of Sindragosa") || 
        this.getVariable("true_breath_cooldown") > 
        Spell.getCooldown("Horn of Winter").duration - 15)
      ),
      
      // actions.single_target+=/arcane_torrent,if=!talent.breath_of_sindragosa&runic_power.deficit>20
      Spell.cast("Arcane Torrent", () => 
        !this.hasTalent("Breath of Sindragosa") && me.runicPowerDeficit > 20
      )
    );
  }
}