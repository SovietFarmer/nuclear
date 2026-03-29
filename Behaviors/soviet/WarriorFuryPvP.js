import { Behavior, BehaviorContext } from "@/Core/Behavior";
import * as bt from "@/Core/BehaviorTree";
import Specialization from "@/Enums/Specialization";
import common from "@/Core/Common";
import spell from "@/Core/Spell";
import { me } from "@/Core/ObjectManager";
import { PowerType } from "@/Enums/PowerType";
import { defaultCombatTargeting as Combat } from "@/Targeting/CombatTargeting";
import { pvpHelpers } from "@/Data/PVPData";
import drTracker from "@/Core/DRTracker";
import { RaceType } from "@/Enums/UnitEnums";
import Settings from "@/Core/Settings";

const auras = {
  battleShout: 6673,
  enrage: 184362,
  whirlwind: 85739,
  thunderBlast: 435615,
  suddenDeath: 52437,
};

/**
 * Fury PvP-only. CC/utility matches JmrSimcFury `buildPVPAlwaysPerform` + burst/sustained priorities.
 * Interrupt: only `spell.interrupt("Pummel", true)` — no custom findPummelTarget / pvpHelpers kick list.
 */
export class WarriorFuryPvP extends Behavior {
  name = "Warrior (Fury) PvP";
  context = BehaviorContext.Any;
  specialization = Specialization.Warrior.Fury;

  static settings = [
    {
      header: "PvP",
      options: [
        { type: "slider", uid: "DefensiveStanceHealthPct", text: "Defensive Stance Health %", min: 20, max: 80, default: 50 },
        { type: "checkbox", uid: "UseBerserkerShout", text: "Use Berserker Shout for Healer", default: true },
        { type: "checkbox", uid: "UseHamstring", text: "Use Hamstring for Movement Control", default: true }
      ]
    },
    {
      header: "Defensive Abilities",
      options: [
        { type: "checkbox", uid: "UseRallyingCry", text: "Use Rallying Cry", default: true },
        { type: "slider", uid: "RallyingCryHealthPct", text: "Rallying Cry Health %", min: 10, max: 50, default: 30 },
        { type: "checkbox", uid: "UseVictoryRush", text: "Use Victory Rush", default: true },
        { type: "slider", uid: "VictoryRushHealthPct", text: "Victory Rush Health %", min: 30, max: 90, default: 70 },
        { type: "checkbox", uid: "UseEnragedRegeneration", text: "Use Enraged Regeneration", default: true },
        { type: "slider", uid: "EnragedRegenerationHealthPct", text: "Enraged Regeneration Health %", min: 30, max: 80, default: 60 },
        { type: "checkbox", uid: "UseBloodthirstHealing", text: "Use Bloodthirst for Healing", default: true },
        { type: "slider", uid: "BloodthirstHealingHealthPct", text: "Bloodthirst Healing Health %", min: 40, max: 90, default: 70 }
      ]
    },
    {
      header: "Major Cooldowns",
      options: [
        { type: "checkbox", uid: "UseRecklessness", text: "Use Recklessness", default: true },
        { type: "checkbox", uid: "UseAvatar", text: "Use Avatar", default: true }
      ]
    },
    {
      header: "Racials",
      options: [
        { type: "checkbox", uid: "BurstIncludeBloodFury", text: "Include Blood Fury in Burst", default: true }
      ]
    }
  ];

  build() {
    return new bt.Selector(
      common.waitForNotSitting(),
      common.waitForNotMounted(),
      common.waitForCastOrChannel(),
      common.waitForTarget(),
      common.waitForFacing(),
      spell.interrupt("Pummel", true),
      new bt.Decorator(
        ret => !spell.isGlobalCooldown(),
        new bt.Selector(
          common.waitForNotWaitingForArenaToStart(),
          common.waitForCombat(),
          this.pvpAlwaysPerform(),
          new bt.Decorator(
            ret => this.hasCooldownsReady(),
            this.burstRotation()
          ),
          this.sustainedDamage()
        )
      )
    );
  }

