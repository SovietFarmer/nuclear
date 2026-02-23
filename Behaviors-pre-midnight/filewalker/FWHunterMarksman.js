import { Behavior, BehaviorContext } from "@/Core/Behavior";
import * as bt from '@/Core/BehaviorTree';
import Specialization from '@/Enums/Specialization';
import Common from '@/Core/Common';
import Spell from "@/Core/Spell";
import { me } from "@/Core/ObjectManager";
import { PowerType } from "@/Enums/PowerType";
import { defaultCombatTargeting as combat } from "@/Targeting/CombatTargeting";
import Pet from "@/Core/Pet";

/**
 * SIMC APL implementation for Marksmanship Hunter
 * Based on TWW2_Hunter_Marksmanship_DarkRanger profile
 */
export class HunterMarksmanshipBehavior extends Behavior {
  context = BehaviorContext.Any;
  specialization = Specialization.Hunter.Marksmanship;
  name = "FW Hunter Marksmanship";
  version = 1;

  /**
   * Settings for HunterMarksmanshipBehavior
   */
  static settings = [
    {
      header: "General Settings",
      options: [
        {
          uid: "AoeThreshold",
          text: "AoE Threshold",
          type: "slider",
          default: 3
        }
      ]
    }
  ];

  build() {
    return new bt.Selector(
      Common.waitForCastOrChannel(),
      Common.waitForNotMounted(),
      this.opener(),
      new bt.Action(() => {
        if (this.getCurrentTarget() === null) {
          return bt.Status.Success;
        }
        return bt.Status.Failure;
      }),
      Pet.attack(() => this.getCurrentTarget()),
      new bt.Selector(
        this.cdsActionList(),
        this.trinketsActionList(),
        new bt.Decorator(
          () => this.getEnemyCount() < 3 || !this.hasTalent("Trick Shots"),
          this.stActionList(),
          new bt.Action(() => bt.Status.Success)
        ),
        new bt.Decorator(
          () => this.getEnemyCount() > 2,
          this.trickshotsActionList(),
          new bt.Action(() => bt.Status.Success)
        )
      )
    );
  }

  /**
   * Precombat actions
   */
  opener() {
    return new bt.Selector(
      // Precombat actions for single target or two targets without Volley
      new bt.Decorator(
        () => !me.inCombat() && (this.getEnemyCount() === 1 || (this.getEnemyCount() === 2 && !this.hasTalent(260243))),
        Spell.cast(19434, () => this.getCurrentTarget()), // Aimed Shot
        new bt.Action(() => bt.Status.Success)
      ),
      // Precombat actions for other scenarios
      new bt.Decorator(
        () => !me.inCombat(),
        Spell.cast(56641, () => this.getCurrentTarget()), // Steady Shot
        new bt.Action(() => bt.Status.Success)
      )
    );
  }

  /**
   * Cooldowns action list
   */
  cdsActionList() {
    return new bt.Selector(
      // Invoke external buff (Power Infusion) when Trueshot is up
      new bt.Action(() => {
        // This is a placeholder for Power Infusion external buff
        if (me.hasAura(288613) && me.getAura(288613).remaining > 1200 || this.getFightRemainsEstimate() < 1300) {
          // In a real environment, this would be handled by coordination
          return bt.Status.Failure; // Continue to next action
        }
        return bt.Status.Failure;
      }),
      // Berserking
      Spell.cast("Berserking", () => me.hasAura(288613) || this.getFightRemainsEstimate() < 13), // Trueshot
      // Blood Fury
      Spell.cast("Blood Fury", () => me.hasAura(288613) || Spell.getCooldown(288613).timeleft > 30 || this.getFightRemainsEstimate() < 16), // Trueshot
      // Ancestral Call
      Spell.cast("Ancestral Call", () => me.hasAura(288613) || Spell.getCooldown(288613).timeleft > 30 || this.getFightRemainsEstimate() < 16), // Trueshot
      // Fireblood
      Spell.cast("Fireblood", () => me.hasAura(288613) || Spell.getCooldown(288613).timeleft > 30 || this.getFightRemainsEstimate() < 9), // Trueshot
      // Light's Judgment
      Spell.cast("Lights Judgment", () => !me.hasAura(288613)) // Trueshot
      // Potion is not implemented as it's a consumable
    );
  }

