import { Behavior, BehaviorContext } from "@/Core/Behavior";
import * as bt from '@/Core/BehaviorTree';
import spell from "@/Core/Spell";
import { me } from "@/Core/ObjectManager";
import { defaultCombatTargeting as Combat } from "@/Targeting/CombatTargeting";
import Specialization from "@/Enums/Specialization";
import common from "@/Core/Common";
import Settings from "@/Core/Settings";
import { PowerType } from "@/Enums/PowerType";
import { pvpHelpers } from "@/Data/PVPData";
import drTracker from "@/Core/DRTracker";
import { RaceType } from "@/Enums/UnitEnums";
import { DispelPriority } from "@/Data/Dispels";
import { WoWDispelType } from "@/Enums/Auras";

const auras = {
  moonkinForm: 24858,
  solarEclipse: 48517,
  lunarEclipse: 48518,
  incarnationChosenOfElune: 102560,
  furyOfElune: 202770,
  sunfire: 164815,
  moonfire: 164812,
  bearForm: 5487,
  catForm: 768,
  prowl: 5215,
  barkskin: 22812,
  renewal: 108238,
  tigerDash: 252216,
  dash: 1850,
  stampedingRoar: 106898,
  entanglingRoots: 339,
  massEntanglement: 102359,
  cyclone: 33786,
  solarBeam: 78675,
  hibernate: 2637,
  removeCorruption: 2782,
  soothe: 2908,
  regrowth: 8936,
  forceOfNature: 205636,
  frenziedRegeneration: 22842,
  faerieSwarm: 209749,
  highWinds: 200931,
  heartOfTheWild: 319454,
};

export class DruidBalancePvP extends Behavior {
  name = "Druid (Balance) PvP";
  context = BehaviorContext.Any;
  specialization = Specialization.Druid.Balance;

  static settings = [
    {
      header: "Defensive Settings",
      options: [
        { type: "slider", uid: "BarkskinHealth", text: "Barkskin health threshold (%)", min: 30, max: 80, default: 60 },
        { type: "slider", uid: "BearFormHealth", text: "Bear Form health threshold (%)", min: 20, max: 60, default: 35 },
        { type: "slider", uid: "RenewalHealth", text: "Renewal health threshold (%)", min: 20, max: 60, default: 40 },
        { type: "checkbox", uid: "UseDefensiveCooldowns", text: "Use defensive cooldowns", default: true }
      ]
    },
    {
      header: "Crowd Control Settings",
      options: [
        { type: "checkbox", uid: "UseCyclone", text: "Use Cyclone on enemy healers", default: true },
        { type: "checkbox", uid: "UseMassEntanglement", text: "Use Mass Entanglement + Solar Beam combo", default: true },
        { type: "slider", uid: "CycloneMaxDR", text: "Max Cyclone DR stacks", min: 0, max: 2, default: 1 }
      ]
    },
    {
      header: "DPS Targeting Settings",
      options: [
        { type: "checkbox", uid: "UseCycloneOnDPS", text: "Cyclone DPS with major cooldowns (when no healers available)", default: true },
        { type: "slider", uid: "DPSCycloneMinCooldownDuration", text: "Minimum DPS cooldown duration (seconds)", min: 2, max: 10, default: 3 },
        { type: "checkbox", uid: "PrioritizeFaerieSwarmOnDPS", text: "Prioritize Faerie Swarm disarm on DPS with cooldowns", default: true }
      ]
    }
  ];