  /**
   * Same order as Jmr `buildPVPAlwaysPerform`: shout → stance → shatter → reflect → hamstring → defensives →
   * opportunistic CC (non-burst) → berserker shout → piercing howl. Interrupt is off-GCD above.
   */
  pvpAlwaysPerform() {
    return new bt.Selector(
      spell.cast("Battle Shout", () => this.shouldCastBattleShoutPVP()),
      spell.cast("Defensive Stance", () => me.pctHealth < Settings.DefensiveStanceHealthPct && !me.hasAura("Defensive Stance")),
      spell.cast("Berserker Stance", () => me.pctHealth >= Settings.DefensiveStanceHealthPct && !me.hasAura("Berserker Stance")),
      spell.cast("Shattering Throw", on => this.findShatteringThrowTarget(), ret => this.findShatteringThrowTarget() !== null),
      spell.cast(23920, () => this.shouldSpellReflectPVP()),
      spell.cast("Hamstring", () => this.shouldHamstringCast()),
      this.pvpDefensives(),
      new bt.Decorator(
        ret => !this.shouldUseBurstAbility(),
        new bt.Selector(
          spell.cast(236077, on => this.findDisarmTarget(), ret => this.findDisarmTarget() !== null),
          spell.cast("Shockwave", on => this.findShockwaveUtilityTarget(), ret => spell.isSpellKnown("Shockwave") && this.findShockwaveUtilityTarget() !== null),
          spell.cast("Storm Bolt", on => this.findStormBoltCCTarget(), ret => this.findStormBoltCCTarget() !== null),
          spell.cast("Intimidating Shout", on => this.findIntimidatingShoutTarget(), ret => this.findIntimidatingShoutTarget() !== null)
        ),
        new bt.Action(() => bt.Status.Success)
      ),
      spell.cast("Berserker Shout", () => Settings.UseBerserkerShout && this.shouldUseBerserkerShout()),
      spell.cast("Piercing Howl", () => this.shouldCastPiercingHowl()),
      new bt.Action(() => bt.Status.Failure)
    );
  }

  /** Mirrors Jmr `buildPVPDefensives` (self Battle Shout + optional defensives). */
  pvpDefensives() {
    return new bt.Selector(
      spell.cast("Battle Shout", () => !me.hasAura(auras.battleShout)),
      spell.cast("Rallying Cry", () =>
        Settings.UseRallyingCry &&
        me.pctHealth < Settings.RallyingCryHealthPct
      ),
      spell.cast("Victory Rush", () =>
        Settings.UseVictoryRush &&
        me.effectiveHealthPercent < Settings.VictoryRushHealthPct
      ),
      spell.cast("Enraged Regeneration", () =>
        Settings.UseEnragedRegeneration &&
        me.pctHealth < Settings.EnragedRegenerationHealthPct
      ),
      spell.cast("Bloodthirst", () =>
        Settings.UseBloodthirstHealing &&
        me.pctHealth < Settings.BloodthirstHealingHealthPct &&
        me.hasAura("Enraged Regeneration")
      ),
      new bt.Action(() => bt.Status.Failure)
    );
  }

