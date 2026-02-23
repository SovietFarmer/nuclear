import { Behavior, BehaviorContext } from "@/Core/Behavior";
import * as bt from '@/Core/BehaviorTree';
import Specialization from '@/Enums/Specialization';
import common from '@/Core/Common';
import spell from "@/Core/Spell";
import { me } from "@/Core/ObjectManager";
import { defaultHealTargeting as heal } from "@/Targeting/HealTargeting";
import { defaultCombatTargeting as combat } from "@/Targeting/CombatTargeting";
import { DispelPriority } from "@/Data/Dispels";
import { WoWDispelType } from "@/Enums/Auras";
import Settings from "@/Core/Settings";
import spellBlacklist from "@/Data/PVPData";

// Aura IDs for Restoration Shaman abilities
const auras = {
  earthShieldMYAURA: 383648,
  earthShield: 974,
  earthLivingWeapon: 382022,
  waterShield: 52127,
  riptide: 61295,
  tidalWaves: 51564,
  ascendance: 114052,
  spiritLinkTotem: 98008,
  healingTideTotem: 108280,
  naturesSwiftness: 378081,
  unleashLife: 73685,
  flameShock: 188389,
  lavaSurge: 77762,
  highTide: 288675,
  spiritWalkersTidalTotem: 404523,
  ancestralSwiftness: 443454
};

/**
 * Restoration Shaman PvP behavior for The War Within Season 2
 */
export class ShamanRestorationPvP extends Behavior {
  name = "Shaman (Restoration) PvP";
  context = BehaviorContext.Any;
  specialization = Specialization.Shaman.Restoration;

  // Track heal target for the rotation
  healTarget = null;

  // Track last Healing Stream Totem cast time
  lastHealingStreamTotemCast = 0;

  /**
   * Settings for the behavior, aligned with Lua and JS examples
   */
  static settings = [
    {
      header: "Restoration Shaman PvP Configuration",
      options: [
        {
          type: "slider",
          uid: "RiptidePct",
          text: "Riptide Health Threshold (%)",
          default: 80,
          min: 0,
          max: 100,
        },
        {
          type: "slider",
          uid: "HealingSurgePct",
          text: "Healing Surge Health Threshold (%)",
          default: 75,
          min: 0,
          max: 100,
        },
        {
          type: "slider",
          uid: "HealingWavePct",
          text: "Healing Wave Health Threshold (%)",
          default: 78,
          min: 0,
          max: 100,
        },
        {
          type: "slider",
          uid: "HealingTideTotemPct",
          text: "Healing Tide Totem Health Threshold (%)",
          default: 42,
          min: 0,
          max: 100,
        },
        {
          type: "slider",
          uid: "SpiritLinkTotemPct",
          text: "Spirit Link Totem Health Threshold (%)",
          default: 33,
          min: 0,
          max: 100,
        },
        {
          type: "slider",
          uid: "AscendancePct",
          text: "Ascendance Health Threshold (%)",
          default: 38,
          min: 0,
          max: 100,
        },
        {
          type: "slider",
          uid: "EarthenWallTotemPct",
          text: "Earthen Wall Totem Health Threshold (%)",
          default: 65,
          min: 0,
          max: 100,
        },
        {
          type: "slider",
          uid: "HealingRainPct",
          text: "Healing Rain Health Threshold (%)",
          default: 75,
          min: 0,
          max: 100,
        },
        {
          type: "slider",
          uid: "UnleashLifePct",
          text: "Unleash Life Health Threshold (%)",
          default: 65,
          min: 0,
          max: 100,
        },
        {
          type: "slider",
          uid: "NaturesSwiftnessPct",
          text: "Nature's Swiftness Health Threshold (%)",
          default: 55,
          min: 0,
          max: 100,
        },
        {
          type: "checkbox",
          uid: "UsePurge",
          text: "Use Greater Purge",
          default: false,
        },
        {
          type: "slider",
          uid: "AstralShiftPct",
          text: "Astral Shift Health Threshold (%)",
          default: 25,
          min: 0,
          max: 100,
        },
      ],
    },
  ];