  /**
   * Single-target action list
   */
  stActionList() {
    return new bt.Selector(
      // Volley if not Double Tap
      Spell.cast(260243, () => !this.hasTalent("Double Tap")), // Volley
      
      // Rapid Fire with Sentinel or Bulletstorm conditions
      Spell.cast(257044, () => this.getCurrentTarget(), () => 
        (this.hasSentinelTalent() && me.hasAura("Lunar Storm Ready")) || 
        (this.hasTalent("Bulletstorm") && !me.hasAura("Bulletstorm"))),
      
      // Trueshot when ready
      Spell.cast(288613, () => this.isTrueshotReady()), // Trueshot
      
      // Volley with Double Tap conditions
      Spell.cast(260243, () => this.hasTalent("Double Tap") && !me.hasAura("Double Tap")), // Volley
      
      // Black Arrow with Headshot/Razor Fragments conditions
      Spell.cast(259391, () => this.getCurrentTarget(), () => 
        (this.hasTalent("Headshot") && me.hasAura(260242)) || // Precise Shots
        (!this.hasTalent("Headshot") && me.hasAura("Razor Fragments"))), // Black Arrow
      
      // Kill Shot with same conditions
      Spell.cast(53351, () => this.getCurrentTarget(), () => 
        (this.hasTalent("Headshot") && me.hasAura(260242)) || // Precise Shots
        (!this.hasTalent("Headshot") && me.hasAura("Razor Fragments"))), // Kill Shot
      
      // Arcane Shot with Precise Shots
      Spell.cast(185358, () => this.getCurrentTarget(), () => 
        me.hasAura(260242) &&  // Precise Shots
        (!this.getCurrentTarget().hasAuraByMe("Spotters Mark") || !me.hasAura("Moving Target"))), // Arcane Shot
      
      // Rapid Fire without Sentinel or with Lunar Storm conditions
      Spell.cast(257044, () => this.getCurrentTarget(), () => 
        !this.hasSentinelTalent() || 
        me.getAura("Lunar Storm Cooldown").remaining > Spell.getCooldown(257044).timeleft / 3), // Rapid Fire
      
      // Explosive Shot with Precision Detonation conditions
      Spell.cast(212431, () => this.getCurrentTarget(), () => 
        this.hasTalent("Precision Detonation") && 
        this.hasSetBonus4pc() && 
        !me.hasAura(260242) && // Precise Shots
        me.hasAura(194595)), // Lock and Load
      
      // Aimed Shot
      Spell.cast(19434, () => this.getCurrentTarget(), () => 
        !me.hasAura(260242) || // Precise Shots
        (this.getCurrentTarget().hasAuraByMe("Spotters Mark") && me.hasAura("Moving Target"))),
      
      // Explosive Shot without 4pc set bonus
      Spell.cast(212431, () => this.getCurrentTarget(), () => !this.hasSetBonus4pc()),
      
      // Black Arrow without Headshot
      Spell.cast(259391, () => this.getCurrentTarget(), () => !this.hasTalent("Headshot")), // Black Arrow
      
      // Steady Shot as filler
      Spell.cast(56641, () => this.getCurrentTarget()) // Steady Shot
    );
  }