  burstRotation() {
    return new bt.Selector(
      this.useRacials(),
      spell.cast("Storm Bolt", on => this.findHealerForStunCC(), ret => this.findHealerForStunCC() !== null),
      spell.cast("Storm Bolt", on => this.getCurrentTargetPVP(), ret => this.shouldStormBoltCurrentTarget() && this.shouldUseBurstAbility()),
      spell.cast("Shockwave", on => this.findShockwaveBurstTarget(), ret => spell.isSpellKnown("Shockwave") && this.findShockwaveBurstTarget() !== null),
      spell.cast("Recklessness", ret => Settings.UseRecklessness && this.shouldUseBurstAbility()),
      spell.cast("Avatar", ret => Settings.UseAvatar && spell.isSpellKnown("Avatar") && this.shouldUseBurstAbility()),
      spell.cast("Bladestorm", on => this.getCurrentTargetPVP()),
      spell.cast("Champion's Spear", on => this.getCurrentTargetPVP(), ret => this.shouldUseChampionsSpear() && this.shouldUseBurstAbility()),
      spell.cast("Odyn's Fury", on => this.getCurrentTargetPVP(), ret => spell.isSpellKnown("Odyn's Fury") && this.shouldUseOdynsFury() && this.shouldUseBurstAbility()),
      spell.cast("Rampage", on => this.getCurrentTargetPVP(), ret => !me.hasAura(auras.enrage) || me.powerByType(PowerType.Rage) >= 110),
      spell.cast("Thunder Blast", on => this.getCurrentTargetPVP(), ret => this.hasTalent("Lightning Strikes") && me.hasAura(auras.thunderBlast)),
      spell.cast("Thunder Clap", on => this.getCurrentTargetPVP(), ret => this.hasTalent("Lightning Strikes") && me.hasAura(auras.thunderBlast)),
      spell.cast("Execute", on => this.getCurrentTargetPVP(), ret => me.hasAura(auras.suddenDeath)),
      spell.cast("Rampage", on => this.getCurrentTargetPVP()),
      spell.cast("Raging Blow", on => this.getCurrentTargetPVP()),
      spell.cast("Bloodthirst", on => this.getCurrentTargetPVP()),
      spell.cast("Thunder Clap", on => this.getCurrentTargetPVP(), ret => this.hasTalent("Lightning Strikes")),
      spell.cast("Whirlwind", on => this.getCurrentTargetPVP()),
      this.sustainedDamage()
    );
  }

  sustainedDamage() {
    return new bt.Selector(
      spell.cast("Rampage", on => this.getCurrentTargetPVP(), ret => !me.hasAura(auras.enrage) || me.powerByType(PowerType.Rage) >= 110),
      spell.cast("Thunder Blast", on => this.getCurrentTargetPVP(), ret => this.hasTalent("Lightning Strikes") && me.hasAura(auras.thunderBlast)),
      spell.cast("Thunder Clap", on => this.getCurrentTargetPVP(), ret => this.hasTalent("Lightning Strikes") && me.hasAura(auras.thunderBlast)),
      spell.cast("Execute", on => this.getCurrentTargetPVP(), ret => me.hasAura(auras.suddenDeath)),
      spell.cast("Execute", on => this.getCurrentTargetPVP(), ret => this.getCurrentTargetPVP()?.getAuraStacks("Marked for Execution") === 3),
      spell.cast("Rampage", on => this.getCurrentTargetPVP()),
      spell.cast("Raging Blow", on => this.getCurrentTargetPVP()),
      spell.cast("Bloodthirst", on => this.getCurrentTargetPVP()),
      spell.cast("Thunder Clap", on => this.getCurrentTargetPVP(), ret => this.hasTalent("Lightning Strikes")),
      spell.cast("Whirlwind", on => this.getCurrentTargetPVP())
    );
  }

  useRacials() {
    return new bt.Selector(
      spell.cast("Blood Fury", on => me, ret =>
        me.race === RaceType.Orc && (!Settings.BurstIncludeBloodFury || this.shouldUseBurstAbility())
      )
    );
  }

  shouldUseBurstAbility() {
    return Combat.burstToggle;
  }

  shouldUseChampionsSpear() {
    if (!this.shouldUseBurstAbility()) return false;
    return !me.hasAura("Smothering Shadows");
  }

  shouldUseOdynsFury() {
    if (!this.shouldUseBurstAbility()) return false;
    return !me.hasAura("Smothering Shadows");
  }

  hasCooldownsReady() {
    return Combat.burstToggle && me.target && me.isWithinMeleeRange(me.target) && (
      (Settings.UseRecklessness && !spell.isOnCooldown("Recklessness")) ||
      (Settings.UseAvatar && spell.isSpellKnown("Avatar") && !spell.isOnCooldown("Avatar"))
    );
  }