  /**
   * Builds the behavior tree for the PvP rotation
   * @returns {bt.Composite} The root node of the behavior tree
   */
  build() {
    return new bt.Decorator(
      ret => !spell.isGlobalCooldown(),
      new bt.Selector(
        common.waitForNotSitting(),
        common.waitForNotMounted(),
        spell.interrupt("Wind Shear", true),
        common.waitForCastOrChannel(),
        new bt.Decorator(
          () => this.shouldStopCasting(),
          new bt.Action(() => {
            me.stopCasting();
            return bt.Status.Success;
          })
        ),
        this.ensureBuffs(),
        common.waitForNotWaitingForArenaToStart(),
        spell.cast("Hex", on => this.hexTarget(), ret => this.hexTarget() !== undefined),
        this.healRotation(),
        common.waitForTarget(),
        common.waitForFacing(),
        this.damageRotation()
      )
    );
  }

  /**
   * Determines if casting should be stopped (e.g., for damage spells when healing is needed)
   */
  shouldStopCasting() {
    if (!me.isCastingOrChanneling) return false;

    const currentCast = me.currentCastOrChannel;
    const remainingCastTime = currentCast.timeleft;

    // If the cast is almost complete (less than 0.5 seconds remaining), let it finish
    if (remainingCastTime < 300) return false;

    // Define damaging spells to stop
    const isDamageCast = [
      "Flame Shock",
      "Lava Burst",
      "Chain Lightning",
      "Lightning Bolt"
    ].includes(currentCast.name);

    if (isDamageCast && (this.isHealingNeeded() || this.isEmergencyHealingNeeded())) {
      return true;
    }

    return false;
  }

  /**
   * Checks if healing is needed (ally health below 70%)
   */
  isHealingNeeded() {
    const lowestHealth = heal.getPriorityPVPHealTarget()?.effectiveHealthPercent;
    return lowestHealth < 85;
  }

  /**
   * Checks if emergency healing is needed (ally health below 40%)
   */
  isEmergencyHealingNeeded() {
    const lowestHealth = heal.getPriorityPVPHealTarget()?.effectiveHealthPercent;
    return me.inCombat() &&
      heal.getPriorityPVPHealTarget()?.inCombat() &&
      me.withinLineOfSight(heal.getPriorityPVPHealTarget()) &&
      lowestHealth <= 55;
  }

  /**
   * Ensures essential buffs are maintained
   */
  ensureBuffs() {
    return new bt.Selector(
      spell.cast('Skyfury', on => me, req => !me.hasAura('Skyfury')),
      spell.cast("Water Shield", on => me, ret => !me.hasAura(auras.waterShield)),
      spell.cast("Earthliving Weapon", on => me, req => !me.hasAura(auras.earthLivingWeapon)),
      spell.cast("Earth Shield", on => me, ret => !me.hasAura(auras.earthShieldMYAURA)),
    );
  }