  build() {
    return new bt.Selector(
      common.waitForNotWaitingForArenaToStart(),
      common.waitForNotSitting(),
      common.waitForNotMounted(),
      common.waitForCastOrChannel(),

      // Form management - can go directly from Bear to Moonkin
      new bt.Selector(
        // If in Bear Form and not in emergency situation, switch to Moonkin
        new bt.Decorator(
          ret => me.hasAura(auras.bearForm) &&
                 me.effectiveHealthPercent > 70 &&
                 (me.timeToDeath() === undefined || me.timeToDeath() > 5),
          spell.cast("Moonkin Form")
        ),
        // If not in any form (and not prowling), go to Moonkin
        new bt.Decorator(
          req => !me.hasAura(auras.moonkinForm) && !me.hasAura(auras.bearForm) && !me.hasAura(auras.prowl),
          spell.cast("Moonkin Form")
        )
      ),

      new bt.Decorator(
        ret => !spell.isGlobalCooldown(),
        new bt.Selector(
          // Skip all combat actions if prowl is active
          new bt.Decorator(
            ret => me.hasAura(auras.prowl),
            new bt.Action(() => bt.Status.Success)
          ),

          // Defensive cooldowns
          this.defensiveCooldowns(),

          // Emergency healing
          spell.cast("Regrowth", on => this.findRegrowthTarget(), ret =>
            this.findRegrowthTarget() !== undefined
          ),

          // Dispels
          spell.dispel("Remove Corruption", true, DispelPriority.Medium, true, WoWDispelType.Curse, WoWDispelType.Poison),

          // Stop casting and allow running away when in bear form and low health or low time to death
          new bt.Decorator(
            ret => me.hasAura(auras.bearForm) &&
                   (me.effectiveHealthPercent < 70 ||
                    (me.timeToDeath() !== undefined && me.timeToDeath() < 3)),
            new bt.Action(() => bt.Status.Success)
          ),

          // Spells that require target and/or facing
          common.waitForTarget(),

          // Faerie Swarm disarm on melee targets
          spell.cast("Faerie Swarm", on => this.findFaerieSwarmTarget(), ret =>
            this.findFaerieSwarmTarget() !== undefined
          ),

          // Cyclone enemy healers
          spell.cast("Cyclone", on => this.cycloneTarget(), ret =>
            this.cycloneTarget() !== undefined
          ),

          // War Stomp for emergency CC when surrounded and low health
          spell.cast("War Stomp", ret => this.shouldUseWarStomp()),

          common.waitForFacing(),

          // Burst damage when conditions are met
          new bt.Decorator(
            ret => Combat.burstToggle && me.target && me.inCombat(),
            this.burstDamage()
          ),

          // Sustained damage rotation
          this.sustainedDamage()
        )
      )
    );
  }

  defensiveCooldowns() {
    return new bt.Selector(
      // Renewal for emergency healing
      spell.cast("Renewal", on => me, () =>
        Settings.UseDefensiveCooldowns &&
        me.effectiveHealthPercent <= Settings.RenewalHealth &&
        !spell.isOnCooldown("Renewal")
      ),

      // Bear Form for emergency defense
      spell.cast("Bear Form", () =>
        Settings.UseDefensiveCooldowns &&
        (me.effectiveHealthPercent <= Settings.BearFormHealth ||
         (me.timeToDeath() !== undefined && me.timeToDeath() < 4)) &&
        !me.hasAura(auras.bearForm)
      ),

      // Barkskin (can be used while stunned)
      spell.cast("Barkskin", on => me, () =>
        Settings.UseDefensiveCooldowns &&
        me.effectiveHealthPercent <= Settings.BarkskinHealth
      ),

      // Frenzied Regeneration when in Bear Form
      spell.cast("Frenzied Regeneration", () =>
        me.hasAura(auras.bearForm) &&
        me.effectiveHealthPercent < 80
      ),

      // Heart of the Wild when in Bear Form and below 50% HP
      spell.cast("Heart of the Wild", () =>
        me.hasAura(auras.bearForm) &&
        me.effectiveHealthPercent < 50 &&
        !spell.isOnCooldown("Heart of the Wild")
      )
    );
  }