  hasTalent(name) {
    return me.hasAura(name);
  }

  getCurrentTargetPVP() {
    const targetPredicate = unit => common.validTarget(unit) && me.isWithinMeleeRange(unit) && me.isFacing(unit) && !pvpHelpers.hasImmunity(unit);
    const target = me.target;
    if (target !== null && targetPredicate(target)) {
      return target;
    }
    return Combat.targets.find(targetPredicate) || null;
  }

  shouldCastBattleShoutPVP() {
    const friends = me.getFriends();
    for (const friend of friends) {
      if (!friend.deadOrGhost && !friend.hasAura(auras.battleShout)) {
        return true;
      }
    }
    return false;
  }

  shouldSpellReflectPVP() {
    const enemies = me.getEnemies();
    for (const enemy of enemies) {
      if (enemy.isCastingOrChanneling && enemy.isPlayer()) {
        const spellInfo = enemy.spellInfo;
        const target = spellInfo ? spellInfo.spellTargetGuid : null;
        if (enemy.spellInfo && target && target.equals(me.guid)) {
          const spellId = enemy.spellInfo.spellCastId;
          if (pvpHelpers.shouldReflectSpell(spellId)) {
            const castRemains = enemy.spellInfo.castEnd - wow.frameTime;
            return castRemains < 1000;
          }
        }
      }
    }
    return false;
  }

  shouldHamstringCast() {
    if (!Settings.UseHamstring) return false;

    const target = this.getCurrentTargetPVP();
    if (!target) return false;

    if (target.hasAura(1715) || target.hasAura(12323)) return false;
    if (pvpHelpers.hasImmunity(target)) return false;
    if (target.hasAura(1044)) return false;

    const lastSuccessfulTime = spell._lastSuccessfulCastTimes.get("hamstring");
    const now = wow.frameTime;
    const timeSinceSuccess = lastSuccessfulTime ? now - lastSuccessfulTime : 999999;

    if (lastSuccessfulTime && timeSinceSuccess < 12000) {
      return false;
    }

    return true;
  }

  findDisarmTarget() {
    const enemies = me.getEnemies();
    for (const enemy of enemies) {
      if (enemy.isPlayer() &&
          me.isWithinMeleeRange(enemy) &&
          this.isMeleeClass(enemy) &&
          this.hasMajorCooldowns(enemy) &&
          drTracker.getDRStacks(enemy.guid, "disarm") < 2 &&
          !pvpHelpers.hasImmunity(enemy) &&
          !enemy.isCCd()) {
        return enemy;
      }
    }
    return null;
  }

  findStormBoltCCTarget() {
    const enemies = me.getEnemies();
    for (const enemy of enemies) {
      if (enemy.isPlayer() &&
          me.distanceTo(enemy) > 7 &&
          me.distanceTo(enemy) <= 30 &&
          this.isCasterClass(enemy) &&
          this.hasMajorCooldowns(enemy) &&
          drTracker.getDRStacks(enemy.guid, "stun") < 2 &&
          !pvpHelpers.hasImmunity(enemy) &&
          !enemy.isCCd()) {
        return enemy;
      }
    }
    return null;
  }

  isShockwaveEligibleTarget(enemy) {
    return enemy &&
      enemy.isPlayer() &&
      me.distanceTo(enemy) <= 10 &&
      me.isFacing(enemy) &&
      enemy.canCC() &&
      drTracker.getDRStacks(enemy.guid, "stun") < 2 &&
      !pvpHelpers.hasImmunity(enemy) &&
      !enemy.isCCd();
  }

  findShockwaveBurstTarget() {
    const killTarget = this.getCurrentTargetPVP();
    if (this.isShockwaveEligibleTarget(killTarget)) {
      return killTarget;
    }

    const enemies = me.getEnemies();
    const eligible = enemies.filter(enemy => this.isShockwaveEligibleTarget(enemy));
    return eligible.length >= 2 ? eligible[0] : null;
  }