  /**
   * Multi-target/AoE (Trickshots) action list
   */
  trickshotsActionList() {
    return new bt.Selector(
      // Volley without Double Tap
      Spell.cast(260243, () => !this.hasTalent("Double Tap")), // Volley
      
      // Trueshot when ready
      Spell.cast(288613, () => this.isTrueshotReady()), // Trueshot
      
      // Multishot with Precise Shots or for Trick Shots
      Spell.cast(2643, () => this.getCurrentTarget(), () => 
        (me.hasAura(260242) && // Precise Shots
        (!this.getCurrentTarget().hasAuraByMe("Spotters Mark") || !me.hasAura("Moving Target"))) ||
        !me.hasAura(257621)), // Trick Shots
      
      // Volley with Double Tap
      Spell.cast(260243, () => this.hasTalent("Double Tap") && !me.hasAura("Double Tap")), // Volley
      
      // Black Arrow with Withering Fire
      Spell.cast(259391, () => this.getCurrentTarget(), () => 
        me.hasAura("Withering Fire") && me.hasAura(257621)), // Trick Shots
      
      // Rapid Fire with Trick Shots
      Spell.cast(257044, () => this.getCurrentTarget(), () => 
        me.getAura(257621).remaining > Spell.getSpell(257044).castTime && // Trick Shots, Rapid Fire
        (!this.hasSentinelTalent() || 
         me.getAura("Lunar Storm Cooldown").remaining > Spell.getCooldown(257044).timeleft / 3 ||
         me.hasAura("Lunar Storm Ready"))),
      
      // Explosive Shot with Precision Detonation
      Spell.cast(212431, () => this.getCurrentTarget(), () => 
        this.hasTalent("Precision Detonation") && 
        (me.hasAura(194595) || !this.hasSetBonus4pc()) && // Lock and Load
        (!me.hasAura(260242) || // Precise Shots
         (this.getCurrentTarget().hasAuraByMe("Spotters Mark") && me.hasAura("Moving Target")))),
      
      // Aimed Shot with Trick Shots
      Spell.cast(19434, () => this.getCurrentTarget(), () => 
        (!me.hasAura(260242) || // Precise Shots
         (this.getCurrentTarget().hasAuraByMe("Spotters Mark") && me.hasAura("Moving Target"))) &&
        me.hasAura(257621)), // Trick Shots
      
      // Explosive Shot
      Spell.cast(212431, () => this.getCurrentTarget()), // Explosive Shot
      
      // Black Arrow
      Spell.cast(259391, () => this.getCurrentTarget()), // Black Arrow
      
      // Steady Shot
      Spell.cast(56641, () => this.getCurrentTarget(), () => 
        me.powerByType(PowerType.Focus) + Spell.getSpell(56641).getFocusRegen() < me.maxPowerByType(PowerType.Focus)), // Steady Shot
      
      // Multishot
      Spell.cast(2643, () => this.getCurrentTarget()) // Multishot
    );
  }

  /**
   * Trinkets action list
   */
  trinketsActionList() {
    if(!me.hasAura(288613))
    {
      return new bt.Selector(
      // Return Blank Selector if no Trueshot Aura is detected
      );
    }
    else
    {
      return new bt.Selector(
        // Variable definitions for trinket logic would go here in the SIMC APL
        // For simplicity, we'll implement a basic trinket usage strategy
        
        Common.useEquippedItemByName("Signet of the Priory"), // Use with Trueshot
        
        // Common.useEquippedItemByName("Trinket2", () => me.hasAura(288613))  // Use with Trueshot
      );
    }
    
  }

  /**
   * Helper method to check if Trueshot is ready to use according to SIMC conditions
   */
  isTrueshotReady() {
    // Simplified from the complex SIMC variable
    return Spell.getCooldown(288613).ready && // Trueshot
           (!this.hasTalent("Bullseye") || 
            this.getFightRemainsEstimate() > Spell.getCooldown(288613).duration + me.getAura(288613).remaining / 2 || 
            (me.hasAura("Bullseye") && me.getAuraStacks("Bullseye") === this.getMaxBullseyeStacks()) ||
            this.getFightRemainsEstimate() < 25);
  }

  /**
   * Get the current target for abilities
   */
  getCurrentTarget() {
    const target = me.target;
    if (target && !target.deadOrGhost && me.canAttack(target)) {
      return target;
    }
    return combat.bestTarget;
  }

  /**
   * Get the number of enemies in combat range
   */
  getEnemyCount() {
    return combat.targets.filter(unit => unit.distanceTo(me) <= 40).length;
  }

  /**
   * Estimate time remaining in the current fight
   */
  getFightRemainsEstimate() {
    // In a real scenario, this would use more sophisticated logic
    const target = this.getCurrentTarget();
    if (target) {
      const ttd = target.timeToDeath();
      if (ttd !== undefined) {
        return ttd;
      }
    }
    return 100; // Default to 100 seconds
  }

  /**
   * Check if the player has a specific talent
   */
  hasTalent(talentIdOrName) {
    if (typeof talentIdOrName === 'number') {
      return Spell.isSpellKnown(talentIdOrName);
    }
    return Spell.isSpellKnown(talentIdOrName);
  }

  /**
   * Check if player has the 4-piece set bonus
   */
  hasSetBonus4pc() {
    return me.hasAura("Set Bonus: The War Within Season 2 4pc");
  }

  /**
   * Check if player has max stacks of Bullseye
   */
  getMaxBullseyeStacks() {
    return 8; // Default max stacks, could be adjusted based on talents
  }

  /**
   * Check for Sentinel hero talent
   */
  hasSentinelTalent() {
    return me.hasAura("Sentinel"); // Top talent in Sentinel hero tree
  }

  /**
   * Check for Dark Ranger hero talent
   */
  hasDarkRangerTalent() {
    return me.hasAura("Black Arrow"); // Top talent in Dark Ranger hero tree
  }
}