  // Burst Damage Rotation
  burstDamage() {
    return new bt.Selector(
      // Mass Entanglement + Solar Beam combo sequence on same target
      new bt.Sequence(
        // Setup target for the combo
        new bt.Action(() => {
          const target = this.findMassEntanglementComboTarget();
          if (target) {
            this.comboTarget = target;
            return bt.Status.Success;
          }
          return bt.Status.Failure;
        }),
        spell.cast("Mass Entanglement", on => this.comboTarget),
        spell.cast("Solar Beam", on => this.comboTarget)
      ),

      // Major cooldowns
      spell.cast("Incarnation: Chosen of Elune", () =>
        !me.hasAura(auras.incarnationChosenOfElune)
      ),

      // Force of Nature for damage boost (use during incarn or if incarn CD > 1min)
      spell.cast("Force of Nature", on => me.target, () => this.shouldUseForceOfNature()),

      // Fury of Elune during incarnation
      spell.cast("Fury of Elune", () =>
        me.hasAura(auras.incarnationChosenOfElune)
      ),

      // Maintain DOTs on all targets for astral power generation
      this.maintainDots(),

      // Starsurge priority during incarnation
      spell.cast("Starsurge", on => me.target, () =>
        this.getAstralPower() >= 40
      ),

      // Dispels
      spell.dispel("Remove Corruption", true, DispelPriority.Low, true, WoWDispelType.Curse, WoWDispelType.Poison),

      // Generate Astral Power - prioritize Wrath
      spell.cast("Wrath", on => me.target)
    );
  }

  // Sustained Damage Rotation
  sustainedDamage() {
    return new bt.Selector(
      // Maintain DOTs on all targets for astral power generation
      this.maintainDots(),

      // Use Starfall to extend DOT duration by 3 seconds
      spell.cast("Starfall", on => me.target, () =>
        this.getAstralPower() >= 50
      ),

      // Use Fury of Elune off cooldown
      spell.cast("Fury of Elune", () => true),

      // Use Force of Nature for damage and astral power (use during incarn or if incarn CD > 1min)
      spell.cast("Force of Nature", on => me.target, () => this.shouldUseForceOfNature()),

      // Use Starsurge when we have enough Astral Power
      spell.cast("Starsurge", on => me.target, () =>
        this.getAstralPower() >= 40
      ),

      // Dispels
      spell.dispel("Remove Corruption", true, DispelPriority.Low, true, WoWDispelType.Curse, WoWDispelType.Poison),

      // Default filler - prioritize Wrath over Starfire
      spell.cast("Wrath", on => me.target),

      // Starfire as last resort only
      spell.cast("Starfire", on => me.target)
    );
  }

  maintainDots() {
    return new bt.Selector(
      // Moonfire on all targets for astral power generation
      spell.cast("Moonfire", on => this.findMoonfireTarget(), ret =>
        this.findMoonfireTarget() !== undefined
      ),

      // Sunfire on kill target (spreads to nearby enemies within 8 yards)
      spell.cast("Sunfire", on => me.target, () =>
        me.target && (!me.target.hasAuraByMe(auras.sunfire) ||
        this.getDebuffRemainingTime(me.target, auras.sunfire) < 5000)
      )
    );
  }

  // Helper methods
  getAstralPower() {
    return me.powerByType(PowerType.LunarPower);
  }

  getDebuffRemainingTime(target, auraId) {
    if (!target) return 0;
    const debuff = target.getAuraByMe(auraId);
    return debuff ? debuff.remaining : 0;
  }

  // Helper method to check if Force of Nature should be used
  shouldUseForceOfNature() {
    return me.hasAura(auras.incarnationChosenOfElune) || spell.getCooldown("Incarnation: Chosen of Elune")?.timeleft >= 39000;
  }