  findShockwaveUtilityTarget() {
    const enemies = me.getEnemies();
    const eligible = enemies.filter(enemy => this.isShockwaveEligibleTarget(enemy));
    if (eligible.length === 0) return null;

    const majorCooldownTarget = eligible.find(enemy => this.hasMajorCooldowns(enemy));
    if (majorCooldownTarget) return majorCooldownTarget;

    return eligible.length >= 2 ? eligible[0] : null;
  }

  findIntimidatingShoutTarget() {
    const enemies = me.getEnemies();

    const eligibleEnemies = enemies.filter(enemy =>
      enemy.isPlayer() &&
      me.distanceTo(enemy) <= 8 &&
      drTracker.getDRStacks(enemy.guid, "disorient") < 2 &&
      !pvpHelpers.hasImmunity(enemy) &&
      !enemy.isCCd()
    );

    if (eligibleEnemies.length < 2) {
      return null;
    }

    const priorityTarget = eligibleEnemies.find(enemy => this.hasMajorCooldowns(enemy));
    return priorityTarget || eligibleEnemies[0];
  }

  findHealerForStunCC() {
    const enemies = me.getEnemies();
    for (const enemy of enemies) {
      if (enemy.isPlayer() &&
          enemy.isHealer() &&
          me.distanceTo(enemy) <= 30 &&
          drTracker.getDRStacks(enemy.guid, "stun") < 2 &&
          !pvpHelpers.hasImmunity(enemy)) {
        return enemy;
      }
    }
    return null;
  }

  shouldStormBoltCurrentTarget() {
    const target = this.getCurrentTargetPVP();
    if (!target || !target.isPlayer()) return false;

    const healer = this.findHealerForStunCC();
    const healerHasStunDR = healer && drTracker.getDRStacks(healer.guid, "stun") >= 2;
    const targetIsNotHealer = !target.isHealer();

    return healerHasStunDR && targetIsNotHealer && drTracker.getDRStacks(target.guid, "stun") < 2;
  }

  shouldUseBerserkerShout() {
    if (!this.hasTalent("Berserker Shout")) return false;

    const friends = me.getFriends();
    for (const friend of friends) {
      if (friend.isHealer() &&
          me.distanceTo(friend) <= 12 &&
          drTracker.isCCdByCategory(friend.guid, "disorient")) {
        return true;
      }
    }
    return false;
  }

  isMeleeClass(unit) {
    if (!unit.isPlayer()) return false;
    const meleePowerTypes = [1, 2, 3, 4, 5, 6, 12, 17, 18, 19];
    return meleePowerTypes.includes(unit.powerType);
  }

  isCasterClass(unit) {
    if (!unit.isPlayer()) return false;
    return unit.powerType === 0;
  }

  hasMajorCooldowns(unit) {
    if (!unit.isPlayer()) return false;
    const majorDamageCooldown = pvpHelpers.hasMajorDamageCooldown(unit, 3);
    const disarmableBuff = pvpHelpers.hasDisarmableBuff(unit, false, 3);
    return majorDamageCooldown !== null || disarmableBuff !== null;
  }

  shouldCastPiercingHowl() {
    const enemies = me.getEnemies();
    const enemiesInRange = enemies.filter(enemy =>
      enemy.isPlayer() &&
      me.distanceTo(enemy) <= 12 &&
      !pvpHelpers.hasImmunity(enemy) &&
      !enemy.hasAura(1044)
    );

    return enemiesInRange.length >= 2;
  }

  findShatteringThrowTarget() {
    const enemies = me.getEnemies();
    for (const enemy of enemies) {
      if (enemy.isPlayer() && me.distanceTo(enemy) <= 30) {
        const hasIceBlock = enemy.hasAura(45438);
        const hasDivineShield = enemy.hasAura(642);

        if (hasIceBlock || hasDivineShield) {
          return enemy;
        }
      }
    }
    return null;
  }
}