  /**
   * Main healing rotation for PvP
   */
  healRotation() {
    return new bt.Selector(
      new bt.Action(() => {
        this.healTarget = heal.getPriorityPVPHealTarget();
        return bt.Status.Failure;
      }),
      spell.cast("Grounding Totem", on => me, ret => this.shouldDropGroundingForCCOnMe()),
      spell.cast("Astral Shift", on => me, ret => me.effectiveHealthPercent < Settings.AstralShiftPct),
      spell.cast("Nature's Swiftness", on => me, ret => this.healTarget?.effectiveHealthPercent < Settings.NaturesSwiftnessPct),
      spell.cast("Ascendance", on => me, ret => this.healTarget?.effectiveHealthPercent < Settings.AscendancePct),
      spell.cast("Spirit Link Totem", on => this.getBestSpiritLinkTarget(), ret => this.shouldCastSpiritLinkTotem()),
      spell.cast("Healing Wave", on => this.healTarget, ret => this.healTarget?.effectiveHealthPercent < 75 && (me.hasAura(auras.ancestralSwiftness) || me.hasAura(auras.naturesSwiftness))),
      spell.cast("Healing Surge", on => this.healTarget, ret => this.healTarget?.effectiveHealthPercent < 55 && me.hasAura(auras.spiritWalkersTidalTotem)),
      spell.cast("Riptide", on => this.healTarget, ret => this.healTarget?.effectiveHealthPercent < 55 && !this.healTarget?.hasAuraByMe(auras.riptide)),
      spell.cast("Healing Tide Totem", on => me, ret => this.healTarget?.effectiveHealthPercent < Settings.HealingTideTotemPct),
      spell.cast("Unleash Life", on => me, ret => this.healTarget?.effectiveHealthPercent < Settings.UnleashLifePct),
      spell.cast("Earthen Wall Totem", on => this.healTarget, ret => this.healTarget?.effectiveHealthPercent < Settings.EarthenWallTotemPct),
      spell.cast("Riptide", on => this.healTarget, ret => this.healTarget?.effectiveHealthPercent < Settings.RiptidePct && !this.healTarget?.hasAuraByMe(auras.riptide)),
      spell.dispel("Greater Purge", false, DispelPriority.High, true, WoWDispelType.Magic, ret => Settings.UsePurge),
      spell.cast("Earth Shield", on => this.shouldCastEarthShield(), ret => {
        const target = this.shouldCastEarthShield();
        return !!target;
      }),
      spell.cast("Healing Stream Totem", on => me, ret => spell.getTimeSinceLastCast("Healing Stream Totem") > 12000 && this.healTarget?.effectiveHealthPercent < 85),
      // spell.cast("Healing Rain", on => this.getBestHealingRainTarget(), ret => this.shouldCastHealingRain()),
      spell.dispel("Purify Spirit", true, DispelPriority.High, true, WoWDispelType.Magic),
      spell.dispel("Greater Purge", false, DispelPriority.Medium, true, WoWDispelType.Magic, ret => Settings.UsePurge),
      spell.cast("Healing Wave", on => this.healTarget, ret => this.healTarget?.effectiveHealthPercent > 25 && this.healTarget?.effectiveHealthPercent < Settings.HealingWavePct && me.hasAura(auras.tidalWaves) && this.noEnemiesWithinRange(20)),
      spell.cast("Healing Surge", on => this.healTarget, ret => this.healTarget?.effectiveHealthPercent < Settings.HealingSurgePct),
      spell.cast("Healing Surge", on => this.healTarget, ret => this.healTarget?.effectiveHealthPercent < 90),
    );
  }

  /**
   * Damage rotation for when healing is not needed
   */
  damageRotation() {
    return new bt.Selector(
      spell.dispel("Purify Spirit", true, DispelPriority.Medium, true, WoWDispelType.Magic),
      spell.dispel("Greater Purge", false, DispelPriority.Low, true, WoWDispelType.Magic, ret => Settings.UsePurge),
      // I removed this because I don't want to interrupt ccd mobs poly etc - once we know this - we can fix
      //spell.cast("Flame Shock", on => this.getFlameShockTarget(), ret => this.getFlameShockTarget() !== undefined),
      spell.cast("Flame Shock", on => me.targetUnit, ret => !(me.targetUnit?.hasAuraByMe(auras.flameShock))),
      spell.cast("Lava Burst", on => me.targetUnit, ret => me.hasAura(auras.lavaSurge) && me.targetUnit?.hasAuraByMe(auras.flameShock)),
      spell.cast("Chain Lightning", on => me.targetUnit, ret => me.targetUnit?.getUnitsAroundCount(10) > 1),
      spell.cast("Lava Burst", on => me.targetUnit, ret => me.targetUnit?.hasAuraByMe(auras.flameShock)),
      spell.cast("Lightning Bolt", on => me.targetUnit, ret => true)
    );
  }

  /**
   * Checks if no enemy players are within the specified range
   * @param {number} range - The range to check (in yards)
   * @returns {boolean} True if no enemies are within range, false otherwise
   */
  noEnemiesWithinRange(range) {
    return combat.targets.filter(unit => unit && unit.isPlayer() && unit.distanceTo(me) <= range).length === 0;
  }


  /**
   * Determines if Earth Shield should be cast on the priority PvP heal target
   * @returns {Object|null} The target to cast Earth Shield on, or null if conditions are not met
   */
  shouldCastEarthShield() {
    const target = heal.getPriorityPVPHealTarget();

    if (
      target &&
      target !== me &&
      target.isPlayer() &&
      target.effectiveHealthPercent < 75 &&
      !(target.hasAura(auras.earthShield)) &&
      spell.getTimeSinceLastCast("Earth Shield") >= 3500
    ) {
      return target;
    }
    return null;
  }