  // Targeting methods
  cycloneTarget() {
    if (!Settings.UseCyclone) return undefined;

    // Check if any enemy player currently has our Cyclone - if so, don't cast another to avoid wasting DRs
    const allEnemies = me.getPlayerEnemies(40); // Check wider range for existing cyclones
    for (const enemy of allEnemies) {
      if (enemy.hasAuraByMe(auras.cyclone)) {
        return undefined; // Someone already has our Cyclone, don't cast another
      }
    }

    // Check for High Winds aura to determine cyclone range
    const cycloneRange = me.hasAura(auras.highWinds) ? 30 : 25; // 25 + 5 if High Winds, else 25
    const nearbyEnemies = me.getPlayerEnemies(cycloneRange);

    // Determine max DR based on current target's health
    const maxDR = (me.target && me.target.effectiveHealthPercent < 35) ? Settings.CycloneMaxDR + 1 : Settings.CycloneMaxDR;

    // Priority 1: Target healers (existing logic)
    for (const unit of nearbyEnemies) {
      if (unit.isHealer() &&
          !unit.isCCd() &&
          unit.canCC() &&
          unit.getDR("disorient") <= maxDR &&
          unit !== me.target &&
          !pvpHelpers.hasImmunity(unit)) { // Added immunity check
        console.info(`[Druid] Cyclone target found: Healer ${unit.unsafeName}`);
        return unit;
      }
    }

    // Priority 2: Target DPS with major cooldowns (including current target)
    if (Settings.UseCycloneOnDPS) {
      for (const unit of nearbyEnemies) {
        if (!unit.isHealer() && // DPS players
            !unit.isCCd() &&
            unit.canCC() &&
            unit.getDR("disorient") <= 1 && // Only 0 DR for DPS            !pvpHelpers.hasImmunity(unit) &&
            this.hasMajorOffensiveCooldown(unit)) {
          console.info(`[Druid] Cyclone target found: DPS ${unit.unsafeName} with major cooldown${unit === me.target ? ' (current target)' : ''}`);
          return unit;
        }
      }
    }

    return undefined;
  }

  findMassEntanglementComboTarget() {
    if (spell.isOnCooldown("Mass Entanglement") || spell.isOnCooldown("Solar Beam")) return undefined;

    const enemies = me.getPlayerEnemies(35);
    for (const enemy of enemies) {
      if (enemy.isHealer() &&
          me.withinLineOfSight(enemy) &&
          !enemy.isCCd() &&
          enemy.canCC() &&
          drTracker.getDRStacks(enemy.guid, "root") === 0 &&
          drTracker.getDRStacks(enemy.guid, "silence") === 0 &&
          !pvpHelpers.hasImmunity(enemy)) {
        return enemy;
      }
    }
    return undefined;
  }

  findRegrowthTarget() {
    // Emergency healing when healer is in trouble
    const friends = me.getPlayerFriends(40);
    for (const friend of friends) {
      if (friend.isHealer() &&
          friend.effectiveHealthPercent < 40 &&
          me.withinLineOfSight(friend)) {
        return friend;
      }
    }
    return undefined;
  }

  findMoonfireTarget() {
    // Prioritize current target if it doesn't have Moonfire
    if (me.target &&
        me.target.isPlayer() &&
        (!me.target.hasAuraByMe(auras.moonfire) ||
         this.getDebuffRemainingTime(me.target, auras.moonfire) < 6000) &&
        !pvpHelpers.hasImmunity(me.target)) {
      return me.target;
    }

    // Find any enemy without Moonfire
    const enemies = me.getPlayerEnemies(40);
    for (const enemy of enemies) {
      if (me.withinLineOfSight(enemy) &&
          (!enemy.hasAuraByMe(auras.moonfire) ||
           this.getDebuffRemainingTime(enemy, auras.moonfire) < 6000) &&
          !pvpHelpers.hasImmunity(enemy)) {
        return enemy;
      }
    }
    return undefined;
  }