  /**
   * Determines if Grounding Totem should be cast to counter CC (e.g., Polymorph) targeting the shaman
   */
  shouldDropGroundingForCCOnMe() {
    const enemies = combat.targets.filter(unit => unit && unit.isPlayer());
    for (const enemy of enemies) {
      if (enemy.isCastingOrChanneling && enemy.isPlayer()) {
        const spellInfo = enemy.spellInfo;
        const target = spellInfo ? spellInfo.spellTargetGuid : null;
        if (spellInfo) {
          const onBlacklist = spellBlacklist[spellInfo.spellCastId];
          const castRemains = spellInfo.castEnd - wow.frameTime;
          if (target && target.equals(me.guid) && onBlacklist && castRemains < 1000) {
            return true;
          }
        }
      }
    }
    return false;
  }

  /**
   * Finds a target for Flame Shock (no or low-duration Flame Shock, players only)
   */
  getFlameShockTarget() {
    const target = me.targetUnit;
    if (target && target.isPlayer() && !target.hasAuraByMe(auras.flameShock) && me.canAttack(target) && me.withinLineOfSight(target)) {
      return target;
    }
    return combat.targets.find(unit =>
      unit && unit.isPlayer() &&
      (!unit.hasAuraByMe(auras.flameShock) || unit.getAuraByMe(auras.flameShock).remaining < 5400) &&
      me.canAttack(unit) && me.withinLineOfSight(unit)
    ) || null;
  }

  /**
   * Determines if Healing Rain should be cast
   */
  shouldCastHealingRain() {
    const target = this.getBestHealingRainTarget();
    if (!target) return false;
    const alliesNear = this.getAlliesInRange(target, 11); // Healing Rain radius
    const lowHealthAllies = alliesNear.filter(ally => ally.effectiveHealthPercent < Settings.HealingRainPct);
    return lowHealthAllies.length >= 2;
  }

  /**
   * Finds the best target for Healing Rain (max allies in range, players only)
   */
  getBestHealingRainTarget() {
    return heal.priorityList.reduce((best, current) => {
      if (!current || !current.isPlayer()) return best;
      const alliesNear = this.getAlliesInRange(current, 11);
      const lowHealthAllies = alliesNear.filter(ally => ally.effectiveHealthPercent < Settings.HealingRainPct);
      if (!best || lowHealthAllies.length > this.getAlliesInRange(best, 11).filter(ally => ally.effectiveHealthPercent < Settings.HealingRainPct).length) {
        return current;
      }
      return best;
    }, null);
  }

  /**
   * Determines if Spirit Link Totem should be cast
   */
  shouldCastSpiritLinkTotem() {
    const target = this.getBestSpiritLinkTarget();
    if (!target) return false;
    const alliesNear = this.getAlliesInRange(target, 12); // Spirit Link radius
    const lowHealthAllies = alliesNear.filter(ally => ally.effectiveHealthPercent < Settings.SpiritLinkTotemPct);
    return lowHealthAllies.length >= 1 && !me.hasAura(auras.ascendance);
  }

  /**
   * Finds the best target for Spirit Link Totem (players only)
   */
  getBestSpiritLinkTarget() {
    return heal.priorityList.reduce((best, current) => {
      if (!current || !current.isPlayer()) return best;
      const alliesNear = this.getAlliesInRange(current, 12);
      const lowHealthAllies = alliesNear.filter(ally => ally.effectiveHealthPercent < Settings.SpiritLinkTotemPct);
      if (!best || lowHealthAllies.length > this.getAlliesInRange(best, 12).filter(ally => ally.effectiveHealthPercent < Settings.SpiritLinkTotemPct).length) {
        return current;
      }
      return best;
    }, null);
  }

  /**
   * Gets allies within a specified range of a unit (players only)
   */
  getAlliesInRange(unit, range) {
    let allies = heal.priorityList.filter(ally => ally && ally.isPlayer() && ally.distanceTo(unit) <= range && me.withinLineOfSight(ally));
    if (!allies.some(ally => ally.guid.equals(me.guid)) && me.distanceTo(unit) <= range && me.isPlayer()) {
      allies.push(me);
    }
    return allies;
  }

  /**
   * Finds a valid target for Hex (enemy healer with specific conditions)
   */
  hexTarget() {
    // Get all enemy players
    const nearbyEnemies = me.getPlayerEnemies(30); // Hex has 30 yard range

    for (const unit of nearbyEnemies) {
      if (unit.isHealer() &&
          !unit.isCCd() &&
          unit.canCC() &&
          unit.getDR("incapacitate") === 0 &&
          heal.getPriorityPVPHealTarget()?.effectiveHealthPercent > 69) {
        return unit;
      }
    }

    return undefined;
  }

}