  findFaerieSwarmTarget() {
    // Check if Faerie Swarm is known and not on cooldown
    if (!spell.isSpellKnown("Faerie Swarm") || spell.isOnCooldown("Faerie Swarm")) {
      return undefined;
    }

    // Check if someone in my group is below 70% health
    const groupNeedsHelp = this.hasGroupMemberBelowHealth(87);
    if (!groupNeedsHelp) {
      return undefined;
    }

    // Get all enemy players within 30 yards
    const enemies = me.getPlayerEnemies(30);

    // Priority 1: DPS with major cooldowns (if setting enabled)
    if (Settings.PrioritizeFaerieSwarmOnDPS) {
      for (const enemy of enemies) {
        if (enemy.isDisarmableMelee() &&
            !enemy.isHealer() &&
            me.withinLineOfSight(enemy) &&
            enemy.getDR("disarm") === 0 &&
            !pvpHelpers.hasImmunity(enemy) &&
            this.hasMajorOffensiveCooldown(enemy)) {
          console.info(`[Druid] Faerie Swarm priority target: DPS ${enemy.unsafeName} with major cooldown`);
          return enemy;
        }
      }
    }

    // Priority 2: Any disarmable melee (existing logic)
    for (const enemy of enemies) {
      if (enemy.isDisarmableMelee() &&
          me.withinLineOfSight(enemy) &&
          enemy.getDR("disarm") === 0 &&
          !pvpHelpers.hasImmunity(enemy)) {
        return enemy;
      }
    }
    return undefined;
  }

  hasGroupMemberBelowHealth(threshold) {
    // Check if the player themselves is below threshold
    if (me.effectiveHealthPercent < threshold) {
      return true;
    }

    // Check group members
    const friends = me.getPlayerFriends(40);
    for (const friend of friends) {
      if (friend.inMyGroup() &&
          friend.effectiveHealthPercent < threshold) {
        return true;
      }
    }
    return false;
  }

  shouldUseWarStomp() {
    // War Stomp is a Tauren racial ability
    if (me.race !== RaceType.Tauren || spell.isOnCooldown("War Stomp")) {
      return false;
    }

    // Check if my health is below 60%
    if (me.effectiveHealthPercent >= 60) {
      return false;
    }

    // Get all enemy players within melee range (8 yards)
    const nearbyEnemies = me.getPlayerEnemies(8);

    // Count enemies with stun DR <= 1
    let validEnemies = 0;
    for (const enemy of nearbyEnemies) {
      if (enemy.getDR("stun") <= 1 && enemy.canCC() && !pvpHelpers.hasImmunity(enemy)) {
        validEnemies++;
      }
    }

    // Use War Stomp if we have at least 2 valid enemies
    return validEnemies >= 1;
  }

  // Helper methods for DPS targeting
  hasMajorOffensiveCooldown(unit) {
    if (!unit || !unit.auras) return false;

    const majorCooldown = pvpHelpers.hasMajorDamageCooldown(unit, Settings.DPSCycloneMinCooldownDuration);
    if (majorCooldown) {
      console.info(`[Druid] Found DPS ${unit.unsafeName} with major cooldown: ${majorCooldown.name} (${majorCooldown.remainingTime.toFixed(1)}s remaining)`);
      return true;
    }
    return false;
  }

  isDPSPlayer(unit) {
    return unit.isPlayer() && !unit.isHealer();
  }

  isPriorityDPSTarget(unit) {
    return this.isDPSPlayer(unit) &&
           this.hasMajorOffensiveCooldown(unit) &&
           unit.getDR("disorient") === 0 &&
           !pvpHelpers.hasImmunity(unit);
  }

  // Enhanced targeting helper for finding DPS with cooldowns
  findDPSWithCooldowns(range = 40) {
    const enemies = me.getPlayerEnemies(range);
    const dpsWithCooldowns = [];

    for (const enemy of enemies) {
      if (this.isPriorityDPSTarget(enemy) && me.withinLineOfSight(enemy)) {
        dpsWithCooldowns.push(enemy);
      }
    }

    return dpsWithCooldowns;
  }
}

